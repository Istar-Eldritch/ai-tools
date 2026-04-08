use pgvector::Vector;
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
    /// Filter results to a specific project.
    pub project: Option<String>,
}

#[derive(Clone)]
pub struct SearchPipeline {
    pool: PgPool,
    embedding: EmbeddingService,
    dedup_threshold: f64,
    dedup_candidate_factor: i64,
}

impl SearchPipeline {
    pub fn new(
        pool: PgPool,
        embedding: EmbeddingService,
        dedup_threshold: f64,
        dedup_candidate_factor: i64,
    ) -> Self {
        Self {
            pool,
            embedding,
            dedup_threshold,
            dedup_candidate_factor,
        }
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

        // Fetch extra candidates to allow for dedup filtering
        let fetch_k = k.saturating_mul(self.dedup_candidate_factor).min(100);
        let candidates = queries::search_chunks(
            &self.pool,
            &query_vector,
            fetch_k,
            filename_like.as_deref(),
            filters.source_metadata.as_ref(),
            filters.project.as_deref(),
        )
        .await?;

        // Greedy dedup: keep a candidate only if its cosine similarity to
        // every already-accepted result is at most the threshold.
        let results = dedup_results(candidates, k as usize, self.dedup_threshold);

        Ok(results)
    }
}

/// Greedy deduplication: iterate candidates (already sorted by descending
/// similarity to the query) and accept each one only if its cosine similarity
/// to every previously accepted result is at most `threshold`.
fn dedup_results(
    candidates: Vec<SearchResult>,
    k: usize,
    threshold: f64,
) -> Vec<SearchResult> {
    // threshold == 1.0 means all candidates pass (no dedup)
    if threshold >= 1.0 {
        return candidates.into_iter().take(k).collect();
    }

    let mut accepted: Vec<SearchResult> = Vec::with_capacity(k);

    for candidate in candidates {
        if accepted.len() >= k {
            break;
        }
        let dominated = accepted.iter().any(|kept| {
            cosine_similarity(&candidate.embedding, &kept.embedding) >= threshold
        });
        if !dominated {
            accepted.push(candidate);
        }
    }

    accepted
}

/// Compute cosine similarity between two pgvector vectors.
/// Returns a value in [-1, 1] for unit vectors; 0 for zero-length vectors.
fn cosine_similarity(a: &Vector, b: &Vector) -> f64 {
    let a_slice = a.as_slice();
    let b_slice = b.as_slice();
    if a_slice.len() != b_slice.len() || a_slice.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;
    for (ai, bi) in a_slice.iter().zip(b_slice.iter()) {
        let a = *ai as f64;
        let b = *bi as f64;
        dot += a * b;
        norm_a += a * a;
        norm_b += b * b;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pgvector::Vector;

    fn make_result(embedding: Vec<f32>, content: &str) -> SearchResult {
        SearchResult {
            chunk_id: uuid::Uuid::new_v4(),
            source_id: uuid::Uuid::new_v4(),
            chunk_index: 0,
            content: content.to_string(),
            embedding: Vector::from(embedding),
            source_filename: "test.txt".to_string(),
            source_metadata: serde_json::json!({}),
            chunk_metadata: serde_json::json!({}),
            similarity: 0.9,
            source_project: None,
        }
    }

    #[test]
    fn dedup_threshold_1_0_passes_all() {
        let candidates = vec![
            make_result(vec![1.0, 0.0, 0.0], "a"),
            make_result(vec![1.0, 0.0, 0.0], "b"), // identical embedding
            make_result(vec![0.0, 1.0, 0.0], "c"),
        ];
        let results = dedup_results(candidates, 5, 1.0);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn dedup_removes_near_identical() {
        let candidates = vec![
            make_result(vec![1.0, 0.0, 0.0], "a"),
            make_result(vec![1.0, 0.001, 0.0], "b"), // very similar to a
            make_result(vec![0.0, 1.0, 0.0], "c"),   // different
        ];
        let results = dedup_results(candidates, 5, 0.97);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].content, "a");
        assert_eq!(results[1].content, "c");
    }

    #[test]
    fn dedup_threshold_0_keeps_only_first() {
        let candidates = vec![
            make_result(vec![1.0, 0.0, 0.0], "a"),
            make_result(vec![0.0, 1.0, 0.0], "b"),
            make_result(vec![0.0, 0.0, 1.0], "c"),
        ];
        let results = dedup_results(candidates, 5, 0.0);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "a");
    }

    #[test]
    fn dedup_respects_k_limit() {
        let candidates = vec![
            make_result(vec![1.0, 0.0, 0.0], "a"),
            make_result(vec![0.0, 1.0, 0.0], "b"),
            make_result(vec![0.0, 0.0, 1.0], "c"),
        ];
        let results = dedup_results(candidates, 2, 1.0);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn cosine_similarity_identical_vectors() {
        let a = Vector::from(vec![1.0f32, 0.0, 0.0]);
        let b = Vector::from(vec![1.0f32, 0.0, 0.0]);
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_similarity_orthogonal_vectors() {
        let a = Vector::from(vec![1.0f32, 0.0, 0.0]);
        let b = Vector::from(vec![0.0f32, 1.0, 0.0]);
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }
}
