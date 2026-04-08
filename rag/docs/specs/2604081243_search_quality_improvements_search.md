# Search Quality Improvements

**Status**: Draft
**Created**: 2026-04-08T12:43:06Z
**Timestamp**: 2604081243

---

## PART I: Requirements

### Problem Statement

The RAG MCP service currently has three gaps that reduce search quality and usability for multi-project deployments:

1. **Near-duplicate results**: A single document section that generates overlapping chunks (e.g., from a sliding-window split or adjacent code blocks) can appear multiple times in the top-k results, crowding out semantically distinct chunks. There is no post-retrieval deduplication step in the search pipeline (`SearchPipeline::search` in `src/pipelines/search.rs`).

2. **No project isolation**: All sources share a flat namespace. Callers who maintain multiple independent knowledge bases (e.g., one per repository or team) must either use separate databases or encode project identity into the free-form `metadata` JSONB and filter via `source_metadata`. The `sources` table (`migrations/20260407000001_create_sources.sql`) has no first-class project column, making it impossible to efficiently list or scope searches to a project without a JSONB containment scan.

3. **No source inventory tool**: There is no way for a caller to discover which sources have been ingested, how many chunks they produced, or which projects exist in the knowledge base without directly querying PostgreSQL. The MCP server exposes `ingest`, `search`, `delete_source`, and `ingest_directory` — but no listing or stats tool.

---

### Requirements

#### R1 — Search-Time Near-Duplicate Deduplication

- **R1.1** After fetching candidate chunks from the database, the search pipeline must discard chunks that are near-identical (by cosine similarity) to a chunk already selected for the result set.
- **R1.2** "Near-identical" is defined as cosine similarity exceeding `DEDUP_THRESHOLD` (default: `0.97`). The threshold is server-side configuration only (env var / CLI flag following the `CHUNK_SIZE`/`CHUNK_OVERLAP` pattern in `src/config.rs`). It is not exposed as a per-call parameter.
- **R1.3** To ensure k deduplicated results can be produced, the pipeline fetches `k * DEDUP_CANDIDATE_FACTOR` candidates from the database before filtering. `DEDUP_CANDIDATE_FACTOR` defaults to `3` and is configurable via env var / CLI flag.
- **R1.4** The greedy filter iterates candidates in descending similarity order. A candidate is accepted if its cosine similarity to every already-accepted result is at most `DEDUP_THRESHOLD`. The filter terminates after accepting k results or exhausting candidates — no second database round-trip.
- **R1.5** If fewer than k candidates survive deduplication, fewer than k results are returned. No error is raised.
- **R1.6** Cosine similarity between two candidates is computed from the embedding vectors returned by the database (`1 - cosine_distance`). The embeddings must be included in the query result for dedup use but must not be serialised in the MCP response.
- **R1.7** When `DEDUP_THRESHOLD` is `1.0`, deduplication is a no-op (all candidates pass). When set to `0.0`, only one result is ever returned (every pair is considered near-identical).

#### R2 — First-Class Project Field

- **R2.1** A nullable `project TEXT` column is added to the `sources` table via a new migration. `NULL` means the source belongs to no project (global). An index is created on `(project)` to support efficient equality filtering.
- **R2.2** `project` is an explicit, optional, top-level parameter on `ingest`, `ingest_directory`, and `search`. It is not embedded inside the `metadata` JSONB.
- **R2.3** On ingest, when `project` is provided, it is stored in the `project` column of the inserted source row.
- **R2.4** On search, when `project` is provided, results are restricted to sources whose `project` column matches the supplied value exactly. When `project` is omitted, no project filter is applied (all sources are searched, regardless of project assignment).
- **R2.5** The existing `filename_glob` and `source_metadata` filters compose with `project` via logical AND.
- **R2.6** The Rust model structs (`Source`, `NewSource`, `SearchResult` in `src/db/models.rs`) gain an `Option<String>` `project` field. `SearchResult` exposes `source_project` to callers.
- **R2.7** The `get_sources_by_filenames` query used in `DirectoryIngestPipeline` is updated to filter by project when a project is supplied, so that changed-file detection is scoped correctly within a project (files with the same relative path in different projects are treated independently).

#### R3 — `list_sources` MCP Tool

- **R3.1** A new `list_sources` MCP tool is registered alongside the existing tools in `src/mcp/mod.rs`.
- **R3.2** Parameters:
  - `project` (`Option<String>`) — restrict listing to sources belonging to this project. `None` returns all sources regardless of project.
  - `filename_glob` (`Option<String>`) — glob filter on `sources.filename`, same semantics as the search filter.
  - `limit` (`Option<i64>`) — page size, default `100`, maximum `500`. Validated server-side.
  - `offset` (`Option<i64>`) — pagination offset, default `0`.
- **R3.3** Each record in the response includes: `id`, `filename`, `content_type`, `project`, `metadata`, `created_at`, `chunk_count` (derived from a `COUNT` over the `chunks` table, joined or subqueried).
- **R3.4** No embedding vectors or chunk content are returned.
- **R3.5** The tool returns a JSON array of source records. When no sources match, an empty array is returned.
- **R3.6** A new `list_sources` query function is added to `src/db/queries.rs`. It performs a single SQL query with a `LEFT JOIN` / subquery to compute `chunk_count`, filtered by `project` (equality) and `filename` (LIKE), ordered by `created_at DESC`, with `LIMIT`/`OFFSET`.

---

### Success Criteria

| ID | Criterion |
|----|-----------|
| SC-1 | A search over a source with highly overlapping chunks returns at most one chunk per near-duplicate cluster. |
| SC-2 | Setting `DEDUP_THRESHOLD=1.0` produces results identical to the pre-dedup baseline. |
| SC-3 | Sources ingested with `project="foo"` are excluded from a search with `project="bar"`. |
| SC-4 | Sources ingested without a project are excluded from a search with an explicit `project` value. |
| SC-5 | `list_sources` with `project="foo"` returns only sources ingested with that project value. |
| SC-6 | `list_sources` `chunk_count` field matches the actual number of chunk rows for each source. |
| SC-7 | Pagination via `limit`/`offset` on `list_sources` returns non-overlapping pages that cover the full result set. |
| SC-8 | The `directory_ingest` dedup check (skip-if-hash-unchanged) is scoped per project — the same filename in two different projects is treated as two distinct sources. |
| SC-9 | All existing tests continue to pass with dedup disabled (`DEDUP_THRESHOLD=1.0`). |

---

### Out of Scope

- Project creation, deletion, or renaming as first-class operations (project identity is implicit in source rows).
- Per-project access control or authentication.
- Multi-project search (OR across a list of projects in a single call).
- Soft deletion or archiving of sources.
- Returning chunk-level content or embeddings from `list_sources`.
- Approximate deduplication at ingest time (dedup is search-time only).
- MMR (Maximum Marginal Relevance) diversity beyond the greedy similarity threshold approach.
- A separate stats/aggregation endpoint.

---

### Open Questions

None. All assumptions have been confirmed during discovery.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Schema migration: add `project TEXT` nullable column with index to `sources` table | 0.5 days |
| Phase 2 | Data model and query layer: update `Source`, `NewSource`, `SearchResult` structs; update `insert_source`, `search_chunks`, `get_sources_by_filenames`; add `list_sources` query | 1 day |
| Phase 3 | Config plumbing: add `DEDUP_THRESHOLD` and `DEDUP_CANDIDATE_FACTOR` to `Config` struct and wire into `SearchPipeline` | 0.5 days |
| Phase 4 | Search pipeline deduplication: implement greedy cosine-similarity filter in `SearchPipeline::search`; adjust candidate fetch count | 1 day |
| Phase 5 | Ingest pipeline updates: thread `project` through `IngestPipeline::ingest`, `DirectoryIngestPipeline::ingest_directory`, and their MCP param structs | 0.5 days |
| Phase 6 | `list_sources` MCP tool: add `ListSourcesParams`, implement tool handler, wire `ListSourcesPipeline` or inline query | 0.5 days |
| Phase 7 | Tests: unit tests for dedup filter logic; integration tests for project scoping on ingest/search/list; pagination correctness | 1 day |
