# Ingestion Pipeline

**Status**: Draft
**Created**: 2026-04-07T20:35:25Z
**Timestamp**: 2604072035
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #7

---

## PART I: Requirements

### Problem Statement

The ingestion pipeline is the central orchestrator that wires together all existing modules (DB, S3, chunking, embedding) to transform a raw document into searchable vector chunks. Individual modules are already implemented and tested in isolation; this feature is the glue layer that composes them into a single transactional operation.

A caller provides document content (as a `&str`), a filename, a MIME content type, and an arbitrary JSON metadata blob. The pipeline must: validate the input, persist the document to S3 for archival, split it into overlapping text chunks, embed those chunks locally via FastEmbed, and store the source record and all chunk vectors in PostgreSQL. If any step after the initial DB write fails, the pipeline must attempt a best-effort compensating cleanup to avoid orphaned state.

No deduplication is performed. Every call to `ingest` creates a new source record. The S3 key for a document is the source UUID (as a plain string, no path prefix). The filename is stored in `sources.filename` for human-readable identification.

### Requirements

- **R1** — `IngestPipeline` struct: holds `PgPool`, `S3Storage`, `ChunkConfig`, and `EmbeddingService`. All four fields implement `Clone`, so `IngestPipeline` itself derives `Clone`. The struct is constructed once at server startup and passed by clone to each request handler.

- **R2** — `IngestPipeline::new(pool: PgPool, storage: S3Storage, chunk_config: ChunkConfig, embedding: EmbeddingService) -> Self`: simple constructor, no fallible operations.

- **R3** — `IngestPipeline::ingest(content: &str, filename: &str, content_type: &str, metadata: serde_json::Value) -> AppResult<Source>`: the main orchestration method. Returns the newly created `Source` record on success.

- **R4** — Input validation: if `content.trim()` is empty, return `Err(AppError::Validation("content must not be empty".into()))` immediately, before any DB or S3 operation. No other validation is required for v1.

- **R5** — Pipeline flow (ordered steps):
  1. Validate content (R4).
  2. Generate `source_id: Uuid = Uuid::new_v4()`.
  3. Call `db::queries::insert_source` with a `NewSource { id: source_id, s3_key: source_id.to_string(), filename, content_type, metadata }`. Store the returned `Source`.
  4. Upload the document bytes to S3: `storage.put_object(&source_id.to_string(), Bytes::from(content.to_owned().into_bytes()), content_type)`. If this fails, trigger compensating cleanup (R7) and return the error.
  5. Chunk the content: if `content_type` contains `"markdown"` (case-insensitive substring match), call `chunking::chunk_markdown(content, &self.chunk_config)`; otherwise call `chunking::chunk_text(content, &self.chunk_config)`.
  6. Embed all chunks in a single batch call. Because `EmbeddingService::embed_batch` is CPU-bound and synchronous, it must be called inside `tokio::task::spawn_blocking`. Capture the cloned `EmbeddingService` and the chunk text strings by value before entering the closure. If the `spawn_blocking` task panics or embedding returns an error, trigger compensating cleanup and return the error.
  7. Build `Vec<NewChunk>`: zip the `TextChunk` slice with the returned `Vec<pgvector::Vector>`, constructing one `NewChunk { id: Uuid::new_v4(), source_id, chunk_index: chunk.index as i32, content: chunk.content.clone(), embedding: vector }` per pair.
  8. Call `db::queries::insert_chunks(pool, &new_chunks)`. If this fails, trigger compensating cleanup and return the error.
  9. Return `Ok(source)`.

- **R6** — Compensating cleanup on failure: a private helper `cleanup(&self, source_id: Uuid)` that calls `db::queries::delete_source` (which cascades to delete all chunks via the FK constraint) and `storage.delete_object`. Both calls are attempted regardless of each other's outcome. Failures in cleanup are logged with `tracing::warn!` but do not replace the original error. The original error is always the one returned to the caller.

- **R7** — `spawn_blocking` for embedding: the embedding call is the only CPU-bound step. It must not block the Tokio executor thread. The pattern is:
  ```rust
  let svc = self.embedding.clone();
  let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
  let vectors = tokio::task::spawn_blocking(move || {
      let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
      svc.embed_batch(&refs)
  })
  .await
  .map_err(|e| AppError::Internal(format!("spawn_blocking panicked: {e}")))??;
  ```

- **R8** — No new Cargo dependencies: the pipeline is pure orchestration of `sqlx`, `aws-sdk-s3`, `uuid`, `bytes`, `serde_json`, `tokio`, and the existing internal modules. All are already present in `Cargo.toml`.

- **R9** — `AppError::Validation` variant: a new variant must be added to `src/error.rs` to support input validation errors. It wraps a `String` message and displays as `"validation error: {0}"`. This is the only change required outside `src/pipelines/`.

### Success Criteria

- [ ] `IngestPipeline::new(...)` compiles and derives `Clone` without additional bounds
- [ ] `ingest("", "file.txt", "text/plain", json!({}))` returns `Err(AppError::Validation(...))` without touching the DB or S3
- [ ] `ingest("hello world", "file.txt", "text/plain", json!({}))` inserts one source row, one S3 object, and at least one chunk row; returns the `Source`
- [ ] `ingest("# Heading\n\nBody", "doc.md", "text/markdown", json!({}))` uses the markdown splitter (verified by chunk boundaries respecting headings)
- [ ] Simulated S3 failure after `insert_source`: the source row is deleted and no chunk rows remain
- [ ] Simulated `insert_chunks` failure: the source row and S3 object are both cleaned up
- [ ] Embedding is called inside `spawn_blocking` (confirmed by not blocking the executor under test)
- [ ] `AppError::Validation` is displayable via `thiserror`
- [ ] All unit and integration tests pass under `cargo test`

### Out of Scope

The following are explicitly deferred and must not be implemented in this feature:

- **Duplicate detection / dedup** — every `ingest` call creates a new source, regardless of content or filename.
- **`list_sources`** — deferred per epic scope decision; does not scale.
- **Streaming ingestion** — content is accepted as a single `&str`; no chunked HTTP or streaming protocol.
- **Batch document ingestion** — one document per `ingest` call; batching is left to the caller.
- **Async chunking** — `chunk_text` and `chunk_markdown` are synchronous and fast enough to call on the async thread.
- **S3 key namespacing / path prefixes** — key is the bare UUID string; no `originals/` prefix in v1.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | `AppError::Validation` variant; `IngestPipeline` struct; `new()` and `ingest()` with compensating cleanup; `spawn_blocking` embedding | 1 d |
| Phase 2 | Integration test with testcontainers (PostgreSQL+pgvector container + MinIO container + real chunking + `EmbeddingService` with `all-minilm-l6-v2` for speed); failure-path tests with mock S3/DB errors | 1 d |

**Total estimate**: 2 days

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/
  error.rs                   -- Add AppError::Validation variant
  pipelines/
    mod.rs                   -- pub mod ingest; (replace TODO)
    ingest.rs                -- IngestPipeline struct, new(), ingest(), cleanup()
```

No other files are modified. No new Cargo dependencies are added.

### 3.2 `AppError::Validation` (`src/error.rs`)

A new variant is appended to the existing `AppError` enum:

```rust
/// Input did not pass validation before any side-effectful operation.
#[error("validation error: {0}")]
Validation(String),
```

No `From` implementation is needed; the variant is constructed directly in `ingest()`.

### 3.3 `IngestPipeline` Struct

```rust
// src/pipelines/ingest.rs

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
    pool:         PgPool,
    storage:      S3Storage,
    chunk_config: ChunkConfig,
    embedding:    EmbeddingService,
}

impl IngestPipeline {
    pub fn new(
        pool:         PgPool,
        storage:      S3Storage,
        chunk_config: ChunkConfig,
        embedding:    EmbeddingService,
    ) -> Self {
        Self { pool, storage, chunk_config, embedding }
    }
}
```

`PgPool` is `Clone` (wraps `Arc` internally). `S3Storage` is `Clone` (wraps `Arc<S3StorageInner>`). `ChunkConfig` derives `Clone` and `Copy`. `EmbeddingService` is `Clone` (wraps `Arc<TextEmbedding>`). Therefore `IngestPipeline` derives `Clone` without additional bounds.

### 3.4 `ingest()` Method

```rust
impl IngestPipeline {
    pub async fn ingest(
        &self,
        content:      &str,
        filename:     &str,
        content_type: &str,
        metadata:     serde_json::Value,
    ) -> AppResult<Source> {
        // R4: Validate before any side effects
        if content.trim().is_empty() {
            return Err(AppError::Validation("content must not be empty".into()));
        }

        // Step 2: generate ID
        let source_id = Uuid::new_v4();
        let s3_key    = source_id.to_string();

        // Step 3: insert source row
        let new_source = NewSource {
            id:           source_id,
            s3_key:       s3_key.clone(),
            filename:     filename.to_owned(),
            content_type: content_type.to_owned(),
            metadata,
        };
        let source = queries::insert_source(&self.pool, &new_source).await?;

        // Step 4: upload to S3
        let data = Bytes::from(content.to_owned().into_bytes());
        if let Err(e) = self.storage.put_object(&s3_key, data, content_type).await {
            self.cleanup(source_id).await;
            return Err(e);
        }

        // Step 5: chunk
        let chunks = if content_type.to_lowercase().contains("markdown") {
            chunk_markdown(content, &self.chunk_config)
        } else {
            chunk_text(content, &self.chunk_config)
        };

        // Step 6: embed (CPU-bound, offloaded to blocking thread pool)
        let svc   = self.embedding.clone();
        let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let vectors = tokio::task::spawn_blocking(move || {
            let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
            svc.embed_batch(&refs)
        })
        .await
        .map_err(|e| AppError::Internal(format!("embedding task panicked: {e}")))?;

        let vectors = match vectors {
            Ok(v)  => v,
            Err(e) => {
                self.cleanup(source_id).await;
                return Err(e);
            }
        };

        // Step 7: build NewChunk records
        let new_chunks: Vec<NewChunk> = chunks
            .iter()
            .zip(vectors.into_iter())
            .map(|(chunk, embedding)| NewChunk {
                id:          Uuid::new_v4(),
                source_id,
                chunk_index: chunk.index as i32,
                content:     chunk.content.clone(),
                embedding,
            })
            .collect();

        // Step 8: insert chunks
        if let Err(e) = queries::insert_chunks(&self.pool, &new_chunks).await {
            self.cleanup(source_id).await;
            return Err(e);
        }

        // Step 9: return source
        Ok(source)
    }
}
```

### 3.5 Compensating Cleanup Helper

```rust
impl IngestPipeline {
    /// Best-effort cleanup after a partial failure. Deletes the source row
    /// (which cascades to any partially-inserted chunks via FK) and the S3
    /// object. Failures are logged but do not propagate; the original error
    /// is always returned to the caller.
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
```

Cleanup order is: DB first, then S3. This is intentional — deleting the source row (with its FK cascade) removes chunk rows before the S3 object disappears, so any concurrent reader following the source → S3 path has a brief window where the DB row is gone but the object still exists, which is safe. The reverse order could leave orphaned DB rows if S3 deletion succeeds but DB deletion fails.

### 3.6 Content-Type Detection

The markdown branch is selected by a case-insensitive substring search on `content_type`:

```rust
content_type.to_lowercase().contains("markdown")
```

This matches common MIME types including `"text/markdown"`, `"text/x-markdown"`, and variations with parameters (e.g., `"text/markdown; charset=utf-8"`). All other content types use the plain-text splitter. No additional content type parsing library is needed.

### 3.7 `spawn_blocking` for Embedding

`EmbeddingService::embed_batch` calls into the ONNX runtime, which is CPU-bound and cannot yield cooperatively. Running it directly on a Tokio async task would starve other tasks sharing the same executor thread. `tokio::task::spawn_blocking` offloads the call to Tokio's dedicated blocking thread pool (default: 512 threads, bounded by the OS).

The closure must own all data it references. The approach:

1. Clone `self.embedding` (cheap: `Arc` clone) before spawning.
2. Collect chunk contents into `Vec<String>` (owned), since `&str` references into `chunks` cannot cross the thread boundary.
3. Inside the closure, build `Vec<&str>` from the owned strings and call `embed_batch`.

`spawn_blocking` returns `JoinHandle<AppResult<Vec<Vector>>>`. The `.await` unwraps the `JoinHandle`, yielding `Result<AppResult<Vec<Vector>>, JoinError>`. The outer `?` handles the `JoinError` (mapped to `AppError::Internal`), and the inner `match` handles the `AppError` from `embed_batch`.

### 3.8 `AppError::Internal` Variant

The `JoinError` panic case maps to `AppError::Internal`. This variant should already exist in `src/error.rs` or be added alongside `AppError::Validation`:

```rust
#[error("internal error: {0}")]
Internal(String),
```

If it already exists, no change is needed. If not, add it in the same PR as `AppError::Validation`.

### 3.9 `mod.rs` Update

`src/pipelines/mod.rs` currently contains only `// TODO`. Replace with:

```rust
pub mod ingest;
```

### 3.10 Startup Wiring (`main.rs` / `serve` command)

The pipeline is constructed after the DB pool and S3 client are initialised and the embedding model is loaded:

```rust
let chunk_config = ChunkConfig {
    chunk_size:  config.chunk_size,
    chunk_overlap: config.chunk_overlap,  // note: field is named `overlap` in ChunkConfig
};

let ingest_pipeline = IngestPipeline::new(
    db_pool.clone(),
    s3_storage.clone(),
    chunk_config,
    embedding_service.clone(),
);
```

Note: `ChunkConfig` has fields `chunk_size: usize` and `overlap: usize` (not `chunk_overlap`). Map from `Config` accordingly.

### 3.11 Field Name Mapping: `Config` → `ChunkConfig`

| `Config` field | `ChunkConfig` field |
|----------------|---------------------|
| `config.chunk_size` | `chunk_config.chunk_size` |
| `config.chunk_overlap` | `chunk_config.overlap` |

### 3.12 Integration Test Outline

Tests live in `tests/ingest_pipeline.rs` (or a submodule of `tests/integration/`). They require `testcontainers` with the `pgvector/pgvector:pg16` and `minio/minio` images.

```
ingest_plain_text
    -- inserts source row; S3 object exists; chunk rows count > 0; returns Source

ingest_markdown_uses_markdown_splitter
    -- content_type "text/markdown"; verify chunk boundaries respect headings
    -- (compare chunk count vs plain splitter on same input to confirm different path)

ingest_empty_content_returns_validation_error
    -- no DB or S3 writes; returns AppError::Validation

ingest_whitespace_only_returns_validation_error
    -- "   \n\t  " treated as empty

ingest_s3_failure_cleans_up_source_row
    -- simulate put_object error (wrong bucket name); source row absent after call

ingest_insert_chunks_failure_cleans_up_source_and_s3
    -- simulate DB failure after S3 upload; source row absent; S3 object absent

ingest_multiple_documents_creates_independent_sources
    -- two ingest calls with same content produce two distinct source UUIDs and S3 keys
```

Embedding in integration tests uses `EmbeddingService::new("all-minilm-l6-v2")` (384-dim, smaller download) marked `#[ignore]` unless a `RUN_INTEGRATION_TESTS=1` env var or feature flag is set. Tests that mock embedding (avoiding model download) can use a mock `EmbeddingService` backed by a deterministic vector generator if the service is made injectable via a trait object — this is left as a follow-up; v1 tests are `#[ignore]`-gated.

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | Does `AppError::Internal` already exist in `src/error.rs`? | Inspect during Phase 1; add if absent, alongside `AppError::Validation`. |
| Q2 | Should `cleanup` be `async fn` or fire-and-forget with `tokio::spawn`? | `async fn` (awaited inline) for v1 — simpler, and cleanup latency is not on the hot path since it only runs on error. |
| Q3 | Should `ingest` return `(Source, usize)` (source + chunk count) instead of just `Source`? | Return `Source` only for v1; the MCP tool handler can derive chunk count from a subsequent query if needed. Revisit in F10. |
| Q4 | Should the S3 key use a path prefix (e.g. `originals/{uuid}`) for organisational clarity? | Bare UUID for v1 per discovery decision; prefix can be added in F10 or a follow-up without breaking the DB schema (s3_key is a free-form string). |
| Q5 | Should the `EmbeddingService` be injectable via a trait for easier unit testing of `ingest()`? | Concrete type for v1 (consistent with F6 design); introduce a trait in a follow-up if test ergonomics demand it. |
