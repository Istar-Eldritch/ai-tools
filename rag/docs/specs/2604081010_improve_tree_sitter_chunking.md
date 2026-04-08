# Improve tree-sitter chunking to merge small adjacent non-extractable nodes and add minimum chunk size threshold

**Status**: Draft
**Created**: 2026-04-08T10:10:22Z
**Timestamp**: 2604081010

---

## PART I: Requirements

### Problem Statement

The current tree-sitter chunking pipeline (`src/chunking/mod.rs`) silently discards non-extractable,
non-container nodes encountered after the preamble — standalone constants, type aliases used as
global configuration, top-level expression statements, and similar constructs that do not match any
`is_extractable_node` or `is_container_node` classification. The same silent-skip occurs inside
container body expansion: non-extractable children of `impl`/`class`/`interface` blocks (e.g.,
associated type declarations, field groups, doc-comment nodes captured as tree-sitter `line_comment`
siblings) are simply omitted from output.

Beyond the silent drop, even nodes that _are_ extracted can be too small to be semantically
meaningful on their own. A one-line `type Alias = SomeType;` or a tiny getter method produces a
chunk so small that embedding quality degrades and retrieval recall suffers.

Two complementary fixes address these gaps:

1. **Forward-merge non-extractable nodes** — accumulate them in a per-level buffer and prepend the
   buffer content to the next extractable chunk. Flush the buffer as a standalone chunk at EOF or
   when the buffer would overflow `chunk_size`.

2. **Minimum chunk size threshold (`min_chunk_size`)** — nodes below the threshold are also
   forward-merged into the next chunk rather than being emitted standalone, regardless of whether
   they are extractable. Buffer is flushed eagerly once accumulated content reaches the threshold
   and the next node begins a new semantic unit, or unconditionally at EOF.

### Requirements

#### R1 — Forward-merge non-extractable nodes (top-level and container bodies)

- **R1.1** After the preamble, any top-level node that is neither extractable nor a container is
  appended to a top-level merge buffer instead of being silently dropped.
- **R1.2** When the next extractable (or container) node is encountered and the buffer is
  non-empty, and `buffer.len() + next_node_text.len() <= chunk_size`, the buffer content is
  prepended to that chunk's `content` field. The buffer is then cleared.
- **R1.3** If `buffer.len() + next_node_text.len() > chunk_size`, the buffer is flushed as a
  standalone chunk before processing the next node. The standalone chunk uses `node_type =
  "non_extractable"`, `context = None`, `start_line`/`end_line` spanning the buffered text.
- **R1.4** At the end of top-level iteration, any non-empty buffer is flushed as a standalone
  chunk (`node_type = "non_extractable"`, `context = None`).
- **R1.5** The same forward-merge logic is applied inside container body expansion. Non-extractable
  children are accumulated in a _separate_ container-level buffer; the buffer is prepended to the
  next extractable child's chunk content, or flushed standalone (with `context = container_sig`)
  at the end of the container body or when it would overflow.
- **R1.6** Metadata fields `node_type`, `start_line`, `end_line` of the merged-into chunk reflect
  the _extractable_ node only. The buffered prefix only affects the `content` field. The `context`
  field is inherited from the extractable node's normal context resolution (i.e., `None` for
  top-level, `container_sig` for container children).

#### R2 — Minimum chunk size (`min_chunk_size`)

- **R2.1** `ChunkConfig` gains a new field `min_chunk_size: usize` with default `50`.
- **R2.2** `ChunkConfig::from_env` reads the `MIN_CHUNK_SIZE` environment variable (same
  parse-or-default pattern as `CHUNK_SIZE`).
- **R2.3** `Config` in `src/config.rs` gains a corresponding `min_chunk_size: usize` field with
  `#[arg(long, env = "MIN_CHUNK_SIZE", default_value = "50")]`. `src/main.rs` passes it through
  when constructing `ChunkConfig`.
- **R2.4** A node whose `content.len() < min_chunk_size` (after optional context prefix) is
  treated identically to a non-extractable node for merging purposes: it is appended to the
  current level's merge buffer instead of being emitted standalone. This applies at both the
  top-level pass and inside container body expansion.
- **R2.5** Flush semantics for the merge buffer:
  - Flush eagerly when `buffer.len() >= min_chunk_size` AND the next node begins a new semantic
    unit (i.e., would produce its own chunk rather than be appended).
  - Flush unconditionally at EOF / end-of-container-body.
  - Never flush a buffer if it would exceed `chunk_size`; in that case emit it as standalone
    before processing the triggering node (same as R1.3).
- **R2.6** Setting `min_chunk_size = 0` disables the threshold (no nodes are merged solely due to
  size). Non-extractable forward-merging (R1) is unaffected by `min_chunk_size`.

#### R3 — Content ordering and structure invariants

- **R3.1** For any emitted chunk the content layout is:
  `[optional container_sig\n] [buffered prefix text\n] [extractable node text]`
- **R3.2** All existing behaviour for preamble chunks, oversized-leaf splitting, error fallback,
  and index re-numbering is unchanged.
- **R3.3** Indices are contiguous from 0 after all merges (existing fix-up loop is sufficient).

### Success Criteria

1. A Rust file containing a top-level `const FOO: &str = "bar";` followed by a `fn process()` now
   produces a single chunk whose content starts with the `const` text and ends with the function.
2. A Java class containing both field declarations and methods emits the field text prepended to
   the first method chunk rather than being silently discarded.
3. Setting `MIN_CHUNK_SIZE=0` reproduces the pre-change output for files that contain only
   extractable and container nodes.
4. The `min_chunk_size` default (50) causes any tiny one-liner nodes to merge forward.
5. Setting `MIN_CHUNK_SIZE` via env var is reflected in `ChunkConfig::from_env` and via `--min-chunk-size` CLI flag.
6. Existing tests continue to pass without modification (or are updated only where the new merge
   behaviour intentionally changes expected chunk counts).

### Out of Scope

- Changing preamble detection or merging preamble nodes with non-extractable nodes.
- Merging across container boundaries (non-extractable top-level nodes are never merged into the
  first method of a container).
- Changing overlap, oversized-leaf splitting, or error-fallback paths.
- Adding `min_chunk_size` filtering to text (`chunk_text`) or Markdown (`chunk_markdown`)
  pipelines.
- Language grammar changes (no new node kinds added to `is_preamble_node`, `is_extractable_node`,
  or `is_container_node`).

### Open Questions

1. **node_type for flushed standalone non-extractable buffers** — `"non_extractable"` is proposed.
   Should it instead use the tree-sitter kind of the first buffered node for better observability?
2. **start_line/end_line of a prepended prefix** — current decision: reflect only the extractable
   node. Should we instead expand the range to cover the buffer's start line as well?
3. **Interaction with oversized-leaf splitting** — if a merged chunk (buffer + extractable) exceeds
   `chunk_size`, does the existing oversized-leaf path split it, or do we need a pre-merge overflow
   guard? The R1.3 overflow guard (flush before merge) avoids most cases but the spec should be
   explicit.
4. **Copy semantics of buffered text** — Rust borrow checker will require cloning node text into
   the buffer since tree-sitter `Node` lifetimes are tied to the `Tree`. Confirm this is acceptable
   (no performance concern for typical file sizes).

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Add `min_chunk_size` to `ChunkConfig`, `Config`, env var wiring, and `src/main.rs` plumbing | 0.5 days |
| Phase 2 | Forward-merge non-extractable nodes at the top-level pass in `chunk_code` | 1 day |
| Phase 3 | Forward-merge non-extractable children inside container body expansion in `process_node` | 1 day |
| Phase 4 | Apply `min_chunk_size` threshold to extractable nodes at both levels (buffer small nodes) | 0.5 days |
| Phase 5 | Unit tests: non-extractable merging, min_chunk_size merging, overflow guard, EOF flush, container body merging | 1 day |
