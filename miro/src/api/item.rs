use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Item {
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "type")]
    pub item_type: String,
    #[serde(default)]
    pub position: Option<Position>,
    #[serde(default)]
    pub geometry: Option<Geometry>,
    #[serde(default)]
    pub data: Option<Value>,
    #[serde(default, rename = "createdAt")]
    pub created_at: String,
    #[serde(default, rename = "modifiedAt")]
    pub modified_at: String,
    #[serde(default, rename = "createdBy")]
    pub created_by: Option<Value>,
    #[serde(default, rename = "modifiedBy")]
    pub modified_by: Option<Value>,
    #[serde(default)]
    pub parent: Option<Value>,
    #[serde(default, rename = "isSupported")]
    pub is_supported: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Position {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Geometry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct ItemListResponse {
    #[serde(default)]
    pub data: Vec<Item>,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Serialize, Debug, Default)]
pub struct CreateItemRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geometry: Option<Geometry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<Value>,
}

#[derive(Serialize, Debug, Default)]
pub struct UpdateItemRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geometry: Option<Geometry>,
}
