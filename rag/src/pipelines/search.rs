use sqlx::PgPool;

use crate::db::models::SearchResult;
use crate::db::queries::{self, glob_to_like};
use crate::embedding::EmbeddingService;
use crate::error::{AppError, AppResult};

/// Optional filters applied to the `sources` table during vector search.
/// All fields are `None` by default (no filtering).
#[derive(Debug, Default, Clone)]
pub struct SearchFilter {
    /// Glob pattern matched against `sources.filename` (case-sensitive).
    /// Supports `*` (any sequence) and `?` (single character).
    pub filename_glob: Option<String>,
    /// JSONB containment filter matched against `sources.metadata`.
    /// Must be a JSON object if `Some`. A source matches if its metadata
    /// contains every key/value pair in this value.
    pub source_metadata: Option<serde_json::Value>,
}

#[derive(Clone)]
pub struct SearchPipeline {
    pool: PgPool,
    embedding: EmbeddingService,
}

impl SearchPipeline {
    pub fn new(pool: PgPool, embedding: EmbeddingService) -> Self {
        Self { pool, embedding }
    }

    pub async fn search(
        &self,
        query: &str,
        k: i64,
        filters: SearchFilter,
    ) -> AppResult<Vec<SearchResult>> {
        if query.trim().is_empty() {
            return Err(AppError::Validation("query must not be empty".into()));
        }
        if !(1..=100).contains(&k) {
            return Err(AppError::Validation("k must be between 1 and 100".into()));
        }

        // Validate source_metadata is a JSON object if provided
        if let Some(ref v) = filters.source_metadata {
            if !v.is_object() {
                return Err(AppError::Validation(
                    "source_metadata filter must be a JSON object".into(),
                ));
            }
        }

        // Translate glob to SQL LIKE pattern
        let filename_like: Option<String> =
            filters.filename_glob.as_deref().map(glob_to_like);

        let svc = self.embedding.clone();
        let query_owned = query.to_owned();
        let query_vector = tokio::task::spawn_blocking(move || svc.embed_one(&query_owned))
            .await
            .map_err(|e| AppError::Internal(format!("embedding task panicked: {e}")))?
            ?;

        let results = queries::search_chunks(
            &self.pool,
            &query_vector,
            k,
            filename_like.as_deref(),
            filters.source_metadata.as_ref(),
        )
        .await?;

        Ok(results)
    }
}
