**Goal:** Make the RAG MCP server accessible remotely so it can be used as a Claude connector from anywhere on the Internet.

**Plan:**
1. **HTTP wrapper** — Wrap the existing stdio-based MCP server in an Actix web HTTP layer so it can receive requests over the Internet.
2. **Custom Claude connector** — Register the server as a custom connector in Claude's platform, which supports remote MCP servers over HTTP.
3. **Authentication** — Use Google OAuth for users logging in to your website, which generates per-user tokens/API keys.
4. **Access control** — Rather than running separate MCP server instances, keep a single server but use the per-user credentials to enforce access control at the request level, supporting things like personal projects vs. company projects.
5. **API keys for Claude** — Per-user long-lived API keys seem like the right fit for how Claude's connector authentication works, since they're easy to store in connector settings and give you granular control on the backend.

