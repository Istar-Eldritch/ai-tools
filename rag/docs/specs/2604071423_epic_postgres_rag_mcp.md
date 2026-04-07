# Epic: RAG MCP Server

## PART I: Epic Overview

### Goal Statement

Build a Rust-based Retrieval-Augmented Generation (RAG) system that exposes an MCP (Model Context Protocol) tool server, enabling Claude to ingest documents and perform semantic search over a knowledge base. The system uses local embedding inference (FastEmbed/Nomic v2) with PostgreSQL+pgvector for vector storage and S3 for original document archival. This is the foundational knowledge retrieval service within the `ai_tools` monorepo.

### Requirements

- **R1: Document Ingestion** -- Accept plain text and markdown documents via an `ingest` MCP tool. Upload the original document to S3, chunk it, generate embeddings locally via FastEmbed (Nomic Embed Text v2), and store chunks with vectors in PostgreSQL+pgvector. Return confirmation with document metadata.

- **R2: Semantic Search** -- Provide a `search` MCP tool that accepts a natural language query, embeds it using the same model, performs cosine similarity search against pgvector, and returns the top-k most relevant chunks with source metadata and relevance scores.

- **R3: Document Deletion** -- Provide a `delete_source` MCP tool that removes a document's original file from S3 and all associated chunks/vectors from PostgreSQL, identified by a source key.

### Success Criteria

- [ ] `ingest` tool accepts a plain text or markdown document, stores original in S3, and persists embedded chunks in PostgreSQL
- [ ] `search` tool returns semantically relevant chunks for natural language queries with cosine similarity scoring
- [ ] `delete_source` tool removes all traces of a document (S3 object + all DB chunks)
- [ ] MCP server starts via stdio transport and is usable as a Claude tool server
- [ ] Embedding inference runs locally with no external API calls (FastEmbed + Nomic v2 ONNX)
- [ ] Local development environment reproducible via `docker compose up` (Postgres+pgvector, MinIO)
- [ ] All core operations have integration tests against containerized dependencies

### Scope & Boundaries

**In scope:**
- MCP server with stdio transport (the standard for Claude tool servers)
- Plain text and markdown input formats
- Local embedding via FastEmbed crate (Nomic Embed Text v2, ONNX runtime)
- PostgreSQL + pgvector for chunk/vector storage
- S3 (MinIO locally) for original document storage
- CLI configuration via clap + env vars + .env (dotenvy)
- Docker Compose for local development dependencies

**Out of scope (deferred):**
- PDF, Word, or other rich document formats
- `list_sources` tool (doesn't scale well with large corpora)
- HTTP/SSE MCP transport (stdio is sufficient for Claude integration)
- Authentication/authorization
- Multi-tenancy
- Re-ranking or hybrid search (keyword + semantic)
- Streaming ingestion or batch APIs
- Web UI or REST API

---

## PART II: Feature Decomposition

| # | Feature | Description | Priority | Dependencies | Est. Days |
|---|---------|-------------|----------|--------------|-----------|
| 1 | Project scaffold & configuration | Cargo project structure, clap CLI with subcommands (`serve`), dotenvy/.env support, configuration struct for DB URL, S3 endpoint/bucket/credentials, embedding model path. Establish error handling patterns (anyhow/thiserror). | High | - | 1 |
| 2 | Docker Compose dev environment | Compose file with PostgreSQL+pgvector and MinIO (S3-compatible). Include health checks, volume mounts, and seed SQL for pgvector extension + schema. Provide a `.env.example` with all required config vars. | High | - | 1 |
| 3 | Database layer & schema | PostgreSQL connection pool (sqlx), schema migrations (sqlx-migrate or refinery), `sources` table (id, s3_key, filename, content_type, metadata jsonb, created_at) and `chunks` table (id, source_id FK, chunk_index, content text, embedding vector(768), created_at). CRUD operations for sources and chunks. HNSW index on embedding column. | High | F1, F2 | 2 |
| 4 | S3 storage layer | S3 client (aws-sdk-s3 or rust-s3) configured for MinIO locally and real S3 in production. Operations: `put_object` (upload original doc), `delete_object` (remove original), `get_object` (retrieve for potential reprocessing). Key scheme: `originals/{source_id}/{filename}`. | High | F1, F2 | 1-2 |
| 5 | Text chunking engine | Chunking module for plain text and markdown. Recursive character-based splitting with configurable chunk size (default ~512 tokens) and overlap (default ~50 tokens). Markdown-aware splitting that respects heading boundaries when possible. Each chunk carries its positional index and character offsets. | High | F1 | 1-2 |
| 6 | Embedding service | Wrapper around the FastEmbed crate using the `nomic-embed-text-v2-moe` (or `nomic-embed-text-v1.5`) model. Supports embedding a single query and batch-embedding chunks. Handles model download/caching on first run. Outputs 768-dimensional f32 vectors. | High | F1 | 1-2 |
| 7 | Ingestion pipeline | Orchestrates the full ingest flow: validate input -> generate source ID -> upload original to S3 -> chunk text -> batch embed chunks -> insert source + chunks into PostgreSQL. Transactional: if any step fails, clean up partial state (delete S3 object, rollback DB). Returns source ID and chunk count. | High | F3, F4, F5, F6 | 2 |
| 8 | Search pipeline | Embed the query string -> execute pgvector cosine similarity search (`<=>` operator) -> return top-k results (configurable, default 5). Each result includes: chunk text, source filename, chunk index, similarity score, and source metadata. | High | F3, F6 | 1-2 |
| 9 | Delete pipeline | Look up source by key/ID -> delete all associated chunks from PostgreSQL -> delete S3 object -> delete source record. Transactional for DB operations. Return confirmation or not-found error. | High | F3, F4 | 1 |
| 10 | MCP server & tool registration | MCP server using stdio transport (rmcp crate or manual JSON-RPC over stdin/stdout). Register three tools: `search`, `ingest`, `delete_source` with proper JSON schemas for inputs/outputs. Wire tools to their respective pipelines. Handle MCP lifecycle (initialize, tool calls, shutdown). | High | F7, F8, F9 | 2-3 |
| 11 | Integration tests | End-to-end tests using testcontainers-rs (PostgreSQL+pgvector, MinIO). Test full ingest->search->delete lifecycle. Verify semantic relevance (ingest known docs, search with related query, assert correct doc returned). Verify deletion removes all artifacts. | High | F10 | 2 |

---

## PART III: Technical Considerations

### 1. Architecture Notes

**Crate structure** -- Single crate with module organization:
```
src/
  main.rs          -- CLI entrypoint (clap), server startup
  config.rs        -- Configuration (clap + env + dotenvy)
  db/
    mod.rs         -- Connection pool, migrations
    models.rs      -- Source, Chunk structs
    queries.rs     -- SQL operations
  storage/
    s3.rs          -- S3 client wrapper
  chunking/
    mod.rs         -- Chunking trait + implementations
    text.rs        -- Plain text chunker
    markdown.rs    -- Markdown-aware chunker
  embedding/
    mod.rs         -- FastEmbed wrapper
  pipelines/
    ingest.rs      -- Ingestion orchestration
    search.rs      -- Search orchestration
    delete.rs      -- Deletion orchestration
  mcp/
    mod.rs         -- MCP server, tool registration
    tools.rs       -- Tool definitions and handlers
  error.rs         -- Error types
```

**Key crate dependencies:**
- `clap` (derive) -- CLI argument parsing
- `dotenvy` -- .env file loading
- `sqlx` (postgres, runtime-tokio, tls-rustls) -- Async PostgreSQL with compile-time query checking
- `aws-sdk-s3` or `rust-s3` -- S3 client
- `fastembed` -- Local ONNX-based embedding inference
- `tokio` -- Async runtime
- `serde` / `serde_json` -- Serialization
- `thiserror` / `anyhow` -- Error handling
- `uuid` -- Source/chunk IDs
- `pgvector` (pgvector-rust) -- Vector type support for sqlx

**Embedding model:** Nomic Embed Text v2 produces 768-dimensional vectors. The FastEmbed crate handles ONNX runtime setup and model caching (`~/.cache/fastembed/` by default). First run downloads the model (~130MB). Embedding is CPU-bound; batch embedding chunks amortizes overhead.

**Vector search:** pgvector's HNSW index provides approximate nearest neighbor search with good recall/performance tradeoff. Use cosine distance operator (`<=>`) since Nomic embeddings are normalized. Index creation: `CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops)`.

### 2. Integration Points

- **MCP stdio transport** -- The server reads JSON-RPC messages from stdin and writes responses to stdout. Claude Desktop and Claude Code both support this transport. The server is configured in the MCP client's config (e.g., `claude_desktop_config.json` or `.mcp.json`) with the binary path and any args.

- **PostgreSQL+pgvector** -- Requires PostgreSQL 15+ with the `pgvector` extension. The Docker image `pgvector/pgvector:pg16` bundles both. Connection string passed via `DATABASE_URL` env var.

- **S3/MinIO** -- MinIO provides S3-compatible API for local development. In production, use real AWS S3 or any S3-compatible service. Configured via standard AWS env vars (`AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`).

- **ai_tools monorepo** -- This is a standalone Rust binary within the monorepo. No shared workspace with other Rust crates (plane, miro, claude-sandbox are independent). The binary can be referenced from the repo root's MCP configuration.

### 3. Testing Strategy

**Unit tests:**
- Chunking logic: verify chunk sizes, overlap, markdown heading boundaries
- Configuration parsing: verify CLI args, env vars, .env precedence
- Error handling: verify graceful failures for missing config, bad inputs

**Integration tests (testcontainers-rs):**
- Spin up PostgreSQL+pgvector and MinIO containers per test suite
- Run migrations, verify schema
- Full lifecycle: ingest document -> search for content -> verify relevance -> delete source -> verify cleanup
- Edge cases: duplicate ingestion, delete nonexistent source, search empty corpus, very large documents

**Manual/smoke testing:**
- Start server via `cargo run -- serve`, connect from Claude Code
- Ingest a sample markdown file, perform searches, verify quality of results
- Confirm MCP protocol compliance (initialize handshake, tool discovery, tool execution)
