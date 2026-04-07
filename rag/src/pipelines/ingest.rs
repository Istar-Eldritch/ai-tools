use bytes::Bytes;
use sqlx::PgPool;
use uuid::Uuid;

use crate::chunking::{chunk_markdown, chunk_text, ChunkConfig};
use crate::db::models::{NewChunk, NewSource, Source};
use crate::db::queries;
use crate::embedding::EmbeddingService;
use crate::error::{AppError, AppResult};
use crate::storage::S3Storage;

#[derive(Clone)]
pub struct IngestPipeline {
    pool: PgPool,
    storage: S3Storage,
    chunk_config: ChunkConfig,
    embedding: EmbeddingService,
}

impl IngestPipeline {
    pub fn new(
        pool: PgPool,
        storage: S3Storage,
        chunk_config: ChunkConfig,
        embedding: EmbeddingService,
    ) -> Self {
        Self {
            pool,
            storage,
            chunk_config,
            embedding,
        }
    }

    pub async fn ingest(
        &self,
        content: &str,
        filename: &str,
        content_type: &str,
        metadata: serde_json::Value,
    ) -> AppResult<Source> {
        if content.trim().is_empty() {
            return Err(AppError::Validation("content must not be empty".into()));
        }

        let source_id = Uuid::new_v4();
        let s3_key = source_id.to_string();

        let new_source = NewSource {
            id: source_id,
            s3_key: s3_key.clone(),
            filename: filename.to_owned(),
            content_type: content_type.to_owned(),
            metadata,
        };
        let source = queries::insert_source(&self.pool, &new_source).await?;

        let data = Bytes::from(content.to_owned().into_bytes());
        if let Err(e) = self.storage.put_object(&s3_key, data, content_type).await {
            self.cleanup(source_id).await;
            return Err(e);
        }

        let chunks = if content_type.to_lowercase().contains("markdown") {
            chunk_markdown(content, &self.chunk_config)
        } else {
            chunk_text(content, &self.chunk_config)
        };

        let svc = self.embedding.clone();
        let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let vectors = tokio::task::spawn_blocking(move || {
            let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
            svc.embed_batch(&refs)
        })
        .await
        .map_err(|e| AppError::Internal(format!("embedding task panicked: {e}")))?;

        let vectors: Vec<pgvector::Vector> = match vectors {
            Ok(v) => v,
            Err(e) => {
                self.cleanup(source_id).await;
                return Err(e);
            }
        };

        let new_chunks: Vec<NewChunk> = chunks
            .iter()
            .zip(vectors.into_iter())
            .map(|(chunk, embedding)| NewChunk {
                id: Uuid::new_v4(),
                source_id,
                chunk_index: chunk.index as i32,
                content: chunk.content.clone(),
                embedding,
            })
            .collect();

        if let Err(e) = queries::insert_chunks(&self.pool, &new_chunks).await {
            self.cleanup(source_id).await;
            return Err(e);
        }

        Ok(source)
    }

    async fn cleanup(&self, source_id: Uuid) {
        if let Err(e) = queries::delete_source(&self.pool, source_id).await {
            tracing::warn!(
                source_id = %source_id,
                error = %e,
                "cleanup: failed to delete source row"
            );
        }
        if let Err(e) = self.storage.delete_object(&source_id.to_string()).await {
            tracing::warn!(
                source_id = %source_id,
                error = %e,
                "cleanup: failed to delete S3 object"
            );
        }
    }
}
