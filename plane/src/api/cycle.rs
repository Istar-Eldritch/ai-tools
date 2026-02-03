use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Cycle {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    pub project: String,
    pub workspace: String,
    pub owned_by: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct CycleListResponse {
    pub results: Vec<Cycle>,
}

#[derive(Serialize, Debug)]
pub struct CreateCycleRequest {
    pub name: String,
    pub project_id: String,
    pub owned_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
}

#[derive(Serialize, Debug, Default)]
pub struct UpdateCycleRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<f64>,
}

#[derive(Serialize, Debug)]
pub struct AddCycleWorkItemRequest {
    pub issues: Vec<String>,
}
