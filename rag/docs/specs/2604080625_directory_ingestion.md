# Directory Ingestion

**Status**: Draft
**Created**: 2026-04-08T06:25:00Z
**Timestamp**: 2604080625
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md)

---

## PART I: Requirements

### Problem Statement

The current `ingest` MCP tool accepts a single document's content as a string parameter. Ingesting an entire codebase (hundreds or thousands of files) requires the MCP client to read every file, send each one as a separate tool call, and manage retries — all in serial. For a project with 1400+ files this is impractical.

A new `ingest_directory` MCP tool is needed that accepts a filesystem path and glob patterns, walks the directory server-side, infers content types, deduplicates against previously ingested files, and processes everything with bounded concurrency. The tool reuses the existing `IngestPipeline` for each file and returns a summary of what was ingested, skipped, and failed.

### Requirements

- **R1** — New MCP tool `ingest_directory` with parameters:
  - `path: String` (required) — absolute path to a directory on the server's filesystem.
  - `include: Vec<String>` (required) — glob patterns for files to include (e.g., `["**/*.rs", "**/*.md"]`). At least one pattern must be provided.
  - `exclude: Option<Vec<String>>` — glob patterns for files to exclude (e.g., `["**/target/**", "**/node_modules/**"]`). Applied after include. Defaults to empty.
  - `metadata: Option<serde_json::Value>` — JSON object attached to every ingested source record. The tool also injects `"directory": "<path>"` into this object so sources can later be queried by their ingestion root.

- **R2** — Directory walking: use `walkdir` crate to recursively traverse `path`. Follow symlinks is off by default. Only regular files are considered (directories, pipes, sockets are skipped). Paths that fail to read (permission errors) are logged and counted as errors in the summary, not fatal.

- **R3** — Pattern matching: use `globset` crate to compile `include` and `exclude` into matchers. A file is eligible if it matches at least one include pattern AND does not match any exclude pattern. Patterns are matched against the file's path relative to the ingestion root (e.g., `core/src/auth/mod.rs`).

- **R4** — Binary file detection: before reading file content, check if the first 8192 bytes contain a NUL byte (`0x00`). If so, skip the file as binary. Count it in the summary under `skipped_binary`.

- **R5** — Content type inference from file extension:

  | Extension(s) | Content Type | Chunking Strategy |
  |---|---|---|
  | `.rs` | `text/x-rust` | code (Rust) |
  | `.py` | `text/x-python` | code (Python) |
  | `.ts`, `.tsx` | `text/typescript` | code (TypeScript) |
  | `.java` | `text/x-java` | code (Java) |
  | `.js`, `.jsx` | `text/javascript` | text |
  | `.md` | `text/markdown` | markdown |
  | `.html`, `.htm` | `text/html` | text |
  | `.yaml`, `.yml` | `text/yaml` | text |
  | `.toml` | `text/toml` | text |
  | `.json` | `application/json` | text |
  | `.sql` | `text/sql` | text |
  | `.sh` | `text/x-shellscript` | text |
  | everything else | `text/plain` | text |

  The mapping is a pure function, no external crate needed. The existing `detect_language()` in the ingest pipeline determines the actual chunking strategy from the filename; the content type is stored on the source record for informational purposes.

- **R6** — Deduplication via content hash:
  - Compute SHA-256 of the file content. Store as `"content_hash": "sha256:<hex>"` in the source's metadata.
  - Before ingesting, query the DB for existing sources with the same `filename`. If a source exists with the same filename and its `metadata->'content_hash'` matches, skip the file.
  - This requires a new query: `get_sources_by_filenames(pool, filenames: &[&str]) -> AppResult<Vec<Source>>`.
  - Dedup is best-effort. Race conditions between concurrent ingestions are acceptable — worst case a file is ingested twice, which is the existing behavior.

- **R7** — Filename convention: the `filename` stored on the source record is the file's path relative to the ingestion root. For example, ingesting `/home/rpaz/code/catacloud` with a file at `/home/rpaz/code/catacloud/core/src/auth/mod.rs` produces `filename = "core/src/auth/mod.rs"`. This makes filename glob filtering in the search tool meaningful across directory structures.

- **R8** — Bounded concurrency: files are ingested with bounded parallelism using `tokio::sync::Semaphore` or `futures::stream::StreamExt::buffer_unordered`. The concurrency limit defaults to 8 (matches typical DB pool size) and is not user-configurable in v1. Each file goes through the full existing `IngestPipeline::ingest()` flow (validate, insert source, upload S3, chunk, embed, insert chunks).

- **R9** — Summary response: the tool returns a JSON object:
  ```json
  {
    "ingested": 412,
    "skipped_unchanged": 98,
    "skipped_binary": 14,
    "skipped_empty": 2,
    "failed": 3,
    "errors": ["core/bad_file.rs: embedding failed: ONNX error"],
    "total_files_matched": 529
  }
  ```
  `errors` contains up to 50 error messages (truncated with "... and N more" if exceeded). Individual file failures do not abort the entire operation.

- **R10** — Input validation:
  - `path` must be an existing directory; return `AppError::Validation` if not.
  - `include` must be non-empty; return `AppError::Validation` if empty.
  - `metadata`, if provided, must be a JSON object; return `AppError::Validation` if not.
  - All glob patterns must compile; return `AppError::Validation` listing the invalid pattern if not.

- **R11** — Re-ingestion (update) semantics: when a file's content has changed (different hash from existing source), the old source is deleted first (via `DeletePipeline::delete` or `queries::delete_source`, which cascades to chunks and S3), then the new content is ingested. This ensures one source record per filename per directory — no accumulation of stale versions.

- **R12** — New Cargo dependencies: `walkdir`, `globset`, `sha2`. All three are well-established, audited crates with no transitive security concerns.

### Success Criteria

- [ ] `ingest_directory("/nonexistent", ["*.rs"])` returns `AppError::Validation`
- [ ] `ingest_directory("/some/dir", [])` returns `AppError::Validation` (empty include)
- [ ] Ingesting a directory with 5 `.rs` files and 3 `.md` files with `include: ["**/*.rs"]` ingests exactly 5 files
- [ ] Ingesting the same directory a second time with identical content skips all 5 files (`skipped_unchanged: 5, ingested: 0`)
- [ ] Modifying one file and re-ingesting produces `ingested: 1, skipped_unchanged: 4`
- [ ] A binary file (e.g., `.png`) matched by include patterns is counted as `skipped_binary`
- [ ] An empty file is counted as `skipped_empty`
- [ ] A file with read permission denied is counted in `failed` with an error message
- [ ] `exclude: ["**/test/**"]` prevents files under `test/` directories from being ingested
- [ ] Source records have `filename` as relative path (e.g., `src/main.rs`, not `/abs/path/src/main.rs`)
- [ ] Source metadata contains `"directory": "/abs/path"` and `"content_hash": "sha256:..."`
- [ ] MCP `ingest_directory` tool appears in `tools/list` with correct JSON schema
- [ ] All existing tests pass unchanged under `cargo test`

### Out of Scope

- **Streaming progress updates** — the tool blocks until complete and returns the full summary. MCP progress notifications can be added in a follow-up.
- **Configurable concurrency** — hardcoded to 8 for v1.
- **Watch mode / filesystem notifications** — no automatic re-ingestion on file change.
- **Partial directory re-ingestion** — the tool always walks the full directory; there is no "only ingest files changed since timestamp X" mode.
- **Gitignore integration** — exclude patterns are explicit; `.gitignore` is not parsed automatically.
- **Symlink following** — symlinks are not followed to avoid infinite loops.
- **Remote paths** — only local filesystem paths are supported.
- **Chunk-level metadata enrichment** — the tool does not add directory-level info to chunk metadata; only source metadata.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Add dependencies (`walkdir`, `globset`, `sha2`); content type inference helper; binary detection helper; `get_sources_by_filenames` query | 0.5 d |
| Phase 2 | `DirectoryIngestPipeline` struct with directory walking, pattern matching, dedup logic, and bounded-concurrency ingestion loop | 1.5 d |
| Phase 3 | MCP tool registration (`IngestDirectoryParams`, `IngestDirectorySummary`, tool wiring) | 0.5 d |
| Phase 4 | Integration tests: happy path, dedup, re-ingest, binary skip, permission error, pattern matching, validation | 1 d |

**Total estimate**: 3.5 days

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/
  db/
    queries.rs          -- add: get_sources_by_filenames()
  pipelines/
    mod.rs              -- add: pub mod directory_ingest;
    directory_ingest.rs  -- new: DirectoryIngestPipeline, walking, dedup, concurrency
  mcp/
    mod.rs              -- add: IngestDirectoryParams, tool wiring
```

### 3.2 Content Type Inference

A pure function in `src/pipelines/directory_ingest.rs`:

```rust
fn infer_content_type(filename: &str) -> &'static str {
    match std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("rs") => "text/x-rust",
        Some("py") => "text/x-python",
        Some("ts" | "tsx") => "text/typescript",
        Some("java") => "text/x-java",
        Some("js" | "jsx") => "text/javascript",
        Some("md") => "text/markdown",
        Some("html" | "htm") => "text/html",
        Some("yaml" | "yml") => "text/yaml",
        Some("toml") => "text/toml",
        Some("json") => "application/json",
        Some("sql") => "text/sql",
        Some("sh") => "text/x-shellscript",
        _ => "text/plain",
    }
}
```

### 3.3 Binary Detection

```rust
fn is_binary(content: &[u8]) -> bool {
    let check_len = content.len().min(8192);
    content[..check_len].contains(&0)
}
```

### 3.4 Content Hashing

```rust
use sha2::{Sha256, Digest};

fn content_hash(content: &str) -> String {
    let hash = Sha256::digest(content.as_bytes());
    format!("sha256:{hash:x}")
}
```

### 3.5 New Query: `get_sources_by_filenames`

Added to `src/db/queries.rs`:

```rust
pub async fn get_sources_by_filenames(
    pool: &PgPool,
    filenames: &[&str],
) -> AppResult<Vec<Source>> {
    let rows = sqlx::query_as::<_, Source>(
        "SELECT * FROM sources WHERE filename = ANY($1)"
    )
    .bind(filenames)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
```

This returns all sources matching any of the given filenames. The caller groups by filename to check hashes. For filenames that map to multiple source records (from prior non-deduped ingestions), only the most recently created one is considered for hash comparison.

### 3.6 `DirectoryIngestPipeline`

```rust
// src/pipelines/directory_ingest.rs

use std::path::Path;
use globset::{Glob, GlobSetBuilder};
use walkdir::WalkDir;
use tokio::sync::Semaphore;

pub struct DirectoryIngestPipeline {
    ingest: IngestPipeline,
    delete: DeletePipeline,
    pool: PgPool,
}
```

### 3.7 Main Orchestration Method

```rust
pub struct IngestDirectorySummary {
    pub ingested: u64,
    pub skipped_unchanged: u64,
    pub skipped_binary: u64,
    pub skipped_empty: u64,
    pub failed: u64,
    pub errors: Vec<String>,
    pub total_files_matched: u64,
}

impl DirectoryIngestPipeline {
    pub async fn ingest_directory(
        &self,
        path: &str,
        include: &[String],
        exclude: &[String],
        metadata: serde_json::Value,
    ) -> AppResult<IngestDirectorySummary> { ... }
}
```

**Algorithm:**

1. Validate inputs (R10).
2. Compile include/exclude glob sets.
3. Walk directory, collect eligible files (matching include, not matching exclude).
4. Read all file contents into memory. For each file:
   a. Read bytes. On failure: count as `failed`, record error, continue.
   b. Check binary (R4). If binary: count as `skipped_binary`, continue.
   c. Decode as UTF-8. On failure: count as `failed`, record error, continue.
   d. Check empty (R4). If empty after trim: count as `skipped_empty`, continue.
   e. Compute content hash.
   f. Record `(relative_path, content, content_type, hash)` tuple.
5. Batch-query existing sources by filenames (R6, §3.5).
6. Build a hash map of `filename -> most_recent_source` from existing records.
7. Partition files into:
   - **skip** — filename exists with same hash → `skipped_unchanged`
   - **update** — filename exists with different hash → delete old source, then ingest
   - **new** — filename does not exist → ingest
8. Process **update** and **new** files with bounded concurrency (R8):
   - For updates: delete the old source first, then ingest.
   - For new files: ingest directly.
   - On per-file error: count as `failed`, record error, continue.
9. Assemble and return `IngestDirectorySummary`.

### 3.8 Bounded Concurrency Pattern

```rust
use futures::stream::{self, StreamExt};

const CONCURRENCY_LIMIT: usize = 8;

let results: Vec<Result<(), (String, String)>> = stream::iter(files_to_ingest)
    .map(|file| {
        let pipeline = self.ingest.clone();
        async move {
            pipeline.ingest(&file.content, &file.filename, &file.content_type, file.metadata.clone())
                .await
                .map(|_| ())
                .map_err(|e| (file.filename.clone(), e.to_string()))
        }
    })
    .buffer_unordered(CONCURRENCY_LIMIT)
    .collect()
    .await;
```

### 3.9 Metadata Injection

The tool merges user-provided metadata with the automatically injected fields:

```rust
fn build_file_metadata(
    user_metadata: &serde_json::Value,
    directory: &str,
    hash: &str,
) -> serde_json::Value {
    let mut meta = user_metadata.clone();
    let obj = meta.as_object_mut().unwrap(); // validated as object in R10
    obj.insert("directory".into(), serde_json::Value::String(directory.into()));
    obj.insert("content_hash".into(), serde_json::Value::String(hash.into()));
    meta
}
```

### 3.10 MCP Tool Registration

```rust
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IngestDirectoryParams {
    /// Absolute path to a directory on the local filesystem.
    pub path: String,
    /// Glob patterns for files to include (e.g., ["**/*.rs", "**/*.md"]).
    /// At least one pattern is required.
    pub include: Vec<String>,
    /// Glob patterns for files to exclude (e.g., ["**/target/**"]).
    /// Applied after include. Defaults to empty.
    pub exclude: Option<Vec<String>>,
    /// Arbitrary JSON metadata attached to every ingested source.
    /// Must be a JSON object if provided.
    pub metadata: Option<serde_json::Value>,
}
```

Tool method:

```rust
#[tool(description = "Ingest all matching files from a local directory into the knowledge base. \
    Walks the directory recursively, filters by include/exclude glob patterns, \
    detects binary files, deduplicates by content hash, and ingests with bounded concurrency. \
    Returns a summary with counts of ingested, skipped, and failed files.")]
async fn ingest_directory(
    &self,
    Parameters(params): Parameters<IngestDirectoryParams>,
) -> Result<CallToolResult, McpError> {
    let metadata = params.metadata
        .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
    let exclude = params.exclude.unwrap_or_default();
    let summary = self.directory_ingest
        .ingest_directory(&params.path, &params.include, &exclude, metadata)
        .await
        .map_err(app_error_to_mcp_error)?;
    let json = serde_json::to_string(&summary)
        .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
    Ok(CallToolResult::success(vec![Content::text(json)]))
}
```

### 3.11 `McpServer` Changes

`McpServer` gains a `directory_ingest: DirectoryIngestPipeline` field, constructed in `main.rs` after the existing pipelines:

```rust
let directory_ingest = DirectoryIngestPipeline::new(
    ingest_pipeline.clone(),
    delete_pipeline.clone(),
    pool.clone(),
);

let server = McpServer::new(
    ingest_pipeline,
    search_pipeline,
    delete_pipeline,
    directory_ingest,
);
```

### 3.12 Re-ingestion (Update) Flow

When a file has changed:

1. Look up the existing `Source` record for the filename.
2. Call `queries::delete_source(pool, old_source.id)` — this cascades to chunks and then delete the S3 object via `storage.delete_object(&old_source.s3_key)`.
3. Call `IngestPipeline::ingest()` with the new content.

This is a delete-then-insert, not an in-place update. It reuses the existing compensating cleanup in the ingest pipeline if the re-insert fails.

### 3.13 Integration Test Outline

Tests live in `tests/directory_ingest.rs`. They use testcontainers for PostgreSQL and create a temporary directory with known files.

```
ingest_directory_basic
    -- create temp dir with 3 .rs files and 2 .md files
    -- ingest with include: ["**/*.rs"]
    -- assert summary.ingested == 3, summary.total_files_matched == 3

ingest_directory_dedup_unchanged
    -- ingest same directory twice with identical content
    -- second call: summary.ingested == 0, summary.skipped_unchanged == 3

ingest_directory_dedup_changed
    -- ingest, modify one file, re-ingest
    -- second call: summary.ingested == 1, summary.skipped_unchanged == 2

ingest_directory_exclude_pattern
    -- create temp dir with files in test/ and src/ subdirs
    -- include: ["**/*.rs"], exclude: ["**/test/**"]
    -- assert only src/ files are ingested

ingest_directory_binary_skip
    -- create temp dir with one text file and one binary file (NUL bytes)
    -- assert summary.skipped_binary == 1

ingest_directory_empty_skip
    -- create temp dir with an empty .rs file
    -- assert summary.skipped_empty == 1

ingest_directory_invalid_path
    -- pass a non-existent path
    -- assert AppError::Validation

ingest_directory_empty_include
    -- pass empty include list
    -- assert AppError::Validation

ingest_directory_relative_filenames
    -- ingest and verify source.filename is relative (not absolute)

ingest_directory_metadata_injection
    -- ingest with metadata: {"project": "test"}
    -- verify source.metadata contains "project", "directory", and "content_hash"
```

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|-------------------|
| Q1 | Should the concurrency limit be configurable via a tool parameter? | No for v1. Hardcode 8. Add parameter in follow-up if needed. |
| Q2 | Should `.gitignore` be parsed automatically for exclude patterns? | No for v1. Explicit exclude patterns only. `ignore` crate could be added later. |
| Q3 | Should symlinks be followed? | No. Avoids infinite loops. Can be added as an opt-in parameter later. |
| Q4 | Should the tool support incremental re-ingestion (only files changed since a timestamp)? | No. The hash-based dedup achieves the same effect at the cost of reading all files. Timestamp-based filtering is a follow-up optimization. |
| Q5 | Should large files (>N MB) be skipped or chunked differently? | No special handling for v1. The existing chunking pipeline handles large files. A size limit parameter could be added later. |
| Q6 | Should `get_sources_by_filenames` use a batch query or individual lookups? | Batch query with `ANY($1)` for efficiency. Single round-trip for all filenames. |
| Q7 | What happens if two concurrent `ingest_directory` calls target overlapping files? | Race condition — both may ingest the same file. Acceptable for v1. A locking mechanism (advisory locks) could be added later. |
