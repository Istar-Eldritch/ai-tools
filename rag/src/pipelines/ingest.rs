use std::collections::HashMap;

use bytes::Bytes;
use pgvector::Vector;
use sha2::{Digest, Sha256};
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
    storage: Option<S3Storage>,
    chunk_config: ChunkConfig,
    embedding: EmbeddingService,
}

impl IngestPipeline {
    pub fn new(
        pool: PgPool,
        storage: Option<S3Storage>,
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

    pub fn chunk_config(&self) -> &ChunkConfig {
        &self.chunk_config
    }

    pub fn storage(&self) -> Option<&S3Storage> {
        self.storage.as_ref()
    }

    pub async fn ingest(
        &self,
        content: &str,
        filename: &str,
        content_type: &str,
        metadata: serde_json::Value,
        project: Option<String>,
        owner_user_id: Option<Uuid>,
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
            project,
            owner_user_id,
        };
        let source = queries::insert_source(&self.pool, &new_source).await?;

        if let Some(ref storage) = self.storage {
            let data = Bytes::from(content.to_owned().into_bytes());
            if let Err(e) = storage.put_object(&s3_key, data, content_type).await {
                self.cleanup(source_id).await;
                return Err(e);
            }
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

    pub async fn update_in_place(
        &self,
        old_source: &Source,
        content: &str,
        content_type: &str,
        metadata: serde_json::Value,
        project: Option<String>,
    ) -> AppResult<Source> {
        let _ = project; // metadata/project already recorded on source row

        if content.trim().is_empty() {
            return Err(AppError::Validation("content must not be empty".into()));
        }

        // 1. Re-chunk the content
        let chunk_triples: Vec<(usize, String, serde_json::Value)> =
            if let Some(lang) = detect_language(&old_source.filename) {
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

        // 2. Fetch existing chunks
        let old_chunks = queries::get_chunks_by_source(&self.pool, old_source.id).await?;

        // 3. Build hash -> embedding map from old chunks
        let mut old_embeddings: HashMap<String, Vector> = HashMap::new();
        for chunk in &old_chunks {
            let hash = format!("{:x}", Sha256::digest(chunk.content.as_bytes()));
            old_embeddings.entry(hash).or_insert_with(|| chunk.embedding.clone());
        }

        // 4. Partition new chunks: reuse existing embeddings vs need embedding
        let mut reuse_indices: Vec<usize> = Vec::new();
        let mut embed_indices: Vec<usize> = Vec::new();
        let mut new_hashes: Vec<String> = Vec::with_capacity(chunk_triples.len());

        for (i, (_, text, _)) in chunk_triples.iter().enumerate() {
            let hash = format!("{:x}", Sha256::digest(text.as_bytes()));
            if old_embeddings.contains_key(&hash) {
                reuse_indices.push(i);
            } else {
                embed_indices.push(i);
            }
            new_hashes.push(hash);
        }

        // 5. Embed only the new/changed chunks
        let texts_to_embed: Vec<String> = embed_indices
            .iter()
            .map(|&i| chunk_triples[i].1.clone())
            .collect();

        let fresh_vectors: Vec<Vector> = if texts_to_embed.is_empty() {
            Vec::new()
        } else {
            let svc = self.embedding.clone();
            let join_result = tokio::task::spawn_blocking(move || {
                let refs: Vec<&str> = texts_to_embed.iter().map(String::as_str).collect();
                svc.embed_batch(&refs)
            })
            .await;

            match join_result {
                Err(e) => {
                    return Err(AppError::Internal(format!("embedding task panicked: {e}")));
                }
                Ok(Err(e)) => {
                    return Err(e);
                }
                Ok(Ok(v)) => v,
            }
        };

        // 6. Merge: assign vectors from reuse map or fresh batch
        let mut fresh_iter = fresh_vectors.into_iter();
        let source_id = old_source.id;
        let new_chunks: Vec<NewChunk> = chunk_triples
            .into_iter()
            .enumerate()
            .map(|(i, (index, text, meta))| {
                let embedding = if old_embeddings.contains_key(&new_hashes[i]) {
                    old_embeddings.get(&new_hashes[i]).unwrap().clone()
                } else {
                    fresh_iter.next().expect("fresh vector count mismatch")
                };
                NewChunk {
                    id: Uuid::new_v4(),
                    source_id,
                    chunk_index: index as i32,
                    content: text,
                    embedding,
                    metadata: meta,
                }
            })
            .collect();

        // 7. S3: overwrite content under existing key
        if let Some(ref storage) = self.storage {
            let data = Bytes::from(content.to_owned().into_bytes());
            storage
                .put_object(&old_source.s3_key, data, content_type)
                .await?;
        }

        // 8. DB: update source metadata + replace chunks
        let updated_source =
            queries::update_source_metadata(&self.pool, source_id, &metadata, content_type)
                .await?;
        queries::replace_chunks(&self.pool, source_id, &new_chunks).await?;

        // 9. Return updated source
        Ok(updated_source)
    }

    async fn cleanup(&self, source_id: Uuid) {
        if let Err(e) = queries::delete_source(&self.pool, source_id).await {
            tracing::warn!(
                source_id = %source_id,
                error = %e,
                "cleanup: failed to delete source row"
            );
        }
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.delete_object(&source_id.to_string()).await {
                tracing::warn!(
                    source_id = %source_id,
                    error = %e,
                    "cleanup: failed to delete S3 object"
                );
            }
        }
    }
}
