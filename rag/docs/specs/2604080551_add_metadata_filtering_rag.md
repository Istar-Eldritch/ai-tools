# Search Metadata Filtering

**Status**: Draft
**Created**: 2026-04-08T05:51:22Z
**Timestamp**: 2604080551
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md)

---

## PART I: Requirements

### Problem Statement

The current `search` MCP tool returns results from across the entire corpus regardless of which source files they came from or what metadata is attached to those sources. Callers have no way to scope a query to a subset of the knowledge base.

Two complementary filters are needed: a filename glob pattern that limits results to chunks from sources whose filename matches the pattern, and a JSONB containment filter that limits results to sources whose metadata contains a specified key/value subset. Both filters are additive (AND semantics) and entirely optional, so existing callers with no filter arguments see identical behavior.

Both filters operate exclusively on the `sources` table. No chunk-level metadata filtering is in scope for this feature.

### Requirements

- **R1** — New optional fields on `SearchParams` (`src/mcp/mod.rs`):
  - `filename_glob: Option<String>` — a glob pattern matched against `sources.filename` (case-sensitive). Supported metacharacters: `*` (matches any sequence of characters) and `?` (matches exactly one character). No globstar (`**`) or character classes (`[abc]`) in scope.
  - `source_metadata: Option<serde_json::Value>` — a JSON object. A source row matches if its `sources.metadata` column contains every key/value pair present in this value (PostgreSQL `@>` JSONB containment operator). Must be a JSON object if provided; other JSON types (array, string, number, boolean, null) are rejected with `AppError::Validation` before any DB operation.

- **R2** — Glob-to-LIKE translation helper `glob_to_like(pattern: &str) -> String` (`src/db/queries.rs` or a new `src/db/filters.rs`):
  - Iterates over the characters of `pattern`.
  - Replaces `*` with `%`.
  - Replaces `?` with `_`.
  - Escapes SQL LIKE special characters that appear literally in the input: `%` → `\%`, `_` → `\_`, `\` → `\\`.
  - The escape character is `\`. The resulting LIKE expression is used with `LIKE pattern ESCAPE '\'` in SQL.
  - Returns a `String`; the function is pure and infallible.

- **R3** — Modified `search_chunks` query with conditional WHERE clauses (`src/db/queries.rs`):
  - The function signature gains two new optional parameters: `filename_like: Option<&str>` and `source_metadata: Option<&serde_json::Value>`.
  - The SQL query adds a WHERE clause using the `IS NULL OR` pattern so that `NULL` parameter bindings act as no-ops:
    ```sql
    WHERE ($3::text IS NULL OR s.filename LIKE $3 ESCAPE '\')
      AND ($4::jsonb IS NULL OR s.metadata @> $4)
    ```
  - Parameter positions: `$1` = embedding vector, `$2` = k, `$3` = filename LIKE pattern (or NULL), `$4` = source_metadata JSON (or NULL).
  - `filename_like` is the result of calling `glob_to_like` on the raw glob string; the caller (pipeline layer) performs this translation before calling `search_chunks`.
  - When both `$3` and `$4` are NULL the query is semantically identical to the current unfiltered query. pgvector performs filtered HNSW scan when filters are active; no pre-filtering subquery is used.
  - Empty result set returns `Ok(vec![])`, not an error. No fallback to unfiltered search.

- **R4** — Updated `SearchPipeline::search` signature (`src/pipelines/search.rs`):
  - New signature: `pub async fn search(&self, query: &str, k: i64, filters: SearchFilter) -> AppResult<Vec<SearchResult>>`.
  - `SearchFilter` is a plain struct defined in `src/pipelines/search.rs` (see §3.1).
  - The pipeline is responsible for:
    1. Validating `query` and `k` as before.
    2. If `filters.source_metadata` is `Some(v)` and `v` is not a JSON object, returning `Err(AppError::Validation("source_metadata filter must be a JSON object".into()))`.
    3. Translating `filters.filename_glob` via `glob_to_like` to produce `filename_like: Option<String>`.
    4. Embedding the query as before.
    5. Calling `queries::search_chunks(&self.pool, &query_vector, k, filename_like.as_deref(), filters.source_metadata.as_ref())`.

- **R5** — MCP search tool wiring (`src/mcp/mod.rs`):
  - `SearchParams` gains `filename_glob: Option<String>` and `source_metadata: Option<serde_json::Value>` fields.
  - The `search` tool method constructs a `SearchFilter` from these fields and passes it to `self.search.search(...)`.
  - No other MCP layer changes.

- **R6** — No new Cargo dependencies: `serde_json`, `sqlx`, and `pgvector` are already in `Cargo.toml`. The LIKE translation helper uses only the Rust standard library. No external glob or regex crate is needed.

- **R7** — Backward compatibility: all filter fields are `Option` and default to `None` when absent. Existing callers that supply only `query` and `k` see exactly the same behavior as before. The `search` tool description is updated to document the new optional parameters.

### Success Criteria

- [ ] `search("query", 5, SearchFilter::default())` on an empty corpus returns `Ok(vec![])` — identical to current behavior
- [ ] `search("query", 5, SearchFilter { filename_glob: Some("*.md".into()), ..Default::default() })` with ingested `.md` and `.rs` sources returns only chunks from `.md` sources
- [ ] `search("query", 5, SearchFilter { filename_glob: Some("src/?.rs".into()), ..Default::default() })` matches sources with single-character basenames
- [ ] `search("query", 5, SearchFilter { source_metadata: Some(json!({"project": "rag"})), ..Default::default() })` returns only chunks from sources whose metadata contains `"project": "rag"`
- [ ] Both filters combined with AND: a source must match both glob and metadata containment to appear in results
- [ ] `search("query", 5, SearchFilter { source_metadata: Some(json!([1, 2, 3])), ..Default::default() })` returns `Err(AppError::Validation(...))` — non-object JSON rejected before DB
- [ ] `search("query", 5, SearchFilter { filename_glob: Some("no_match_*".into()), ..Default::default() })` returns `Ok(vec![])` — no fallback to unfiltered
- [ ] `glob_to_like("*.md")` == `"%.md"` (unit test)
- [ ] `glob_to_like("src/?.rs")` == `"src/_.rs"` (unit test)
- [ ] `glob_to_like("100%_off")` == `r"100\%\_off"` — SQL special chars escaped (unit test)
- [ ] `glob_to_like("path\\to\\file")` == `r"path\\to\\file"` — backslash doubled (unit test)
- [ ] MCP `search` tool accepts `filename_glob` and `source_metadata` in its JSON schema (visible in `tools/list`)
- [ ] Callers that omit both new fields receive the same results as before the change
- [ ] All existing unit and integration tests pass unchanged under `cargo test`

### Out of Scope

The following are explicitly deferred and must not be implemented in this feature:

- **Chunk-level metadata filtering** — `chunks.metadata` is not filtered; only `sources.metadata` and `sources.filename` are in scope.
- **Globstar (`**`) patterns** — multi-segment path matching is not implemented; `**` is treated as two consecutive `*` wildcards (both map to `%`), which is a passable approximation but not a correct globstar.
- **Character classes (`[abc]`, `[a-z]`)** — POSIX character class syntax is not translated; these characters pass through as literals (no SQL LIKE equivalent).
- **Case-insensitive glob matching** — `LIKE` is case-sensitive in PostgreSQL for non-`citext` columns. Case-insensitive matching (`ILIKE`) is a follow-up.
- **JSONB path filtering** — the `source_metadata` filter uses `@>` containment only; JSONPath (`jsonb_path_exists`) queries are not in scope.
- **Chunk metadata filtering** — searching by `chunks.metadata` is not in scope.
- **Similarity threshold filtering** — already deferred in the search pipeline spec.
- **Pre-filtering subquery** — the filtered and similarity ORDER BY are in the same query; no two-phase retrieval.
- **Fallback to unfiltered search** — if filters produce zero results, the empty vec is returned as-is.
- **`list_sources` tool** — deferred per epic scope.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | `glob_to_like` helper with unit tests; `SearchFilter` struct; modify `search_chunks` signature and SQL | 0.5 d |
| Phase 2 | Update `SearchPipeline::search` to accept `SearchFilter`, validate `source_metadata` type, translate glob, pass filters to query | 0.5 d |
| Phase 3 | Update `SearchParams` with new optional fields; wire into `McpServer::search` tool method; update tool description | 0.25 d |
| Phase 4 | Integration tests: filename glob filter, metadata containment filter, combined filters, no-match returns empty, unfiltered callers unchanged | 0.75 d |

**Total estimate**: 2 days

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/
  db/
    queries.rs        -- modify: search_chunks gains filename_like + source_metadata params; add glob_to_like
  pipelines/
    search.rs         -- add: SearchFilter struct; modify: search() signature
  mcp/
    mod.rs            -- modify: SearchParams gains filename_glob + source_metadata; wire SearchFilter
```

No new files are required. No Cargo dependencies are added.

### 3.2 `SearchFilter` Struct

Defined in `src/pipelines/search.rs`, alongside `SearchPipeline`:

```rust
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
}
```

`SearchFilter` derives `Default` so call sites can use `SearchFilter::default()` or struct-update syntax.

### 3.3 `glob_to_like` Translation Function

Added to `src/db/queries.rs` (or extracted to `src/db/filters.rs` if the file grows large):

```rust
/// Translates a glob pattern to a SQL LIKE pattern.
///
/// Metacharacter mapping:
/// - `*`  →  `%`  (match any sequence)
/// - `?`  →  `_`  (match exactly one character)
///
/// SQL LIKE special characters that appear literally in the input are escaped
/// with a backslash so they are treated as literals:
/// - `%`  →  `\%`
/// - `_`  →  `\_`
/// - `\`  →  `\\`
///
/// Use the result with `LIKE $n ESCAPE '\'` in SQL.
pub fn glob_to_like(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len() + 4);
    for ch in pattern.chars() {
        match ch {
            '*'  => out.push('%'),
            '?'  => out.push('_'),
            '%'  => { out.push('\\'); out.push('%'); }
            '_'  => { out.push('\\'); out.push('_'); }
            '\\' => { out.push('\\'); out.push('\\'); }
            c    => out.push(c),
        }
    }
    out
}
```

Unit tests live directly below the function in a `#[cfg(test)]` block:

```rust
#[cfg(test)]
mod glob_tests {
    use super::glob_to_like;

    #[test]
    fn star_becomes_percent() {
        assert_eq!(glob_to_like("*.md"), "%.md");
    }

    #[test]
    fn question_becomes_underscore() {
        assert_eq!(glob_to_like("src/?.rs"), "src/_.rs");
    }

    #[test]
    fn literal_percent_escaped() {
        assert_eq!(glob_to_like("100%off"), r"100\%off");
    }

    #[test]
    fn literal_underscore_escaped() {
        assert_eq!(glob_to_like("some_file"), r"some\_file");
    }

    #[test]
    fn backslash_doubled() {
        assert_eq!(glob_to_like(r"path\to"), r"path\\to");
    }

    #[test]
    fn combined_metacharacters() {
        assert_eq!(glob_to_like("docs/*.md"), "docs/%.md");
    }

    #[test]
    fn empty_pattern() {
        assert_eq!(glob_to_like(""), "");
    }

    #[test]
    fn no_metacharacters() {
        assert_eq!(glob_to_like("README.md"), "README.md");
    }
}
```

### 3.4 Modified `search_chunks` Signature and SQL

```rust
// src/db/queries.rs

pub async fn search_chunks(
    pool: &PgPool,
    embedding: &Vector,
    k: i64,
    filename_like: Option<&str>,
    source_metadata: Option<&serde_json::Value>,
) -> AppResult<Vec<SearchResult>> {
    let rows = sqlx::query_as::<_, SearchResult>(
        "SELECT
             c.id          AS chunk_id,
             c.source_id,
             c.chunk_index,
             c.content,
             s.filename    AS source_filename,
             s.metadata    AS source_metadata,
             c.metadata    AS chunk_metadata,
             1.0 - (c.embedding <=> $1) AS similarity
         FROM chunks c
         JOIN sources s ON s.id = c.source_id
         WHERE ($3::text IS NULL OR s.filename LIKE $3 ESCAPE '\\')
           AND ($4::jsonb IS NULL OR s.metadata @> $4)
         ORDER BY c.embedding <=> $1
         LIMIT $2"
    )
    .bind(embedding)
    .bind(k)
    .bind(filename_like)
    .bind(source_metadata)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
```

Key design points:

- `$3::text IS NULL OR` — when `filename_like` is bound as SQL `NULL`, the cast `$3::text` resolves to `NULL`, making the entire OR clause true (no filename filter applied). This avoids dynamic query construction.
- `$4::jsonb IS NULL OR` — same pattern for the metadata containment filter.
- `s.metadata @> $4` — PostgreSQL JSONB containment: the stored metadata must contain all keys and values present in `$4`.
- `ESCAPE '\\'` — the Rust string literal `'\\'` produces the two-character SQL string `\\`, which PostgreSQL interprets as the single escape character `\`. This allows the LIKE pattern to contain `\%` and `\_` as literal `%` and `_`.
- The `ORDER BY` and `LIMIT` are unchanged; pgvector applies the WHERE filter before the HNSW similarity ordering.

### 3.5 Modified `SearchPipeline::search` Signature

```rust
// src/pipelines/search.rs

use crate::db::queries::{self, glob_to_like};

impl SearchPipeline {
    pub async fn search(
        &self,
        query: &str,
        k: i64,
        filters: SearchFilter,
    ) -> AppResult<Vec<SearchResult>> {
        // Existing validation
        if query.trim().is_empty() {
            return Err(AppError::Validation("query must not be empty".into()));
        }
        if !(1..=100).contains(&k) {
            return Err(AppError::Validation("k must be between 1 and 100".into()));
        }

        // New: validate source_metadata is a JSON object if provided
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

        // Embed query (CPU-bound, spawn_blocking)
        let svc = self.embedding.clone();
        let query_owned = query.to_owned();
        let query_vector = tokio::task::spawn_blocking(move || svc.embed_one(&query_owned))
            .await
            .map_err(|e| AppError::Internal(format!("embedding task panicked: {e}")))?
            ?;

        // Vector search with optional filters
        let results = queries::search_chunks(
            &self.pool,
            &query_vector,
            k,
            filename_like.as_deref(),
            filters.source_metadata.as_ref(),
        )
        .await?;

        Ok(results)
    }
}
```

The `source_metadata` validation check (JSON object type) is performed before embedding to avoid a wasted ONNX call on an obviously invalid request.

### 3.6 Modified `SearchParams` and MCP Tool Wiring

```rust
// src/mcp/mod.rs

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchParams {
    /// Natural language query string.
    pub query: String,
    /// Number of results to return (1–100). Defaults to 5.
    pub k: Option<i64>,
    /// Glob pattern to filter results by source filename (case-sensitive).
    /// Supports `*` (any sequence) and `?` (single character).
    /// Example: `"docs/*.md"` matches any `.md` file under `docs/`.
    pub filename_glob: Option<String>,
    /// JSONB containment filter on source metadata.
    /// Must be a JSON object. A source matches if its metadata contains
    /// every key/value pair in this object.
    /// Example: `{"project": "rag", "lang": "en"}`.
    pub source_metadata: Option<serde_json::Value>,
}
```

The `search` tool method in the `#[tool_router]` impl block:

```rust
    #[tool(description = "Search the knowledge base with a natural language query. Returns a JSON array of the top-k most semantically relevant chunks, each with content, source_filename, chunk_index, similarity score, and source_metadata. k defaults to 5 (range: 1–100). Optional: filename_glob filters by source filename (glob pattern, case-sensitive); source_metadata filters by JSONB containment (must be a JSON object).")]
    async fn search(
        &self,
        Parameters(params): Parameters<SearchParams>,
    ) -> Result<CallToolResult, McpError> {
        let k = params.k.unwrap_or(5);
        let filters = SearchFilter {
            filename_glob:   params.filename_glob,
            source_metadata: params.source_metadata,
        };
        let result: Result<_, McpError> = self
            .search
            .search(&params.query, k, filters)
            .await
            .map_err(app_error_to_mcp_error);
        let results = result?;
        let json = serde_json::to_string(&results)
            .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }
```

The `SearchFilter` import is added to the use block:

```rust
use rag_mcp::pipelines::search::{SearchFilter, SearchPipeline};
```

### 3.7 Modified Function Signature Summary

| Layer | Before | After |
|-------|--------|-------|
| `db::queries::search_chunks` | `(pool, embedding, k)` | `(pool, embedding, k, filename_like: Option<&str>, source_metadata: Option<&Value>)` |
| `pipelines::search::SearchPipeline::search` | `(&self, query, k)` | `(&self, query, k, filters: SearchFilter)` |
| `mcp::McpServer::search` (tool method) | builds `SearchParams { query, k }` | builds `SearchParams { query, k, filename_glob, source_metadata }` |

No other files are modified. `src/error.rs`, `src/config.rs`, `src/db/models.rs`, and all pipeline files other than `src/pipelines/search.rs` are unchanged.

### 3.8 `SearchResult` Fields (Unchanged)

The `db::models::SearchResult` struct and the SELECT column list are unchanged. No new columns are fetched.

### 3.9 Integration Test Outline

Tests live in `tests/search_filtering.rs`. They use `testcontainers` with the `pgvector/pgvector:pg16` image. No MinIO container is needed for filter-only tests if sources are inserted directly via `db::queries::insert_source` and `db::queries::insert_chunks`.

```
search_no_filter_returns_all_chunks
    -- ingest two sources (md and rs); search with no filters; assert both appear

search_filename_glob_filters_by_extension
    -- ingest "README.md" and "main.rs"; search with filename_glob = "*.md"
    -- assert only chunks from README.md are returned

search_filename_glob_question_mark
    -- ingest "a.rs" and "ab.rs"; search with filename_glob = "?.rs"
    -- assert only chunks from "a.rs" are returned

search_filename_glob_no_match_returns_empty
    -- ingest "main.rs"; search with filename_glob = "*.go"
    -- assert Ok(vec![])

search_metadata_containment_filter
    -- ingest two sources with different metadata; search with source_metadata = {"lang": "en"}
    -- assert only chunks from the "lang":"en" source are returned

search_combined_filters_and_semantics
    -- ingest sources covering all combinations of filename/metadata;
    -- search with both filters active; assert only sources matching BOTH are returned

search_metadata_non_object_returns_validation_error
    -- source_metadata = json!([1,2,3]); assert Err(AppError::Validation(...)) before DB call

search_unfiltered_caller_unchanged
    -- SearchFilter::default(); assert results identical to calling old two-arg form
    -- (no regression for existing callers)
```

Tests requiring `EmbeddingService` are `#[ignore]`-gated behind `RUN_INTEGRATION_TESTS=1`, consistent with the search pipeline spec.

### 3.10 `glob_to_like` Placement Decision

`glob_to_like` is placed in `src/db/queries.rs` because it is exclusively a DB query concern — it produces a string only meaningful to the SQL LIKE operator. If `queries.rs` grows beyond ~200 lines, it may be extracted to `src/db/filters.rs` with a `pub use` re-export in `src/db/mod.rs`. The pipeline layer imports it from `crate::db::queries::glob_to_like` either way.

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | Should `filename_glob` matching use `ILIKE` (case-insensitive) instead of `LIKE`? | `LIKE` (case-sensitive) for v1, matching filesystem conventions. `ILIKE` can be added as an opt-in flag (`case_insensitive: bool`) in a follow-up. |
| Q2 | Should zero results from a filtered search fall back to an unfiltered search? | No fallback. Filtered queries return `Ok(vec![])` when no sources match. Fallback behavior would surprise callers and violate the principle of least astonishment. |
| Q3 | Should both `filename_glob` and `source_metadata` be combined with OR instead of AND? | AND semantics for v1. OR would widen results unpredictably; AND is the safe default. An `OR` option (`filter_combine: "and" | "or"`) can be added later. |
| Q4 | Should `glob_to_like` be in `src/db/queries.rs` or a separate `src/db/filters.rs`? | `src/db/queries.rs` for v1 to minimize file proliferation. Extract if the file exceeds ~200 lines or if other query functions need the helper. |
| Q5 | Should `SearchFilter` live in `src/pipelines/search.rs` or a shared `src/search.rs`? | `src/pipelines/search.rs` for v1. If other pipeline types (e.g., a hypothetical `list_sources` pipeline) need the same filter, promote to a shared module at that time. |
| Q6 | How does pgvector HNSW behave with a selective WHERE clause? | pgvector performs a filtered HNSW scan: it traverses the graph and skips rows that do not satisfy the WHERE predicate. For highly selective filters this can degrade to a sequential scan. A pre-filtering subquery is explicitly out of scope for v1; revisit if latency regresses under narrow filters. |
