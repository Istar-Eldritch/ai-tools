# Spec: Project Scaffold & Configuration

**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #1

## Overview

Set up the Rust project scaffold for the RAG MCP server, including Cargo project structure, CLI argument parsing with clap, environment variable support with dotenvy, and the configuration struct that will be used by all downstream features.

## Requirements

- **R1**: Initialize a Cargo binary project (`rag-mcp`) with `edition = "2024"`
- **R2**: Define a `Config` struct that holds all configuration fields: database URL, S3 endpoint, S3 bucket, S3 access key, S3 secret key, embedding model name, and server-related options
- **R3**: CLI entrypoint using clap (derive) with a `serve` subcommand. All config fields available as CLI args and also loadable from environment variables (clap's `env` attribute)
- **R4**: `.env` file support via dotenvy — loaded before clap parses, so env vars from `.env` are available as fallbacks
- **R5**: `.env.example` file documenting all required/optional configuration variables
- **R6**: Establish error handling patterns using `thiserror` for typed errors and `anyhow` for application-level error propagation
- **R7**: Module structure matching the planned architecture:
  ```
  src/
    main.rs          -- CLI entrypoint (clap), server startup
    config.rs        -- Configuration struct + parsing
    db/mod.rs        -- (placeholder)
    storage/mod.rs   -- (placeholder)
    chunking/mod.rs  -- (placeholder)
    embedding/mod.rs -- (placeholder)
    pipelines/mod.rs -- (placeholder)
    mcp/mod.rs       -- (placeholder)
    error.rs         -- Error types
  ```

## Success Criteria

- [ ] `cargo build` succeeds
- [ ] `cargo run -- serve --help` shows all configuration options with descriptions
- [ ] `cargo run -- serve` with a `.env` file picks up environment variables
- [ ] CLI args override env vars
- [ ] Module structure is in place with placeholder modules
- [ ] Error types compile and are usable

## Technical Notes

- Use `clap` derive macros with `env` attribute for dual CLI/env support
- Load `.env` via `dotenvy::dotenv().ok()` before clap parsing in main
- Use `tokio` async runtime (`#[tokio::main]`)
- Placeholder modules should have minimal content (just `// TODO` or empty structs) — they'll be filled in by subsequent features

## Out of Scope

- Actual database connections, S3 clients, or MCP server logic (those are separate features)
- Docker Compose setup (Feature #2)
