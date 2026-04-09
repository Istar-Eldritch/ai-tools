use std::sync::Arc;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use pgvector::Vector;

use crate::error::{AppError, AppResult};

/// Service for generating text embeddings using local ONNX models via fastembed.
#[derive(Clone)]
pub struct EmbeddingService {
    model: Arc<TextEmbedding>,
}

impl EmbeddingService {
    /// Create a new EmbeddingService for the given model name.
    ///
    /// Supported model names:
    /// - `"all-minilm-l6-v2"` / `"AllMiniLML6V2"`
    /// - `"nomic-embed-text-v1.5"` / `"NomicEmbedTextV15"`
    /// - `"bge-small-en-v1.5"` / `"BGESmallENV15"` (default in fastembed)
    /// - `"bge-base-en-v1.5"` / `"BGEBaseENV15"`
    /// - `"bge-large-en-v1.5"` / `"BGELargeENV15"`
    pub fn new(model_name: &str) -> AppResult<Self> {
        let embedding_model = map_model_name(model_name)?;
        let options = InitOptions::new(embedding_model).with_show_download_progress(true);
        let model = TextEmbedding::try_new(options)
            .map_err(|e| AppError::Embedding(format!("Failed to load model: {e}")))?;
        Ok(Self {
            model: Arc::new(model),
        })
    }

    /// Generate embeddings for a batch of texts.
    ///
    /// Returns one `pgvector::Vector` per input text.
    pub fn embed_batch(&self, texts: &[&str]) -> AppResult<Vec<Vector>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let texts_vec: Vec<&str> = texts.to_vec();
        let embeddings = self
            .model
            .embed(texts_vec, None)
            .map_err(|e| AppError::Embedding(format!("Batch embedding failed: {e}")))?;
        Ok(embeddings.into_iter().map(Vector::from).collect())
    }

    /// Generate an embedding for a single text.
    pub fn embed_one(&self, text: &str) -> AppResult<Vector> {
        let mut results = self.embed_batch(&[text])?;
        results
            .pop()
            .ok_or_else(|| AppError::Embedding("No embedding returned".into()))
    }
}

/// Map a human-friendly model name string to a fastembed `EmbeddingModel` enum variant.
fn map_model_name(name: &str) -> AppResult<EmbeddingModel> {
    match name {
        "all-minilm-l6-v2" | "AllMiniLML6V2" => Ok(EmbeddingModel::AllMiniLML6V2),
        "all-minilm-l12-v2" | "AllMiniLML12V2" => Ok(EmbeddingModel::AllMiniLML12V2),
        "nomic-embed-text-v1" | "NomicEmbedTextV1" => Ok(EmbeddingModel::NomicEmbedTextV1),
        "nomic-embed-text-v1.5" | "NomicEmbedTextV15" => Ok(EmbeddingModel::NomicEmbedTextV15),
        "nomic-embed-text-v1.5q" | "NomicEmbedTextV15Q" => Ok(EmbeddingModel::NomicEmbedTextV15Q),
        "bge-small-en-v1.5" | "BGESmallENV15" => Ok(EmbeddingModel::BGESmallENV15),
        "bge-base-en-v1.5" | "BGEBaseENV15" => Ok(EmbeddingModel::BGEBaseENV15),
        "bge-large-en-v1.5" | "BGELargeENV15" => Ok(EmbeddingModel::BGELargeENV15),
        "mxbai-embed-large-v1" | "MxbaiEmbedLargeV1" => Ok(EmbeddingModel::MxbaiEmbedLargeV1),
        _ => Err(AppError::Embedding(format!(
            "Unknown embedding model: '{name}'"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_model_name_known_models() {
        // kebab-case names
        assert_eq!(
            map_model_name("all-minilm-l6-v2").unwrap(),
            EmbeddingModel::AllMiniLML6V2
        );
        assert_eq!(
            map_model_name("nomic-embed-text-v1.5").unwrap(),
            EmbeddingModel::NomicEmbedTextV15
        );
        assert_eq!(
            map_model_name("bge-small-en-v1.5").unwrap(),
            EmbeddingModel::BGESmallENV15
        );
        assert_eq!(
            map_model_name("bge-base-en-v1.5").unwrap(),
            EmbeddingModel::BGEBaseENV15
        );
        assert_eq!(
            map_model_name("bge-large-en-v1.5").unwrap(),
            EmbeddingModel::BGELargeENV15
        );
        assert_eq!(
            map_model_name("mxbai-embed-large-v1").unwrap(),
            EmbeddingModel::MxbaiEmbedLargeV1
        );

        // PascalCase names
        assert_eq!(
            map_model_name("AllMiniLML6V2").unwrap(),
            EmbeddingModel::AllMiniLML6V2
        );
        assert_eq!(
            map_model_name("NomicEmbedTextV15").unwrap(),
            EmbeddingModel::NomicEmbedTextV15
        );
        assert_eq!(
            map_model_name("BGESmallENV15").unwrap(),
            EmbeddingModel::BGESmallENV15
        );
    }

    #[test]
    fn test_map_model_name_unknown_model() {
        let result = map_model_name("nonexistent-model");
        assert!(result.is_err());
        let err = result.unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("Unknown embedding model"),
            "Expected 'Unknown embedding model' in: {msg}"
        );
        assert!(
            msg.contains("nonexistent-model"),
            "Expected model name in error: {msg}"
        );
    }

    #[test]
    fn test_app_error_embedding_display() {
        let err = AppError::Embedding("test failure".into());
        assert_eq!(err.to_string(), "Embedding error: test failure");
    }

    #[test]
    #[ignore] // Requires model download
    fn test_embed_one_produces_vector() {
        let service = EmbeddingService::new("all-minilm-l6-v2").unwrap();
        let vector = service.embed_one("Hello, world!").unwrap();
        // all-minilm-l6-v2 produces 384-dimensional embeddings
        assert_eq!(vector.as_slice().len(), 384);
    }

    #[test]
    #[ignore] // Requires model download
    fn test_embed_batch_produces_correct_count() {
        let service = EmbeddingService::new("all-minilm-l6-v2").unwrap();
        let texts = &["First text", "Second text", "Third text"];
        let vectors = service.embed_batch(texts).unwrap();
        assert_eq!(vectors.len(), 3);
        for v in &vectors {
            assert_eq!(v.as_slice().len(), 384);
        }
    }

    #[test]
    #[ignore] // Requires model download
    fn test_embed_batch_empty_input() {
        let service = EmbeddingService::new("all-minilm-l6-v2").unwrap();
        let vectors = service.embed_batch(&[]).unwrap();
        assert!(vectors.is_empty());
    }
}
