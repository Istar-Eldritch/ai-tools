use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
pub struct EmptyObject {}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum SearchWorkItemResponse {
    Results(Vec<WorkItemResponseData>),
    NoResults(EmptyObject),
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct WorkItemListResponse {
    pub results: Vec<WorkItemResponseData>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct WorkItemResponseData {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Debug)]
pub struct CreateWorkItemRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignees: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimate_point: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub issue_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct CreateWorkItemResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Debug, Default)]
pub struct UpdateWorkItemRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignees: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimate_point: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub issue_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct UpdateWorkItemResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct GetWorkItemResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
