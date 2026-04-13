# Large PDF Ingestion Support

## Problem

The `ingest` MCP tool requires PDF bytes as a base64-encoded `content` parameter.
A 13 MB PDF inflates to ~18 MB of base64, exceeding practical limits for both
the actix-web HTTP body and large stdio pipe writes.

## Solution

Three complementary changes that eliminate the size ceiling for both transports:

1. **Raise actix-web JSON body limit** to 64 MB (stopgap, one-liner in `main.rs`).
2. **`file_path` parameter** on `IngestParams` — stdio clients reference a local
   file instead of embedding bytes (follows the `ingest_directory` pattern).
3. **`POST /upload` staging endpoint** — accepts raw PDF as `multipart/form-data`,
   stages bytes temporarily, returns an `upload_token` for `ingest`.

### Alternatives considered

| Approach | Verdict |
|----------|---------|
| Chunked MCP tools | Too much client complexity for little benefit |
| S3 pre-signed upload | Couples clients to S3 credentials |
| URL fetch by server | SSRF risk requires careful allowlist validation |
| MCP Resources protocol | Premature without broader ecosystem support |

## Requirements

### Functional

- **R1** — `IngestParams` gains `file_path: Option<String>`. Server reads raw bytes
  from that path, bypassing the base64 `content` path.
- **R2** — `file_path` rejected over HTTP (same as `ingest_directory`).
- **R3** — `POST /upload` accepts `multipart/form-data`, stages bytes, returns
  `{"upload_token": "<uuid>", "expires_in": 300}`.
- **R4** — `IngestParams` gains `upload_token: Option<String>`. HTTP handler resolves
  token to staged bytes before calling `ingest_pdf`.
- **R5** — JSON body limit raised to 64 MB via `web::JsonConfig` + 128 MB payload
  limit for multipart.
- **R6** — `max_pdf_bytes` guard fires regardless of delivery method.
- **R7** — `POST /upload` requires API-key auth (same as `POST /mcp`).
- **R8** — Tokens expire after 300 s. Background sweeper evicts expired entries.
  Tokens are single-use (consumed on first `ingest` call).
- **R9** — `upload_token` rejected over stdio with a clear error message.

### Non-Functional

- **R10** — Multipart streaming rejects oversized files before full buffering.
- **R11** — No changes to `IngestPipeline` internals.
- **R12** — Schema changes are backward-compatible (`Option<…>` fields).

## Design

### `IngestParams` extension (`src/mcp/mod.rs`)

`content` stays as required `String` for backward compatibility. Callers using
`file_path` or `upload_token` pass `""` and it is ignored.

### Byte resolution logic

```
match (file_path, upload_token, content) {
    (Some(path), None, _)    => tokio::fs::read(path)         // stdio
    (None, Some(token), _)   => resolve_upload_token(token)   // HTTP
    (None, None, Some(b64))  => base64_decode(b64)            // legacy
    _                        => error("supply exactly one source")
}
```

### `UploadStore` (`src/http/upload.rs`)

In-memory `DashMap<Uuid, StagedUpload>` with TTL. `take()` removes atomically
(single-use). Sweeper runs every 60 s.

### Token resolution in HTTP handler

`handle_tools_call` detects `upload_token`, resolves it from `AppState.upload_store`,
and calls `ingest_pipeline().ingest_pdf()` directly — bypassing MCP dispatch to
avoid serializing raw bytes through the JSON arguments map. `AuthorizedMcpServer`
exposes `ingest_pipeline() -> &IngestPipeline` for this.

### Data flow

**Stdio — `file_path`:**
```
Client → ingest(file_path="/data/report.pdf", filename=…)
  → McpServer reads file → Vec<u8>
  → IngestPipeline::ingest_pdf(bytes, …)
  → Source record
```

**HTTP — `upload_token`:**
```
Client → POST /upload (multipart, raw PDF)
Server → {"upload_token": "abc…", "expires_in": 300}

Client → POST /mcp tools/call ingest {"upload_token": "abc…", …}
Server → resolves token → bytes → ingest_pdf → Source record
```
