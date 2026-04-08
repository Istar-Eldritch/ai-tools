# Atomic Directory Ingestion Updates

**Status**: Draft
**Created**: 2026-04-08T13:53:56Z
**Timestamp**: 2604081353

---

## PART I: Requirements

### Problem Statement

The `FileAction::Update` branch in `DirectoryIngestPipeline::ingest_directory`
(`src/pipelines/directory_ingest.rs`, lines 247–268) uses a delete-then-ingest
order:

```
delete.delete(old_source_id).await?   // old data gone
ingest.ingest(...).await?             // new data created
```

This has three concrete failure modes:

1. **Data loss on ingest failure.** If `ingest` fails after `delete` succeeds,
   the file disappears from the knowledge base entirely. The caller receives
   an error but there is nothing left to search.

2. **Non-atomic ID churn.** Every update mints a new `source.id` and a new S3
   key (`source_id.to_string()`). Any external record that stored the old UUID
   becomes a dangling reference immediately.

3. **Full embedding re-computation on every update.** Even when only one
   function in a 2 000-line file changed, all chunks are re-embedded.
   Embedding is the dominant latency and cost driver for large files.

### Requirements

#### R1 — Ingest-first ordering (atomicity)

The update path **must** create new content before removing old content.
The revised sequence for `FileAction::Update` is:

1. Ingest new content under a fresh temporary source row (new UUID, new S3
   object).
2. Only on ingest success: delete the old source row and its S3 object via
   `DeletePipeline::delete`.
3. On any ingest failure: leave the old source row untouched; propagate the
   error.

The brief window in which both source rows exist simultaneously (same
`filename` + `project`, different `id`) is acceptable. The existing
`get_sources_by_filenames` query already handles multiple rows per filename by
selecting the most-recently-created one (`created_at` tie-break in
`DirectoryIngestPipeline::ingest_directory` lines 187–196), so search
correctness is maintained during the window.

#### R2 — Stable source IDs across updates

External callers that store a `source.id` UUID must not have it invalidated
by a re-ingest. After implementing R1, the system will still mint a new UUID
for each update (the temporary row). R2 adds an in-place update step that
reuses the existing UUID and S3 key.

The revised sequence for R2 (supersedes the R1 sequence above):

1. Re-chunk and re-embed the new file content (with chunk-level reuse per R3).
2. Within a single database transaction:
   a. `UPDATE sources SET metadata = $new_meta, content_type = $ct WHERE id = $old_id`
   b. `DELETE FROM chunks WHERE source_id = $old_id`
   c. `INSERT INTO chunks ...` (new chunk rows, same `source_id = $old_id`)
3. `PUT` the new content to S3 under the existing key (`old_source.s3_key`).
   S3 `PutObject` is idempotent; on failure the old content remains readable.

Failure modes:
- If S3 `PutObject` fails before the DB transaction: no state change; surface
  error; old data intact.
- If DB transaction fails: S3 object may briefly hold new content while DB
  holds old metadata/chunks. On the next re-ingest the content hash will
  differ from the stored hash, triggering another update and self-healing.
- If S3 `PutObject` fails after the DB transaction commits: S3 object holds
  old bytes, DB holds new metadata/chunks. Same self-healing path.

Because S3 `PutObject` is not transactional with Postgres, full
read-your-writes consistency is not achievable without a two-phase protocol.
The chosen ordering (S3 first, then DB commit) is preferred so a crash after
S3 but before DB commit leaves the DB in the old state — the safer of the two
inconsistency directions.

#### R3 — Chunk-level embedding reuse

On update, only genuinely changed chunks should be re-embedded.

Algorithm:

1. Re-chunk the new file content using the same chunking path as today
   (`chunk_code` / `chunk_markdown` / `chunk_text` in
   `src/pipelines/ingest.rs` lines 68–97).
2. Query the existing chunks for the source:
   ```sql
   SELECT id, content, embedding, metadata FROM chunks WHERE source_id = $1
   ```
   This requires a new query (`queries::get_chunks_by_source`).
3. Build a `HashMap<String, pgvector::Vector>` keyed by SHA-256 of chunk
   content. The key is `sha256:<hex>` (same scheme as `content_hash` in
   `directory_ingest.rs` line 170).
4. For each new chunk:
   - If its content hash exists in the map: reuse the stored `Vector`.
   - Otherwise: add to the batch for `EmbeddingService::embed_batch`.
5. Proceed with `INSERT INTO chunks` using the blended vector set.

Matching is by **content hash, not chunk index**. A pure insertion at the top
of a file shifts all subsequent chunk indices but does not change their content.

This is valid for both text chunks (`TextChunk`) and code chunks (`CodeChunk`).
Code chunks carry additional metadata (`start_line`, `end_line`, `node_type`,
`context`) that may shift on edit; the chunk is still considered unchanged if
its `content` field is bit-for-bit identical.

### Success Criteria

- **SC1.** Re-ingesting an unchanged file (same content hash) continues to
  produce `skipped_unchanged`; no writes occur.
- **SC2.** Re-ingesting a changed file leaves a valid, searchable source
  record on every outcome: success, S3 failure, DB failure.
- **SC3.** After a successful update, the `source.id` UUID and `s3_key` are
  identical to those present before the update.
- **SC4.** Re-ingesting a file with one modified function in a 1 000-line
  Rust file produces zero embedding calls for unchanged chunks.
- **SC5.** The existing `skipped_unchanged` / `ingested` / `failed` counters
  in `IngestDirectorySummary` remain correct.
- **SC6.** The `CONCURRENCY_LIMIT` of 1 (line 19 in `directory_ingest.rs`)
  is preserved; no concurrent writes to the same source row are introduced.

### Out of Scope

- Atomic removal of files deleted from disk (not tracked in current design).
- Parallelising chunk embedding across multiple source files simultaneously.
- Schema migrations to add a content-hash column directly to `chunks` (hashes
  are computed at runtime from `chunk.content`).
- Changing the S3 key scheme (keys remain `source_id.to_string()`).
- Exposing chunk-level reuse statistics in `IngestDirectorySummary`.

### Open Questions

- **OQ1.** Should the S3 `PutObject` for R2 happen before or after the DB
  transaction? The spec recommends S3-first for safer failure semantics, but
  this means a crash between S3 write and DB commit leaves a stale S3 object
  that is overwritten on the next update. Confirm preference.
- **OQ2.** `delete_chunks_by_source` exists in `queries.rs` (line 158) and is
  currently unused. Should R2 use it inside the transaction, or issue a
  targeted delete of only chunks whose hashes are not in the new set (avoiding
  a full replace)?  The spec uses full replace for simplicity; partial replace
  avoids invalidating chunk UUIDs referenced by external systems.
- **OQ3.** `insert_chunks` uses `ON CONFLICT (source_id, chunk_index) DO
  NOTHING` (line 78). Under R2's full-replace path the old chunks are deleted
  before insert, so the conflict guard is never triggered. Verify this
  assumption holds when `CONCURRENCY_LIMIT` is raised in the future.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Add `queries::get_chunks_by_source` — new query returning `(id, content, embedding, metadata)` for a given `source_id`. Add unit test asserting correct SQL shape. | 0.5 days |
| Phase 2 | Add `queries::update_source_metadata` — `UPDATE sources SET metadata, content_type WHERE id` — and `queries::replace_chunks` — delete-then-batch-insert within a single `sqlx` transaction. | 0.5 days |
| Phase 3 | Implement chunk-level embedding reuse helper in `IngestPipeline` (or a new `UpdatePipeline`): re-chunk, hash new chunks, diff against old hash map, embed only novel chunks, merge vectors. | 1 day |
| Phase 4 | Implement `IngestPipeline::update_in_place(old_source: &Source, content, ...)` that orchestrates S3 `PutObject` then DB transaction (R2 sequence). On S3 failure return error with no DB change. On DB failure log warning (S3 already written). | 1 day |
| Phase 5 | Refactor `FileAction::Update` branch in `DirectoryIngestPipeline::ingest_directory` to call `update_in_place` instead of `delete` + `ingest`. Remove the `DeletePipeline` reference from the update branch. | 0.5 days |
| Phase 6 | Integration test: ingest a directory, mutate one file, re-ingest, assert source UUID unchanged, assert only changed-chunk embedding calls were made (spy on `EmbeddingService::embed_batch`), assert old data searchable until update completes. | 1 day |
| Phase 7 | Update `IngestDirectorySummary` docs and MCP tool description in `src/mcp/mod.rs` to reflect stable-ID semantics. | 0.25 days |

**Total estimated effort: ~4.75 days**

### Key Touch Points

| File | Change |
|------|--------|
| `src/db/queries.rs` | Add `get_chunks_by_source`, `update_source_metadata`, `replace_chunks` |
| `src/db/models.rs` | No schema changes; `Chunk` model already has all needed fields |
| `src/pipelines/ingest.rs` | Add `update_in_place` method; extract chunk-hashing helper |
| `src/pipelines/directory_ingest.rs` | Replace delete-then-ingest in `FileAction::Update` with `update_in_place` |
| `src/mcp/mod.rs` | Update `ingest_directory` tool description |
| `migrations/` | No new migrations required |
