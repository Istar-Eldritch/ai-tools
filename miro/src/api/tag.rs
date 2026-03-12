use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Tag {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, rename = "fillColor")]
    pub fill_color: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct TagListResponse {
    #[serde(default)]
    pub data: Vec<Tag>,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub offset: u64,
}

#[derive(Serialize, Debug)]
pub struct CreateTagRequest {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fillColor")]
    pub fill_color: Option<String>,
}

#[derive(Serialize, Debug, Default)]
pub struct UpdateTagRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fillColor")]
    pub fill_color: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct AttachTagRequest {
    pub id: String,
}
