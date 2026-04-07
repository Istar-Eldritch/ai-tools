# Search Pipeline

**Status**: Draft
**Created**: 2026-04-07T21:07:06Z
**Timestamp**: 2604072107
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #8

---

## PART I: Requirements

### Problem Statement

The search pipeline is the query-time counterpart to the ingestion pipeline. Given a natural language query string, it must embed that query using the same local embedding model used during ingestion, execute a cosine similarity search against the pgvector `chunks` table, and return the top-k most relevant chunks with their associated source metadata and similarity scores.

All prerequisite modules are already implemented: the `EmbeddingService` (F6) provides `embed_one`, `db::queries::search_chunks` (F3) executes the vector search, and `db::models::SearchResult` carries the full result shape. This feature is a thin orchestration layer that composes those modules, validates inputs, and offloads the CPU-bound embedding call to Tokio's blocking thread pool.

No S3 interaction is required. The search path is entirely DB + embedding; the S3 layer is only involved in ingestion and deletion.

### Requirements

- **R1** — `SearchPipeline` struct: holds `PgPool` and `EmbeddingService`. Both implement `Clone`, so `SearchPipeline` itself derives `Clone`. The struct is constructed once at server startup and passed by clone to each request handler.

- **R2** — `SearchPipeline::new(pool: PgPool, embedding: EmbeddingService) -> Self`: simple constructor, no fallible operations.

- **R3** — `SearchPipeline::search(query: &str, k: i64) -> AppResult<Vec<SearchResult>>`: the main search method. Returns the top-k results from pgvector ordered by cosine similarity (descending). Returns an empty `Vec` (not an error) when no chunks match.

- **R4** — Input validation:
  - If `query.trim()` is empty, return `Err(AppError::Validation("query must not be empty".into()))` immediately, before any embedding or DB operation.
  - If `k` is not in `[1, 100]` (inclusive), return `Err(AppError::Validation("k must be between 1 and 100".into()))` immediately.
  - No other validation is required for v1.

- **R5** — Pipeline flow (ordered steps):
  1. Validate inputs (R4).
  2. Embed the query: because `EmbeddingService::embed_one` is CPU-bound and synchronous, it must be called inside `tokio::task::spawn_blocking`. Clone `self.embedding` and capture the query string by value before entering the closure. Map a `JoinError` (panic) to `AppError::Internal`. Propagate any `AppError` returned by `embed_one`.
  3. Call `db::queries::search_chunks(&self.pool, &query_vector, k)`.
  4. Return `Ok(results)`.

- **R6** — No compensating cleanup: search is a read-only operation. No state is mutated, so no rollback or cleanup helper is needed.

- **R7** — `spawn_blocking` for embedding: the pattern mirrors the ingest pipeline's blocking call, but uses `embed_one` instead of `embed_batch`:
  ```rust
  let svc = self.embedding.clone();
  let query_owned = query.to_owned();
  let query_vector = tokio::task::spawn_blocking(move || svc.embed_one(&query_owned))
      .await
      .map_err(|e| AppError::Internal(format!("embedding task panicked: {e}")))??;
  ```
  The double `?` unwraps the `JoinError` (outer `Result`) and then the `AppError` from `embed_one` (inner `Result`).

- **R8** — Zero results is not an error: `search_chunks` returns an empty `Vec<SearchResult>` when the corpus contains no chunks, or when no chunk meets any implicit similarity threshold. The pipeline passes this through as `Ok(vec![])`. The MCP tool layer is responsible for formatting an appropriate response to the caller.

- **R9** — `k` is a runtime parameter: `k` is not a field on `SearchPipeline`. The default of `5` lives at the MCP tool layer. This keeps the pipeline generic and allows different tool invocations to request different result counts.

- **R10** — No new Cargo dependencies: the pipeline composes `sqlx`, `pgvector`, `tokio`, and the existing internal modules. All are already present in `Cargo.toml`.

- **R11** — `AppError::Validation` and `AppError::Internal` variants: both already exist in `src/error.rs` (added in F7). No changes to `src/error.rs` are required for this feature.

### Success Criteria

- [ ] `SearchPipeline::new(pool, embedding)` compiles and derives `Clone` without additional bounds
- [ ] `search("", 5)` returns `Err(AppError::Validation(...))` without touching the DB or embedding service
- [ ] `search("   \n  ", 5)` (whitespace-only) returns `Err(AppError::Validation(...))` without touching the DB or embedding service
- [ ] `search("query", 0)` returns `Err(AppError::Validation(...))` — k=0 is invalid
- [ ] `search("query", 101)` returns `Err(AppError::Validation(...))` — k=101 is out of range
- [ ] `search("query", 1)` and `search("query", 100)` pass validation — boundary values are accepted
- [ ] `search("rust programming", 5)` on an empty corpus returns `Ok(vec![])` — not an error
- [ ] `search("rust programming", 5)` after ingesting a relevant document returns results with `similarity > 0.0` and `similarity <= 1.0`
- [ ] Embedding is called inside `spawn_blocking` (confirmed by not blocking the executor under test)
- [ ] Returned `SearchResult` fields match `db::models::SearchResult`: `chunk_id`, `source_id`, `chunk_index`, `content`, `source_filename`, `source_metadata`, `similarity`
- [ ] All unit and integration tests pass under `cargo test`

### Out of Scope

The following are explicitly deferred and must not be implemented in this feature:

- **Similarity threshold filtering** — all results from `search_chunks` are returned regardless of their similarity score; threshold-based filtering is a follow-up.
- **Hybrid search (keyword + vector)** — pure vector search only; BM25 or full-text combination is deferred per epic scope.
- **Re-ranking** — no cross-encoder or LLM-based re-ranking in v1.
- **Pagination / offset** — top-k only; cursor-based pagination is deferred.
- **Per-source filtering** — no `WHERE source_id = ?` scoping; search always spans the full corpus.
- **Query expansion / rewriting** — the query string is embedded as-is with no preprocessing beyond trim validation.
- **Caching** — no query result caching or embedding memoization.
- **`k` default** — the default value of `5` lives at the MCP tool layer (F10), not in `SearchPipeline`.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | `SearchPipeline` struct; `new()` and `search()` with input validation and `spawn_blocking` embedding; wire into `src/pipelines/mod.rs` | 0.5 d |
| Phase 2 | Integration tests with testcontainers (PostgreSQL+pgvector container + real `EmbeddingService` with `all-minilm-l6-v2`); validation-path unit tests | 0.5 d |

**Total estimate**: 1 day

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/
  pipelines/
    mod.rs        -- add: pub mod search;
    search.rs     -- SearchPipeline struct, new(), search()
```

No other files are modified. No new Cargo dependencies are added. `src/error.rs` is unchanged.

### 3.2 `SearchPipeline` Struct

```rust
// src/pipelines/search.rs

use sqlx::PgPool;

use crate::db::models::SearchResult;
use crate::db::queries;
use crate::embedding::EmbeddingService;
use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct SearchPipeline {
    pool:      PgPool,
    embedding: EmbeddingService,
}

impl SearchPipeline {
    pub fn new(pool: PgPool, embedding: EmbeddingService) -> Self {
        Self { pool, embedding }
    }
}
```

`PgPool` is `Clone` (wraps `Arc` internally). `EmbeddingService` is `Clone` (wraps `Arc<TextEmbedding>`). Therefore `SearchPipeline` derives `Clone` without additional bounds.

### 3.3 `search()` Method

```rust
impl SearchPipeline {
    pub async fn search(&self, query: &str, k: i64) -> AppResult<Vec<SearchResult>> {
        // R4: Validate before any side effects
        if query.trim().is_empty() {
            return Err(AppError::Validation("query must not be empty".into()));
        }
        if !(1..=100).contains(&k) {
            return Err(AppError::Validation("k must be between 1 and 100".into()));
        }

        // Step 2: embed the query (CPU-bound, offloaded to blocking thread pool)
        let svc = self.embedding.clone();
        let query_owned = query.to_owned();
        let query_vector = tokio::task::spawn_blocking(move || svc.embed_one(&query_owned))
            .await
            .map_err(|e| AppError::Internal(format!("embedding task panicked: {e}")))??;

        // Step 3: vector similarity search
        let results = queries::search_chunks(&self.pool, &query_vector, k).await?;

        // Step 4: return results (empty Vec is not an error)
        Ok(results)
    }
}
```

### 3.4 `spawn_blocking` for Query Embedding

`EmbeddingService::embed_one` calls into the ONNX runtime via `embed_batch`, which is CPU-bound and cannot yield cooperatively. Running it directly on a Tokio async task would starve other tasks sharing the same executor thread. `tokio::task::spawn_blocking` offloads the call to Tokio's dedicated blocking thread pool.

The closure must own all data it references:

1. Clone `self.embedding` (cheap: `Arc` clone) before spawning.
2. Convert `query: &str` to `String` (owned), since the `&str` reference cannot cross the thread boundary.
3. Inside the closure, call `svc.embed_one(&query_owned)` — `embed_one` accepts `&str` and is defined to call `embed_batch` internally.

`spawn_blocking` returns `JoinHandle<AppResult<Vector>>`. The `.await` unwraps the `JoinHandle`, yielding `Result<AppResult<Vector>, JoinError>`. The first `?` handles the `JoinError` (mapped to `AppError::Internal`), and the second `?` propagates the `AppError` from `embed_one`. This is the double-`??` pattern used in the ingest pipeline for the same reason.

### 3.5 Validation Logic

Two independent validations are applied before any embedding or DB work:

**Empty query check:**
```rust
if query.trim().is_empty() {
    return Err(AppError::Validation("query must not be empty".into()));
}
```
This matches the ingest pipeline's `content.trim().is_empty()` pattern. A query consisting entirely of whitespace is treated as empty.

**k range check:**
```rust
if !(1..=100).contains(&k) {
    return Err(AppError::Validation("k must be between 1 and 100".into()));
}
```
Valid range is `[1, 100]` inclusive. `k = 0` is rejected because a zero-result search is meaningless. `k > 100` is rejected as a safeguard against runaway result sets at the DB layer. The MCP tool layer provides a default of `5` when the caller omits `k`.

### 3.6 `SearchResult` Fields

`db::models::SearchResult` is returned as-is from `db::queries::search_chunks`. No mapping or transformation is applied in the pipeline layer. The struct fields are:

| Field | Type | Source |
|-------|------|--------|
| `chunk_id` | `Uuid` | `chunks.id` |
| `source_id` | `Uuid` | `chunks.source_id` |
| `chunk_index` | `i32` | `chunks.chunk_index` |
| `content` | `String` | `chunks.content` |
| `source_filename` | `String` | `sources.filename` |
| `source_metadata` | `serde_json::Value` | `sources.metadata` |
| `similarity` | `f64` | `1.0 - (c.embedding <=> $1)` |

The `similarity` field is computed by the SQL query as `1.0 - cosine_distance`, yielding a value in `[0.0, 1.0]` where `1.0` is a perfect match. This conversion is done in `search_chunks`; the pipeline does not recompute or re-normalize it.

### 3.7 `mod.rs` Update

`src/pipelines/mod.rs` currently exports only `pub mod ingest;`. Add the search module:

```rust
pub mod ingest;
pub mod search;
```

### 3.8 Startup Wiring (`main.rs` / `serve` command)

The pipeline is constructed after the DB pool and embedding service are initialised:

```rust
let search_pipeline = SearchPipeline::new(
    db_pool.clone(),
    embedding_service.clone(),
);
```

Unlike `IngestPipeline`, `SearchPipeline` does not require `S3Storage` or `ChunkConfig`. This keeps search startup cost independent of S3 availability.

### 3.9 Integration Test Outline

Tests live in `tests/search_pipeline.rs` (or a submodule of `tests/integration/`). They require `testcontainers` with the `pgvector/pgvector:pg16` image. No MinIO container is needed — search does not touch S3.

```
search_empty_query_returns_validation_error
    -- query = ""; returns AppError::Validation; no DB or embedding calls

search_whitespace_query_returns_validation_error
    -- query = "   \n\t  "; treated as empty; same result

search_k_zero_returns_validation_error
    -- k = 0; returns AppError::Validation

search_k_above_max_returns_validation_error
    -- k = 101; returns AppError::Validation

search_k_boundary_values_pass_validation
    -- k = 1 and k = 100 both pass validation (may return empty results on empty corpus)

search_empty_corpus_returns_empty_vec
    -- no documents ingested; search returns Ok(vec![]); not an error

search_returns_relevant_results
    -- ingest a known document via IngestPipeline; search with related query;
    -- assert results non-empty; assert top result content matches; assert similarity in [0.0, 1.0]

search_respects_k_limit
    -- ingest N documents; search with k < N; assert results.len() <= k

search_result_fields_populated
    -- verify chunk_id, source_id, chunk_index, content, source_filename, source_metadata,
       similarity are all populated on a returned SearchResult
```

Embedding in integration tests uses `EmbeddingService::new("all-minilm-l6-v2")` (384-dim, smaller download), marked `#[ignore]` unless a `RUN_INTEGRATION_TESTS=1` environment variable is set, consistent with the ingest pipeline test strategy.

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | Should `search()` accept an `Option<i64>` for `k` and resolve the default internally, or leave defaulting entirely to the MCP tool layer? | Leave defaulting at the MCP tool layer for v1 — `search()` requires an explicit `k` and validates it is in `[1, 100]`. Simpler signature, and the pipeline does not need to know MCP conventions. |
| Q2 | Should there be a minimum similarity threshold parameter to filter out low-quality matches? | No threshold in v1. All results from `search_chunks` are returned. Threshold filtering is a follow-up once real-world result quality is observed. |
| Q3 | Should `SearchPipeline` expose a `search_with_source` variant that filters results to a specific `source_id`? | Not in v1. Per-source filtering requires a new `search_chunks_by_source` query. Defer to F10 or a follow-up once the MCP `search` tool is in use. |
| Q4 | Should search results include an `embedding` field for downstream re-ranking? | No. `SearchResult` omits the embedding vector (it is not selected in `search_chunks`). Returning raw vectors over MCP would be impractical. Re-ranking is explicitly out of scope. |
| Q5 | Should the pipeline log a `tracing::info!` event on each search call for observability? | Not specified in v1. Add structured logging (query length, k, result count, latency) in the same pass as MCP wiring (F10) when request tracing is set up holistically. |
