# Remote HTTP Connector with Google OAuth — Technical Specification

**Topic:** Make the RAG MCP server accessible remotely as a Claude connector over HTTP, with Google OAuth authentication and per-user access control  
**Date:** 2026-04-09  
**Revision:** 3

---

## Overview

The RAG MCP server currently runs as a local stdio process. This specification describes how to expose it as an internet-accessible Claude connector over HTTP, enabling any user to add the server as a custom MCP connector in the Claude web/desktop app from anywhere on the internet.

The design adds three layers on top of the existing server:

1. **HTTP transport** — Implements the MCP Streamable HTTP transport protocol via Actix Web, replacing (or complementing) the existing stdio transport.
2. **Authentication** — The server implements an OAuth 2.1 Authorization Server that delegates identity to Google. Claude authenticates users through the standard MCP OAuth discovery flow; long-lived API keys are issued as access tokens.
3. **Per-user access control** — A single server instance enforces row-level access so each user sees only their own projects and sources.

The existing MCP tools (`ingest`, `search`, `delete_source`, `ingest_directory`, `list_sources`), pipelines, and database schema are preserved. Access control is layered on top via middleware that injects a user identity into every tool call.

Both the existing `stdio` subcommand (for Claude Code / local use) and the new `serve-http` subcommand are kept; the same binary serves both modes.

---

## Requirements

### Functional

| ID | Requirement |
|----|-------------|
| F-1 | Claude and other MCP clients can connect to the server over HTTPS using the MCP Streamable HTTP transport. |
| F-2 | The server implements OAuth 2.1 Authorization Server endpoints so Claude authenticates users via Google through the standard MCP OAuth flow. |
| F-3 | Users manage API keys via CLI subcommands or MCP admin tools. |
| F-4 | Claude connector authentication uses a Bearer API key issued as the OAuth access token (stored once by Claude after the OAuth flow completes). |
| F-5 | Each user can only read and write sources in projects they have been granted access to, or sources they personally own. |
| F-6 | A user whose API key has been revoked receives `401 Unauthorized` immediately. |
| F-7 | An admin user can create projects and grant other users access to them. |
| F-8 | All existing MCP tools continue to work with per-user data scoping applied transparently. |
| F-9 | The `project` field already present on sources maps directly to the project-based ACL; a user can only operate on sources whose `project` is in their granted project list. |
| F-10 | The existing stdio transport continues to work unchanged for local use. |
| F-11 | `ingest_directory` is disabled for remote HTTP sessions (it references local filesystem paths that don't apply to remote callers); calling it returns a clear `UNSUPPORTED` error message. |
| F-12 | Admin capabilities (create projects, grant/revoke access) are exposed as MCP tools available through Claude, in addition to CLI subcommands for bootstrapping. |

### Non-functional

| ID | Requirement |
|----|-------------|
| NF-1 | A single server process serves all users concurrently (no per-user forks). |
| NF-2 | API key validation must be fast; keys are hashed and cached in-memory with a configurable TTL. |
| NF-3 | HTTPS is terminated at a reverse proxy (nginx/Caddy); the application binds to plain HTTP internally. |
| NF-4 | All new database tables follow the existing migration pattern (timestamped SQL files under `migrations/`). |
| NF-5 | Idle MCP sessions are evicted after a configurable timeout to bound memory use. |

---

## Architecture & Design

### System Topology

```
Internet
  │
  ▼
[Reverse proxy — TLS termination]
  │  HTTPS :443
  ▼
[rag-mcp process — Actix Web]
  ├── GET  /.well-known/oauth-authorization-server  ← OAuth 2.1 discovery metadata
  ├── GET  /auth/google                             ← OAuth 2.1 authorization endpoint
  ├── GET  /auth/callback                           ← Google OAuth callback
  ├── POST /oauth/token                             ← OAuth 2.1 token endpoint
  ├── POST /mcp                                     ← MCP Streamable HTTP (JSON-RPC)
  ├── GET  /mcp                                     ← SSE stream for server notifications
  └── DELETE /mcp                                   ← Terminate session
  │
  ├── PostgreSQL (existing + new auth tables)
  └── S3-compatible storage (unchanged)
```

### MCP Streamable HTTP Transport

The MCP Streamable HTTP transport uses:

- **`POST /mcp`** — Client sends a JSON-RPC request or notification. Server responds with:
  - `Content-Type: application/json` for a single response message.
  - `Content-Type: text/event-stream` for a streaming response (used when the server needs to send intermediate progress notifications before the final result, e.g. for `ingest`).
- **`GET /mcp`** — Client opens a long-lived SSE stream to receive server-initiated notifications (optional for tool-call-only usage, but needed for progress on long-running tools).
- **`DELETE /mcp`** — Client terminates the session.
- **`Mcp-Session-Id`** header — Identifies stateful sessions. Generated by the server on the first `POST /mcp` (initialize) and returned in the response; included by the client in subsequent requests.

Actix Web is chosen because:
- The project already uses async Tokio (which Actix Web requires).
- Actix Web gives full control over request lifecycle, enabling middleware for authentication and request-scoped user context.
- The `rmcp` crate's HTTP transport support is not yet stable enough to rely on.

#### Session State

Each session maps a `Mcp-Session-Id` (random UUID) to:
- The authenticated user ID and their cached project list.
- An `AuthorizedMcpServer` instance (a thin wrapper around the shared `McpServer`).

Sessions live in a `DashMap<Uuid, Arc<SessionState>>` in-process. A background Tokio task sweeps the map every minute and removes entries idle for longer than `MCP_SESSION_IDLE_SECS` (default: 1800 s).

Because `McpServer` is `Clone` and all its dependencies (pool, pipelines) are `Arc`-wrapped, creating a per-session wrapper is cheap.

#### rmcp Bridge Approach

The `rmcp` crate exposes a `ToolRouter` and a `ServerHandler` trait but does not have a stable `handle_message(raw_json) → raw_json` entry point suitable for HTTP bridging. The bridge therefore **bypasses `rmcp`'s transport layer entirely** and calls tool implementations directly:

```
POST /mcp JSON-RPC message
  ↓
mcp_handler: parse JSON-RPC (method, params, id)
  ↓
match method:
  "initialize"           → return ServerInfo struct (hardcoded capabilities)
  "tools/list"           → return tool list from AuthorizedMcpServer::tool_list()
  "tools/call"           → AuthorizedMcpServer::call_tool(name, params, &UserContext)
                              → returns ToolResult (or error)
  notifications/ping     → return empty pong
  "session/close"        → drop session
  unknown                → return JSON-RPC MethodNotFound error
```

`AuthorizedMcpServer::call_tool` wraps the existing `McpServer` tool logic with ACL checks and returns a `serde_json::Value` that the HTTP handler serializes back into a JSON-RPC response envelope.

For tools that emit progress notifications (`ingest`), `call_tool` accepts an `mpsc::Sender<ProgressNotification>`. The HTTP handler, when it detects a streaming response is needed, upgrades the response to `text/event-stream` and polls the channel until the channel closes.

### Authentication

#### OAuth 2.1 Authorization Server Flow

The server acts as a full OAuth 2.1 Authorization Server (AS), using Google as the identity provider (IdP). Claude discovers and drives the OAuth flow automatically via the standard MCP OAuth mechanism.

**Discovery endpoint:**

`GET /.well-known/oauth-authorization-server` returns JSON metadata:

```json
{
  "issuer": "https://rag.example.com",
  "authorization_endpoint": "https://rag.example.com/auth/google",
  "token_endpoint": "https://rag.example.com/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"]
}
```

**Authorization Code + PKCE flow:**

```
Claude (MCP client)
  1. Discovers OAuth metadata via /.well-known/oauth-authorization-server
  2. Opens system browser to:
       GET /auth/google
         ?redirect_uri=<claude_redirect>
         &state=<random_csrf_token>
         &code_challenge=<S256_hash_of_verifier>
         &code_challenge_method=S256
     Server stores (state → {redirect_uri, code_challenge}) in an in-memory
     DashMap with a 10-minute expiry (no session cookie required).
     Server 302-redirects browser to Google OAuth:
       accounts.google.com/o/oauth2/auth
         ?client_id=...&redirect_uri=https://host/auth/callback
         &scope=email+profile&state=<same_state_token>
         &response_type=code

  3. User authenticates at Google.

  4. Google → GET /auth/callback?code=<google_code>&state=<state_token>
     Server:
       - Looks up state token; retrieves redirect_uri + code_challenge.
       - Exchanges google_code for access token (oauth2 crate).
       - Fetches email, display_name, google_sub from Google userinfo endpoint.
       - Upserts user record in `users` table (keyed on google_sub).
       - Generates a short-lived server authorization code (random UUID, 5-min TTL).
       - Stores (server_auth_code → {user_id, code_challenge}) in memory.
       - Redirects browser to: <claude_redirect>?code=<server_auth_code>&state=<state>
       - Returns body: "Authorization complete, you may close this tab."

  5. Claude → POST /oauth/token
       grant_type=authorization_code
       &code=<server_auth_code>
       &code_verifier=<original_pkce_verifier>
       &redirect_uri=<claude_redirect>
     Server:
       - Looks up auth code; verifies SHA-256(code_verifier) == code_challenge.
       - Generates a new API key: rag_<base62(32 random bytes)>.
       - Stores SHA-256(key) in api_keys table for the user.
       - Returns JSON:
         {"access_token": "rag_<key>", "token_type": "bearer"}
       - Deletes the server auth code (single use).

  6. Claude stores the access token and includes it as:
       Authorization: Bearer rag_<key>
     on all subsequent MCP requests.
```

Crates:
- `oauth2` (standard Rust OAuth2 client library) for Google token exchange and PKCE helpers.
- `reqwest` for the userinfo fetch.

#### API Key Authentication (for Claude)

```
Claude → POST /mcp
  Authorization: Bearer rag_<base62-random-32-bytes>

Server ApiKeyAuth middleware:
  1. Parse Bearer token from Authorization header.
  2. Hash with SHA-256.
  3. Look up hash in `api_keys` table → get user_id (only if revoked_at IS NULL).
  4. Cache result in Arc<Mutex<LruCache<[u8;32], UserRecord>>> (TTL: 60 s).
  5. Update last_used_at asynchronously (fire-and-forget).
  6. Attach UserContext to request extensions.
```

The API key format is `rag_` followed by 32 bytes of `rand::random` encoded in base62 (~190 bits entropy, 47-char total). Only the SHA-256 hash is stored in the database; the plaintext is returned exactly once via the OAuth token endpoint.

### Per-User Access Control

#### Default Isolation Policy

**Users see only their own data by default.** A source is visible to a user if:
- `owner_user_id = current_user`, OR
- The source's `project` is a project they have been granted access to (any role).

This means a freshly signed-up user with no project grants has a private namespace. Sharing is explicit (admin grants access to a project).

#### Project-Based ACL

The existing `project` column on `sources` is the core of access control.

Data model additions (see Database Schema section):
- `users(id, google_sub, email, display_name, is_admin, created_at)`
- `api_keys(id, user_id, key_hash, label, created_at, last_used_at, revoked_at)`
- `projects(id, name, description, created_at)`
- `user_project_access(user_id, project_id, role)` — role ∈ `{reader, writer, admin}`
- `sources` gains `owner_user_id UUID REFERENCES users(id)`.

#### Access Enforcement

Tool-call access control is enforced in `AuthorizedMcpServer`:

| Tool | Check | Action on violation |
|------|-------|---------------------|
| `ingest` | Requested `project` must be in user's writable projects | Return MCP error `PERMISSION_DENIED` |
| `ingest_directory` | Always rejected for HTTP sessions | Return MCP error `UNSUPPORTED` |
| `search` | Silently scope results via ACL WHERE clause | No error; filtered result |
| `list_sources` | Silently scope results via ACL WHERE clause | No error; filtered result |
| `delete_source` | Source must be owned by user or in user's writable project | Return MCP error `PERMISSION_DENIED` |
| Admin MCP tools | Caller must have `is_admin = true` | Return MCP error `PERMISSION_DENIED` |

Sources ingested via HTTP always have `owner_user_id` set to the current user.

#### Admin Capabilities

Users with `is_admin = true` bypass all ACL checks on data tools and can invoke admin MCP tools. The first user to complete the OAuth flow whose email matches `FIRST_ADMIN_EMAIL` (env var) is auto-promoted. An admin can also be promoted via the CLI fallback:

```
rag-mcp admin promote <email>
```

### MCP Admin Tools

Admin capabilities are exposed as MCP tools within `AuthorizedMcpServer`, callable through Claude. This is the primary management interface for a remote deployment. CLI subcommands remain available as a bootstrapping fallback (before any admin user exists).

#### Tool Visibility by Role

| Tool | Non-admin user | Admin user |
|------|---------------|------------|
| `project_list` | ✓ (own projects only) | ✓ (all projects) |
| `api_key_rotate` | ✓ | ✓ |
| `project_create` | ✗ | ✓ |
| `access_grant` | ✗ | ✓ |
| `access_revoke` | ✗ | ✓ |

`AuthorizedMcpServer::tool_list()` filters the tool list based on the caller's `UserContext.is_admin` flag, so non-admin users never see admin-only tools.

#### Tool Definitions

**`project_list()`**  
Lists projects accessible to the current user. For admins, returns all projects in the database with member counts. For regular users, returns only projects they have been granted access to.

Returns: array of `{ id, name, description, role, created_at }` (role omitted for admins viewing all).

---

**`api_key_rotate()`**  
Revokes the caller's current API key and issues a new one. The new key is returned in the tool result **exactly once** — the caller must copy it immediately. Subsequent MCP calls must use the new key.

Returns: `{ new_key: "rag_..." }` — plaintext, shown once.

Side effect: sets `revoked_at = now()` on the old key; inserts a new `api_keys` row.

---

**`project_create(name: string, description: string)`** *(admin only)*  
Creates a new project. Fails if the name already exists.

Returns: `{ id, name, description, created_at }`.

---

**`access_grant(email: string, project: string, role: string)`** *(admin only)*  
Grants the user identified by `email` access to `project` (by name) at the specified `role` (`reader`, `writer`, or `admin`). Upserts — if the user already has access, updates the role.

Fails with a descriptive error if the email or project does not exist.

Returns: `{ user_email, project, role, granted_at }`.

---

**`access_revoke(email: string, project: string)`** *(admin only)*  
Removes the user's access to the project. The user's owned sources within the project are unaffected (ownership is separate from project ACL).

Fails if the grant does not exist.

Returns: `{ user_email, project, revoked: true }`.

#### Implementation Notes for Admin Tools

Admin tools are implemented as additional match arms in `AuthorizedMcpServer::call_tool`. They share the same JSON-RPC dispatch path as the RAG tools. The `UserContext` carries `is_admin: bool`, checked at the top of each admin arm; a non-admin caller receives `-32000 PERMISSION_DENIED` without the tool doing any database work.

Because `api_key_rotate` changes the caller's own API key, the tool returns the new plaintext key in the MCP tool result. The current MCP session continues to work until the next request (the old key's LRU cache entry is invalidated immediately by the tool by clearing the cache entry). The caller must reconnect with the new key for subsequent sessions.

### Configuration

New environment variables added to `Config`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | — | OAuth2 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | — | OAuth2 client secret |
| `OAUTH_REDIRECT_URI` | — | Full callback URL, e.g. `https://rag.example.com/auth/callback` |
| `HTTP_BIND` | `0.0.0.0:8080` | Address to bind |
| `API_KEY_CACHE_TTL_SECS` | `60` | LRU cache TTL for API key lookups |
| `MCP_SESSION_IDLE_SECS` | `1800` | Idle session eviction timeout |
| `FIRST_ADMIN_EMAIL` | — | Email auto-promoted to admin on first OAuth login |

---

## Database Schema

### New Tables

```sql
-- Migration: 20260409000001_add_users.sql

CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    google_sub      TEXT        UNIQUE NOT NULL,
    email           TEXT        UNIQUE NOT NULL,
    display_name    TEXT        NOT NULL,
    is_admin        BOOLEAN     NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration: 20260409000002_add_api_keys.sql

CREATE TABLE api_keys (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash        TEXT        UNIQUE NOT NULL,   -- SHA-256 hex of the raw key
    label           TEXT        NOT NULL DEFAULT 'default',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ                    -- NULL = active
);
CREATE INDEX idx_api_keys_user_id ON api_keys (user_id);
-- Partial index for fast active-key lookups
CREATE INDEX idx_api_keys_hash_active ON api_keys (key_hash) WHERE revoked_at IS NULL;

-- Migration: 20260409000003_add_projects.sql

CREATE TABLE projects (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        UNIQUE NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_project_access (
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL CHECK (role IN ('reader', 'writer', 'admin')),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);
CREATE INDEX idx_upa_user_id ON user_project_access (user_id);

-- Migration: 20260409000004_add_source_owner.sql

ALTER TABLE sources ADD COLUMN owner_user_id UUID REFERENCES users(id);
CREATE INDEX idx_sources_owner ON sources (owner_user_id);
```

### ACL Query Pattern

For filtered queries (search, list_sources), the SQL WHERE clause gains:

```sql
-- User can see a source if:
-- (a) they own it (owner_user_id = $user_id), OR
-- (b) the source's project is in their accessible projects
WHERE (
    s.owner_user_id = $user_id
    OR s.project IN (
        SELECT p.name FROM projects p
        JOIN user_project_access upa ON upa.project_id = p.id
        WHERE upa.user_id = $user_id
    )
)
```

Admins skip this clause entirely. The user's project list is fetched once per session on `initialize` and cached in `SessionState`; it is not re-fetched per-tool-call. If access is revoked, it takes effect on the next session (or on the next LRU cache miss for API key validation).

---

## Implementation Notes

### New Cargo Dependencies

```toml
actix-web        = { version = "4", features = ["rustls"] }
oauth2           = "4"
reqwest          = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
rand             = "0.8"
sha2             = "0.10"          # likely already present
lru              = "0.12"
dashmap          = "6"
```

Base62 encoding for the key body is implemented inline (~20 lines) to avoid a niche dependency.

`rmcp` stays as-is; the HTTP layer calls tool logic directly and does not use `rmcp`'s transport.

### Module Structure

```
src/
  main.rs                  # adds Commands::ServeHttp(HttpConfig) subcommand
  http/
    mod.rs                 # Actix App factory, AppState (shared)
    mcp_handler.rs         # POST/GET/DELETE /mcp — JSON-RPC bridge
    auth_handler.rs        # GET /auth/google, GET /auth/callback,
                           # GET /.well-known/oauth-authorization-server,
                           # POST /oauth/token
    middleware.rs          # ApiKeyAuth extractor / middleware
    session.rs             # DashMap<Uuid, Arc<SessionState>>, eviction task
    oauth_state.rs         # In-memory stores: pending_auth (state→params) +
                           #   pending_codes (auth_code→user_id+challenge)
  auth/
    google.rs              # OAuth2 client wrapper (build_client, exchange_code, fetch_userinfo)
    api_key.rs             # generate_key(), hash_key(), LruCache wrapper
  acl/
    context.rs             # UserContext { user_id, project_names: Vec<String>, is_admin }
    authorized_server.rs   # AuthorizedMcpServer: call_tool + tool_list with ACL
                           #   includes admin MCP tools dispatch
  db/
    queries.rs             # extend with user/key/project queries + admin tool queries
    models.rs              # extend with User, ApiKey, Project, UserProjectAccess
```

### JSON-RPC Request/Response Envelope

The bridge handles a minimal subset of JSON-RPC 2.0:

```rust
#[derive(Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,           // must be "2.0"
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,     // "2.0"
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}
```

Standard error codes used: `-32700` (parse error), `-32601` (method not found), `-32602` (invalid params), `-32000` (application error — ACL denial, unsupported tool, etc.).

### Streaming Tool Responses (SSE)

When a tool call may emit progress, `AuthorizedMcpServer::call_tool` takes an optional `ProgressSink`:

```rust
pub async fn call_tool(
    &self,
    name: &str,
    params: serde_json::Value,
    ctx: &UserContext,
    progress: Option<mpsc::Sender<serde_json::Value>>,
) -> Result<serde_json::Value, McpError>
```

`mcp_handler.rs` inspects whether the tool is known to be long-running (currently only `ingest`) and if so, sets `Content-Type: text/event-stream` on the response and streams SSE frames from the channel until the channel closes, then emits the final `result` frame.

Non-streaming tools return `application/json` directly.

### Claude Connector Registration

Claude discovers and drives the OAuth flow automatically — no manual key pasting required.

1. Open Claude → Settings → Connectors → Add custom connector.
2. Enter the server URL: `https://rag.example.com/mcp`
3. Claude fetches `https://rag.example.com/.well-known/oauth-authorization-server` and discovers the authorization and token endpoints.
4. Claude opens a browser window directing the user through the Google sign-in flow on the server's `/auth/google` endpoint.
5. After Google authentication, the server issues an access token via `/oauth/token` and Claude stores it automatically.
6. Claude includes `Authorization: Bearer rag_<key>` on every MCP request from this point forward.

No portal visit, no copy-pasting of keys — the connector setup is entirely driven by the standard OAuth 2.1 + PKCE flow.

### Error Handling

| Scenario | HTTP status | JSON-RPC error |
|----------|-------------|----------------|
| Missing / malformed Authorization header | 401 | — (returned before JSON-RPC parse) |
| Revoked or unknown API key | 401 | — |
| Missing `Mcp-Session-Id` on non-initialize call | 400 | -32602 Invalid params |
| Unknown session ID | 404 | — |
| ACL denial | 200 | -32000 PERMISSION_DENIED |
| Non-admin calling admin tool | 200 | -32000 PERMISSION_DENIED |
| `ingest_directory` via HTTP | 200 | -32000 UNSUPPORTED |
| Internal server error | 500 | -32000 Internal error |
| OAuth state not found / expired | 400 | — (OAuth error response) |
| PKCE verification failure | 400 | — (OAuth error response) |

### Security Considerations

- **HTTPS only**: The reverse proxy must enforce HTTPS; plain HTTP is redirected.
- **Key rotation**: Old keys have `revoked_at` set (soft delete) and are rejected immediately; the LRU cache entry is explicitly invalidated by the `api_key_rotate` tool, ensuring no grace period.
- **CSRF**: The OAuth `state` parameter provides CSRF protection; stored server-side in a `DashMap` with a 10-minute TTL (no browser cookies required).
- **PKCE**: Authorization Code + PKCE (S256) is required, preventing authorization code interception attacks.
- **Rate limiting**: `/auth/callback` and `/oauth/token` should be rate-limited (actix-governor or nginx `limit_req`).
- **API key exposure**: Plaintext key returned only once (in the OAuth token response). Subsequent `api_key_rotate` calls via MCP return the new key in the tool result exactly once per call.
- **Session isolation**: Each MCP session holds its own `UserContext`; there is no shared mutable state between sessions.
- **Admin bootstrap**: Auto-promotion via `FIRST_ADMIN_EMAIL`; fallback CLI `admin promote` for manual bootstrapping.
- **Short-lived OAuth state**: Pending auth states and authorization codes live in memory with strict TTLs (10 min and 5 min respectively) and are single-use; a background sweep clears expired entries.

### Deployment

The Docker Compose file gains a new service:

```yaml
rag-mcp-http:
  build: .
  command: serve-http
  environment:
    DATABASE_URL: postgres://rag:rag@postgres:5432/rag
    S3_ENDPOINT: http://minio:9000
    S3_BUCKET: rag-documents
    S3_ACCESS_KEY: minioadmin
    S3_SECRET_KEY: minioadmin
    GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
    GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
    OAUTH_REDIRECT_URI: ${OAUTH_REDIRECT_URI}
    HTTP_BIND: 0.0.0.0:8080
    FIRST_ADMIN_EMAIL: ${FIRST_ADMIN_EMAIL}
  ports:
    - "8080:8080"
  depends_on:
    postgres:
      condition: service_healthy
```

A Caddy `Caddyfile` snippet (placed alongside `docker-compose.yml`) handles TLS and reverse-proxies to port 8080:

```caddy
rag.example.com {
    reverse_proxy rag-mcp-http:8080
}
```

---

## Testing Strategy

### Unit Tests

- `api_key.rs`: key generation format, hash round-trip, LRU cache hit/miss/eviction.
- `acl/authorized_server.rs`: ACL filtering logic with mock `UserContext` (owned sources, project-scoped sources, admin bypass, admin-tool permission gate).
- JSON-RPC envelope serialization / error codes.
- `oauth_state.rs`: state insertion, retrieval, expiry sweep, single-use code consumption.
- Admin tool parameter validation (bad role, non-existent email/project).

### Integration Tests

- Full OAuth 2.1 PKCE flow using a mock Google server (wiremock): discovery → authorize → callback → token exchange.
- `POST /mcp` initialize → tools/list → tools/call cycle using `reqwest` test client.
- `api_key_rotate` via MCP tool: old key returns 401 immediately after rotation; new key returns 200.
- ACL integration: user A cannot search user B's sources; shared project is visible to both.
- Session eviction: manually expire a session, verify 404 on next call.
- Admin MCP tools via Claude (integration): admin creates project, grants user B access, user B can now search it.
- Non-admin attempting admin tools: verify PERMISSION_DENIED error in tool result.

### Manual Testing Checklist

- [ ] Add connector in Claude web UI via OAuth discovery; verify tools appear.
- [ ] Ingest a document via MCP; verify it appears in search.
- [ ] Rotate API key via `api_key_rotate` MCP tool; verify old key rejected immediately and new key works.
- [ ] Admin calls `project_create` and `access_grant` via Claude; verify user B can search the project.
- [ ] Non-admin user calls `project_create`; verify PERMISSION_DENIED error.
- [ ] Call `ingest_directory` via HTTP; verify UNSUPPORTED error.
- [ ] Bootstrap first admin via `FIRST_ADMIN_EMAIL` auto-promotion; verify admin tools visible.

---

## Open Questions

| # | Question | Status | Decision / Notes |
|---|----------|--------|-----------------|
| 1 | Does `rmcp` expose a `handle_message` API suitable for bridging? | **Resolved** | No stable entry point. Bridge bypasses `rmcp` transport and calls tool logic directly via `AuthorizedMcpServer::call_tool`. |
| 2 | Should `ingest_directory` be available to remote clients? | **Resolved** | Disabled for HTTP sessions (returns UNSUPPORTED). A future `ingest_upload` tool accepting a zip payload can replace it. |
| 3 | Default isolation: private or shared? | **Resolved** | Private by default; sharing is explicit via admin grant. |
| 4 | Primary management interface for remote deployment? | **Resolved** | MCP admin tools (`project_create`, `project_list`, `access_grant`, `access_revoke`, `api_key_rotate`) are the primary interface. CLI subcommands remain for bootstrapping only (before any admin exists). No management portal. |
| 5 | Deployment environment? | **Open** | Spec includes Docker Compose + Caddy. Adjust if target is a managed platform (Fly.io, Railway, etc.). |
| 6 | Keep stdio subcommand? | **Resolved** | Yes — both `stdio` (for Claude Code) and `serve-http` are retained in the same binary. |
| 7 | Multi-key support per user? | **Deferred to v2** | v1 is single-key-per-user (rotate replaces the one active key). Schema supports multiple keys; management tools can be extended. |
| 8 | Should the OAuth token endpoint issue short-lived JWTs instead of long-lived API keys? | **Deferred to v2** | v1 issues long-lived API keys for simplicity. v2 could issue short-lived JWTs with refresh tokens if key rotation becomes a UX burden. |
