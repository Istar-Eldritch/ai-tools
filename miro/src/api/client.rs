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

    pub async fn get_item(&self, board_id: &str, item_id: &str) -> AppResult<Item> {
        let url = self
            .base_url
            .join(&format!("/v2/boards/{}/items/{}", board_id, item_id))?;
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
