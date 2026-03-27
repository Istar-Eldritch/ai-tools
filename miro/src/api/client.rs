use super::{
    board::{Board, BoardListResponse, CreateBoardRequest, UpdateBoardRequest},
    connector::{
        Connector, ConnectorListResponse, CreateConnectorRequest, UpdateConnectorRequest,
    },
    item::{CreateItemRequest, Item, ItemListResponse, UpdateItemRequest},
    tag::{AttachTagRequest, CreateTagRequest, Tag, TagListResponse, UpdateTagRequest},
};
use crate::{
    config::CliConfig,
    error::{AppError, AppResult},
};
use reqwest::{header, Client as ReqwestClient, Response, Url};
use secrecy::ExposeSecret;

const API_BASE_URL: &str = "https://api.miro.com/";

pub struct Client {
    client: ReqwestClient,
    base_url: Url,
}

async fn handle_response<T: serde::de::DeserializeOwned + Default>(
    response: Response,
) -> AppResult<T> {
    if response.status().is_success() {
        let text = response.text().await?;
        if text.is_empty() {
            return Ok(T::default());
        }
        serde_json::from_str(&text).map_err(AppError::from)
    } else {
        let error_message = response.text().await?;
        Err(AppError::General(error_message))
    }
}

impl Client {
    pub fn new(config: &CliConfig) -> AppResult<Self> {
        let mut headers = header::HeaderMap::new();
        if let Some(token) = &config.access_token {
            headers.insert(
                header::AUTHORIZATION,
                header::HeaderValue::from_str(&format!("Bearer {}", token.expose_secret()))?,
            );
        } else {
            return Err(AppError::General(
                "Access token not found. Please run `miro-cli setup` to configure it.".to_string(),
            ));
        }

        let client = ReqwestClient::builder()
            .default_headers(headers)
            .build()?;

        let base_url = config.api_base_url.as_deref().unwrap_or(API_BASE_URL);
        let base_url = Url::parse(base_url)?;

        Ok(Client { client, base_url })
    }

    // Board operations

    pub async fn list_boards(&self) -> AppResult<BoardListResponse> {
        let url = self.base_url.join("/v2/boards")?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn get_board(&self, board_id: &str) -> AppResult<Board> {
        let url = self.base_url.join(&format!("/v2/boards/{}", board_id))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_board(&self, req: &CreateBoardRequest) -> AppResult<Board> {
        let url = self.base_url.join("/v2/boards")?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_board(&self, board_id: &str, req: &UpdateBoardRequest) -> AppResult<Board> {
        let url = self.base_url.join(&format!("/v2/boards/{}", board_id))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_board(&self, board_id: &str) -> AppResult<()> {
        let url = self.base_url.join(&format!("/v2/boards/{}", board_id))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn copy_board(&self, board_id: &str) -> AppResult<Board> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/copy", board_id))?;
        let response = self.client.put(url).send().await?;
        handle_response(response).await
    }

    // Item operations

    pub async fn list_items(&self, board_id: &str) -> AppResult<ItemListResponse> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/items", board_id))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    /// List all items on a board by querying each type-specific endpoint with pagination.
    /// Uses v2-experimental API which returns full data for all items, including those
    /// the standard v2 API marks as `isSupported: false`.
    pub async fn list_all_items(&self, board_id: &str) -> AppResult<Vec<Item>> {
        let type_paths = ["shapes", "sticky_notes", "texts", "cards", "frames", "images"];
        let mut all_items = Vec::new();

        for type_path in &type_paths {
            let mut cursor: Option<String> = None;
            loop {
                let mut url = self.base_url.join(&format!(
                    "/v2-experimental/boards/{}/{}",
                    board_id, type_path
                ))?;
                url.query_pairs_mut().append_pair("limit", "50");
                if let Some(ref c) = cursor {
                    url.query_pairs_mut().append_pair("cursor", c);
                }

                let response = self.client.get(url).send().await?;
                if !response.status().is_success() {
                    // Fall back to v2 if experimental fails for this type
                    let mut url = self.base_url.join(&format!(
                        "/v2/boards/{}/{}",
                        board_id, type_path
                    ))?;
                    url.query_pairs_mut().append_pair("limit", "50");
                    if let Some(ref c) = cursor {
                        url.query_pairs_mut().append_pair("cursor", c);
                    }
                    let response = self.client.get(url).send().await?;
                    let page: ItemListResponse = handle_response(response).await?;
                    all_items.extend(page.data);
                    if page.cursor.is_some() {
                        cursor = page.cursor;
                    } else {
                        break;
                    }
                    continue;
                }
                let page: ItemListResponse = handle_response(response).await?;
                let has_more = page.cursor.is_some();
                cursor = page.cursor;
                all_items.extend(page.data);

                if !has_more {
                    break;
                }
            }
        }

        Ok(all_items)
    }

    pub async fn get_item(&self, board_id: &str, item_id: &str) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/items/{}", board_id, item_id))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    /// Get an item using the v2-experimental type-specific endpoint, which supports
    /// items that the standard v2 API marks as `isSupported: false`.
    /// Falls back to the generic /items/{id} endpoint for unknown types.
    pub async fn get_item_by_type(
        &self,
        board_id: &str,
        item_id: &str,
        item_type: &str,
    ) -> AppResult<Item> {
        let type_path = match item_type {
            "shape" => "shapes",
            "sticky_note" => "sticky_notes",
            "text" => "texts",
            "card" => "cards",
            "frame" => "frames",
            "image" => "images",
            _ => "items",
        };
        // Try v2-experimental first (supports all items including "unsupported" ones),
        // fall back to v2 if experimental fails
        let exp_url = self.base_url.join(&format!(
            "/v2-experimental/boards/{}/{}/{}",
            board_id, type_path, item_id
        ))?;
        let response = self.client.get(exp_url).send().await?;
        if response.status().is_success() {
            return handle_response(response).await;
        }
        let url = self.base_url.join(&format!(
            "/v2/boards/{}/{}/{}",
            board_id, type_path, item_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_sticky_note(
        &self,
        board_id: &str,
        req: &CreateItemRequest,
    ) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/sticky_notes", board_id))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn create_shape(&self, board_id: &str, req: &CreateItemRequest) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/shapes", board_id))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn create_text(&self, board_id: &str, req: &CreateItemRequest) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/texts", board_id))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn create_card(&self, board_id: &str, req: &CreateItemRequest) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/cards", board_id))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn create_frame(&self, board_id: &str, req: &CreateItemRequest) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/frames", board_id))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_item(
        &self,
        board_id: &str,
        item_id: &str,
        req: &UpdateItemRequest,
    ) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/items/{}", board_id, item_id))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_item(&self, board_id: &str, item_id: &str) -> AppResult<()> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/items/{}", board_id, item_id))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    // Connector operations

    pub async fn list_connectors(&self, board_id: &str) -> AppResult<ConnectorListResponse> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/connectors", board_id))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn get_connector(
        &self,
        board_id: &str,
        connector_id: &str,
    ) -> AppResult<Connector> {
        let url = self.base_url.join(&format!(
            "/v2/boards/{}/connectors/{}",
            board_id, connector_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_connector(
        &self,
        board_id: &str,
        req: &CreateConnectorRequest,
    ) -> AppResult<Connector> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/connectors", board_id))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_connector(
        &self,
        board_id: &str,
        connector_id: &str,
        req: &UpdateConnectorRequest,
    ) -> AppResult<Connector> {
        let url = self.base_url.join(&format!(
            "/v2/boards/{}/connectors/{}",
            board_id, connector_id
        ))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_connector(
        &self,
        board_id: &str,
        connector_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/v2/boards/{}/connectors/{}",
            board_id, connector_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    // Tag operations

    pub async fn list_tags(&self, board_id: &str) -> AppResult<TagListResponse> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/tags", board_id))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn get_tag(&self, board_id: &str, tag_id: &str) -> AppResult<Tag> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/tags/{}", board_id, tag_id))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_tag(&self, board_id: &str, req: &CreateTagRequest) -> AppResult<Tag> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/tags", board_id))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_tag(
        &self,
        board_id: &str,
        tag_id: &str,
        req: &UpdateTagRequest,
    ) -> AppResult<Tag> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/tags/{}", board_id, tag_id))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_tag(&self, board_id: &str, tag_id: &str) -> AppResult<()> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/tags/{}", board_id, tag_id))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn attach_tag(
        &self,
        board_id: &str,
        item_id: &str,
        req: &AttachTagRequest,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/v2/boards/{}/items/{}/tags",
            board_id, item_id
        ))?;
        let response = self.client.post(url).json(req).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn detach_tag(
        &self,
        board_id: &str,
        item_id: &str,
        tag_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/v2/boards/{}/items/{}/tags/{}",
            board_id, item_id, tag_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }
}
