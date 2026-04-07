# Database layer & schema (sqlx, migrations, pgvector)

**Status**: Draft
**Created**: 2026-04-07T14:56:51Z
**Timestamp**: 2604071456
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #3

---

## PART I: Requirements

### Problem Statement

The RAG server needs a persistent store for ingested document metadata (`sources`) and their embedded text chunks (`chunks`). The DB layer must initialise the schema automatically on startup (no manual migration steps), support pgvector cosine similarity search over 768-dim embeddings, and expose a clean Rust API that the ingestion, search, and deletion pipelines can call without leaking SQL details.

The layer sits between `Config` (which supplies `DATABASE_URL`) and the three pipeline modules (`ingest`, `search`, `delete`). It is the only place raw `sqlx` queries appear.

### Requirements

- **R1** — Connection pool: build a `sqlx::PgPool` from `Config::database_url` on server startup. Expose it as a cheap-to-clone handle shared across all pipeline calls. Pool size is configurable (env var `DB_MAX_CONNECTIONS`, default 5).
- **R2** — Migrations: embed plain SQL migration files via `sqlx::migrate!("migrations/")`. Run `migrator.run(&pool)` before the pool is returned to the caller. Migrations are idempotent and versioned (`{timestamp}_{name}.sql`).
- **R3** — pgvector extension: the extension is created by `init-db/01-extensions.sql` (Docker) and by an explicit `CREATE EXTENSION IF NOT EXISTS vector` step in the testcontainers helper. Migrations must **not** attempt to create the extension (requires superuser).
- **R4** — `sources` table: stores document metadata. Columns: `id uuid PK`, `s3_key text UNIQUE NOT NULL`, `filename text NOT NULL`, `content_type text NOT NULL`, `metadata jsonb NOT NULL DEFAULT '{}'`, `created_at timestamptz NOT NULL DEFAULT now()`.
- **R5** — `chunks` table: stores text chunks and their embeddings. Columns: `id uuid PK`, `source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE`, `chunk_index int NOT NULL`, `content text NOT NULL`, `embedding vector(768) NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. Unique constraint on `(source_id, chunk_index)`.
- **R6** — HNSW index on `chunks.embedding` using cosine distance: `CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops)`.
- **R7** — Source queries: `insert_source`, `get_source_by_id`, `get_source_by_s3_key`, `delete_source` (cascades to chunks via FK).
- **R8** — Chunk queries: `insert_chunks` (bulk insert for a single source), `search_chunks` (top-k cosine similarity via `<=>` operator, returns chunk + source fields), `delete_chunks_by_source` (used pre-delete to allow explicit cleanup if needed).
- **R9** — Model structs: `Source` and `Chunk` derive `sqlx::FromRow`, `serde::Serialize/Deserialize`. A `SearchResult` struct bundles chunk fields with `source_filename`, `source_metadata`, and `similarity: f32`.
- **R10** — Error propagation: all query functions return `Result<_, AppError>`. A new `AppError::Database(#[from] sqlx::Error)` variant is added to `error.rs`.
- **R11** — Cargo dependencies: add `sqlx` (features: `postgres`, `runtime-tokio-rustls`, `uuid`, `chrono`, `json`), `pgvector` (features: `sqlx`), `uuid` (features: `v4`, `serde`), `chrono` (features: `serde`).

### Success Criteria

- [ ] `cargo sqlx migrate run` (or server startup) applies all migrations against a fresh DB with the `vector` extension already installed
- [ ] `sources` and `chunks` tables match the schema in R4/R5; HNSW index exists
- [ ] `insert_source` + `insert_chunks` round-trip persists data retrievable by `get_source_by_id`
- [ ] `search_chunks` returns results ordered by cosine similarity (closest first), limited to `k`
- [ ] `delete_source` removes the source row and all its chunks (cascade verified)
- [ ] All DB functions compile with `cargo sqlx prepare` (offline query metadata checked in)
- [ ] Integration test (testcontainers) passes the full insert → search → delete lifecycle
- [ ] `AppError::Database` variant exists; all existing error arms still compile

### Out of Scope

- PDF or binary content storage (content is always `text`)
- Full-text search or hybrid keyword+vector ranking
- `list_sources` query (deferred per epic scope)
- Schema versioning beyond sequential SQL migrations (no refinery, Diesel, or SeaORM)
- Multi-tenant row isolation
- Connection string parsing or validation beyond what sqlx provides

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Cargo deps, `AppError::Database`, `db/mod.rs` pool + migrate bootstrap | 0.5 d |
| Phase 2 | Migration SQL files, pgvector testcontainers helper | 0.5 d |
| Phase 3 | `db/models.rs` structs, `db/queries.rs` CRUD + search functions | 0.5 d |
| Phase 4 | `cargo sqlx prepare` (offline metadata), integration test | 0.5 d |

**Total estimate**: 2 days (matches epic F3 estimate)

---

## PART III: Detailed Design

### 3.1 File Layout

```
migrations/
  20260407000001_create_sources.sql
  20260407000002_create_chunks.sql
src/db/
  mod.rs       -- connect_pool(), run_migrations(), pub use
  models.rs    -- Source, Chunk, SearchResult, NewSource, NewChunk
  queries.rs   -- all SQL functions
```

### 3.2 Migration Files

**`20260407000001_create_sources.sql`**

```sql
CREATE TABLE IF NOT EXISTS sources (
    id           UUID        PRIMARY KEY,
    s3_key       TEXT        UNIQUE NOT NULL,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`20260407000002_create_chunks.sql`**

```sql
CREATE TABLE IF NOT EXISTS chunks (
    id          UUID    PRIMARY KEY,
    source_id   UUID    NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    chunk_index INT     NOT NULL,
    content     TEXT    NOT NULL,
    embedding   vector(768) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);
```

### 3.3 Pool Bootstrap (`db/mod.rs`)

```rust
pub async fn connect(database_url: &str, max_connections: u32) -> AppResult<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await
        .map_err(AppError::Database)?;
    sqlx::migrate!("migrations/").run(&pool).await
        .map_err(|e| AppError::Database(e.into()))?;
    Ok(pool)
}
```

Called once from `main.rs` during server startup; the returned pool is stored in an `Arc<AppState>` (or equivalent) threaded through the pipelines.

### 3.4 Model Structs (`db/models.rs`)

```rust
pub struct Source {
    pub id: Uuid,
    pub s3_key: String,
    pub filename: String,
    pub content_type: String,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

pub struct Chunk {
    pub id: Uuid,
    pub source_id: Uuid,
    pub chunk_index: i32,
    pub content: String,
    pub embedding: pgvector::Vector,
    pub created_at: DateTime<Utc>,
}

pub struct SearchResult {
    pub chunk_id: Uuid,
    pub source_id: Uuid,
    pub chunk_index: i32,
    pub content: String,
    pub source_filename: String,
    pub source_metadata: serde_json::Value,
    pub similarity: f32,   -- 1.0 - cosine_distance
}

// Input types (no id/created_at)
pub struct NewSource { pub id: Uuid, pub s3_key: String, pub filename: String,
                       pub content_type: String, pub metadata: serde_json::Value }
pub struct NewChunk  { pub id: Uuid, pub source_id: Uuid, pub chunk_index: i32,
                       pub content: String, pub embedding: pgvector::Vector }
```

### 3.5 Query Functions (`db/queries.rs`)

| Function | Signature | Notes |
|----------|-----------|-------|
| `insert_source` | `(pool, &NewSource) -> AppResult<Source>` | `INSERT ... RETURNING *` |
| `get_source_by_id` | `(pool, Uuid) -> AppResult<Option<Source>>` | |
| `get_source_by_s3_key` | `(pool, &str) -> AppResult<Option<Source>>` | Used by ingest to detect duplicates |
| `delete_source` | `(pool, Uuid) -> AppResult<bool>` | Returns false if not found |
| `insert_chunks` | `(pool, &[NewChunk]) -> AppResult<u64>` | Unnest bulk insert; single round-trip |
| `search_chunks` | `(pool, &pgvector::Vector, k: i64) -> AppResult<Vec<SearchResult>>` | `ORDER BY embedding <=> $1 LIMIT $2`; join to sources |
| `delete_chunks_by_source` | `(pool, Uuid) -> AppResult<u64>` | Explicit cleanup; also covered by FK cascade |

**Search query sketch:**

```sql
SELECT
    c.id          AS chunk_id,
    c.source_id,
    c.chunk_index,
    c.content,
    s.filename    AS source_filename,
    s.metadata    AS source_metadata,
    1.0 - (c.embedding <=> $1)  AS similarity
FROM chunks c
JOIN sources s ON s.id = c.source_id
ORDER BY c.embedding <=> $1
LIMIT $2;
```

**Bulk chunk insert** uses `UNNEST` to avoid N round-trips:

```sql
INSERT INTO chunks (id, source_id, chunk_index, content, embedding)
SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::int[], $4::text[], $5::vector[])
ON CONFLICT (source_id, chunk_index) DO NOTHING;
```

### 3.6 Error Variant Addition (`error.rs`)

```rust
#[error("Database error: {0}")]
Database(#[from] sqlx::Error),
```

`sqlx::migrate::MigrateError` does not implement `Into<sqlx::Error>` so migration errors are mapped manually in `connect()`.

### 3.7 Testcontainers Helper

Integration tests (in `tests/`) use a shared async helper:

```rust
async fn setup_db() -> PgPool {
    let container = testcontainers::runners::AsyncRunner::run(
        RunnableImage::from(Postgres::default().with_tag("16-pgvector"))
    ).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres",
                      container.get_host_port_ipv4(5432).await.unwrap());
    // Ensure extension before migrations
    let tmp = PgPoolOptions::new().connect(&url).await.unwrap();
    sqlx::query("CREATE EXTENSION IF NOT EXISTS vector").execute(&tmp).await.unwrap();
    db::connect(&url, 2).await.unwrap()
}
```

The `pgvector/pgvector:pg16` image already has the extension available; the explicit `CREATE EXTENSION` call makes it active in the test database before `sqlx::migrate!` runs.

### 3.8 `sqlx` Offline Mode

Run `cargo sqlx prepare` (with a live DB) to generate `.sqlx/` query metadata. Commit this directory so CI can build with `SQLX_OFFLINE=true` without a live Postgres.

Add to `.env.example`:

```
# Required for cargo sqlx prepare / compile-time query checking
DATABASE_URL=postgres://rag:rag@localhost:5432/rag
```

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | Use `sqlx::query_as!` (compile-time checked) or `query_as` (runtime)? Compile-time checking requires offline metadata to be current. | Use `query_as!` for all queries; document `cargo sqlx prepare` workflow. |
| Q2 | HNSW index build parameters (`m`, `ef_construction`)? Default pgvector values (m=16, ef_construction=64) are adequate for initial corpus sizes. | Keep defaults; make configurable later if perf demands it. |
| Q3 | Should `search_chunks` accept a minimum similarity threshold? | No threshold in initial version; callers can filter the returned `Vec`. |
| Q4 | `insert_chunks` UNNEST with pgvector array — sqlx support for `vector[]` type? | May need raw `query!` with manual binding; verify during implementation. |
