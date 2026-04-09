# Optional S3 Storage for stdio / Local Mode

**Status**: Draft  
**Created**: 2026-04-09  
**Timestamp**: 2604091409  
**Parent Epic**: RAG MCP Server

---

## Overview

The RAG MCP server can be run in two modes:

| Subcommand   | Transport | Audience              |
|--------------|-----------|-----------------------|
| `serve`      | stdio     | Local / IDE use (single user, no OAuth) |
| `serve-http` | HTTP      | Multi-user deployment (Google OAuth, API keys) |

Currently **both** modes require S3 credentials to be configured, and the server hard-fails at startup if they are absent. For a developer running the `serve` (stdio) subcommand locally, standing up a MinIO instance is unnecessary friction — all ingested document content is already reconstructable from the text provided by the MCP client, and the embeddings live in PostgreSQL. The S3 archive primarily serves the HTTP mode (for potential future retrieval / reprocessing pipelines) and as an audit store.

This spec makes S3 optional for `serve` mode while keeping it **required** for `serve-http`.

---

## Requirements

### Functional

- **R1** — S3 config fields (`s3_endpoint`, `s3_bucket`, `s3_access_key`, `s3_secret_key`) MUST become optional in the base `Config` struct used by the `serve` subcommand.  
- **R2** — When S3 config is absent, `serve` MUST start successfully, log a warning that S3 is disabled, and operate without any S3 calls.  
- **R3** — The `ingest` pipeline MUST skip the `put_object` call when no S3 storage is configured, proceeding with chunking, embedding, and DB writes normally.  
- **R4** — The `ingest` pipeline's cleanup path MUST skip the `delete_object` call when no S3 storage is configured.  
- **R5** — The `update_in_place` path of the `ingest` pipeline MUST skip the `put_object` call when no S3 storage is configured.  
- **R6** — The `delete` pipeline MUST skip the `delete_object` call when no S3 storage is configured; the DB row and chunks MUST still be deleted.  
- **R7** — `serve-http` MUST continue to require all four S3 config fields. If any are absent, the server MUST fail at startup with a descriptive error before binding the HTTP port.  
- **R8** — The `s3_key` column in the `sources` DB table continues to be set to the source UUID string regardless of whether S3 is configured. No DB schema migration is required.

### Non-Functional

- **R9** — The `S3Storage` struct and its `put_object` / `delete_object` methods remain unchanged in their signatures. Optionality is expressed by wrapping usages in `Option<S3Storage>`.  
- **R10** — No new environment variables or CLI flags are introduced purely to control S3 enablement. Presence/absence of the S3 fields implicitly controls the behaviour.  
- **R11** — Existing integration tests that exercise S3 continue to pass. New unit/integration tests cover the "S3 absent" code paths in both pipelines.
- **R12** — The `search` and `list_sources` MCP tool descriptions MUST document how clients can reconstruct the original file path from `source_filename` and `source_metadata.directory` (for `ingest_directory` sources).

---

## Design

### 3.1 Config Changes (`src/config.rs`)

The four S3 fields in `Config` change from `String` to `Option<String>`:

```rust
/// S3-compatible endpoint URL (e.g., http://localhost:9000 for MinIO).
/// Optional; omit to disable S3 storage (stdio/local mode only).
#[arg(long, env = "S3_ENDPOINT")]
pub s3_endpoint: Option<String>,

/// S3 bucket name for document storage.
/// Optional; omit to disable S3 storage (stdio/local mode only).
#[arg(long, env = "S3_BUCKET")]
pub s3_bucket: Option<String>,

/// S3 access key ID.
/// Optional; omit to disable S3 storage (stdio/local mode only).
#[arg(long, env = "S3_ACCESS_KEY")]
pub s3_access_key: Option<String>,

/// S3 secret access key.
/// Optional; omit to disable S3 storage (stdio/local mode only).
#[arg(long, env = "S3_SECRET_KEY")]
pub s3_secret_key: Option<String>,
```

A helper method is added to `Config` that either returns all four fields as validated strings or returns a config error. This is called by the `serve-http` startup path to enforce S3 as required:

```rust
/// Bundled, validated S3 connection parameters (all fields guaranteed non-empty).
pub struct S3Params {
    pub endpoint:   String,
    pub bucket:     String,
    pub access_key: String,
    pub secret_key: String,
}

impl Config {
    /// Returns all four S3 fields as owned strings, or an AppError::Config if any are absent.
    /// Called by `serve-http` startup to enforce S3 as a hard requirement.
    pub fn require_s3(&self) -> AppResult<S3Params> {
        match (
            self.s3_endpoint.as_deref(),
            self.s3_bucket.as_deref(),
            self.s3_access_key.as_deref(),
            self.s3_secret_key.as_deref(),
        ) {
            (Some(e), Some(b), Some(ak), Some(sk)) => Ok(S3Params {
                endpoint:   e.to_owned(),
                bucket:     b.to_owned(),
                access_key: ak.to_owned(),
                secret_key: sk.to_owned(),
            }),
            _ => Err(AppError::Config(
                "serve-http requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, \
                 and S3_SECRET_KEY to all be set".into(),
            )),
        }
    }
}
```

`S3Params` is defined in `config.rs` — it is a validation artifact of the config layer, not an implementation detail of the storage layer.

### 3.2 Storage Changes (`src/storage/mod.rs`)

`S3Storage::new` currently accepts `&Config` and reads the four fields directly as `String`. After this change the fields are `Option<String>`, so `S3Storage` gains two constructors: one that accepts explicit `&str` parameters (used when the values have already been validated), and one that tries to construct from `Config` and returns `None` when any field is absent.

```rust
impl S3Storage {
    /// Construct from explicit, already-validated parameters.
    pub async fn from_params(
        endpoint:   &str,
        bucket:     &str,
        access_key: &str,
        secret_key: &str,
    ) -> AppResult<Self> {
        let creds = Credentials::new(access_key, secret_key, None, None, "rag-static");

        let s3_config = S3ConfigBuilder::new()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(endpoint)
            .region(Region::new("us-east-1"))
            .credentials_provider(creds)
            .force_path_style(true)
            .build();

        Ok(Self {
            inner: Arc::new(S3StorageInner {
                client: Client::from_conf(s3_config),
                bucket: bucket.to_owned(),
            }),
        })
    }

    /// Try to construct from Config. Returns Ok(None) if any S3 field is absent.
    /// Returns Ok(Some(_)) when all fields are present and the client is created.
    pub async fn from_config(config: &Config) -> AppResult<Option<Self>> {
        match (
            config.s3_endpoint.as_deref(),
            config.s3_bucket.as_deref(),
            config.s3_access_key.as_deref(),
            config.s3_secret_key.as_deref(),
        ) {
            (Some(e), Some(b), Some(ak), Some(sk)) => {
                Ok(Some(Self::from_params(e, b, ak, sk).await?))
            }
            _ => Ok(None),
        }
    }
}
```

The previous `S3Storage::new(&config)` constructor is **removed** (it becomes a compile-time error that surfaces all call sites that need updating). The internal `S3StorageInner`, `put_object`, `delete_object`, and `create_bucket` implementations are **unchanged**.

### 3.3 Ingest Pipeline Changes (`src/pipelines/ingest.rs`)

The `storage` field changes from `S3Storage` to `Option<S3Storage>`:

```rust
pub struct IngestPipeline {
    pool:         PgPool,
    storage:      Option<S3Storage>,
    chunk_config: ChunkConfig,
    embedding:    EmbeddingService,
}

impl IngestPipeline {
    pub fn new(
        pool:         PgPool,
        storage:      Option<S3Storage>,
        chunk_config: ChunkConfig,
        embedding:    EmbeddingService,
    ) -> Self { ... }

    /// Returns a reference to the S3 storage if configured.
    pub fn storage(&self) -> Option<&S3Storage> {
        self.storage.as_ref()
    }
}
```

**`ingest()` — S3 upload is gated:**

```rust
let s3_key = source_id.to_string();

let new_source = NewSource {
    id: source_id,
    s3_key: s3_key.clone(),   // always set to UUID; no object stored when S3 absent
    filename: filename.to_owned(),
    content_type: content_type.to_owned(),
    metadata,
    project,
    owner_user_id,
};
let source = queries::insert_source(&self.pool, &new_source).await?;

if let Some(storage) = &self.storage {
    let data = Bytes::from(content.to_owned().into_bytes());
    if let Err(e) = storage.put_object(&s3_key, data, content_type).await {
        self.cleanup(source_id).await;
        return Err(e);
    }
}
```

**`update_in_place()` — S3 overwrite is gated (step 7):**

```rust
// Step 7: S3 — overwrite content under existing key (skipped when S3 not configured)
if let Some(storage) = &self.storage {
    let data = Bytes::from(content.to_owned().into_bytes());
    storage.put_object(&old_source.s3_key, data, content_type).await?;
}
```

**`cleanup()` — S3 deletion is gated:**

```rust
async fn cleanup(&self, source_id: Uuid) {
    if let Err(e) = queries::delete_source(&self.pool, source_id).await {
        tracing::warn!(source_id = %source_id, error = %e,
            "cleanup: failed to delete source row");
    }
    if let Some(storage) = &self.storage {
        if let Err(e) = storage.delete_object(&source_id.to_string()).await {
            tracing::warn!(source_id = %source_id, error = %e,
                "cleanup: failed to delete S3 object");
        }
    }
}
```

### 3.4 Delete Pipeline Changes (`src/pipelines/delete.rs`)

The `storage` field changes from `S3Storage` to `Option<S3Storage>`:

```rust
pub struct DeletePipeline {
    pool:    PgPool,
    storage: Option<S3Storage>,
}

impl DeletePipeline {
    pub fn new(pool: PgPool, storage: Option<S3Storage>) -> Self {
        Self { pool, storage }
    }

    pub async fn delete(&self, source_id: Uuid) -> AppResult<()> {
        let source = queries::get_source_by_id(&self.pool, source_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("source {source_id} not found")))?;

        let s3_key = source.s3_key;

        // Always delete the DB row and its chunks first.
        queries::delete_source(&self.pool, source_id).await?;

        // Only attempt S3 deletion when storage is configured.
        if let Some(storage) = &self.storage {
            if let Err(e) = storage.delete_object(&s3_key).await {
                tracing::warn!(
                    source_id = %source_id,
                    s3_key    = %s3_key,
                    error     = %e,
                    "delete: S3 object removal failed after successful DB delete; \
                     object may be orphaned"
                );
            }
        }

        Ok(())
    }
}
```

### 3.5 Main Entry Point Changes (`src/main.rs`)

**`Commands::Serve` (stdio) — S3 is optional:**

```rust
Commands::Serve(config) => {
    // ... tracing setup (file appender + panic hook) unchanged ...

    let pool = db::connect(&config.database_url, config.db_max_connections).await?;
    tracing::info!("database connected and migrations applied");

    let storage = S3Storage::from_config(&config).await?;
    match &storage {
        Some(_) => tracing::info!("S3 storage initialised"),
        None    => tracing::warn!(
            "S3 not configured — document archive is disabled for this session; \
             set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY to enable"
        ),
    }

    // ... embedding, chunk_config unchanged ...

    let ingest_pipeline = IngestPipeline::new(
        pool.clone(), storage.clone(), chunk_config, embedding.clone()
    );
    let delete_pipeline = DeletePipeline::new(pool.clone(), storage.clone());

    // ... DirectoryIngestPipeline, McpServer construction, stdio serve — unchanged ...
}
```

**`Commands::ServeHttp` (HTTP) — S3 remains required:**

```rust
Commands::ServeHttp(http_config) => {
    let config = &http_config.base;
    // ... tracing init unchanged ...

    let pool = db::connect(&config.database_url, config.db_max_connections).await?;
    tracing::info!("database connected and migrations applied");

    // Fail fast before binding the port if S3 config is incomplete.
    let s3 = config.require_s3()?;
    let storage = S3Storage::from_params(&s3.endpoint, &s3.bucket, &s3.access_key, &s3.secret_key).await?;
    tracing::info!("S3 storage initialised");

    // ... embedding, chunk_config unchanged ...

    let ingest_pipeline = IngestPipeline::new(
        pool.clone(), Some(storage.clone()), chunk_config, embedding.clone()
    );
    let delete_pipeline = DeletePipeline::new(pool.clone(), Some(storage.clone()));

    // ... remainder of serve-http unchanged ...
}
```

---

## Implementation Notes

### DB Schema — no migration required

The `sources.s3_key` column stays `TEXT NOT NULL`. When S3 is disabled, it is populated with the source UUID string — the same value that *would* be the S3 object key if storage were active. This preserves the schema contract and keeps backfill possible: if an operator later enables S3, the existing `s3_key` values can be used as keys to upload archived content.

### `DirectoryIngestPipeline`

`DirectoryIngestPipeline` owns an `IngestPipeline` and a `DeletePipeline` and delegates to them. No changes are required in `src/pipelines/directory_ingest.rs`; it inherits the optional S3 behaviour transparently.

### `IngestPipeline::storage()` accessor

The public `storage()` accessor return type changes from `&S3Storage` to `Option<&S3Storage>`. Any call site that directly uses `pipeline.storage()` must be updated. At the time of this writing the accessor is only used in tests and the `serve-http`'s `AuthorizedMcpServer` does not call it directly; a compilation pass will surface any remaining uses.

### Logging strategy

- **`serve` startup, S3 absent**: single `tracing::warn!` with the list of missing env vars.  
- **`serve` startup, S3 present**: `tracing::info!` (existing behaviour preserved).  
- **`serve-http` startup, S3 absent**: hard error returned from `main` before the HTTP listener is bound; the Actix Web server never starts.  
- **Per-operation**: no additional log entries when S3 ops are skipped — the startup warning is sufficient for the common local-dev case.

### Source Location Discovery for Clients

Clients (e.g., coding agents) need to locate the original file that produced a search result. The mechanism differs by transport mode:

**stdio / local mode (no S3)**

For sources ingested via `ingest_directory`, the full filesystem path is reconstructable from two fields already present on search results:

- `source_filename` — the relative path within the ingested directory (e.g., `src/pipelines/ingest.rs`)
- `source_metadata.directory` — the absolute directory root (e.g., `/home/user/code/project`)

Full path = `metadata.directory + "/" + filename`.

The `directory` key is injected automatically by `build_file_metadata` in `directory_ingest.rs`. Sources ingested via the single-file `ingest` tool do not have this field unless the caller includes it in the metadata.

The `search` and `list_sources` tool descriptions should document this convention so MCP clients know how to reconstruct the path without guessing.

**serve-http mode (S3 required)**

Remote clients cannot access the server's filesystem. The `s3_key` field on each source record references the archived content in S3. A future `get_source_content` tool could serve the S3 object to remote clients on demand; this is out of scope for the current change but noted as a known gap.

For now, remote clients can use `source_filename` and `source_metadata` for display purposes, but cannot retrieve the original content.

### Backward Compatibility

- Operators who already set all four S3 env vars in their `serve` invocations see no behaviour change.  
- Operators who run `serve-http` see no behaviour change.  
- `.env` files used in Docker Compose still work as before.

---

## Testing Plan

| Test | Location | What it covers |
|------|----------|----------------|
| `ingest_without_s3` | `tests/ingest_pipeline.rs` | Full ingest with `storage: None`; source and chunks are in DB, no S3 error |
| `update_in_place_without_s3` | `tests/ingest_pipeline.rs` | Re-ingest with `storage: None` replaces chunks correctly |
| `delete_without_s3` | `tests/delete_pipeline.rs` | Delete removes DB row/chunks with `storage: None`; no S3 error |
| `require_s3_missing_fields` | unit test in `src/config.rs` | `Config::require_s3()` returns `Err` when any field is `None` |
| `from_config_returns_none` | unit test in `src/storage/mod.rs` | `S3Storage::from_config` returns `Ok(None)` when fields are absent |
| Existing S3 integration tests | `tests/storage.rs` | Unchanged; still run against testcontainers MinIO |

---

## Open Questions

| # | Question | Recommended default |
|---|----------|---------------------|
| Q1 | Should `s3_key` become `Option<String>` in the `sources` DB table to explicitly model the "no S3" case? | No — keep `TEXT NOT NULL` with the UUID placeholder. A future backfill can pair existing values with real objects. Schema simplicity and zero migration cost wins. |
| Q2 | Should `serve-http` also support running without S3 (e.g., a self-hosted instance without object storage)? | Out of scope for this change. `serve-http` is the multi-user path where the document archive provides more value. Revisit only if concrete demand arises. |
| Q3 | When S3 is absent in stdio mode, should `ingest` log a `DEBUG` trace per document noting the archive was skipped? | No — the startup warning is sufficient. Per-document noise would clutter logs for the common local-dev case. |
| Q4 | Should `S3Params` live in `config.rs` or `storage/mod.rs`? | `config.rs` — it is a validation artifact of the config layer, not an implementation concern of the storage layer. The storage layer should not need to import `Config`. |
