# Tree-Sitter Code-Aware Chunking

**Status**: Draft
**Created**: 2026-04-08T04:22:26Z
**Timestamp**: 2604080422

---

## PART I: Requirements

### Problem Statement

The RAG system currently chunks all non-markdown content with `chunk_text`, which splits by character count without regard for syntactic boundaries. When a source file is code (Rust, Python, TypeScript, Java), this produces chunks that bisect function bodies, cut through struct definitions, and discard the relationship between a method and its containing type. The result is low-quality retrieval: embeddings of partial syntactic units carry less semantic signal than embeddings of complete, self-contained declarations.

Tree-sitter provides deterministic, incremental parsing for all target languages via pure-library grammar crates. Parsing is fast enough to run inline during ingestion. The output AST gives exact byte offsets for every named node, enabling chunks that align precisely with the syntactic units developers search for.

### Requirements

**R1 — Language detection by file extension**
The chunking dispatcher MUST select the appropriate strategy based on the source filename's extension before consulting `content_type`. The fallback chain is:

1. Extension match: `.rs` → Rust, `.py` → Python, `.ts` / `.tsx` → TypeScript, `.java` → Java.
2. `content_type` contains `"markdown"` → markdown chunker.
3. No match → `chunk_text`.

**R2 — New `chunk_code` function**
A new public function `chunk_code(source: &str, language: CodeLanguage, config: &ChunkConfig) -> Vec<CodeChunk>` MUST be added to `src/chunking/mod.rs`. It accepts the full file text and a detected language enum, and returns an ordered list of `CodeChunk` values.

**R3 — `CodeLanguage` enum**
A `CodeLanguage` enum with variants `Rust`, `Python`, `TypeScript`, `Java` MUST be defined. A separate `detect_language(filename: &str) -> Option<CodeLanguage>` function MUST perform the extension mapping from R1.

**R4 — `CodeChunk` type**
A new `CodeChunk` struct MUST be defined with fields:

| Field | Type | Description |
|-------|------|-------------|
| `index` | `usize` | Sequential chunk index starting at 0 |
| `content` | `String` | Full text of the chunk as it will be embedded |
| `start_line` | `usize` | 1-based line number of the first line of the node |
| `end_line` | `usize` | 1-based line number of the last line of the node |
| `node_type` | `String` | Tree-sitter node type string (e.g. `"function_item"`) |
| `context` | `Option<String>` | Container header prepended as context, if applicable |

**R5 — Preamble chunk**
`chunk_code` MUST extract file-level preamble declarations as a single chunk at index 0. Preamble nodes are language-specific top-level constructs that carry no executable logic: `use`, `mod` declarations, and file-level attributes in Rust; `import` and `from ... import` in Python; `import` statements in TypeScript; `package` and `import` declarations in Java. If the accumulated preamble text exceeds `config.chunk_size`, the preamble falls back to `chunk_text` with each resulting `TextChunk` promoted to a `CodeChunk` with `node_type = "preamble"` and `context = None`. If no preamble nodes are present, no preamble chunk is emitted.

**R6 — Extractable node types per language**
`chunk_code` MUST recognize the following node types as candidates for individual chunks:

- **Rust**: `function_item`, `struct_item`, `enum_item`, `trait_item`, `impl_item`, `type_alias`, `const_item`, `macro_definition`
- **Python**: `function_definition`, `class_definition`, `decorated_definition`
- **TypeScript / TSX**: `function_declaration`, `class_declaration`, `method_definition`, `interface_declaration`, `type_alias_declaration`, `export_statement`
- **Java**: `method_declaration`, `class_declaration`, `interface_declaration`, `enum_declaration`, `constructor_declaration`

**R7 — Container node handling**
Container nodes (`impl_item`, `class_definition`, `class_declaration`, `class_declaration` in Java, etc.) that contain at least one extractable child node MUST have their children extracted as individual chunks. Each child chunk MUST include the container's opening signature (the text up to and including the opening brace, or the equivalent header for the language) as the `context` field. A container that contains no extractable children MUST be emitted as a single chunk with `context = None`.

**R8 — Oversized leaf node fallback**
Any extractable leaf node whose text length exceeds `config.chunk_size` MUST be split using `chunk_text`. Each resulting sub-chunk MUST be promoted to a `CodeChunk` with `node_type` set to the original node's type, `start_line` / `end_line` set to the full node's line range, and `context` set to the node's first source line (the function/method/struct signature line).

**R9 — Zero overlap for code chunks**
`chunk_code` MUST use overlap = 0. AST-aligned chunks are complete syntactic units; overlap would duplicate partial declarations and degrade retrieval precision. The `config.overlap` value is ignored when calling `chunk_code`.

**R10 — Error node fallback**
If the tree-sitter parse tree for a file contains one or more `ERROR` nodes, `chunk_code` MUST fall back silently to `chunk_text(source, config)`, promoting each `TextChunk` to a `CodeChunk` with `node_type = "text"`, `start_line = 0`, `end_line = 0`, `context = None`. No error is surfaced to the caller; the tracing layer MAY emit a `warn`-level log with the filename and error node count.

**R11 — `chunks` table metadata column**
A new migration MUST add a `metadata JSONB NOT NULL DEFAULT '{}'` column to the `chunks` table. The `NewChunk` struct MUST gain a `metadata: serde_json::Value` field. The `Chunk` model MUST gain the same field. `SearchResult` MUST gain a `chunk_metadata: serde_json::Value` field populated from `c.metadata` in `search_chunks`.

**R12 — Chunk metadata population in ingest pipeline**
`IngestPipeline::ingest` MUST map `CodeChunk` fields to `NewChunk.metadata` as:

```json
{
  "start_line": <usize>,
  "end_line": <usize>,
  "node_type": "<string>",
  "context": "<string> | null"
}
```

For text and markdown chunks (where `TextChunk` is used), `NewChunk.metadata` MUST be set to `serde_json::Value::Object(Default::default())` (empty object).

**R13 — Ingest pipeline dispatch**
`IngestPipeline::ingest` MUST be updated to call `detect_language(filename)` first. If a `CodeLanguage` is detected, it calls `chunk_code`. Otherwise it falls through to the existing markdown / plain-text branch. The function signature and public API of `IngestPipeline::ingest` MUST NOT change.

**R14 — Cargo dependencies**
`Cargo.toml` MUST add:

```toml
tree-sitter = "0.23"
tree-sitter-rust = "0.23"
tree-sitter-python = "0.23"
tree-sitter-typescript = "0.23"
tree-sitter-java = "0.23"
```

Exact version pins MUST be verified against crates.io at implementation time; the minor version shown is indicative.

**R15 — `insert_chunks` query update**
The `INSERT INTO chunks` statement in `queries::insert_chunks` MUST include the `metadata` column. The `search_chunks` query MUST select `c.metadata AS chunk_metadata`.

### Success Criteria

- [ ] `cargo test` passes with no regressions on existing text and markdown chunking tests.
- [ ] A Rust source file is chunked such that each top-level item (function, struct, impl block child) produces exactly one `CodeChunk` with correct `start_line`, `end_line`, and `node_type`.
- [ ] An `impl` block with multiple method items produces one `CodeChunk` per method, each with the `impl` signature in the `context` field.
- [ ] A Python file with `import` statements at the top produces a preamble chunk at index 0 containing only those imports.
- [ ] A synthetically malformed file containing `ERROR` nodes falls back to `chunk_text` output without panicking or returning an error.
- [ ] An oversized function (longer than `chunk_size`) is split into sub-chunks, each carrying the function signature as `context`.
- [ ] After migration, `NewChunk` persists `metadata` to PostgreSQL and `SearchResult` returns `chunk_metadata` from the database.
- [ ] `.ts`, `.tsx`, `.py`, `.java`, `.rs` filenames are dispatched to `chunk_code`; all other filenames follow the prior markdown / plain-text path.
- [ ] A file with no code constructs (only preamble, or completely empty after trimming) produces either a single preamble chunk or an empty vec, without panicking.

### Out of Scope

- HTML chunking — existing markdown chunker handles markup-like content; HTML is not added as a `CodeLanguage` variant.
- C, C++, Go, Ruby, or any language beyond the four specified (Rust, Python, TypeScript, Java).
- Incremental re-ingestion or partial file updates — the ingest pipeline always replaces the full source.
- Semantic chunking strategies (e.g. call-graph clustering, docstring extraction) beyond what the AST node boundary provides.
- Token-count-aware chunking (all sizes remain character-based, consistent with the existing `ChunkConfig`).
- Custom node type configuration at runtime — the set of extractable node types per language is hardcoded.
- Exposing `start_line` / `end_line` / `node_type` through the MCP `search` tool response — `SearchResult.chunk_metadata` is stored but surfacing it to MCP callers is a future concern.
- Changes to the embedding model or vector dimensionality.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Add `tree-sitter` and grammar crates to `Cargo.toml`; define `CodeLanguage`, `CodeChunk`, and `detect_language` in `src/chunking/mod.rs`; write unit tests for language detection covering all extensions and the fallback case | 0.5 days |
| Phase 2 | Implement `chunk_code` core: preamble extraction, extractable node iteration, container-children expansion with context prefix, oversized-leaf fallback to `chunk_text`, ERROR-node fallback; unit tests covering each code path for at least Rust and Python | 2 days |
| Phase 3 | Extend `chunk_code` for TypeScript and Java; validate against real-world sample files; confirm node type names match the installed grammar crate versions | 0.5 days |
| Phase 4 | Database migration adding `metadata JSONB NOT NULL DEFAULT '{}'` to `chunks`; update `NewChunk`, `Chunk`, `SearchResult` models; update `insert_chunks` and `search_chunks` queries; integration test confirming round-trip persistence of metadata | 0.5 days |
| Phase 5 | Update `IngestPipeline::ingest` to call `detect_language` and dispatch to `chunk_code`, mapping `CodeChunk` fields to `NewChunk.metadata`; update text/markdown path to supply empty metadata; end-to-end integration test ingesting a `.rs` file and verifying chunk count and metadata in the database | 0.5 days |
