use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
pub struct SearchWorkItemResponse {
    #[serde(default)]
    pub issues: Vec<SearchWorkItemResult>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SearchWorkItemResult {
    pub id: String,
    pub name: String,
    pub sequence_id: u64,
    #[serde(rename = "project__identifier")]
    pub project_identifier: Option<String>,
    pub project_id: String,
    #[serde(rename = "workspace__slug")]
    pub workspace_slug: Option<String>,
    pub type_id: Option<String>,
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
    pub description_html: Option<String>,
    pub description_stripped: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<serde_json::Value>>,
    pub assignees: Option<Vec<serde_json::Value>>,
    pub sequence_id: Option<u64>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub completed_at: Option<String>,
    pub is_draft: Option<bool>,
    pub estimate_point: Option<String>,
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
    pub description_html: Option<String>,
    pub description_stripped: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<serde_json::Value>>,
    pub assignees: Option<Vec<serde_json::Value>>,
    pub sequence_id: Option<u64>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub completed_at: Option<String>,
    pub is_draft: Option<bool>,
    pub estimate_point: Option<String>,
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
    pub description_html: Option<String>,
    pub description_stripped: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<serde_json::Value>>,
    pub assignees: Option<Vec<serde_json::Value>>,
    pub sequence_id: Option<u64>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub completed_at: Option<String>,
    pub is_draft: Option<bool>,
    pub estimate_point: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct GetWorkItemResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub description_html: Option<String>,
    pub description_stripped: Option<String>,
    pub state: String,
    pub project: String,
    pub parent: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<serde_json::Value>>,
    pub assignees: Option<Vec<serde_json::Value>>,
    pub sequence_id: Option<u64>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub completed_at: Option<String>,
    pub is_draft: Option<bool>,
    pub estimate_point: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
