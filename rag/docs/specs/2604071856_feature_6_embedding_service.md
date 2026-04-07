# Embedding Service

**Status**: Draft
**Created**: 2026-04-07T18:56:52Z
**Timestamp**: 2604071856
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #6

---

## PART I: Requirements

### Problem Statement

The ingestion pipeline (F7) and search pipeline (F8) both need to convert text into dense vector representations. Embedding must be performed locally — no external API calls — using the Nomic Embed Text v2 MoE model via the FastEmbed crate and its bundled ONNX runtime. The model produces 768-dimensional f32 vectors that are compatible with the `vector(768)` column type in the `chunks` table and with the `pgvector::Vector` type used throughout the DB layer.

The embedding module is a thin, async-safe service wrapper around `fastembed::TextEmbedding`. It is constructed once at server startup (model loaded into memory), then shared across requests via `Arc`. All callers receive `pgvector::Vector` values and are shielded from fastembed's internal types.

### Requirements

- **R1** — Cargo dependency: add `fastembed = "4"` to `Cargo.toml`. The v4 release bundles the ONNX runtime statically; no separate system library installation is required. No additional feature flags are needed for the default CPU inference path.

- **R2** — `EmbeddingService` struct: wraps `Arc<fastembed::TextEmbedding>`. Derives `Clone`. Implements `Send + Sync` (satisfied automatically because `TextEmbedding` is `Send + Sync` and `Arc` is both). The `Arc` wrapper allows the service to be cheaply cloned and shared across Tokio tasks without re-loading the model.

- **R3** — `EmbeddingService::new(model_name: &str) -> AppResult<Self>`: constructs the service by mapping the model name string to a `fastembed::EmbeddingModel` enum variant, then initialising `TextEmbedding` with default options (CPU inference, fastembed's default cache directory `~/.cache/fastembed/`). Returns `AppError::Embedding` on any fastembed error. Model loading is a blocking operation and must be called once at startup before the async runtime's thread pool is saturated — wrapping with `tokio::task::spawn_blocking` is the caller's responsibility if invoked from async context.

- **R4** — `embed_batch(texts: &[&str]) -> AppResult<Vec<pgvector::Vector>>`: embeds a slice of texts in a single fastembed batch call. Returns one `pgvector::Vector` per input text in the same order. Errors are mapped to `AppError::Embedding`. This is the primary method used by the ingestion pipeline when embedding document chunks.

- **R5** — `embed_one(text: &str) -> AppResult<pgvector::Vector>`: embeds a single string. Implemented as a convenience wrapper over `embed_batch` (`embed_batch(&[text]).map(|mut v| v.remove(0))`). This is the primary method used by the search pipeline when embedding a query.

- **R6** — `AppError::Embedding` variant: a new variant is added to the application error enum in `src/error.rs`. It wraps the fastembed error via `#[from]` or a manual `impl From<fastembed::Error>`, and includes a human-readable message. Displayed as `"embedding error: {source}"`.

- **R7** — Single model load: `TextEmbedding` is constructed once when the application starts (inside the `serve` command handler in `main.rs`, before spawning the MCP server). The resulting `EmbeddingService` is stored in application state and passed by clone to each pipeline. No model re-loading occurs on subsequent requests.

### Success Criteria

- [ ] `cargo add fastembed@4` compiles without warnings and no system ONNX library is required
- [ ] `EmbeddingService::new("nomic-embed-text-v2-moe")` succeeds (model downloaded/cached on first run) and returns a valid service instance
- [ ] `EmbeddingService::new("unknown-model")` returns `Err(AppError::Embedding(...))`
- [ ] `embed_batch` on a slice of 10 strings returns exactly 10 vectors, each of length 768
- [ ] `embed_one("hello world")` returns a single 768-dimensional vector
- [ ] `embed_one` result is identical to `embed_batch(&["hello world"])[0]`
- [ ] `EmbeddingService` can be cloned and used from two concurrent Tokio tasks without data races
- [ ] `AppError::Embedding` is displayable and round-trips through `thiserror`
- [ ] All unit and integration tests pass under `cargo test`

### Out of Scope

The following are explicitly deferred and must not be implemented in this feature:

- **GPU acceleration** — CPU-only inference via ONNX runtime for v1. GPU/CUDA support is a future optimisation.
- **Model fine-tuning or training** — the module is inference-only.
- **Embedding caching** — re-embedding identical strings on every call is acceptable for v1. A caching layer (e.g. in-memory LRU keyed on text hash) is deferred.
- **Multiple simultaneous models** — exactly one model is loaded at startup. Multi-model support is deferred.
- **Custom model paths** — fastembed's default cache directory (`~/.cache/fastembed/`) is used. Configurable cache paths are deferred.
- **Streaming or async batch interfaces** — embedding is CPU-bound and synchronous; callers wrap with `spawn_blocking` at the pipeline layer if needed.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | `fastembed` Cargo dependency; `AppError::Embedding` variant; `EmbeddingService` struct; `new()`, `embed_batch()`, `embed_one()` implementations; `Config` wiring | 0.5 d |
| Phase 2 | Unit and integration tests: model loading, batch embedding dimension check, single embedding, concurrent access, error mapping | 0.5 d |

**Total estimate**: 1 day

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/embedding/
  mod.rs    -- EmbeddingService struct, new(), embed_batch(), embed_one()
src/error.rs -- AppError::Embedding variant (addition)
```

`src/embedding/mod.rs` currently contains only a `// TODO` comment and is ready for implementation. No new files need to be created.

### 3.2 Cargo Dependency (`Cargo.toml`)

```toml
fastembed = "4"
```

fastembed v4 statically links the ONNX runtime. No system packages are required. Model weights are downloaded to `~/.cache/fastembed/` on first use (~130 MB for Nomic Embed Text v2 MoE). Subsequent runs reuse the cached ONNX model file. The crate re-exports its own error type as `fastembed::Error`.

### 3.3 `AppError::Embedding` (`src/error.rs`)

A new variant is added to the application error enum:

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    // ... existing variants ...

    /// An error originating from the FastEmbed embedding library.
    #[error("embedding error: {0}")]
    Embedding(String),
}

impl From<fastembed::Error> for AppError {
    fn from(e: fastembed::Error) -> Self {
        AppError::Embedding(e.to_string())
    }
}
```

`fastembed::Error` does not implement `std::error::Error` in all v4 builds, so a manual `From` implementation converting via `.to_string()` is safer than `#[from]`. This decision should be confirmed against the actual v4 API during Phase 1.

### 3.4 `EmbeddingService` Struct and Constructor

```rust
use std::sync::Arc;
use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};
use pgvector::Vector;
use crate::error::AppError;

pub type AppResult<T> = Result<T, AppError>;

/// Thread-safe wrapper around a loaded FastEmbed TextEmbedding model.
///
/// Clone is cheap: all clones share the same underlying model via Arc.
#[derive(Clone)]
pub struct EmbeddingService {
    model: Arc<TextEmbedding>,
}

impl EmbeddingService {
    /// Load the named embedding model, downloading it to ~/.cache/fastembed/
    /// on first use.
    ///
    /// `model_name` must be a string that maps to a known `EmbeddingModel`
    /// variant (e.g. `"nomic-embed-text-v2-moe"`).  Returns
    /// `AppError::Embedding` if the name is unrecognised or model
    /// initialisation fails.
    ///
    /// This function is blocking.  Call it before entering the async runtime,
    /// or wrap with `tokio::task::spawn_blocking` if called from async
    /// context.
    pub fn new(model_name: &str) -> AppResult<Self> {
        let model_variant = map_model_name(model_name)?;

        let model = TextEmbedding::try_new(
            InitOptions::new(model_variant),
        )
        .map_err(AppError::from)?;

        Ok(Self {
            model: Arc::new(model),
        })
    }
}
```

### 3.5 Model Name Mapping

`fastembed::EmbeddingModel` is an enum. The `Config` struct stores the model as a plain string (`embedding_model: String`) for CLI/env-var flexibility. The mapping is performed in `EmbeddingService::new` via a private helper:

```rust
fn map_model_name(name: &str) -> AppResult<EmbeddingModel> {
    match name {
        "nomic-embed-text-v2-moe" => Ok(EmbeddingModel::NomicEmbedTextV2),
        "nomic-embed-text-v1.5"   => Ok(EmbeddingModel::NomicEmbedTextV15),
        other => Err(AppError::Embedding(
            format!("unknown embedding model: '{other}'; \
                     supported: nomic-embed-text-v2-moe, nomic-embed-text-v1.5")
        )),
    }
}
```

The exact `EmbeddingModel` variant names must be confirmed against the fastembed v4 public API during Phase 1 implementation. The mapping table here is illustrative; additional variants can be added without changing the public interface of `EmbeddingService`.

### 3.6 `embed_batch`

```rust
impl EmbeddingService {
    /// Embed a batch of texts, returning one 768-dimensional vector per input.
    ///
    /// Vectors are returned in the same order as the input slice.
    /// Returns `AppError::Embedding` on any fastembed failure.
    pub fn embed_batch(&self, texts: &[&str]) -> AppResult<Vec<Vector>> {
        let embeddings = self
            .model
            .embed(texts.to_vec(), None)
            .map_err(AppError::from)?;

        Ok(embeddings
            .into_iter()
            .map(|v| Vector::from(v))
            .collect())
    }
}
```

`TextEmbedding::embed` accepts a `Vec<&str>` and an optional batch size (`None` uses the crate default). It returns `Vec<Vec<f32>>`. Each inner `Vec<f32>` is wrapped in `pgvector::Vector` via `Vector::from(v)`, which accepts `Vec<f32>`.

### 3.7 `embed_one`

```rust
impl EmbeddingService {
    /// Embed a single text string.  Convenience wrapper over `embed_batch`.
    pub fn embed_one(&self, text: &str) -> AppResult<Vector> {
        self.embed_batch(&[text])
            .map(|mut v| v.remove(0))
    }
}
```

Delegating to `embed_batch` ensures identical preprocessing and model inference paths for both single and batch calls. The overhead of constructing a one-element slice is negligible.

### 3.8 Startup Wiring (`main.rs` / `serve` command)

Model loading is blocking and must complete before the async server loop starts. The recommended pattern in the `serve` command handler:

```rust
// In the serve command handler, before entering the Tokio async runtime:
let embedding_service = EmbeddingService::new(&config.embedding_model)?;

// Then, inside the Tokio runtime, the service is passed to pipelines by clone:
let ingest_pipeline = IngestPipeline::new(
    db_pool.clone(),
    s3_client.clone(),
    chunker_config,
    embedding_service.clone(),
);
let search_pipeline = SearchPipeline::new(
    db_pool.clone(),
    embedding_service.clone(),
);
```

If the serve command is itself async (e.g. annotated `#[tokio::main]`), model loading should use `spawn_blocking`:

```rust
let embedding_service = tokio::task::spawn_blocking(move || {
    EmbeddingService::new(&config.embedding_model)
})
.await??;
```

### 3.9 `Config` Wiring

`config.rs` already has:

```rust
#[arg(long, env = "EMBEDDING_MODEL", default_value = "nomic-embed-text-v2-moe")]
pub embedding_model: String,
```

No changes to `config.rs` are required for this feature. The default value `"nomic-embed-text-v2-moe"` aligns with the primary mapping in `map_model_name`.

### 3.10 Relationship to `NewChunk`

The ingestion pipeline assembles `NewChunk` records by combining `TextChunk` output (F5) with vectors from `EmbeddingService`:

| Source | `NewChunk` field |
|--------|-----------------|
| `Uuid::new_v4()` | `id` |
| ingestion pipeline | `source_id` |
| `TextChunk::index as i32` | `chunk_index` |
| `TextChunk::content` | `content` |
| `EmbeddingService::embed_batch(...)` | `embedding: pgvector::Vector` |

The embedding module has no direct dependency on `db/models.rs`. The ingestion pipeline owns the translation.

### 3.11 Unit Test Outline

Tests live in a `#[cfg(test)]` block at the bottom of `src/embedding/mod.rs`. Tests that perform actual model inference require network access on the first run (model download) and are gated with `#[ignore]` or a feature flag so CI can skip them if offline.

```
map_model_name_known        -- "nomic-embed-text-v2-moe" maps without error
map_model_name_unknown      -- "bad-model" returns Err(AppError::Embedding)
embed_batch_dimension       -- batch of 3 texts: each vector has len() == 768
embed_batch_ordering        -- output order matches input order
embed_one_matches_batch     -- embed_one("x") == embed_batch(&["x"])[0]
embed_batch_empty           -- embed_batch(&[]) returns Ok(vec![])
embed_service_clone_sends   -- two clones used from spawn() without panic
app_error_display           -- AppError::Embedding("msg").to_string() == "embedding error: msg"
```

Tests that load the model (`embed_batch_dimension`, `embed_batch_ordering`, `embed_one_matches_batch`) are marked `#[ignore]` by default:

```rust
#[test]
#[ignore = "requires model download (~130 MB); run with --include-ignored"]
fn embed_batch_dimension() { ... }
```

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | What are the exact `EmbeddingModel` variant names in fastembed v4 for Nomic v2 MoE and v1.5? The crate renamed variants between v3 and v4. | Confirm by inspecting `fastembed::EmbeddingModel` enum in v4 docs or source during Phase 1. Update `map_model_name` accordingly. |
| Q2 | Does `fastembed::Error` implement `std::error::Error` in v4? If so, `#[from]` can be used in `AppError` directly. | Default to `From` via `.to_string()` as a safe fallback; switch to `#[from]` if confirmed. |
| Q3 | Does `TextEmbedding::embed` in v4 accept `Vec<&str>` or `Vec<String>`? | Confirm during Phase 1. Adjust `embed_batch` signature or `.to_vec()` call accordingly. |
| Q4 | Should `embed_batch` accept an explicit batch size hint for large ingestion jobs, or is fastembed's internal default sufficient? | Use `None` (fastembed default) for v1. Add an optional `batch_size` parameter to `embed_batch` in a follow-up if ingestion benchmarks reveal a bottleneck. |
| Q5 | Should model loading be exposed as async (using `spawn_blocking` internally) to simplify caller code? | Keep `new()` synchronous for v1 to avoid hiding the blocking operation. Revisit if startup ergonomics are a pain point during F7/F8 implementation. |
