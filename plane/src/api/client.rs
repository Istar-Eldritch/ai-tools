use super::{
    cycle::{
        AddCycleWorkItemRequest, CreateCycleRequest, Cycle, CycleListResponse, UpdateCycleRequest,
    },
    label::{CreateLabelRequest, Label, LabelListResponse, UpdateLabelRequest},
    link::{CreateLinkRequest, Link, LinkListResponse, UpdateLinkRequest},
    module::{
        AddModuleWorkItemsRequest, CreateModuleRequest, Module, ModuleListResponse,
        UpdateModuleRequest,
    },
    project::{CreateProjectRequest, Project, ProjectListResponse, UpdateProjectRequest},
    state::{CreateStatePayload, State, StateListResponse},
    user::User,
    work_item::{
        CreateWorkItemRequest, CreateWorkItemResponse, GetWorkItemResponse,
        SearchWorkItemResponse, SearchWorkItemResult, UpdateWorkItemRequest,
        UpdateWorkItemResponse, WorkItemListResponse,
    },
};
use crate::{
    config::CliConfig,
    error::{AppError, AppResult},
};
use reqwest::{header, Client as ReqwestClient, Response, Url};
use secrecy::ExposeSecret;

const API_BASE_URL: &str = "https://api.plane.so/";

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
        if let Some(api_key) = &config.api_key {
            headers.insert(
                "X-API-Key",
                header::HeaderValue::from_str(api_key.expose_secret())?,
            );
        } else {
            return Err(AppError::General(
                "API key not found. Please run `plane-cli setup` to configure it.".to_string(),
            ));
        }

        let client = ReqwestClient::builder().default_headers(headers).build()?;

        let base_url = config.api_base_url.as_deref().unwrap_or(API_BASE_URL);
        let base_url = Url::parse(base_url)?;

        Ok(Client { client, base_url })
    }

    pub async fn get_work_items(
        &self,
        workspace_slug: &str,
        project_id: &str,
    ) -> AppResult<WorkItemListResponse> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/",
            workspace_slug, project_id
        ))?;

        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_work_item(
        &self,
        workspace_slug: &str,
        project_id: &str,
        req: &CreateWorkItemRequest,
    ) -> AppResult<CreateWorkItemResponse> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/",
            workspace_slug, project_id
        ))?;

        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_work_item(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
        req: &UpdateWorkItemRequest,
    ) -> AppResult<UpdateWorkItemResponse> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/",
            workspace_slug, project_id, work_item_id
        ))?;

        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn search_work_items(
        &self,
        workspace_slug: &str,
        search: &str,
        project: Option<&str>,
    ) -> AppResult<Vec<SearchWorkItemResult>> {
        let mut url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/work-items/search/",
            workspace_slug
        ))?;

        url.query_pairs_mut().append_pair("search", search);

        if let Some(project_id) = project {
            url.query_pairs_mut().append_pair("project", project_id);
        }

        let response = self.client.get(url).send().await?;

        if response.status().is_success() {
            let search_response = response.json::<SearchWorkItemResponse>().await?;
            Ok(search_response.issues)
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn get_work_item(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
    ) -> AppResult<GetWorkItemResponse> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/",
            workspace_slug, project_id, work_item_id
        ))?;

        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn get_work_item_by_identifier(
        &self,
        workspace_slug: &str,
        identifier: &str,
    ) -> AppResult<GetWorkItemResponse> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/work-items/{}/",
            workspace_slug, identifier
        ))?;

        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn delete_work_item(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/",
            workspace_slug, project_id, work_item_id
        ))?;

        let response = self.client.delete(url).send().await?;

        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn create_state(
        &self,
        workspace_slug: &str,
        project_id: &str,
        name: &str,
        color: &str,
    ) -> AppResult<State> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/states/",
            workspace_slug, project_id
        ))?;
        let payload = CreateStatePayload { name, color };
        let response = self.client.post(url).json(&payload).send().await?;
        handle_response(response).await
    }

    pub async fn delete_state(
        &self,
        workspace_slug: &str,
        project_id: &str,
        state_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/states/{}/",
            workspace_slug, project_id, state_id
        ))?;
        let response = self.client.delete(url).send().await?;

        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn list_states(
        &self,
        workspace_slug: &str,
        project_id: &str,
    ) -> AppResult<Vec<State>> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/states/",
            workspace_slug, project_id
        ))?;
        let response = self.client.get(url).send().await?;
        let list_response: StateListResponse = handle_response(response).await?;
        Ok(list_response.results)
    }

    pub async fn list_projects(&self, workspace_slug: &str) -> AppResult<Vec<Project>> {
        let url = self
            .base_url
            .join(&format!("/api/v1/workspaces/{}/projects/", workspace_slug))?;
        let response = self.client.get(url).send().await?;
        let list_response: ProjectListResponse = handle_response(response).await?;
        Ok(list_response.results)
    }

    pub async fn get_project(&self, workspace_slug: &str, project_id: &str) -> AppResult<Project> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/",
            workspace_slug, project_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_project(
        &self,
        workspace_slug: &str,
        req: &CreateProjectRequest,
    ) -> AppResult<Project> {
        let url = self
            .base_url
            .join(&format!("/api/v1/workspaces/{}/projects/", workspace_slug))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_project(
        &self,
        workspace_slug: &str,
        project_id: &str,
        req: &UpdateProjectRequest,
    ) -> AppResult<Project> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/",
            workspace_slug, project_id
        ))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_project(&self, workspace_slug: &str, project_id: &str) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/",
            workspace_slug, project_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn list_cycles(
        &self,
        workspace_slug: &str,
        project_id: &str,
    ) -> AppResult<Vec<Cycle>> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/",
            workspace_slug, project_id
        ))?;
        let response = self.client.get(url).send().await?;
        let list_response: CycleListResponse = handle_response(response).await?;
        Ok(list_response.results)
    }

    pub async fn get_cycle(
        &self,
        workspace_slug: &str,
        project_id: &str,
        cycle_id: &str,
    ) -> AppResult<Cycle> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/{}/",
            workspace_slug, project_id, cycle_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_cycle(
        &self,
        workspace_slug: &str,
        project_id: &str,
        req: &CreateCycleRequest,
    ) -> AppResult<Cycle> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/",
            workspace_slug, project_id
        ))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_cycle(
        &self,
        workspace_slug: &str,
        project_id: &str,
        cycle_id: &str,
        req: &UpdateCycleRequest,
    ) -> AppResult<Cycle> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/{}/",
            workspace_slug, project_id, cycle_id
        ))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_cycle(
        &self,
        workspace_slug: &str,
        project_id: &str,
        cycle_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/{}/",
            workspace_slug, project_id, cycle_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn list_cycle_work_items(
        &self,
        workspace_slug: &str,
        project_id: &str,
        cycle_id: &str,
    ) -> AppResult<WorkItemListResponse> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/{}/cycle-issues/",
            workspace_slug, project_id, cycle_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn add_cycle_work_items(
        &self,
        workspace_slug: &str,
        project_id: &str,
        cycle_id: &str,
        req: &AddCycleWorkItemRequest,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/{}/cycle-issues/",
            workspace_slug, project_id, cycle_id
        ))?;
        let response = self.client.post(url).json(req).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn remove_cycle_work_item(
        &self,
        workspace_slug: &str,
        project_id: &str,
        cycle_id: &str,
        work_item_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/cycles/{}/cycle-issues/{}/",
            workspace_slug, project_id, cycle_id, work_item_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn list_modules(
        &self,
        workspace_slug: &str,
        project_id: &str,
    ) -> AppResult<Vec<Module>> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/",
            workspace_slug, project_id
        ))?;
        let response = self.client.get(url).send().await?;
        let list_response: ModuleListResponse = handle_response(response).await?;
        Ok(list_response.results)
    }

    pub async fn get_module(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
    ) -> AppResult<Module> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/",
            workspace_slug, project_id, module_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_module(
        &self,
        workspace_slug: &str,
        project_id: &str,
        req: &CreateModuleRequest,
    ) -> AppResult<Module> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/",
            workspace_slug, project_id
        ))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_module(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
        req: &UpdateModuleRequest,
    ) -> AppResult<Module> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/",
            workspace_slug, project_id, module_id
        ))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_module(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/",
            workspace_slug, project_id, module_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn archive_module(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/archive/",
            workspace_slug, project_id, module_id
        ))?;
        let response = self.client.post(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn unarchive_module(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/unarchive/",
            workspace_slug, project_id, module_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn list_archived_modules(
        &self,
        workspace_slug: &str,
        project_id: &str,
    ) -> AppResult<Vec<Module>> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/archived/",
            workspace_slug, project_id
        ))?;
        let response = self.client.get(url).send().await?;
        let list_response: ModuleListResponse = handle_response(response).await?;
        Ok(list_response.results)
    }

    pub async fn list_module_work_items(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
    ) -> AppResult<WorkItemListResponse> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/module-issues/",
            workspace_slug, project_id, module_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn add_module_work_items(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
        req: &AddModuleWorkItemsRequest,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/module-issues/",
            workspace_slug, project_id, module_id
        ))?;
        let response = self.client.post(url).json(req).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn remove_module_work_item(
        &self,
        workspace_slug: &str,
        project_id: &str,
        module_id: &str,
        work_item_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/modules/{}/module-issues/{}/",
            workspace_slug, project_id, module_id, work_item_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn list_labels(
        &self,
        workspace_slug: &str,
        project_id: &str,
    ) -> AppResult<Vec<Label>> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/labels/",
            workspace_slug, project_id
        ))?;
        let response = self.client.get(url).send().await?;
        let list_response: LabelListResponse = handle_response(response).await?;
        Ok(list_response.results)
    }

    pub async fn get_label(
        &self,
        workspace_slug: &str,
        project_id: &str,
        label_id: &str,
    ) -> AppResult<Label> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/labels/{}/",
            workspace_slug, project_id, label_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_label(
        &self,
        workspace_slug: &str,
        project_id: &str,
        req: &CreateLabelRequest,
    ) -> AppResult<Label> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/labels/",
            workspace_slug, project_id
        ))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_label(
        &self,
        workspace_slug: &str,
        project_id: &str,
        label_id: &str,
        req: &UpdateLabelRequest,
    ) -> AppResult<Label> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/labels/{}/",
            workspace_slug, project_id, label_id
        ))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_label(
        &self,
        workspace_slug: &str,
        project_id: &str,
        label_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/labels/{}/",
            workspace_slug, project_id, label_id
        ))?;
        let response = self.client.delete(url).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            let error_message = response.text().await?;
            Err(AppError::General(error_message))
        }
    }

    pub async fn get_current_user(&self) -> AppResult<User> {
        let url = self.base_url.join("/api/v1/users/me/")?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn list_links(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
    ) -> AppResult<Vec<Link>> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/links/",
            workspace_slug, project_id, work_item_id
        ))?;
        let response = self.client.get(url).send().await?;
        let list_response: LinkListResponse = handle_response(response).await?;
        Ok(list_response.results)
    }

    pub async fn get_link(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
        link_id: &str,
    ) -> AppResult<Link> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/links/{}/",
            workspace_slug, project_id, work_item_id, link_id
        ))?;
        let response = self.client.get(url).send().await?;
        handle_response(response).await
    }

    pub async fn create_link(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
        req: &CreateLinkRequest,
    ) -> AppResult<Link> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/links/",
            workspace_slug, project_id, work_item_id
        ))?;
        let response = self.client.post(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn update_link(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
        link_id: &str,
        req: &UpdateLinkRequest,
    ) -> AppResult<Link> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/links/{}/",
            workspace_slug, project_id, work_item_id, link_id
        ))?;
        let response = self.client.patch(url).json(req).send().await?;
        handle_response(response).await
    }

    pub async fn delete_link(
        &self,
        workspace_slug: &str,
        project_id: &str,
        work_item_id: &str,
        link_id: &str,
    ) -> AppResult<()> {
        let url = self.base_url.join(&format!(
            "/api/v1/workspaces/{}/projects/{}/work-items/{}/links/{}/",
            workspace_slug, project_id, work_item_id, link_id
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
