# Brainstorm: MCP Spec Pipeline Server

**Status**: Draft
**Created**: 2026-04-08T15:50:02Z
**Timestamp**: 2604081550

## Problem / Opportunity

The current spec pipeline is implemented as a Python engine (`engine.py`) that drives multi-phase document generation workflows (brainstorm → epic → spec). It works, but is tightly coupled to Python subprocess invocations, has no structured output contract with callers, and lacks the composability needed to support richer agent-driven workflows.

The opportunity is to replace (or wrap) this engine with a Rust MCP server that exposes spec pipeline stages as MCP tools, enabling Claude CLI agents to participate in a well-typed, gate-driven workflow with explicit human checkpoints.

## Context & Background

The existing `engine.py` is already a generic JSON-driven state machine. It supports stage types: `conversation`, `agent`, `approval`, `review`, `commit`, and `loop`. This is a solid foundation — the goal is not to discard it but to re-implement its orchestration layer in Rust with proper types, MCP tool exposure, and structured Claude CLI integration.

The broader RAG MCP server already exists in Rust and exposes `ingest`, `search`, `delete_source`, and related tools. The spec pipeline server would be a sibling service that leverages RAG for context retrieval during discovery phases.

Three workflow types currently exist or are planned:
- **Brainstorm**: open-ended exploration, synthesizes into a structured document
- **Epic**: child extraction from a brainstorm output, produces scoped work items
- **Spec**: formal technical spec drafting grounded in epic/brainstorm artifacts

## Key Decisions

1. **Hybrid async + gate model**: The server autonomously drives through phases between gates, surfacing to the user only at explicit checkpoints (human approval required to proceed). Not a turn-by-turn chatbot; not a fire-and-forget queue.

2. **Typed interaction points**: Gate responses are typed — `answer`, `feedback`, or `approve` — rather than a flat unstructured `respond`. This lets the server route responses correctly without parsing intent.

3. **Discriminated union output from Claude**: `claude -p` calls return a JSON envelope with a `--json-schema`-validated discriminated union: `{ type: "continue" | "gate" | "done", ... }`. The server interprets this to decide whether to loop, surface a checkpoint, or finalize.

4. **One `claude -p` call per phase**: Claude is stateless compute. The server is the state machine. Context is reconstructed per invocation from stored artifacts and RAG retrieval — not from session continuity.

5. **Typed building blocks (Option C)**: Shared traits (`Gate`, `Review`, `Conversation`) composed per workflow as enum variants, rather than a single mega-enum (Option A typestate) or untyped JSON blob (Option B). This balances type safety with extensibility.

6. **Independent sessions linked by reference**: Brainstorm, epic, and spec sessions are separate state machine instances. They reference each other via file path (e.g., brainstorm output path injected as context into epic phase). No implicit session inheritance.

7. **Epic as a real engine workflow**: Epic extraction should be a first-class workflow with a `child_extraction` stage, not an ad-hoc script. This gives it the same gate/review/approval machinery as brainstorm and spec.

8. **Sub-phases as nested enum variants**: A phase like `Discovery` can have sub-states `{Exploring, Synthesizing, AwaitingApproval}` as nested variants rather than top-level state fields. Keeps the state type clean and transition logic local.

## Proposed Architecture

```
┌─────────────────────────────────────┐
│           MCP Spec Server           │  ← Rust, sibling to RAG server
│                                     │
│  ┌─────────┐   ┌─────────────────┐  │
│  │Workflow │   │  Phase Runner   │  │
│  │Registry │──▶│  (state machine)│  │
│  └─────────┘   └────────┬────────┘  │
│                         │           │
│              ┌──────────▼─────────┐ │
│              │   claude -p  CLI   │ │  ← subprocess per phase
│              └──────────┬─────────┘ │
│                         │           │
│              ┌──────────▼─────────┐ │
│              │   Artifact Store   │ │  ← local fs, structured paths
│              └────────────────────┘ │
└─────────────────────────────────────┘
         │ MCP tools
         ▼
  Claude Code / human client
```

The server manages workflow instances in memory (with disk persistence for crash recovery). Each instance holds current state, accumulated artifacts, and gate history. The phase runner invokes `claude -p` as a subprocess, passing context via stdin and system prompt file, and parses the structured JSON response to advance state.

## MCP Tool Surface

Tools exposed by the spec pipeline MCP server:

| Tool | Description |
|---|---|
| `spec_start` | Create a new workflow instance. Params: `workflow_type` (brainstorm/epic/spec), `topic`, `context_refs` (optional paths to prior artifacts). Returns `session_id`. |
| `spec_status` | Poll current state of a session. Returns phase, sub-phase, last gate content if pending, and artifact paths produced so far. |
| `spec_respond` | Submit a typed gate response. Params: `session_id`, `response_type` (answer/feedback/approve), `content`. Unblocks a waiting gate. |
| `spec_cancel` | Abort a session. Cleans up in-progress work, marks session terminal. |
| `spec_list` | List active and recently completed sessions with their current phase. |

Notifications (push): the server may emit MCP progress notifications during autonomous phases so the client can display status without polling. `spec_status` remains available for poll-based clients.

### Typed gate response schema

```
GateResponse =
  | { type: "answer",   content: string }          // answer a discovery question
  | { type: "feedback", content: string }           // request revision with notes
  | { type: "approve",  artifact_path?: string }    // accept output, advance
```

### Claude output schema (discriminated union)

```
PhaseOutput =
  | { type: "continue" }                            // still working, loop
  | { type: "gate",    question: string,
                       artifact_path?: string }     // surface checkpoint
  | { type: "done",    artifact_path: string,
                       summary: string }            // phase complete
```

## Claude CLI Integration

### Invocation pattern

```
claude -p \
  --bare \
  --no-session-persistence \
  --output-format json \
  --json-schema /path/to/phase_output_schema.json \
  --mcp-config /path/to/rag_mcp.json \
  --strict-mcp-config \
  --model sonnet \
  --system-prompt-file /path/to/phase_system_prompt.txt \
  < phase_context.json
```

Key flags:
- `--bare`: skips hooks, LSP, CLAUDE.md loading — minimal overhead for server context
- `--no-session-persistence`: Claude is stateless; server owns state
- `--output-format json`: machine-readable envelope with `total_cost_usd`, `stop_reason`, `num_turns`
- `--json-schema`: enforces discriminated union response; prevents free-form text bleed
- `--mcp-config` + `--strict-mcp-config`: grants isolated RAG access, no other tools
- `--system-prompt-file`: avoids shell escaping hazards for multi-line prompts
- stdin: phase context (topic, prior artifacts, gate history, RAG results) as JSON

### Context injection strategy

- **Cheap roles** (summarizer, reviewer): inject RAG results directly into the prompt as text. No MCP access needed.
- **Heavyweight roles** (discovery agent, spec drafter): give RAG MCP access so the agent can query iteratively.

### Cost tracking

The JSON envelope exposes `total_cost_usd` per invocation. The server accumulates per-session cost and surfaces it in `spec_status` responses and gate checkpoint messages.

## State Machine Design

Each workflow is a Rust `enum` with variants per phase. Sub-phases are nested enums within variants.

### Brainstorm workflow example

```
BrainstormState =
  | Discovery(DiscoveryPhase)
  | Synthesis { draft_path: PathBuf, revision: u32 }
  | AwaitingApproval { artifact_path: PathBuf }
  | Complete { artifact_path: PathBuf }
  | Cancelled

DiscoveryPhase =
  | Exploring { turn: u32 }
  | AwaitingAnswer { question: String }
```

### Shared traits (Option C building blocks)

```rust
trait WorkflowPhase {
    fn advance(&self, input: PhaseInput) -> PhaseTransition;
    fn artifact_paths(&self) -> Vec<PathBuf>;
}

trait HasGate {
    fn gate_content(&self) -> Option<GateContent>;
    fn apply_response(&self, r: GateResponse) -> Self;
}
```

Concrete workflows implement `WorkflowPhase`. Phases that expose checkpoints also implement `HasGate`. The phase runner is generic over `WorkflowPhase` — it doesn't need to know the concrete workflow type.

### Transition rules

- The server loops `advance()` autonomously until a `Gate` or `Done` transition is returned.
- Gates block until `spec_respond` is called with a matching `session_id`.
- `feedback` responses re-enter the previous phase with revision context appended.
- `approve` advances to the next phase; if the phase was the final phase, the workflow moves to `Complete`.

### Session linking

```json
{
  "workflow_type": "epic",
  "topic": "Postgres RAG MCP",
  "context_refs": [
    "/rag/docs/specs/2604071423_epic_postgres_rag_mcp.md"
  ]
}
```

The epic and spec workflows receive prior artifact paths as `context_refs`. The server reads these files and injects their content (or a RAG-retrieved summary) into the phase context. No session ID inheritance — linking is purely by file reference.

## Out of Scope

- Replacing the RAG MCP server itself (this is a sibling, not a replacement)
- Real-time streaming output within a phase (gate notifications are enough)
- Multi-user session isolation / auth (single-user local tool)
- Parallel phase execution within a single workflow (phases are sequential)
- GUI or web frontend (MCP client surface only)
- Git commit automation as part of spec workflows (existing engine's `commit` stage is out for now)

## Open Questions

1. **Persistence format**: Should workflow state be serialized to SQLite (reuse existing RAG DB) or to per-session JSON files? SQLite gives queryability; JSON files are simpler and portable.

2. **MCP server lifecycle**: Should this be a standalone binary or embedded in the existing RAG MCP server binary? Separate binary is cleaner; embedding shares DB connection pool.

3. **Gate timeout**: Should gates have a configurable timeout after which the session is auto-cancelled or auto-approved? Useful for unattended runs; complicates the common interactive case.

4. **Epic child_extraction stage**: What is the output contract? A list of scoped spec topics? A set of pre-populated spec `context_refs`? Needs its own brainstorm before implementation.

5. **Model routing policy**: Should the server enforce which model alias (`opus`/`sonnet`/`haiku`) is used per phase type, or leave it to the caller at `spec_start` time? Per-phase policy is safer (cost control) but less flexible.

6. **Feedback loop depth**: How many `feedback` → revise cycles should be permitted before forcing an `approve` or `cancel`? Unbounded loops are a cost risk.

7. **RAG MCP config per workflow**: Should each workflow type have its own MCP config (restricting which RAG collections are accessible), or is a single shared config sufficient?

## Rough Scope Assessment

| Component | Effort |
|---|---|
| MCP server skeleton (tool registration, routing) | Small — pattern exists in RAG server |
| Workflow state machine (brainstorm) | Medium — enum design + transition logic |
| Workflow state machine (epic, spec) | Medium each — similar pattern once brainstorm is done |
| `claude -p` subprocess runner + JSON parsing | Small |
| Gate blocking / `spec_respond` wiring | Small-medium |
| Session persistence (JSON file approach) | Small |
| Cost accumulation + status reporting | Small |
| Context injection + RAG retrieval | Medium — needs prompt engineering per phase |
| Epic `child_extraction` stage design | Separate spike needed |

**Overall**: Medium-large effort, well-scoped. The RAG server codebase provides the scaffolding; the novel work is the state machine design and prompt engineering for each phase.

Suggested sequencing: brainstorm workflow end-to-end first (including gate mechanics), then spec, then epic with child extraction.
