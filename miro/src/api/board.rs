use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Board {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "createdAt")]
    pub created_at: String,
    #[serde(default, rename = "modifiedAt")]
    pub modified_at: String,
    #[serde(default, rename = "viewLink")]
    pub view_link: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct BoardListResponse {
    #[serde(default)]
    pub data: Vec<Board>,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub offset: u64,
}

#[derive(Serialize, Debug)]
pub struct CreateBoardRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Serialize, Debug, Default)]
pub struct UpdateBoardRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}
