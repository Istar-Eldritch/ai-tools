# Delete Pipeline

**Status**: Draft
**Created**: 2026-04-07T21:21:12Z
**Timestamp**: 2604072121
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #9

---

## PART I: Requirements

### Problem Statement

The delete pipeline is the removal counterpart to the ingestion pipeline. Given a `source_id` UUID, it must confirm the source exists, delete the source record (and all associated chunks via FK cascade) from PostgreSQL, and remove the original document from S3. The caller receives either a unit confirmation (`Ok(())`) or a typed error.

All prerequisite modules are already implemented: `db::queries::get_source_by_id` retrieves the source record (providing the `s3_key`), `db::queries::delete_source` removes the source and cascades chunk deletion via the `ON DELETE CASCADE` foreign key constraint, and `S3Storage::delete_object` removes the archived original. This feature is a thin orchestration layer that composes those modules in the correct order, handles the not-found case, and tolerates S3 failures gracefully.

No embedding is involved. The delete path is entirely DB + S3; the chunking and embedding services are irrelevant to deletion.

### Requirements

- **R1** — `DeletePipeline` struct: holds `pool: PgPool` and `storage: S3Storage`. Both implement `Clone`, so `DeletePipeline` itself derives `Clone`. The struct is constructed once at server startup and passed by clone to each request handler.

- **R2** — `DeletePipeline::new(pool: PgPool, storage: S3Storage) -> Self`: simple constructor, no fallible operations.

- **R3** — `DeletePipeline::delete(source_id: Uuid) -> AppResult<()>`: the main deletion method. Returns `Ok(())` on success. Returns `Err(AppError::NotFound(...))` if no source with the given UUID exists. S3 failures after a successful DB delete are logged and swallowed; `Ok(())` is returned.

- **R4** — No UUID validation: nil UUIDs or arbitrary well-formed UUIDs that do not correspond to a known source are handled uniformly — `get_source_by_id` returns `None`, and the pipeline returns `AppError::NotFound`. No special-casing of the nil UUID is required.

- **R5** — Pipeline flow (ordered steps):
  1. Call `db::queries::get_source_by_id(&self.pool, source_id)`. If the result is `Ok(None)`, return `Err(AppError::NotFound(format!("source {source_id} not found")))`. If the query itself fails, propagate the error with `?`.
  2. Extract `source.s3_key` from the returned `Source` for use in the S3 deletion step.
  3. Call `db::queries::delete_source(&self.pool, source_id)`. Propagate any DB error with `?`. The `ON DELETE CASCADE` constraint on `chunks.source_id` automatically removes all chunk rows; no separate chunk deletion query is needed.
  4. Attempt `self.storage.delete_object(&s3_key)`. If this fails, log `tracing::warn!` with the `source_id` and error, but return `Ok(())`. The DB delete is committed and non-reversible; S3 failure is treated as a best-effort cleanup, consistent with the ingest pipeline's `cleanup()` pattern.
  5. Return `Ok(())`.

- **R6** — `AppError::NotFound` variant: a new variant must be added to `src/error.rs` to signal that the requested source does not exist. It wraps a `String` message and displays as `"not found: {0}"`. This is the only change required outside `src/pipelines/`.

- **R7** — S3 failure tolerance: S3 deletion is attempted after the DB delete is committed. If S3 deletion fails, the pipeline logs a structured warning and returns `Ok(())`. The rationale is that the DB state is the authoritative record of what exists; an orphaned S3 object is a storage leak but not a correctness failure. Manual cleanup of orphaned objects is possible via S3 lifecycle rules or a future reconciliation job.

- **R8** — No compensating rollback: unlike the ingest pipeline, the delete pipeline has no compensating cleanup helper. Deletion is inherently simpler — there is no partial state to roll back, since `get_source_by_id` confirms existence before any mutation begins. If `delete_source` fails, the source row is still present and consistent.

- **R9** — No new Cargo dependencies: the pipeline composes `sqlx`, `aws-sdk-s3`, `uuid`, `tokio`, and the existing internal modules. All are already present in `Cargo.toml`.

- **R10** — `AppError::Validation` and `AppError::Internal` variants: both already exist in `src/error.rs` (added in F7). No additional error variants beyond `AppError::NotFound` are needed.

### Success Criteria

- [ ] `DeletePipeline::new(pool, storage)` compiles and derives `Clone` without additional bounds
- [ ] `delete(nonexistent_uuid)` returns `Err(AppError::NotFound(...))` without mutating the DB or calling S3
- [ ] `delete(nil_uuid)` returns `Err(AppError::NotFound(...))` — nil UUID is treated as any other nonexistent ID
- [ ] `delete(valid_source_id)` after ingesting a document removes the source row, all chunk rows, and the S3 object; returns `Ok(())`
- [ ] After `delete(valid_source_id)`, a subsequent `get_source_by_id` call returns `None`
- [ ] After `delete(valid_source_id)`, all `chunks` rows with that `source_id` are absent (CASCADE confirmed)
- [ ] Simulated S3 failure after a successful `delete_source`: `delete` returns `Ok(())` and logs a `tracing::warn!` event
- [ ] `AppError::NotFound` is displayable via `thiserror`
- [ ] All unit and integration tests pass under `cargo test`

### Out of Scope

The following are explicitly deferred and must not be implemented in this feature:

- **Bulk / batch deletion** — one source per `delete` call; deleting multiple sources in a single request is left to the caller to iterate.
- **Soft delete / tombstoning** — deletion is hard; no `deleted_at` column or logical delete flag is introduced in v1.
- **Delete by filename or s3_key** — lookup is by `Uuid` only; alternate key lookup is deferred per discovery decision.
- **Orphaned S3 object reconciliation** — if S3 deletion fails, recovery is out of scope for this feature; lifecycle rules or a future sweep job would handle it.
- **Transactional S3 + DB atomicity** — true two-phase commit across DB and S3 is not achievable with these dependencies; the best-effort approach (R7) is intentional and documented.
- **Authorization / ownership checks** — no caller identity or ownership validation in v1.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | `AppError::NotFound` variant; `DeletePipeline` struct; `new()` and `delete()` with S3-failure tolerance and structured warning logging; wire into `src/pipelines/mod.rs` | 0.5 d |
| Phase 2 | Integration tests with testcontainers (PostgreSQL+pgvector container + MinIO container); not-found path unit tests; S3 failure simulation | 0.5 d |

**Total estimate**: 1 day

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/
  error.rs                   -- Add AppError::NotFound variant
  pipelines/
    mod.rs                   -- add: pub mod delete;
    delete.rs                -- DeletePipeline struct, new(), delete()
```

No other files are modified. No new Cargo dependencies are added.

### 3.2 `AppError::NotFound` (`src/error.rs`)

A new variant is appended to the existing `AppError` enum:

```rust
/// The requested resource does not exist.
#[error("not found: {0}")]
NotFound(String),
```

No `From` implementation is needed; the variant is constructed directly in `delete()`.

### 3.3 `DeletePipeline` Struct

```rust
// src/pipelines/delete.rs

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::queries;
use crate::error::{AppError, AppResult};
use crate::storage::S3Storage;

#[derive(Clone)]
pub struct DeletePipeline {
    pool:    PgPool,
    storage: S3Storage,
}

impl DeletePipeline {
    pub fn new(pool: PgPool, storage: S3Storage) -> Self {
        Self { pool, storage }
    }
}
```

`PgPool` is `Clone` (wraps `Arc` internally). `S3Storage` is `Clone` (wraps `Arc<S3StorageInner>`). Therefore `DeletePipeline` derives `Clone` without additional bounds.

### 3.4 `delete()` Method

```rust
impl DeletePipeline {
    pub async fn delete(&self, source_id: Uuid) -> AppResult<()> {
        // Step 1: confirm existence and retrieve s3_key
        let source = queries::get_source_by_id(&self.pool, source_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("source {source_id} not found")))?;

        let s3_key = source.s3_key;

        // Step 3: delete source row (CASCADE removes all chunk rows)
        queries::delete_source(&self.pool, source_id).await?;

        // Step 4: best-effort S3 deletion; failure is logged but not fatal
        if let Err(e) = self.storage.delete_object(&s3_key).await {
            tracing::warn!(
                source_id = %source_id,
                s3_key = %s3_key,
                error = %e,
                "delete: S3 object removal failed after successful DB delete; object may be orphaned"
            );
        }

        // Step 5: return confirmation
        Ok(())
    }
}
```

### 3.5 Deletion Order Rationale

The three operations execute in this order:

1. **`get_source_by_id`** — read-only; confirms existence and captures `s3_key` before any mutation. If the source does not exist, `NotFound` is returned before any destructive operation is attempted.
2. **`delete_source`** — commits the DB delete. The `ON DELETE CASCADE` FK constraint on `chunks.source_id` removes all associated chunk rows in the same statement. After this point, the source is permanently gone from the DB.
3. **`delete_object`** (S3) — attempted last. If it fails, the DB state is already correct (no orphaned DB rows), and only the S3 object is leaked.

This order means a successful DB delete followed by an S3 failure leaves an orphaned object in storage — a recoverable storage leak — rather than a dangling DB row pointing to a deleted S3 object, which could confuse readers or cause 404 errors on retrieval attempts.

### 3.6 S3 Failure Logging

The warning log is structured to aid debugging and future reconciliation:

```rust
tracing::warn!(
    source_id = %source_id,
    s3_key    = %s3_key,
    error     = %e,
    "delete: S3 object removal failed after successful DB delete; object may be orphaned"
);
```

Including `s3_key` (not just `source_id`) allows an operator to directly construct the S3 path for manual removal without querying the (now-deleted) DB row. The message text explicitly flags the potential for an orphaned object to prompt operational awareness.

### 3.7 `mod.rs` Update

`src/pipelines/mod.rs` currently exports `pub mod ingest;` and `pub mod search;`. Add the delete module:

```rust
pub mod delete;
pub mod ingest;
pub mod search;
```

### 3.8 Startup Wiring (`main.rs` / `serve` command)

The pipeline is constructed after the DB pool and S3 client are initialised:

```rust
let delete_pipeline = DeletePipeline::new(
    db_pool.clone(),
    s3_storage.clone(),
);
```

Unlike `IngestPipeline`, `DeletePipeline` does not require `ChunkConfig` or `EmbeddingService`. This keeps delete startup cost independent of embedding model availability.

### 3.9 Integration Test Outline

Tests live in `tests/delete_pipeline.rs` (or a submodule of `tests/integration/`). They require `testcontainers` with the `pgvector/pgvector:pg16` and `minio/minio` images.

```
delete_nonexistent_source_returns_not_found
    -- source_id = Uuid::new_v4() with no prior ingest; returns AppError::NotFound
    -- no DB mutation; no S3 call

delete_nil_uuid_returns_not_found
    -- source_id = Uuid::nil(); treated as nonexistent; returns AppError::NotFound

delete_removes_source_and_chunks
    -- ingest a document via IngestPipeline; call delete(source_id)
    -- assert Ok(()); assert get_source_by_id returns None
    -- assert chunks table has 0 rows for source_id

delete_removes_s3_object
    -- ingest a document; call delete(source_id)
    -- assert S3 get_object on the former s3_key returns a NoSuchKey error

delete_s3_failure_returns_ok
    -- ingest a document; simulate S3 delete_object failure (e.g., wrong bucket config)
    -- assert delete returns Ok(())
    -- assert source row and chunk rows are absent in DB (DB delete succeeded)

delete_idempotent_not_found_on_second_call
    -- ingest, delete, then delete again with the same source_id
    -- second call returns AppError::NotFound

delete_does_not_affect_other_sources
    -- ingest two documents A and B; delete(A)
    -- assert source B and its chunks remain intact; assert A is gone
```

Tests that require `IngestPipeline` (to set up fixture data) depend on F7 being implemented. The embedding model (`all-minilm-l6-v2`) is fetched on first use; integration tests are `#[ignore]`-gated behind a `RUN_INTEGRATION_TESTS=1` environment variable, consistent with the ingest and search pipeline test strategies.

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | Should `delete` accept a `&str` s3_key as an alternative lookup key (in addition to UUID)? | UUID only for v1 per discovery decision. The MCP tool layer can accept either form and resolve to a UUID via `get_source_by_s3_key` if needed — that lookup lives in `db::queries` already. |
| Q2 | Should the S3 key be re-derived as `source_id.to_string()` instead of being fetched from the DB row? | Fetch from `source.s3_key` (as implemented). This is correct even if the key scheme ever changes — the DB record is the authoritative mapping and must not be assumed to always equal the UUID string. |
| Q3 | Should `delete` return the deleted `Source` record instead of `()`, for caller convenience? | Return `()` for v1; the MCP `delete_source` tool only needs success/not-found confirmation. If callers need the deleted record's metadata, they should call `get_source_by_id` before `delete` — mixing concerns in the delete response is a follow-up. |
| Q4 | Should `delete_source` returning `false` (0 rows affected) be treated as `NotFound`? | No. The pipeline already checks for existence via `get_source_by_id` before calling `delete_source`. If `delete_source` returns `false` after a successful `get_source_by_id`, a concurrent delete occurred — this is not treated as an error in v1; the outcome (source absent) is correct. |
| Q5 | Should the pipeline log a `tracing::info!` event on each successful delete for observability? | Not specified in v1. Add structured logging (source_id, filename, chunk count) in the same pass as MCP wiring (F10) when request tracing is set up holistically. |
