use chrono::{DateTime, Utc};
use pgvector::Vector;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Source {
    pub id: Uuid,
    pub s3_key: String,
    pub filename: String,
    pub content_type: String,
    pub metadata: serde_json::Value,
    pub project: Option<String>,
    pub created_at: DateTime<Utc>,
    pub owner_user_id: Option<Uuid>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Chunk {
    pub id: Uuid,
    pub source_id: Uuid,
    pub chunk_index: i32,
    pub content: String,
    #[serde(skip)]
    pub embedding: Vector,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct SearchResult {
    pub chunk_id: Uuid,
    pub source_id: Uuid,
    pub chunk_index: i32,
    pub content: String,
    #[serde(skip)]
    pub embedding: Vector,
    pub source_filename: String,
    pub source_metadata: serde_json::Value,
    pub chunk_metadata: serde_json::Value,
    pub similarity: f64,
    pub source_project: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct SourceSummary {
    pub id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub project: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub chunk_count: i64,
}

#[derive(Debug, Clone)]
pub struct NewSource {
    pub id: Uuid,
    pub s3_key: String,
    pub filename: String,
    pub content_type: String,
    pub metadata: serde_json::Value,
    pub project: Option<String>,
    pub owner_user_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct NewChunk {
    pub id: Uuid,
    pub source_id: Uuid,
    pub chunk_index: i32,
    pub content: String,
    pub embedding: Vector,
    pub metadata: serde_json::Value,
    pub source_type: String,
}

// -- Auth / ACL models --

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub google_sub: String,
    pub email: String,
    pub display_name: String,
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: Uuid,
    pub user_id: Uuid,
    pub key_hash: String,
    pub label: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct UserProjectAccess {
    pub user_id: Uuid,
    pub project_id: Uuid,
    pub role: String,
    pub granted_at: DateTime<Utc>,
}
