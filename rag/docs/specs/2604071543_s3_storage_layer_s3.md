# S3 Storage Layer

**Status**: Draft
**Created**: 2026-04-07T15:43:39Z
**Timestamp**: 2604071543
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #4

---

## PART I: Requirements

### Problem Statement

The RAG server must archive original ingested documents to S3 (MinIO locally, real AWS S3 in production) so that the deletion pipeline can remove them and future pipelines can retrieve them for reprocessing. The storage layer must initialise an S3 client from `Config` on server startup, expose `put_object` and `delete_object` operations, and propagate failures through the existing `AppError` type.

The layer sits between `Config` (which supplies `s3_endpoint`, `s3_bucket`, `s3_access_key`, `s3_secret_key`) and the ingestion and deletion pipelines. It is the only place `aws-sdk-s3` calls appear.

### Requirements

- **R1** — Client initialisation: build an `aws_sdk_s3::Client` from `Config` fields on server startup using path-style addressing (`force_path_style = true`) for MinIO compatibility. The client is wrapped in an `S3Storage` struct that also holds the bucket name. `S3Storage` is cheap to clone (inner `Arc`).
- **R2** — `put_object`: upload `bytes::Bytes` with a caller-supplied `content_type` to the configured bucket under the given key. Returns `AppResult<()>`. The operation is idempotent: re-uploading the same key overwrites the previous object.
- **R3** — `delete_object`: remove the object at the given key from the configured bucket. Returns `AppResult<()>`. The operation is idempotent: deleting a non-existent key is not an error (S3 `DeleteObject` semantics).
- **R4** — Error propagation: add an `AppError::Storage` variant to `error.rs` for S3 SDK errors. All `S3Storage` methods return `AppResult<_>`.
- **R5** — Cargo dependencies: add `aws-sdk-s3`, `aws-config`, `aws-credential-types`, and `bytes` to `Cargo.toml`.
- **R6** — Key scheme: callers pass a `{source_id}` UUID string as the key (e.g., `"019571b3-1234-7abc-8def-0a1b2c3d4e5f"`). The storage layer does not impose any prefix; key construction is the caller's responsibility (the ingestion pipeline will use the source UUID directly).

### Success Criteria

- [ ] `S3Storage::new(&config)` returns an initialised client; all four config fields are consumed
- [ ] `put_object` uploads bytes readable via MinIO console at the expected key
- [ ] `delete_object` removes the object; a subsequent `put_object` at the same key succeeds
- [ ] Deleting a non-existent key does not return an error
- [ ] `AppError::Storage` variant exists; `cargo build` succeeds with no new warnings
- [ ] Integration test (testcontainers MinIO) passes a full put → delete lifecycle
- [ ] `S3Storage` is `Clone + Send + Sync`

### Out of Scope

The following are deferred to later features and must not be implemented in this phase:

- `get_object` — deferred until the ingestion pipeline needs document retrieval for reprocessing or document overlay support (chunk offset feature, F5/future)
- Streaming upload (`ByteStream` from file path) — adequate for initial corpus sizes; revisit when large-file ingestion is needed
- Multipart upload — not required until individual objects exceed practical single-request limits
- Pre-signed URLs — not required for current MCP tool surface
- Bucket creation and lifecycle policies — bucket is pre-created by `minio-init` in Docker Compose and assumed to exist in production
- Chunk offset storage — a chunking engine concern, not a storage layer concern

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Cargo deps, `AppError::Storage`, `storage/mod.rs` skeleton | 0.25 d |
| Phase 2 | `S3Storage::new` client initialisation with path-style addressing | 0.25 d |
| Phase 3 | `put_object` and `delete_object` implementations | 0.25 d |
| Phase 4 | Testcontainers MinIO helper, integration test | 0.25 d |

**Total estimate**: 1 day (matches epic F4 estimate)

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/storage/
  mod.rs    -- S3Storage struct, new(), put_object(), delete_object()
```

No submodules are needed for v1. If `get_object` is added later, it lives in the same file.

### 3.2 Cargo Dependencies (`Cargo.toml`)

```toml
aws-sdk-s3         = "1"
aws-config         = { version = "1", default-features = false, features = ["behavior-version-latest"] }
aws-credential-types = "1"
bytes              = "1"
```

`aws-sdk-s3` v1 tracks the AWS SDK for Rust stable series. All three `aws-*` crates must be version-compatible (same major). `bytes::Bytes` is already a common dependency in the async Rust ecosystem and avoids copying the document payload unnecessarily.

### 3.3 `S3Storage` Struct (`storage/mod.rs`)

```rust
use std::sync::Arc;
use aws_sdk_s3::Client;

#[derive(Clone)]
pub struct S3Storage {
    inner: Arc<S3StorageInner>,
}

struct S3StorageInner {
    client: Client,
    bucket: String,
}
```

Wrapping in `Arc<Inner>` makes `clone()` O(1) and allows `S3Storage` to be stored in an `Arc<AppState>` alongside the database pool without double-wrapping.

### 3.4 Initialisation (`S3Storage::new`)

```rust
use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{Builder as S3ConfigBuilder, BehaviorVersion};

impl S3Storage {
    pub async fn new(config: &Config) -> AppResult<Self> {
        let creds = Credentials::new(
            &config.s3_access_key,
            &config.s3_secret_key,
            None,   // session token
            None,   // expiry
            "rag-static",
        );

        let s3_config = S3ConfigBuilder::new()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(&config.s3_endpoint)
            .region(Region::new("us-east-1"))   // MinIO ignores region; use placeholder
            .credentials_provider(creds)
            .force_path_style(true)             // required for MinIO
            .build();

        let client = Client::from_conf(s3_config);

        Ok(Self {
            inner: Arc::new(S3StorageInner {
                client,
                bucket: config.s3_bucket.clone(),
            }),
        })
    }
}
```

`force_path_style(true)` is the critical flag for MinIO: it produces URLs of the form `http://localhost:9000/rag-documents/{key}` rather than the AWS virtual-hosted style (`http://rag-documents.localhost:9000/{key}`), which MinIO does not support in the default Docker setup.

The region value `"us-east-1"` is a placeholder; MinIO ignores it entirely. Real AWS deployments will pass the correct region via `S3_ENDPOINT` (or a separate config field added in a future spec).

### 3.5 `put_object`

```rust
use aws_sdk_s3::primitives::ByteStream;

impl S3Storage {
    pub async fn put_object(
        &self,
        key: &str,
        data: bytes::Bytes,
        content_type: &str,
    ) -> AppResult<()> {
        self.inner
            .client
            .put_object()
            .bucket(&self.inner.bucket)
            .key(key)
            .body(ByteStream::from(data))
            .content_type(content_type)
            .send()
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }
}
```

`ByteStream::from(bytes::Bytes)` is a zero-copy conversion; the SDK holds a reference to the same allocation.

### 3.6 `delete_object`

```rust
impl S3Storage {
    pub async fn delete_object(&self, key: &str) -> AppResult<()> {
        self.inner
            .client
            .delete_object()
            .bucket(&self.inner.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }
}
```

The S3 `DeleteObject` API returns HTTP 204 whether or not the key existed. No special handling is needed to achieve idempotency; the `.map_err` only fires on network or authentication errors.

### 3.7 Error Variant Addition (`error.rs`)

```rust
#[error("Storage error: {0}")]
Storage(String),
```

The AWS SDK error types are generic over the operation (`SdkError<PutObjectError>`, `SdkError<DeleteObjectError>`, etc.) and do not share a common `From` impl, so the error is converted to a `String` via `.to_string()` at the call site rather than using `#[from]`. This is consistent with how `AppError::Config` is already defined.

The full updated `AppError` enum:

```rust
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Storage error: {0}")]
    Storage(String),
}
```

### 3.8 Testcontainers Helper

Integration tests (in `tests/`) use a shared async helper that starts a MinIO container and pre-creates the bucket:

```rust
use testcontainers::{runners::AsyncRunner, GenericImage, RunnableImage};

async fn setup_storage() -> S3Storage {
    let image = RunnableImage::from(
        GenericImage::new("minio/minio", "latest")
            .with_env_var("MINIO_ROOT_USER", "minioadmin")
            .with_env_var("MINIO_ROOT_PASSWORD", "minioadmin")
            .with_cmd(["server", "/data"])
            .with_wait_for(WaitFor::message_on_stderr("API:"))
    )
    .with_mapped_port((0, 9000));   // ephemeral host port

    let container = image.start().await.unwrap();
    let port = container.get_host_port_ipv4(9000).await.unwrap();

    let config = Config {
        s3_endpoint: format!("http://127.0.0.1:{}", port),
        s3_bucket: "test-bucket".to_string(),
        s3_access_key: "minioadmin".to_string(),
        s3_secret_key: "minioadmin".to_string(),
        ..Default::default()   // other fields unused by S3Storage
    };

    let storage = S3Storage::new(&config).await.unwrap();

    // Pre-create the bucket (MinIO does not auto-create)
    storage.inner.client
        .create_bucket()
        .bucket("test-bucket")
        .send()
        .await
        .unwrap();

    storage
}
```

The `create_bucket` step is only needed in the testcontainers helper. In the Docker Compose environment the `minio-init` service creates the bucket. In production the bucket is assumed to exist.

### 3.9 Integration Test Outline

```rust
#[tokio::test]
async fn test_put_and_delete_object() {
    let storage = setup_storage().await;
    let key = "test-source-id";
    let data = bytes::Bytes::from("hello, world");

    // put succeeds
    storage.put_object(key, data.clone(), "text/plain").await.unwrap();

    // delete succeeds
    storage.delete_object(key).await.unwrap();

    // delete again is idempotent (no error)
    storage.delete_object(key).await.unwrap();

    // re-put after delete succeeds
    storage.put_object(key, data, "text/plain").await.unwrap();
}
```

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | Should `put_object` accept a `content_length` hint to avoid buffering by the SDK? `ByteStream::from(Bytes)` already knows the length, so this is automatic. | No action needed; SDK infers content length from `Bytes`. |
| Q2 | Real AWS S3 deployments will need a proper region. Should `region` come from a `Config` field (`S3_REGION`) now or wait until the MinIO-only phase is complete? | Add `S3_REGION` with a default of `"us-east-1"` when the first non-MinIO deployment is configured. No code change needed today; the placeholder value works for both MinIO and single-region AWS. |
| Q3 | Should `S3Storage` expose `bucket_name()` for use in log messages / error context in pipelines? | Add a trivial `pub fn bucket(&self) -> &str` accessor if any pipeline needs it; skip until then. |
| Q4 | When `get_object` is added (future, needed for document overlay feature), should it return `bytes::Bytes` (fully buffered) or `ByteStream` (streaming)? | Return `bytes::Bytes` for simplicity in v1; revisit streaming when large-file support is a requirement. |
