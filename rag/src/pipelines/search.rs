use sqlx::PgPool;

use crate::db::models::SearchResult;
use crate::db::queries;
use crate::embedding::EmbeddingService;
use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct SearchPipeline {
    pool: PgPool,
    embedding: EmbeddingService,
}

impl SearchPipeline {
    pub fn new(pool: PgPool, embedding: EmbeddingService) -> Self {
        Self { pool, embedding }
    }

    pub async fn search(&self, query: &str, k: i64) -> AppResult<Vec<SearchResult>> {
        if query.trim().is_empty() {
            return Err(AppError::Validation("query must not be empty".into()));
        }
        if !(1..=100).contains(&k) {
            return Err(AppError::Validation("k must be between 1 and 100".into()));
        }

        let svc = self.embedding.clone();
        let query_owned = query.to_owned();
        let query_vector = tokio::task::spawn_blocking(move || svc.embed_one(&query_owned))
            .await
            .map_err(|e| AppError::Internal(format!("embedding task panicked: {e}")))?
            ?;

        let results = queries::search_chunks(&self.pool, &query_vector, k).await?;

        Ok(results)
    }
}
