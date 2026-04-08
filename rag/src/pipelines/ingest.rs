use bytes::Bytes;
use sqlx::PgPool;
use uuid::Uuid;

use crate::chunking::{chunk_code, chunk_markdown, chunk_text, detect_language, ChunkConfig};
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
            project: None,
        };
        let source = queries::insert_source(&self.pool, &new_source).await?;

        let data = Bytes::from(content.to_owned().into_bytes());
        if let Err(e) = self.storage.put_object(&s3_key, data, content_type).await {
            self.cleanup(source_id).await;
            return Err(e);
        }

        // Collect (index, content, metadata) triples from either code or text chunking.
        let chunk_triples: Vec<(usize, String, serde_json::Value)> =
            if let Some(lang) = detect_language(filename) {
                chunk_code(content, lang, &self.chunk_config)
                    .into_iter()
                    .map(|c| {
                        let meta = serde_json::json!({
                            "start_line": c.start_line,
                            "end_line": c.end_line,
                            "node_type": c.node_type,
                            "context": c.context,
                        });
                        (c.index, c.content, meta)
                    })
                    .collect()
            } else {
                let text_chunks = if content_type.to_lowercase().contains("markdown") {
                    chunk_markdown(content, &self.chunk_config)
                } else {
                    chunk_text(content, &self.chunk_config)
                };
                text_chunks
                    .into_iter()
                    .map(|c| {
                        (
                            c.index,
                            c.content,
                            serde_json::Value::Object(Default::default()),
                        )
                    })
                    .collect()
            };

        let svc = self.embedding.clone();
        let texts: Vec<String> = chunk_triples.iter().map(|(_, c, _)| c.clone()).collect();
        let join_result = tokio::task::spawn_blocking(move || {
            let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
            svc.embed_batch(&refs)
        })
        .await;

        let vectors: Vec<pgvector::Vector> = match join_result {
            Err(e) => {
                self.cleanup(source_id).await;
                return Err(AppError::Internal(format!("embedding task panicked: {e}")));
            }
            Ok(Err(e)) => {
                self.cleanup(source_id).await;
                return Err(e);
            }
            Ok(Ok(v)) => v,
        };

        let new_chunks: Vec<NewChunk> = chunk_triples
            .into_iter()
            .zip(vectors.into_iter())
            .map(|((index, content, metadata), embedding)| NewChunk {
                id: Uuid::new_v4(),
                source_id,
                chunk_index: index as i32,
                content,
                embedding,
                metadata,
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
