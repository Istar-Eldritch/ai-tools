# MCP spec pipeline server

**Status**: Draft
**Created**: 2026-04-08T18:21:32Z
**Timestamp**: 2604081821

---

## PART I: Requirements

### Problem Statement

The current spec pipeline is a TypeScript/Python engine that drives multi-phase document generation
workflows (brainstorm → epic → spec). It is tightly coupled to subprocess invocations, has no
structured output contract between orchestrator and Claude, and lacks the composability needed to
support richer agent-driven workflows. Each phase transition is implicit; human checkpoints are
ad-hoc; cost tracking is absent; and there is no stable API surface for external callers.

The solution is a standalone Rust MCP server that exposes spec pipeline stages as MCP tools,
enabling Claude CLI agents (and human clients via Claude Code) to participate in a well-typed,
gate-driven workflow with explicit human checkpoints. The server is a sibling to the existing
RAG MCP server — it delegates document retrieval to RAG but owns all workflow state.

### Requirements

**R1 — MCP tool surface**

The server exposes exactly five tools:

| Tool | Purpose |
|------|---------|
| `spec_start` | Create a new workflow instance. |
| `spec_status` | Poll current state of a session. |
| `spec_respond` | Submit a typed gate response to unblock a waiting gate. |
| `spec_cancel` | Abort a session. |
| `spec_list` | List active and recently completed sessions. |

Tool schemas and parameter contracts are defined in section 1.4 below.

**R2 — Workflow types**

Three workflow types are supported at launch:

| Workflow | Description |
|----------|-------------|
| `brainstorm` | Open-ended exploration; synthesises into a structured document. |
| `spec` | Formal technical spec drafting grounded in prior artifacts. |
| `epic` | Child extraction from a brainstorm output; produces scoped work items. |

Each workflow is a typed Rust enum with variants per phase. Phases execute sequentially; parallel
phase execution is out of scope. Independent sessions are linked by file reference via
`context_refs` — there is no implicit session inheritance.

**R3 — Hybrid async + gate model**

The server autonomously drives phase execution between gates. A *gate* is an explicit checkpoint
where human approval is required to proceed. The execution model is:

1. `spec_start` creates a session and immediately begins autonomous phase execution in a
   background Tokio task.
2. The phase runner invokes `claude -p` as a subprocess per phase, passing context via stdin and
   a system prompt file.
3. When Claude returns a `gate` output, the phase runner suspends and marks the session as
   `WaitingAtGate`. The gate content (question or artifact path) is surfaced via `spec_status`.
4. The caller submits a response via `spec_respond` with a typed `GateResponse`. The phase runner
   resumes and processes the response.
5. When Claude returns `done`, the workflow advances to the next phase or moves to `Complete`.

**R3a — Error gates**

When a `claude -p` subprocess fails (non-zero exit, timeout, or unparseable output), the workflow
is paused and transitions to `ErrorGate` state. The caller must explicitly resume (via
`spec_respond` with `response_type: "retry"`) or abort (via `spec_cancel`). There is no automatic
retry.

**R4 — Typed gate responses**

Gate responses submitted via `spec_respond` are typed to enable correct server-side routing:

```
GateResponse =
  | { type: "answer",   content: string }          // answer a discovery question
  | { type: "feedback", content: string }           // request revision with notes
  | { type: "approve",  artifact_path?: string }    // accept output, advance
  | { type: "retry" }                               // retry after an error gate
```

- `answer` — unblocks a `WaitingAtGate` state from a discovery question; content is injected
  into the next phase invocation context.
- `feedback` — re-enters the current phase with revision notes appended; increments the revision
  counter. A configurable `feedback_depth_limit` (default: 5) prevents unbounded revision loops.
  When the limit is reached, the gate transitions to `FeedbackLimitReached` and the caller must
  `approve` or `cancel`.
- `approve` — accepts the current output and advances to the next phase. If the current phase is
  the final phase, the workflow moves to `Complete`.
- `retry` — valid only in `ErrorGate` state; re-runs the failed phase invocation.

**R5 — Discriminated union output from Claude**

Every `claude -p` invocation is constrained by `--json-schema` to return a validated discriminated
union:

```
PhaseOutput =
  | { type: "continue" }
  | { type: "gate",    question: string, artifact_path?: string }
  | { type: "done",    artifact_path: string, summary: string }
```

The phase runner loops `continue` responses autonomously. A `gate` response surfaces a checkpoint.
A `done` response finalises the phase and advances the state machine.

**R6 — Session persistence**

Workflow state is persisted as JSON files in a designated local directory
(`$SPEC_PIPELINE_STATE_DIR`, default: `~/.local/state/spec-pipeline/sessions/`). Each session is
a single file named `{session_id}.json`. Writes are atomic (write to a `.tmp` file, then rename).
Persisted state enables crash recovery: on startup, the server loads all session files and
restores in-memory state. Sessions in `WaitingAtGate` or `ErrorGate` state are immediately
resumable. Sessions that were `Running` at the time of crash are transitioned to `ErrorGate` with
a crash-recovery error message.

**R7 — Claude CLI integration**

Each phase invocation uses the following `claude -p` command pattern:

```sh
claude -p \
  --bare \
  --no-session-persistence \
  --output-format json \
  --json-schema /path/to/phase_output_schema.json \
  --mcp-config /path/to/rag_mcp.json \
  --strict-mcp-config \
  --model {model_alias} \
  --system-prompt-file /path/to/phase_system_prompt.txt \
  < phase_context.json
```

Key flags:
- `--bare`: skips hooks, LSP, CLAUDE.md loading — minimal overhead for server context.
- `--no-session-persistence`: Claude is stateless; the server owns all state.
- `--output-format json`: machine-readable envelope with `total_cost_usd`, `stop_reason`,
  `num_turns`.
- `--json-schema`: enforces discriminated union response; prevents free-form text bleed.
- `--mcp-config` + `--strict-mcp-config`: grants isolated RAG access; no other tools.
- `--system-prompt-file`: avoids shell escaping hazards for multi-line prompts.
- stdin: phase context (topic, prior artifacts, gate history, RAG results) as JSON.

Two context injection strategies are used based on phase role:
- **Lightweight roles** (summariser, reviewer): RAG results injected directly as text into the
  prompt. No MCP access needed; lower latency.
- **Heavyweight roles** (discovery agent, spec drafter): RAG MCP access granted so Claude can
  query iteratively.

**R8 — Cost tracking**

The JSON output envelope from `claude -p` exposes `total_cost_usd` per invocation. The server
accumulates per-session cost and surfaces it in `spec_status` responses and gate checkpoint
messages. Cost is persisted in the session JSON file.

**R9 — Startup validation**

At server startup, before accepting MCP connections:
1. Verify that `claude` is on `PATH` by running `claude --version`.
2. Verify that Claude credentials are valid by running a minimal `claude -p` probe call.

If either check fails, the server exits immediately with a clear error message written to stderr.

**R10 — Model routing**

The server applies per-phase default model aliases with caller override at `spec_start` time:

| Phase role | Default model |
|------------|---------------|
| Discovery (heavyweight) | `sonnet` |
| Synthesis / drafting | `sonnet` |
| Review / approval summary | `haiku` |

The caller may override the default for the entire session by passing `model` in `spec_start`.
Per-phase overrides are not supported in MVP.

**R11 — Logging**

All log output is routed to stderr and to a rolling daily log file at
`$SPEC_PIPELINE_LOG_DIR` (default: `~/.local/state/spec-pipeline/logs/`). stdout is reserved for
MCP JSON-RPC framing. Log format matches the RAG MCP server (`tracing`, no ANSI, file + stderr
dual output).

### 1.4 Tool Parameter Contracts

**`spec_start`**

```
Params:
  workflow_type: "brainstorm" | "epic" | "spec"   (required)
  topic:         string                            (required)
  context_refs:  string[]                          (optional, paths to prior artifacts)
  model:         string                            (optional, overrides per-phase defaults)

Returns:
  { session_id: string, status: "running" }
```

**`spec_status`**

```
Params:
  session_id: string   (required)

Returns:
  {
    session_id:    string,
    workflow_type: string,
    topic:         string,
    phase:         string,
    sub_phase:     string | null,
    state:         "Running" | "WaitingAtGate" | "ErrorGate" | "Complete" | "Cancelled",
    gate_content:  { question: string, artifact_path?: string } | null,
    artifacts:     string[],
    total_cost_usd: number,
    created_at:    string (ISO 8601),
    updated_at:    string (ISO 8601),
  }
```

**`spec_respond`**

```
Params:
  session_id:    string                                          (required)
  response_type: "answer" | "feedback" | "approve" | "retry"   (required)
  content:       string                                         (required for answer/feedback)

Returns:
  { session_id: string, status: string }
```

Returns `invalid_params` error if the session is not in a gate state or if `response_type` is
incompatible with the current gate kind (e.g., `retry` when not in `ErrorGate`).

**`spec_cancel`**

```
Params:
  session_id: string   (required)

Returns:
  { session_id: string, status: "cancelled" }
```

If the session has an in-flight `claude -p` subprocess, it is killed before the session is
marked `Cancelled`.

**`spec_list`**

```
Params:
  include_completed: bool     (optional, default false)
  workflow_type:     string   (optional filter)
  limit:             integer  (optional, default 20, max 100)

Returns:
  [{ session_id, workflow_type, topic, state, phase, created_at, updated_at }]
```

### Success Criteria

- `spec_start` with `workflow_type: "brainstorm"` and a topic returns a session ID and drives
  through the discovery phase to a gate without human intervention.
- `spec_status` returns accurate phase, sub-phase, and gate content for a session in any state.
- `spec_respond` with `response_type: "approve"` advances the workflow to the next phase.
- `spec_respond` with `response_type: "feedback"` triggers a revision cycle; the revised
  output surfaces at a new gate.
- `spec_respond` with `response_type: "feedback"` after `feedback_depth_limit` revisions returns
  a `FeedbackLimitReached` gate that only accepts `approve` or `cancel`.
- A crashed or killed server process restores all sessions correctly on restart; previously-running
  sessions appear in `ErrorGate` state.
- `spec_cancel` kills any in-flight subprocess and marks the session terminal.
- Startup validation fails fast with a clear error when `claude` is not on PATH or credentials
  are invalid.
- `spec_list` returns only active sessions by default; includes completed sessions when
  `include_completed: true`.
- Per-session cost is accurate and non-zero for any completed brainstorm session.
- All log output appears on stderr / log file; stdout carries only MCP JSON-RPC frames.

### Out of Scope

- Replacing the RAG MCP server (this is a sibling, not a replacement).
- Real-time streaming output within a phase (progress notifications at phase transitions are
  sufficient for MVP).
- Multi-user session isolation or authentication (single-user local tool).
- Parallel phase execution within a single workflow (phases are sequential).
- GUI or web frontend (MCP client surface only).
- Git commit automation as part of spec workflows.
- HTTP/SSE MCP transport (stdio only for MVP).
- Cross-session context inheritance (linking is by file reference only).
- Epic `child_extraction` stage output contract (requires a separate design spike before
  implementation).
- Configurable orphan deletion or cross-directory rename detection (RAG server concern).
- Gate timeout / auto-cancellation (can be added in a follow-up).
- Per-phase model override (session-level override only for MVP).

### Open Questions

1. **Epic `child_extraction` output contract.** What does the stage produce — a list of scoped
   spec topics? A set of pre-populated `context_refs`? Decision deferred to a design spike before
   Phase 4 implementation begins.

2. **RAG MCP config per workflow type.** Should each workflow type have its own `--mcp-config`
   (restricting RAG collection access), or is a single shared config sufficient? Default: single
   shared config for MVP; per-workflow configs can be added via a `rag_mcp_config` field in
   `spec_start` params.

3. **`feedback_depth_limit` configurability.** Currently a server-side default (5). Should it be
   overridable per `spec_start` call? Leaning yes — add as an optional param in a follow-up.

4. **MCP progress notifications.** Should the server emit `notifications/progress` during
   autonomous phase execution so poll-free clients can display status? `spec_status` covers
   poll-based clients. Decision: implement notifications in Phase 3 if the brainstorm demo reveals
   UX friction from polling.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Project scaffold: new Rust binary `spec-pipeline-mcp`, Cargo workspace entry, clap `serve` subcommand, config struct (`SPEC_PIPELINE_STATE_DIR`, `SPEC_PIPELINE_LOG_DIR`, RAG MCP config path), dual stderr + rolling file tracing setup matching RAG server pattern | 1 day |
| Phase 2 | Startup validation: `claude --version` check and credential probe at startup; fail-fast with clear error messages written to stderr before MCP transport is opened | 0.5 days |
| Phase 3 | Core state machine: `WorkflowPhase` and `HasGate` traits; `BrainstormState` enum with `Discovery(DiscoveryPhase)`, `Synthesis`, `AwaitingApproval`, `Complete`, `Cancelled`, `ErrorGate` variants; `DiscoveryPhase` nested enum; typed `GateResponse` and `PhaseOutput` structs with serde | 1.5 days |
| Phase 4 | `claude -p` subprocess runner: build command with all required flags, write phase context to a temp file, spawn subprocess, stream stdout, parse JSON envelope, extract `PhaseOutput` via `--json-schema` validation, surface subprocess errors as `ErrorGate` | 1.5 days |
| Phase 5 | Session persistence: atomic JSON file writes (`tmp` + rename), session registry in-memory (`DashMap<Uuid, Arc<Mutex<Session>>>`), startup recovery (load all `.json` files, transition `Running` → `ErrorGate`), session ID as UUID filename | 1 day |
| Phase 6 | MCP server: `McpServer` struct with `rmcp` tool router, five tool implementations (`spec_start`, `spec_status`, `spec_respond`, `spec_cancel`, `spec_list`), typed param structs with `schemars::JsonSchema`, error translation helper, `ServerHandler` impl | 2 days |
| Phase 7 | Brainstorm workflow end-to-end: wire `spec_start` → background task → phase runner → gate → `spec_respond` → phase runner → `done` → `Complete`; manual smoke test with Claude Code client | 1.5 days |
| Phase 8 | Spec workflow: `SpecState` enum mirroring brainstorm structure; `context_refs` injection into phase context (read files from disk, inject as text); wire end-to-end | 1.5 days |
| Phase 9 | Epic workflow: `EpicState` enum with `ChildExtraction` phase; output contract TBD (see Open Question 1); basic end-to-end wiring with a placeholder `child_extraction` stage | 2 days |
| Phase 10 | Feedback loop depth limit: `revision: u32` counter on synthesis phases; `FeedbackLimitReached` gate variant; enforce limit in `spec_respond` handler | 0.5 days |
| Phase 11 | Cost tracking: accumulate `total_cost_usd` from `claude -p` JSON envelope per invocation; persist in session file; surface in `spec_status` response | 0.5 days |
| Phase 12 | Integration tests: session lifecycle (start → gate → approve → complete), error gate (inject subprocess failure), crash recovery (write session file, restart server, verify `ErrorGate`), feedback depth limit, `spec_cancel` kills subprocess | 2 days |

**Total estimated effort: ~16.5 days**
