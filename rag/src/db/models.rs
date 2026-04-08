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

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
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
}

#[derive(Debug, Clone)]
pub struct NewChunk {
    pub id: Uuid,
    pub source_id: Uuid,
    pub chunk_index: i32,
    pub content: String,
    pub embedding: Vector,
    pub metadata: serde_json::Value,
}
