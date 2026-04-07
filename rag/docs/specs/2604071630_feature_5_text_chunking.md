# Text Chunking Engine

**Status**: Draft
**Created**: 2026-04-07T16:30:49Z
**Timestamp**: 2604071630
**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #5

---

## PART I: Requirements

### Problem Statement

The ingestion pipeline (F7) receives a plain text or markdown string and must split it into overlapping chunks before embedding. The chunking module is a pure, synchronous computation layer with no I/O dependencies: it takes a `&str` and configuration, and returns a `Vec<TextChunk>`. It must handle both unstructured plain text and structured markdown, where the latter benefits from splitting at semantic boundaries (headings, code fences) to keep logically related content together.

The module sits between raw document bytes (received from the MCP caller) and the embedding service (F6). The `NewChunk` DB model already captures `chunk_index` and `content`; `TextChunk` maps cleanly onto those two fields. No character offsets are produced at this stage — that concern is deferred to the document overlay feature.

### Requirements

- **R1** — Cargo dependency: add `text-splitter` with the `markdown` feature to `Cargo.toml`. No other new runtime crates are required by this module.

- **R2** — `ChunkConfig` struct: expose `chunk_size: usize` (target maximum chunk length in characters, default 2048) and `overlap: usize` (overlap between consecutive chunks in characters, default 200). Both fields must be constructable from environment variables `CHUNK_SIZE` and `CHUNK_OVERLAP` with fallback to the defaults if the variables are absent or unparseable. `ChunkConfig` derives `Debug`, `Clone`, and `Copy`.

- **R3** — `chunk_text(text: &str, config: &ChunkConfig) -> Vec<TextChunk>`: split plain text using `text-splitter`'s character-based splitter. Chunk boundaries are determined by the crate's recursive character splitting heuristic; callers do not choose the split strategy beyond `chunk_size` and `overlap`.

- **R4** — `chunk_markdown(text: &str, config: &ChunkConfig) -> Vec<TextChunk>`: split markdown-formatted text using `text-splitter`'s `MarkdownSplitter`. The splitter respects heading hierarchy and code fences as natural boundaries, preferring to keep a heading and its immediately following content together when it fits within `chunk_size`.

- **R5** — `TextChunk` struct: two public fields, `index: usize` (zero-based position of this chunk in the document) and `content: String` (the chunk text, exactly as returned by `text-splitter` with no additional trimming or normalisation). Derives `Debug`, `Clone`.

- **R6** — Empty and whitespace-only input: both `chunk_text` and `chunk_markdown` must return an empty `Vec` when given a string that is empty or consists entirely of whitespace characters. This is checked before calling into `text-splitter` to avoid crate-specific edge-case behaviour.

- **R7** — Config from environment: `ChunkConfig` provides a `from_env()` constructor that reads `CHUNK_SIZE` and `CHUNK_OVERLAP` via `std::env::var`. If either variable is absent or fails `parse::<usize>()`, the default value is used silently (no panic, no log). The `Config` struct in `config.rs` gains two optional clap arguments (`--chunk-size`, `--chunk-overlap`) backed by the same env vars; when absent, the clap defaults match `ChunkConfig`'s built-in defaults.

### Success Criteria

- [ ] `cargo add text-splitter --features markdown` compiles without warnings
- [ ] `chunk_text("", &config)` and `chunk_markdown("   ", &config)` both return `vec![]`
- [ ] `chunk_text` with a 10 000-character input and default config returns chunks where every `content.len() <= chunk_size`
- [ ] `chunk_markdown` places a heading and its first paragraph in the same chunk when they fit within `chunk_size`
- [ ] Consecutive chunks produced by either function share an overlapping suffix/prefix of approximately `overlap` characters
- [ ] `TextChunk::index` values are contiguous from 0 for every non-empty input
- [ ] `ChunkConfig::from_env()` picks up `CHUNK_SIZE=512` from the environment in tests
- [ ] All unit tests pass under `cargo test`

### Out of Scope

The following are explicitly deferred and must not be implemented in this feature:

- **Character offsets** — `TextChunk` carries no `start_byte`/`end_byte` fields. Offsets are deferred to the document overlay feature that will allow highlighting source passages.
- **Token-based splitting** — splitting is character-based only. At ~4 characters per token the default 2048-character chunk corresponds to roughly 512 tokens, which matches common embedding model context windows without requiring a tokenizer dependency.
- **PDF and binary extraction** — the chunker receives a `&str`. Extraction of text from PDFs, DOCX, or other binary formats is a pipeline concern upstream of this module.
- **Embedding generation** — `TextChunk` carries no vector field. Embedding is the responsibility of F6.
- **Async interface** — chunking is CPU-bound and allocation-heavy but not I/O-bound; the functions are synchronous and may be called from an async context with `spawn_blocking` if needed.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | `text-splitter` Cargo dependency; `TextChunk` and `ChunkConfig` structs; `chunk_text` and `chunk_markdown` implementations; `Config` env var additions | 0.5 d |
| Phase 2 | Unit tests: chunk size bounds, overlap verification, markdown boundary preservation, empty/whitespace edge cases, `from_env()` config parsing | 0.5 d |

**Total estimate**: 1 day

---

## PART III: Detailed Design

### 3.1 File Layout

```
src/chunking/
  mod.rs    -- ChunkConfig, TextChunk, chunk_text(), chunk_markdown()
```

The epic's architecture diagram lists `chunking/text.rs` and `chunking/markdown.rs` as separate submodules, but the implementation is simple enough that a single `mod.rs` is preferable for v1. If the module grows (e.g. adding a `SentenceSplitter` or a streaming API), submodules can be introduced without breaking the public interface.

### 3.2 Cargo Dependency (`Cargo.toml`)

```toml
text-splitter = { version = "0.17", features = ["markdown"] }
```

The `markdown` feature activates the `MarkdownSplitter` type and pulls in `pulldown-cmark` as a transitive dependency. No other features are needed. Pin to the `0.17` minor series; the crate follows semver and minor bumps within `0.x` may change splitting heuristics.

### 3.3 `TextChunk` and `ChunkConfig` Structs

```rust
/// A single chunk produced by splitting a document.
#[derive(Debug, Clone)]
pub struct TextChunk {
    /// Zero-based position of this chunk within the document.
    pub index: usize,
    /// The chunk text, as returned by the splitter.
    pub content: String,
}

/// Configuration for the chunking functions.
#[derive(Debug, Clone, Copy)]
pub struct ChunkConfig {
    /// Maximum chunk length in characters (default: 2048).
    pub chunk_size: usize,
    /// Overlap between consecutive chunks in characters (default: 200).
    pub overlap: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            chunk_size: 2048,
            overlap: 200,
        }
    }
}

impl ChunkConfig {
    /// Build from environment variables `CHUNK_SIZE` and `CHUNK_OVERLAP`,
    /// falling back to defaults for any missing or unparseable value.
    pub fn from_env() -> Self {
        let chunk_size = std::env::var("CHUNK_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(Self::default().chunk_size);

        let overlap = std::env::var("CHUNK_OVERLAP")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(Self::default().overlap);

        Self { chunk_size, overlap }
    }
}
```

### 3.4 `chunk_text`

```rust
use text_splitter::TextSplitter;

/// Split plain text into overlapping chunks.
///
/// Returns an empty Vec for empty or whitespace-only input.
pub fn chunk_text(text: &str, config: &ChunkConfig) -> Vec<TextChunk> {
    if text.trim().is_empty() {
        return Vec::new();
    }

    let splitter = TextSplitter::new(config.chunk_size)
        .with_trim_chunks(false);

    splitter
        .chunks(text)
        .enumerate()
        .map(|(index, content)| TextChunk {
            index,
            content: content.to_string(),
        })
        .collect()
}
```

`TextSplitter::new(max_characters)` uses recursive character splitting: it tries to split on paragraph boundaries first, then sentence boundaries, then word boundaries, and finally raw character positions. This produces human-readable chunks without requiring a tokenizer. `with_trim_chunks(false)` preserves leading/trailing whitespace in chunks exactly as the crate emits them; the ingestion pipeline can trim if desired.

Overlap is handled by the `text-splitter` crate when constructed via `TextSplitter::new(...).with_overlap(config.overlap)`. The exact implementation detail is deferred to Phase 1 where the API call signature is confirmed against the pinned crate version.

### 3.5 `chunk_markdown`

```rust
use text_splitter::MarkdownSplitter;

/// Split markdown text into overlapping chunks, respecting heading and
/// code-fence boundaries.
///
/// Returns an empty Vec for empty or whitespace-only input.
pub fn chunk_markdown(text: &str, config: &ChunkConfig) -> Vec<TextChunk> {
    if text.trim().is_empty() {
        return Vec::new();
    }

    let splitter = MarkdownSplitter::new(config.chunk_size)
        .with_trim_chunks(false);

    splitter
        .chunks(text)
        .enumerate()
        .map(|(index, content)| TextChunk {
            index,
            content: content.to_string(),
        })
        .collect()
}
```

`MarkdownSplitter` uses `pulldown-cmark` to parse the document structure and prefers splitting at heading boundaries before falling back to the same recursive character heuristics as `TextSplitter`. Code fences are treated as atomic units: a fenced code block is never split across chunks unless it alone exceeds `chunk_size`. This preserves the semantic integrity of code examples, which is particularly valuable for the RAG use case (code snippets should embed and retrieve as a unit).

### 3.6 `Config` Additions (`config.rs`)

Two new optional fields are added to the `Config` struct to integrate chunking parameters into the clap-based CLI:

```rust
/// Maximum chunk size in characters
#[arg(long, env = "CHUNK_SIZE", default_value = "2048")]
pub chunk_size: usize,

/// Overlap between consecutive chunks in characters
#[arg(long, env = "CHUNK_OVERLAP", default_value = "200")]
pub chunk_overlap: usize,
```

The ingestion pipeline (F7) converts these into a `ChunkConfig` as:

```rust
let chunk_config = ChunkConfig {
    chunk_size: app_config.chunk_size,
    overlap: app_config.chunk_overlap,
};
```

`ChunkConfig::from_env()` remains available for contexts outside the CLI entrypoint (e.g. unit tests that set env vars directly).

### 3.7 Integration with `NewChunk` (`db/models.rs`)

`TextChunk` maps to `NewChunk` in the ingestion pipeline. The correspondence is:

| `TextChunk` field | `NewChunk` field | Notes |
|---|---|---|
| `index: usize` | `chunk_index: i32` | Cast with `index as i32`; chunk counts will not exceed `i32::MAX` in practice |
| `content: String` | `content: String` | Direct move |
| (absent) | `id: Uuid` | Generated by the ingestion pipeline via `Uuid::new_v4()` |
| (absent) | `source_id: Uuid` | Supplied by the ingestion pipeline from the parent source record |
| (absent) | `embedding: Vector` | Supplied by the embedding service (F6) |

The chunking module has no dependency on `db/models.rs` or `uuid`. The ingestion pipeline owns the translation.

### 3.8 Unit Test Outline

Tests live in a `#[cfg(test)]` block at the bottom of `src/chunking/mod.rs`. No external test fixtures are needed; all inputs are inline string literals.

```
chunk_text_empty_input          -- empty string returns vec![]
chunk_text_whitespace_input     -- "   \n\t  " returns vec![]
chunk_text_short_input          -- input shorter than chunk_size returns single chunk at index 0
chunk_text_long_input           -- 10k-char input: all chunks <= chunk_size, indices contiguous from 0
chunk_text_overlap              -- consecutive chunks share approximately `overlap` chars at boundary
chunk_markdown_empty_input      -- empty string returns vec![]
chunk_markdown_heading_boundary -- heading + short body stays in one chunk when it fits
chunk_markdown_code_fence       -- fenced code block shorter than chunk_size is not split
chunk_markdown_large_code_fence -- fenced code block exceeding chunk_size is split (graceful fallback)
chunk_config_from_env           -- CHUNK_SIZE=512 env var is picked up; missing var uses default
chunk_config_from_env_invalid   -- CHUNK_SIZE=notanumber silently uses default
```

---

## PART IV: Open Questions

| # | Question | Default / Fallback |
|---|----------|--------------------|
| Q1 | The `text-splitter` API for overlap changed between minor versions (`.with_overlap()` vs constructor parameter). Which exact method signature does v0.17 expose? | Confirm during Phase 1 implementation. If overlap is not supported at this version, track the chunk boundary manually in a post-processing pass. |
| Q2 | Should `with_trim_chunks` be `true` or `false`? Trimming removes leading/trailing whitespace from each chunk, which cleans up output but may alter overlap calculations. | Default to `false` to preserve splitter output exactly; revisit if search quality experiments show trimming improves embedding recall. |
| Q3 | Should `chunk_markdown` fall back to `chunk_text` behaviour when the input is valid UTF-8 but not well-formed markdown (e.g. a plain `.txt` file accidentally routed to the markdown path)? | No special fallback needed: `MarkdownSplitter` degrades gracefully to paragraph/sentence splitting on non-markdown input. The ingestion pipeline is responsible for routing based on `content_type`. |
| Q4 | Are 2048 chars / 200 overlap the right defaults for Nomic Embed Text v2? Nomic v2 supports up to 8192 tokens; 2048 chars ≈ 512 tokens leaves significant headroom. | Keep defaults conservative for v1. Once search quality is measurable (F8 complete), tune via `CHUNK_SIZE` and `CHUNK_OVERLAP` env vars without code changes. |
| Q5 | Should `TextChunk` be `#[non_exhaustive]`? Adding fields later (e.g. offsets) would be a breaking change for any destructuring. | Mark `#[non_exhaustive]` at definition time to allow field additions without a major version bump. Low cost, high future flexibility. |
