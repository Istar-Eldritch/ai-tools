# Directory Ingest Rename and Deletion Detection

**Status**: Draft
**Created**: 2026-04-08T15:07:11Z
**Timestamp**: 2604081507

---

## PART I: Requirements

### Problem Statement

`DirectoryIngestPipeline::ingest_directory` (in `src/pipelines/directory_ingest.rs`) currently
operates on a closed-world assumption: it only considers files it finds on disk during the current
walk. Files that were previously indexed but are no longer present on disk — either because they
were deleted or renamed — are left behind as **orphan sources** in the database. These orphans
continue to surface in search results, polluting the knowledge base with stale or duplicated
content.

Two distinct cases must be handled:

1. **Deletion** — a file that existed in the previous ingest is absent from the current walk.
   The corresponding `Source` row (and its cascading `Chunk` rows) should be removed.

2. **Rename** — a file has been moved or renamed but its content is the same or substantially
   similar. The `Source` row should be updated in-place (preserving its UUID and S3 key) rather
   than deleted-and-recreated, keeping history intact and avoiding unnecessary re-embedding.

### Requirements

**R1 — Orphan detection**

After the directory walk and dedup-check phase, compute the set of orphan sources:

```
orphans = { s ∈ sources | s.metadata->>'directory' = ingest_path
                         AND (s.project = project OR both are NULL) }
          MINUS
          { sources matched by filename during the current walk }
```

This requires a new query — tentatively `get_sources_by_directory` in
`src/db/queries.rs` — that returns all `Source` rows whose metadata `directory` field matches
the current ingest path and project scope. The existing `get_sources_by_filenames`
(which filters by `filename = ANY($1)`) is scoped to known filenames and cannot enumerate
unknowns.

**R2 — Fuzzy rename detection (chunk-overlap heuristic)**

For each orphan, attempt rename detection before deletion:

1. Re-chunk each unmatched disk file (files in `actions` that resolved to `FileAction::New`)
   using the same `chunk_code` / `chunk_markdown` / `chunk_text` dispatch already used in
   `IngestPipeline::update_in_place` (`src/pipelines/ingest.rs`, lines 159–189).

2. Compute SHA-256 hashes of the new file's chunks (identical to the hashing already used in
   `update_in_place`, line 197: `format!("{:x}", Sha256::digest(chunk.content.as_bytes()))`).

3. Fetch the orphan's existing chunk hashes via `get_chunks_by_source`
   (`src/db/queries.rs`, line 158).

4. Compute overlap ratio:

   ```
   overlap = |new_chunk_hashes ∩ orphan_chunk_hashes| / |orphan_chunk_hashes|
   ```

5. Decision:
   - **overlap = 1.0 (100%)** — pure rename, content unchanged. Update `sources.filename`
     and `sources.metadata` in-place; do not re-embed. Requires a new
     `rename_source` query.
   - **0.5 ≤ overlap < 1.0 (≥50%)** — rename-with-modification. Route through the existing
     `update_in_place` path but targeting the orphan's `Source` row instead of creating a new
     source.
   - **overlap < 0.5** — no rename relationship. The new file is treated as a genuine new
     ingest (`FileAction::New` unchanged); the orphan proceeds to deletion.

When multiple new files match the same orphan above the threshold, take the one with the
highest overlap ratio.

**R3 — Orphan deletion (default on)**

Orphans that survive rename detection (overlap < 0.5, or no candidate new files exist) are
deleted. Deletion calls `DeletePipeline::delete` (`src/pipelines/delete.rs`, line 19), which
invokes `queries::delete_source` (cascades chunks via `ON DELETE CASCADE`) followed by
`storage.delete_object` for the S3 object.

Deletion is **on by default**. Orphans degrade search quality; the content is re-indexable on
the next ingest. This behavior may be made opt-out via a future `delete_orphans: bool`
parameter on `IngestDirectoryParams`, but that is out of scope for this spec.

Counts of renamed and deleted sources are appended to `IngestDirectorySummary` as new fields:
`renamed` and `deleted_orphans`.

### Success Criteria

- After a rename (file moved within the indexed directory tree), re-running `ingest_directory`
  on the same path results in zero orphan sources and the `Source` UUID is preserved.
- After a file deletion, re-running `ingest_directory` removes the corresponding source from
  search results.
- Pure renames (100% overlap) do not trigger embedding calls.
- Rename+modify cases (≥50% overlap) reuse unchanged chunk embeddings via the existing
  `update_in_place` embedding-reuse logic.
- The `IngestDirectorySummary` returned to the MCP caller accurately reports `renamed` and
  `deleted_orphans` counts.
- No regressions in the existing `skipped_unchanged`, `ingested`, and `failed` counters.

### Out of Scope

- Cross-directory rename detection (orphan and new file in different `directory` values).
- Configurable overlap threshold (threshold is hardcoded at 0.5 for this iteration).
- Opt-in/opt-out of orphan deletion (always on).
- Rename detection for binary or empty files (these are already excluded from `prepared`
  before orphan logic runs).

### Open Questions

1. **Denominator choice for overlap ratio.** The spec uses `|orphan_chunk_hashes|` as the
   denominator, which is robust when a renamed file grows significantly. An alternative is
   `max(|new|, |orphan|)`. Decision deferred to implementation.

2. **Multiple rename candidates.** If two new files score above the 0.5 threshold against the
   same orphan, the highest-overlap candidate wins. If there is a tie, the lexicographically
   earlier `relative_path` wins. This is a simple tiebreak; a smarter heuristic (e.g. edit
   distance on filenames) is out of scope.

3. **Cancellation interaction.** The orphan deletion phase runs after the main ingest stream.
   Whether cancellation (via `CancellationToken`) short-circuits the deletion phase needs to
   be decided at implementation time. Safest default: honour cancellation and skip deletion
   if cancelled before it starts.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | **New DB query: `get_sources_by_directory`** — add to `src/db/queries.rs`. Query: `SELECT * FROM sources WHERE metadata->>'directory' = $1 AND ($2::text IS NULL OR project = $2)`. Returns `Vec<Source>`. Add unit test in the same file. | 0.5 days |
| Phase 2 | **New DB query: `rename_source`** — add to `src/db/queries.rs`. Updates `sources.filename` and `sources.metadata` for a given source ID (pure rename, no chunk or S3 changes). Signature: `rename_source(pool, source_id: Uuid, new_filename: &str, new_metadata: &serde_json::Value) -> AppResult<Source>`. | 0.5 days |
| Phase 3 | **Orphan identification in `ingest_directory`** — after the `source_map` and `actions` partition loop, call `get_sources_by_directory` to fetch all directory-scoped sources, then subtract filenames already covered by `source_map` (matched files) to produce an `orphans: Vec<Source>` list. | 0.5 days |
| Phase 4 | **Rename detection loop** — for each candidate `FileAction::New` file, re-chunk and hash its chunks. For each orphan, compute overlap ratios against all New-file candidates. Classify matches per R2. Convert matched New files to `FileAction::Rename { file, orphan_source }` or `FileAction::RenameModify { file, orphan_source }` variants added to the `FileAction` enum. Remove matched New files from the orphan deletion list. | 1.5 days |
| Phase 5 | **Dispatch rename actions** — in the `stream::iter(actions)` loop, handle the two new `FileAction` variants: `Rename` calls `rename_source`; `RenameModify` calls `ingest.update_in_place` with the orphan's `Source` row (same path used today for `FileAction::Update`). | 0.5 days |
| Phase 6 | **Orphan deletion phase** — after the main stream completes (and only if not cancelled), iterate remaining orphans and call `self.delete.delete(orphan.id)`. Collect errors into `summary.errors`. Increment `summary.deleted_orphans`. | 0.5 days |
| Phase 7 | **`IngestDirectorySummary` additions** — add `renamed: u64` and `deleted_orphans: u64` fields to the struct in `src/pipelines/directory_ingest.rs`. Update `total_files_matched` calculation to include `renamed`. Update MCP tool description in `src/mcp/mod.rs`. | 0.25 days |
| Phase 8 | **Tests** — integration tests covering: pure rename, rename+modify, file deletion, no-op (no orphans), multi-candidate tiebreak, cancellation before deletion phase. | 1.5 days |

**Total estimated effort: ~5.75 days**
