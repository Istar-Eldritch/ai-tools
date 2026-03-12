use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Connector {
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "startItem")]
    pub start_item: Option<ConnectorEndpoint>,
    #[serde(default, rename = "endItem")]
    pub end_item: Option<ConnectorEndpoint>,
    #[serde(default)]
    pub shape: Option<String>,
    #[serde(default)]
    pub style: Option<Value>,
    #[serde(default, rename = "createdAt")]
    pub created_at: String,
    #[serde(default, rename = "modifiedAt")]
    pub modified_at: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct ConnectorEndpoint {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub position: Option<RelativePosition>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct RelativePosition {
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct ConnectorListResponse {
    #[serde(default)]
    pub data: Vec<Connector>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct CreateConnectorRequest {
    #[serde(rename = "startItem")]
    pub start_item: ConnectorEndpoint,
    #[serde(rename = "endItem")]
    pub end_item: ConnectorEndpoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
}

#[derive(Serialize, Debug, Default)]
pub struct UpdateConnectorRequest {
    #[serde(skip_serializing_if = "Option::is_none", rename = "startItem")]
    pub start_item: Option<ConnectorEndpoint>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "endItem")]
    pub end_item: Option<ConnectorEndpoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
}
