# Specification: PDF Ingestion for RAG MCP Server

**Status:** Draft  
**Date:** 2026-04-09  
**Revision:** 1

---

## Overview

This document specifies the addition of PDF ingestion to the existing Rust-based RAG MCP server. The server currently handles markdown and source code files, running them through a pipeline of chunking, embedding, and storage. PDF support extends this pipeline with a PDF-specific text extraction step that feeds into the same downstream infrastructure.

**Selected library:** [`pdfium-render`](https://crates.io/crates/pdfium-render) — Rust bindings to Google's PDFium (the same C++ library used by Chromium). Chosen for reliability with real-world PDFs, active maintenance, and keeping the stack entirely in Rust.

---

## Requirements

### Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | The server MUST accept PDF files as input via the existing `ingest` MCP tool. |
| FR-2 | Text MUST be extracted from all text-bearing pages of a PDF. |
| FR-3 | Extracted text MUST be chunked using paragraph-boundary detection (double newlines `\n\n`) before passing to the shared chunker. |
| FR-4 | Chunks MUST be embedded using the same embedding model used for markdown/code. |
| FR-5 | The original PDF file MUST be stored in S3 using the same key scheme as other source types. |
| FR-6 | Chunk embeddings MUST be stored in Postgres (pgvector) with a `source_type = "pdf"` tag. Each PDF chunk MUST also include `page_number` and `bbox` positional metadata in the `metadata JSONB` column. |
| FR-7 | PDF chunks MUST be retrievable via the existing `search` MCP tool without caller changes. |
| FR-8 | The `ingest_directory` tool MUST automatically detect and process `.pdf` files. |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | PDF extraction MUST NOT block the async runtime — pdfium-render calls MUST run on a blocking thread pool (e.g., `tokio::task::spawn_blocking`). |
| NFR-2 | A single PDF ingestion MUST complete within 60 seconds for documents up to 500 pages under normal load. |
| NFR-3 | Errors during text extraction for a single page MUST be logged and skipped; the rest of the document MUST still be processed. |
| NFR-4 | The pdfium native library (`.so` / `.dylib` / `.dll`) MUST be documented as a deployment dependency. |

### Out of Scope (v1)

- OCR for scanned/image-only PDFs.
- Table extraction or structured layout analysis.
- Parallel/async embedding queue (noted as a future scaling concern).

---

## Design

### Pipeline Overview

```
PDF file
   │
   ▼
[1] S3 upload (raw PDF)
   │
   ▼
[2] pdfium-render — page-by-page text + character-level bbox extraction
   │   (runs on blocking thread via spawn_blocking)
   │   → Vec<PageTextSpan> (text, page_number, bbox per span)
   ▼
[3] Pre-processor — join spans into a single string with \n\n boundaries,
   │               tracking span byte-offsets for post-chunking bbox mapping
   ▼
[4] Shared chunker (existing) — splits on paragraph boundaries,
   │   respects max_chunk_tokens limit
   ▼
[4b] Bbox mapper — for each chunk, map back to source PageTextSpan(s);
   │   record page_number (starting page) and aggregate bbox on that page
   ▼
[5] Embedding model (existing) — produces vectors
   │
   ▼
[6] Postgres / pgvector — store chunks + embeddings
      (source_type = "pdf", source_key = S3 key,
       metadata = {"page_number": N, "bbox": {…}})
```

Steps 4–6 are **largely unchanged** from the existing markdown/code path. Steps 1–3 and step 4b are new.

### Component: `PdfExtractor`

A new struct in `src/ingest/pdf.rs` responsible for steps 2–3.

#### Data types

```rust
/// Bounding rectangle in PDF points (1 pt = 1/72 inch).
/// Origin is at the bottom-left corner of the page.
pub struct PdfBbox {
    pub top: f32,
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
}

/// A contiguous run of text from a single page, with positional metadata.
pub struct PageTextSpan {
    /// 1-based page index.
    pub page_number: u32,
    /// Text content of this span (may represent a full page or a paragraph within a page).
    pub text: String,
    /// Bounding rectangle computed from the min/max bounds of all characters in this span.
    pub bbox: PdfBbox,
    /// Byte offset of `text` within the joined document string (set by the pre-processor).
    pub byte_offset: usize,
}
```

#### Struct and public API

```rust
pub struct PdfExtractor {
    // Holds pdfium bindings instance (loaded once at startup)
    pdfium: Arc<Pdfium>,
}

impl PdfExtractor {
    /// Load pdfium dynamic library from the path configured in settings.
    pub fn new(pdfium_lib_path: &Path) -> Result<Self>;

    /// Extract text with positional metadata from a PDF byte buffer.
    /// Returns a Vec of PageTextSpan ordered by page, and the joined document
    /// string (spans concatenated with "\n\n" separators).
    /// Runs synchronously — callers MUST use spawn_blocking.
    pub fn extract(&self, pdf_bytes: &[u8]) -> Result<(Vec<PageTextSpan>, String)>;
}
```

#### `extract` algorithm

1. Open the PDF from the in-memory buffer using `pdfium-render`.
2. Iterate pages in order (0-indexed internally, but `page_number` is stored 1-based).
3. For each page, iterate characters using pdfium-render's character-level API (`PdfPageText::chars()`).
4. Group characters into a single span per page, accumulating:
   - The text content (preserving internal whitespace and newlines).
   - The bounding box as the running `min(left, bottom)` / `max(right, top)` across all character bounding rectangles on the page.
5. If a page raises an error, log `WARN` with the page index and continue.
6. Run a lightweight normalisation pass on each span's text:
   - Collapse runs of 3+ newlines to `\n\n`.
   - Strip null bytes and control characters (except `\n`, `\t`).
7. Join spans with `\n\n`, recording each span's `byte_offset` in the joined string.
8. Return `(Vec<PageTextSpan>, joined_string)`.

#### Bbox mapper (step 4b)

After the shared chunker produces chunks (each as a `(start_byte, end_byte, text)` triple), the bbox mapper resolves positional metadata:

1. For each chunk, find the `PageTextSpan` whose range contains `start_byte` — this is the **starting page**.
2. Set `page_number` to that span's `page_number`.
3. Compute `bbox` as the aggregate bounding box of all characters belonging to this chunk **on the starting page only** (characters past a page boundary are excluded from the bbox).
4. Serialise into the `metadata` JSON object (see Data Model below).

> **Multi-page chunks:** If a chunk spans a page boundary, `page_number` is set to the page where the chunk **starts**, and `bbox` covers only the text region on that starting page. The remainder of the chunk's text on subsequent pages is not reflected in the bbox.

### Component: `IngestService` changes

The existing `IngestService` dispatches on file type. Add a `Pdf` variant to the `SourceType` enum and a new branch:

```rust
SourceType::Pdf => {
    let extractor = self.pdf_extractor.clone(); // Arc<PdfExtractor>
    let raw_bytes = bytes.clone();
    let (spans, text) = tokio::task::spawn_blocking(move || {
        extractor.extract(&raw_bytes)
    })
    .await??;

    self.ingest_pdf_text(text, spans, s3_key).await?
}
```

`ingest_pdf_text` is a thin wrapper over the shared `ingest_text` path that additionally runs the bbox mapper and writes chunk metadata.

### MCP Tool Changes

| Tool | Change |
|------|--------|
| `ingest` | Accept `application/pdf` MIME type; detect by magic bytes (`%PDF`) as a fallback. |
| `ingest_directory` | Add `.pdf` to the list of recognised extensions (alongside `.md`, `.rs`, etc.). |
| `search` | No changes — already filters by embedding metadata, returns `source_type` in results. |

### Data Model

No schema migrations are required for v1.

- The existing `chunks` table has a `source_type` column (string); the value `"pdf"` will be used.
- The existing `chunks` table has a `metadata JSONB` column (added in migration `20260407000003_add_chunk_metadata.sql`). PDF chunks will populate this column with page and bounding box data.

**PDF chunk metadata schema:**

```json
{
  "page_number": 3,
  "bbox": {
    "top": 742.5,
    "left": 72.0,
    "bottom": 580.1,
    "right": 523.0
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `page_number` | integer | 1-based index of the page where the chunk starts. |
| `bbox.top` | float | Top edge of the bounding rectangle, in PDF points (1/72 inch). Origin is bottom-left of page. |
| `bbox.left` | float | Left edge of the bounding rectangle, in PDF points. |
| `bbox.bottom` | float | Bottom edge of the bounding rectangle, in PDF points. |
| `bbox.right` | float | Right edge of the bounding rectangle, in PDF points. |

The `bbox` is computed by accumulating the `min`/`max` bounds of every character in the chunk that falls on the starting page.

The `sources` table `s3_key` for PDFs follows the existing convention:
`{namespace}/{sha256_of_content}.pdf`

---

## Implementation Phases

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Core PDF text extraction, data types, and unit tests | 2 days |
| Phase 2 | Pipeline integration, MCP tool changes, and integration tests | 2 days |

---

## Implementation Notes

### Dependency Setup

Add to `Cargo.toml`:

```toml
[dependencies]
pdfium-render = { version = "0.8", features = ["sync"] }
```

> **Note:** `pdfium-render` requires the PDFium native shared library to be present at runtime. It is **not** bundled in the crate. The library must be:
> - Available on the host (path configurable via `PDFIUM_LIB_PATH` env var or settings).
> - Included in Docker images / deployment packages.
> - See [pdfium-render docs](https://docs.rs/pdfium-render) for pre-built binaries per platform.

### Configuration

Add to the server's settings struct:

```toml
[pdf]
# Path to the pdfium shared library. Required when PDF ingestion is enabled.
pdfium_lib_path = "/usr/local/lib/libpdfium.so"

# Maximum PDF file size accepted (bytes). Default: 100 MB.
max_pdf_bytes = 104857600
```

### Error Handling

| Scenario | Behaviour |
|----------|-----------|
| pdfium library not found at startup | Fatal — server refuses to start if PDF ingestion is enabled |
| PDF is password-protected | Return error to caller: `"PDF is encrypted and cannot be ingested"` |
| All pages fail text extraction | Return error: `"No text could be extracted from PDF"` |
| Some pages fail | Skip page, log warning, continue |
| File exceeds `max_pdf_bytes` | Reject with `413`-style error before extraction |
| Bbox computation yields no characters | Store `null` for `bbox` in metadata rather than failing |

### Deployment

1. Add `pdfium` shared library to the Docker image.
2. Set `PDFIUM_LIB_PATH` in the container environment, or configure in `settings.toml`.
3. No database migrations needed.
4. No new external services required.

### Testing

- **Unit tests** (`src/ingest/pdf.rs`): test `PdfExtractor::extract` with fixture PDFs covering: single page, multi-page, page with extraction error, empty PDF, password-protected PDF.
- **Bbox tests**: assert that extracted `PageTextSpan` bounding boxes match known coordinates for fixture PDFs with predictable text layout.
- **Multi-page chunk test**: assert that a chunk straddling a page boundary records the correct `page_number` (starting page) and a `bbox` scoped to that page.
- **Integration tests**: end-to-end `ingest → search` round-trip using a known PDF with known text content; assert at least one chunk is returned by vector search and that its `metadata` contains valid `page_number` and `bbox` fields.
- **Fixture PDFs** to include in `tests/fixtures/`: `simple.pdf`, `multi_page.pdf`, `encrypted.pdf`, `image_only.pdf` (expected: error).

---

## Scaling Notes

> These are informational and do not affect v1 implementation.

- **Embedding throughput** is the most likely bottleneck under high ingest load. Batch embedding calls and/or an async work queue should be evaluated once internal usage grows.
- **pdfium is single-threaded per document.** Concurrent ingestion of multiple PDFs is safe (each call is independent), but a single large PDF cannot be parallelised internally by the extractor.
- **S3 and Postgres (pgvector)** are expected to scale without structural changes for the foreseeable internal-tool usage level.

---

## Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | Do we need OCR support for scanned PDFs in v1, or can we defer? | Team | Deferred to v2 |
| 2 | Should `ingest_directory` recurse into subdirectories for PDFs? (It may already for other types — confirm current behaviour.) | Eng | Open |
| 3 | What is the acceptable SLA for large PDFs (e.g. 1000-page documents)? NFR-2 assumes 500 pages / 60 s. | Team | Open |
| 4 | Licensing: PDFium is BSD-licensed. Confirm this is compatible with the project's licence. | Legal/Eng | Open |
