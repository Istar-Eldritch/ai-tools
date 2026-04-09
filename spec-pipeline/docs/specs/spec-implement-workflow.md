# Specification: `implement` Workflow Type for the Rust MCP spec-pipeline Server

**Status**: Draft  
**Created**: 2026-04-09  
**Revision**: 1

---

## Overview

This specification defines the `implement` workflow type for the existing Rust MCP
`spec-pipeline` server.  The workflow takes a completed spec file as input, extracts
implementation phases from it, and autonomously executes a
plan-generation → review → revision → implementation → code-review → code-revision
pipeline for every phase, with exactly **two user-facing gates**:

1. **Configuration gate** — at the start, the user sees the extracted phases and
   model assignments and can adjust them before the autonomous run begins.
2. **Approval gate** — at the end, the user reviews the complete implementation and
   either approves or requests additional review/revision iterations.

Everything between the two gates runs without user intervention; each agent call is a
separate `run_phase()` invocation so that any failure lands at an `ErrorGate` from
which the session can be retried at the exact point of failure.

---

## Requirements

### Functional

**R1 — Workflow registration**  
`implement` MUST be added as a fourth `WorkflowType` variant alongside `brainstorm`,
`spec`, and `epic`.  All existing enum arms (`WorkflowState`, `SessionState` mappings,
`WorkflowType::Display`, `session.rs` cancel/recover logic, and `mcp/mod.rs` helpers)
MUST be extended to handle the new variant.

**R2 — Spec-file input**  
When the user calls `spec_start` with `workflow_type = "implement"` the `topic` field
MUST be the path (absolute or relative to the server's working directory) of an
existing spec file.  The server reads the file at session creation time and stores its
content in the session state so that the autonomous pipeline can reference it without
re-reading from disk (the file may change after the session starts).

**R3 — Phase extraction**  
Phase extraction MUST be performed by a dedicated `PhaseExtraction` phase agent call
(not inline Rust) so that all four table formats supported by the TypeScript reference
implementation are handled consistently:

| Format | Pattern |
|--------|---------|
| Table with links (legacy) | `\| Phase N \| Focus \| Effort \| [name](./path) \|` |
| Table without links (preferred) | `\| Phase N \| Focus description \| Effort \|` |
| Typst table | `[Phase N], [Focus description], [Effort],` |
| Inline headers (fallback) | `### Phase N: Name` |

The extractor agent writes a JSON file listing the extracted phases (number, slug,
description) to a temp path and returns it as the `artifact_path` in its `done`
output.  If zero phases are found, the agent synthesises a single
`phase1_implementation` pseudo-phase.

**R4 — Configuration gate**  
After phase extraction the workflow MUST pause at a `Configuring` gate.  The gate
content MUST include:

- The list of extracted phases (number + description slug).
- The default model assignments for each agent role:
  - `planner` — model used for plan generation
  - `reviewer` — model used for plan review and code review
  - `reviser` — model used for plan revision and code revision  
  - `implementer` — model used for code implementation
- A note explaining the defaults and how to override them via `spec_respond` with
  `response_type = "configure"` carrying a JSON payload.

The user may respond with:
- `approve` — accept defaults and begin the autonomous run.
- `configure` — supply model overrides in `content` (JSON map from role name to model
  string); the server updates the stored `ImplementConfig` and re-presents the gate.
- `cancel` — cancel the session.

**R5 — Autonomous per-phase pipeline**  
For each extracted phase, the workflow MUST autonomously execute the following
sub-phases in order, without user interaction:

```
PlanGeneration → PlanReview ⇄ PlanRevision → Implementation → CodeReview ⇄ CodeRevision
```

- `PlanGeneration` — a `planner` agent reads the spec content and the phase
  description and writes a detailed implementation plan file to a temp directory.
- `PlanReview` — a `reviewer` agent reads the plan and produces an
  `APPROVED | NEEDS_CHANGES` verdict.
  - If `APPROVED` and no prior revisions → advance to `Implementation`.
  - If `NEEDS_CHANGES` and revision count < `plan_revision_limit` → advance to
    `PlanRevision`.
  - If `NEEDS_CHANGES` and revision count ≥ `plan_revision_limit` → advance to
    `Implementation` (hard cap; carry forward the best plan available).
- `PlanRevision` — a `reviser` agent reads the plan + review feedback and writes an
  updated plan back to the same temp path; loop back to `PlanReview`.
- `Implementation` — an `implementer` agent reads the plan and makes code changes.
- `CodeReview` — a `reviewer` agent inspects the code changes and produces an
  `APPROVED | NEEDS_CHANGES` verdict.
  - If `APPROVED` → advance to the next phase (or `AwaitingApproval` if last phase).
  - If `NEEDS_CHANGES` and revision count < `code_revision_limit` → advance to
    `CodeRevision`.
  - If `NEEDS_CHANGES` and revision count ≥ `code_revision_limit` → advance to next
    phase (hard cap; implementation stands as-is).
- `CodeRevision` — a `reviser` agent reads the code + review feedback and makes
  further changes; loop back to `CodeReview`.

**R6 — Skip-plan flag**  
An optional boolean `skip_plan_generation` field in the start params (or in the
`configure` gate response) MUST skip `PlanGeneration`, `PlanReview`, and
`PlanRevision` for all phases and jump directly to `Implementation`.

**R7 — Approval gate**  
After all phases complete, the workflow MUST pause at an `AwaitingApproval` gate.  The
gate content MUST include:

- A summary of how many phases were implemented.
- Per-phase review cycle counts (plan cycles, code cycles).
- A list of `artifact_paths` (the spec file + any phase plan files still in temp).

The user may respond with:
- `approve` — transition to `Complete`.
- `revise` — re-enter an `IterationReview ⇄ IterationRevision` loop (see R8).
- `cancel` — transition to `Cancelled`.

**R8 — Post-approval review/revision loop**  
When the user requests a revision from the `AwaitingApproval` gate, a global
`IterationReview` agent call MUST review the entire implementation (all phases) and
produce a unified `APPROVED | NEEDS_CHANGES` verdict.  If `NEEDS_CHANGES`, the
workflow enters `IterationRevision` (a single `reviser` call with the combined
feedback).  The cycle loops back to `IterationReview`.  After the loop, control
returns to `AwaitingApproval`.  The loop is hard-capped at `FEEDBACK_DEPTH_LIMIT`
(imported from `phase_runner`).

**R9 — ErrorGate wrapping**  
Any `run_phase()` failure MUST transition the session to `ErrorGate` carrying the
failed sub-phase name, error message, and exit code.  On `retry`, the session loop
MUST re-enter the exact same sub-phase that failed.  On `cancel`, the session
transitions to `Cancelled`.

**R10 — Temp directory lifecycle**  
Spec content and all plan files MUST be written to a `tempfile::TempDir` created when
the session loop starts (not at session creation).  The directory is cleaned up when
the `ImplementState` is dropped (i.e., when the session loop exits normally, is
cancelled, or transitions to `Complete`).  Plan artifact paths stored in state MUST be
relative to the temp dir; the loop resolves them to absolute paths at runtime.

**R11 — Metrics tracking**  
The `ImplementState` MUST record, per phase: plan generation outcome, plan review cycle
count, code review cycle count, and whether code was approved on the first review pass.
Aggregated metrics MUST be included in the `AwaitingApproval` gate summary.

### Non-Functional

**R12 — No new MCP tools**  
The `implement` workflow MUST reuse the existing `spec_start` / `spec_status` /
`spec_respond` / `spec_cancel` / `spec_list` tools.  No new MCP tools are introduced.

**R13 — Session persistence**  
The `ImplementState` MUST be fully serialisable with `serde` so that it survives
server restarts.  Sessions recovered in a `Running` sub-phase are moved to `ErrorGate`
by the existing recovery mechanism; no special-casing is needed.

**R14 — Backward compatibility**  
All existing workflow types (brainstorm, spec, epic) MUST continue to work unchanged.

---

## Design

### State Machine

```
                         ┌──────────────────────────────────────────────────────────┐
                         │                  Autonomous loop                         │
                         │                                                          │
Start ──▶ PhaseExtraction ──▶ Configuring ══(approve)══▶ ┌── PlanGeneration ──▶ PlanReview ──┐
                                   │                     │       ▲                    │       │ APPROVED
                            (cancel)                     │       │ NEEDS_CHANGES      ▼       │
                                   ▼                     │   PlanRevision ◀───────────┘       │
                                Cancelled                │                                    ▼
                                                         │                            Implementation ──▶ CodeReview ──┐
                                                         │                                                    │       │ APPROVED
                                                         │                                                    ▼       │
                                                         │                                            CodeRevision ◀──┘
                                                         │                                                    │
                                                         │                                                    ▼
                                                         │                                           (next phase or…)
                                                         └──────────────────────────────────────────▶ AwaitingApproval
                                                                                                            │
                                                                       ╔══════════════╗          (approve) ─┼─ (cancel)
                                                                       ║IterationReview║◀─(revise)          │
                                                                       ╚══════════════╝                     ▼
                                                                              │ NEEDS_CHANGES            Complete
                                                                              ▼
                                                                       IterationRevision
                                                                              │
                                                                              └──▶ IterationReview (loop)
```

Every state node that executes a `run_phase()` can fail into `ErrorGate`.

### `ImplementState` Enum

```rust
/// State machine for the implement workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase")]
pub enum ImplementState {
    /// Extracting phases from the spec file.
    #[serde(rename = "phase_extraction")]
    PhaseExtraction,

    /// Waiting for user to review extracted phases and confirm model config.
    #[serde(rename = "configuring")]
    Configuring {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
    },

    /// Generating an implementation plan for the current phase.
    #[serde(rename = "plan_generation")]
    PlanGeneration {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// Reviewing the current phase plan.
    #[serde(rename = "plan_review")]
    PlanReview {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        plan_revision: u32,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// Revising the current phase plan based on review feedback.
    #[serde(rename = "plan_revision")]
    PlanRevision {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        plan_revision: u32,
        review_feedback: String,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// Implementing the current phase.
    #[serde(rename = "implementation")]
    Implementation {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// Reviewing the implementation of the current phase.
    #[serde(rename = "code_review")]
    CodeReview {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        code_revision: u32,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// Revising the implementation based on code review feedback.
    #[serde(rename = "code_revision")]
    CodeRevision {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        code_revision: u32,
        review_feedback: String,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// All phases complete — awaiting user approval.
    #[serde(rename = "awaiting_approval")]
    AwaitingApproval {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
        approval_revision: u32,
    },

    /// Global review of the full implementation (post-approval iteration).
    #[serde(rename = "iteration_review")]
    IterationReview {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
        iteration: u32,
    },

    /// Global revision of the full implementation.
    #[serde(rename = "iteration_revision")]
    IterationRevision {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
        iteration: u32,
        review_feedback: String,
    },

    /// Workflow completed successfully.
    #[serde(rename = "complete")]
    Complete {
        spec_path: String,
        metrics: Vec<PhaseMetrics>,
    },

    /// Workflow was cancelled.
    #[serde(rename = "cancelled")]
    Cancelled,

    /// A phase failed; waiting for user decision.
    #[serde(rename = "error_gate")]
    ErrorGate {
        message: String,
        failed_phase: String,
        exit_code: Option<i32>,
    },
}
```

### Supporting Types

```rust
/// A single phase extracted from the spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedPhase {
    /// 1-indexed phase number.
    pub number: u32,
    /// Filesystem-safe slug derived from the focus description.
    pub slug: String,
    /// Full focus description from the spec.
    pub description: String,
}

/// User-configurable model assignments for the implement workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImplementConfig {
    /// Model used to generate phase implementation plans.
    pub planner: String,
    /// Model used to review plans and code.
    pub reviewer: String,
    /// Model used to revise plans and code after review.
    pub reviser: String,
    /// Model used to implement code changes.
    pub implementer: String,
    /// Max plan review+revision cycles per phase before forcing advancement.
    pub plan_revision_limit: u32,
    /// Max code review+revision cycles per phase before forcing advancement.
    pub code_revision_limit: u32,
    /// When true, skip PlanGeneration / PlanReview / PlanRevision for all phases.
    pub skip_plan_generation: bool,
}

impl Default for ImplementConfig {
    fn default() -> Self {
        Self {
            planner: "opus".to_string(),
            reviewer: "sonnet".to_string(),
            reviser: "sonnet".to_string(),
            implementer: "opus".to_string(),
            plan_revision_limit: 3,
            code_revision_limit: 3,
            skip_plan_generation: false,
        }
    }
}

/// Metrics collected for a single implementation phase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseMetrics {
    pub phase_number: u32,
    pub plan_cycles: u32,
    pub code_cycles: u32,
    pub code_approved_first_pass: bool,
}
```

#### Default model assignments

| Role | Default | Used for |
|------|---------|---------|
| `planner` | `opus` | `PlanGeneration` |
| `implementer` | `opus` | `Implementation` |
| `reviewer` | `sonnet` | `PlanReview`, `CodeReview`, `IterationReview` |
| `reviser` | `sonnet` | `PlanRevision`, `CodeRevision`, `IterationRevision` |

> **Note**: `haiku` is **not** used in `ImplementConfig`.  If commit-message generation
> is added in a future iteration it will use `haiku`, but that is a separate concern
> outside this struct.

### `WorkflowType` Extension

```rust
pub enum WorkflowType {
    Brainstorm,
    Spec,
    Epic,
    Implement,   // ← new
}
```

All `match` arms in `WorkflowType`, `WorkflowState`, `mod.rs` trait impls, `session.rs`
(cancel/recover), and `mcp/mod.rs` (`parse_workflow_type`, `spawn_session_loop`,
initial-state construction) MUST add an `Implement` arm.

### `WorkflowState` Extension

```rust
pub enum WorkflowState {
    Brainstorm(BrainstormState),
    Spec(SpecState),
    Epic(EpicState),
    Implement(ImplementState),   // ← new
}
```

`session_state()` mapping for `ImplementState`:

| ImplementState variant | SessionState |
|------------------------|-------------|
| `PhaseExtraction` | `Running` |
| `Configuring` | `WaitingAtGate` |
| `PlanGeneration` | `Running` |
| `PlanReview` | `Running` |
| `PlanRevision` | `Running` |
| `Implementation` | `Running` |
| `CodeReview` | `Running` |
| `CodeRevision` | `Running` |
| `AwaitingApproval` | `WaitingAtGate` |
| `IterationReview` | `Running` |
| `IterationRevision` | `Running` |
| `Complete` | `Complete` |
| `Cancelled` | `Cancelled` |
| `ErrorGate` | `ErrorGate` |

### `GateResponse` Extension

A new variant is needed for the configuration gate:

```rust
pub enum GateResponse {
    Approve { content: Option<String> },
    Revise { feedback: String },
    Cancel,
    Retry,
    Configure { config_json: String },   // ← new
}
```

`spec_respond` accepts `response_type = "configure"` and maps it to
`GateResponse::Configure { config_json: content.unwrap_or_default() }`.

### Gate Content

**Configuring gate**:

```json
{
  "summary": "Implement workflow ready. Review extracted phases and model configuration.",
  "artifact_path": null,
  "suggested_actions": ["approve", "configure", "cancel"],
  "phases": [
    { "number": 1, "slug": "backend_api_endpoints", "description": "Backend API endpoints for job cancellation" },
    { "number": 2, "slug": "frontend_ui_components", "description": "Frontend UI components" }
  ],
  "config": {
    "planner": "opus",
    "reviewer": "sonnet",
    "reviser": "sonnet",
    "implementer": "opus",
    "plan_revision_limit": 3,
    "code_revision_limit": 3,
    "skip_plan_generation": false
  }
}
```

Because the existing `GateContent` struct has only `summary`, `artifact_path`, and
`suggested_actions`, the phases and config will be serialised into the `summary` field
as a human-readable block AND the workflow state itself (which is already included in
the `spec_status` snapshot) carries the full structured data.  No changes to
`GateContent` are required to remain backward-compatible with the MCP client.

**AwaitingApproval gate**:

```json
{
  "summary": "Implementation complete. 3 phases implemented. Plan cycles: 4 total. Code cycles: 6 total. Code approved on first pass: 2/3 phases.",
  "artifact_path": null,
  "suggested_actions": ["approve", "revise", "cancel"]
}
```

### Phase Runner: `run_implement_session`

A new async function `run_implement_session` is added to `phase_runner.rs` following
the same structure as `run_brainstorm_session`, `run_spec_session`, and
`run_epic_session`.

The function:

1. Reads the current `ImplementState` from the registry.
2. Dispatches to the correct handler based on the phase variant.
3. After each handler, persists the updated state to the registry.
4. If a handler returns `Err(RunnerError)`, transitions to `ErrorGate` and exits the
   loop (the gate channel is not registered; the user uses `spec_respond(retry)` to
   re-enter).
5. When a `Configuring` or `AwaitingApproval` gate is reached, registers a oneshot
   gate channel and blocks on it.

#### Temp directory management

Because `run_implement_session` is spawned as a task, it owns the `TempDir`.  The
temp dir is created at the top of the function (not stored in session state) and passed
by reference into each handler.  When the loop exits (for any reason), the `TempDir`
is dropped and the directory is removed.

Plan paths stored in `ExtractedPhase` and workflow state are stored as bare filenames
(e.g., `"phase1_backend_api_endpoints.md"`); the runner constructs the full absolute
path by joining with the temp dir path at call time.

#### Prompt keys (new entries in `PromptStore`)

| Key | File | Agent role |
|-----|------|-----------|
| `implement/phase_extraction` | `implement_phase_extraction.txt` | Extracts phases from spec; writes JSON |
| `implement/plan_generation` | `implement_plan_generation.txt` | Writes detailed plan file |
| `implement/plan_review` | `implement_plan_review.txt` | Reviews plan; emits APPROVED/NEEDS_CHANGES in `question` field |
| `implement/plan_revision` | `implement_plan_revision.txt` | Revises plan in place |
| `implement/implementation` | `implement_implementation.txt` | Makes code changes |
| `implement/code_review` | `implement_code_review.txt` | Reviews code; emits APPROVED/NEEDS_CHANGES in `question` field |
| `implement/code_revision` | `implement_code_revision.txt` | Addresses code review findings |
| `implement/iteration_review` | `implement_iteration_review.txt` | Global review after approval gate |
| `implement/iteration_revision` | `implement_iteration_revision.txt` | Global revision |

Review phases (plan_review, code_review, iteration_review) use the `gate` output type
where `question` carries the verdict string (`"APPROVED"` or `"NEEDS_CHANGES: …"`).
The runner reads the `question` field to decide the transition; no actual user gate is
presented.

#### `PhaseContext` fields used by implement agents

The existing `PhaseContext` struct is sufficient.  Relevant fields per phase:

| Field | Content |
|-------|---------|
| `topic` | Path to the spec file |
| `workflow_type` | `"implement"` |
| `phase` | Sub-phase name (e.g., `"plan_generation"`) |
| `prior_artifacts` | `[spec_path, plan_path?]` |
| `context_refs` | User-supplied context refs (forwarded from session) |
| `gate_history` | Accumulated gate/response pairs |
| `revision_feedback` | Review feedback for revision phases; `null` otherwise |
| `revision` | Current revision index for the sub-phase |

### `spec_start` changes

When `workflow_type = "implement"`, the server:

1. Resolves and reads the spec file (path is in `topic`).  Returns an MCP error if the
   file does not exist.
2. Creates the session with `ImplementState::PhaseExtraction` as the initial state,
   storing the raw spec content in a new `spec_content` field on `Session` (or,
   alternatively, keeping it in the `ImplementState` directly — see Implementation
   Notes).
3. Spawns `run_implement_session`.

### `spec_respond` changes

A new `"configure"` branch is added alongside `"approve"`, `"revise"`, `"cancel"`,
`"retry"`.  `content` MUST be a JSON string parseable as a partial `ImplementConfig`
(only fields present are overridden).

---

## Implementation Notes

### Storing spec content

The spec file content needs to be available to every agent in the pipeline, but it
should not be re-read from disk on every phase (the file could change).  Two options:

**Option A — Store in `ImplementState`**: The `Configuring` variant (and all
subsequent variants) carries a `spec_content: String` field.  Clean, self-contained,
but bloats the serialised session JSON for large specs.

**Option B — Write to temp file at loop start**: `run_implement_session` writes the
spec content to `{tmpdir}/spec.md` and passes the path as a `context_refs` entry.
Keeps state lean but ties content lifetime to the task.

**Recommendation**: Use Option B.  The pattern mirrors the TypeScript reference
(`specTmpPath`), keeps the serialised session small, and the temp file is only needed
while the loop is running.  The spec path (the original file path) is stored in
`topic` for reference.

### Verdict parsing

Review agents emit their verdict via the `gate` output type (`question` field) rather
than `done`.  The runner inspects `question.trim().to_uppercase().starts_with("APPROVED")`
to determine the transition.  The full question string is stored as `review_feedback`
in the revision state for the reviser agent.

An alternative is to define a new `RawPhaseOutput::Verdict` variant, but that would
require schema changes.  Using the `gate` field avoids schema changes and is
consistent with how the spec research phase asks questions.

### `configure` gate response

The `GateResponse::Configure` variant is new.  `apply_gate_response` in
`phase_runner.rs` MUST handle it by:

1. Parsing `config_json` as a `serde_json::Value`.
2. Merging only the present fields into the stored `ImplementConfig`.
3. Keeping the session at `Configuring` (not advancing) so the gate is re-presented
   with the updated config for confirmation.

### `PhaseRole` for implement agents

The existing `PhaseRole` enum covers `Discovery`, `Synthesis`, `Review`.  For the
implement workflow the mapping is:

| Sub-phase | PhaseRole |
|-----------|-----------|
| `PhaseExtraction` | `Discovery` |
| `PlanGeneration` | `Synthesis` |
| `PlanReview` | `Review` |
| `PlanRevision` | `Synthesis` |
| `Implementation` | `Synthesis` |
| `CodeReview` | `Review` |
| `CodeRevision` | `Synthesis` |
| `IterationReview` | `Review` |
| `IterationRevision` | `Synthesis` |
| All gate/terminal states | `Review` |

This mapping is used by `ImplementState::phase_role()` and determines which default
model from `ModelConfig` is selected unless the `ImplementConfig` overrides it.

### Model resolution

The `run_implement_session` function resolves the model for each sub-phase as follows:

```rust
fn resolve_model(sub_phase: &str, config: &ImplementConfig) -> &str {
    match sub_phase {
        "plan_generation" => &config.planner,
        "plan_review" | "code_review" | "iteration_review" => &config.reviewer,
        "plan_revision" | "code_revision" | "iteration_revision" => &config.reviser,
        "implementation" => &config.implementer,
        _ => "sonnet",
    }
}
```

The global `ModelConfig` (passed to all other session runners) is used as a fallback
for the `PhaseExtraction` sub-phase (no implement-specific role yet assigned).

### Prompt content guidelines

The eight new system prompts follow the same `stdin JSON → structured output` contract
as the existing prompts.  Key differences from the spec/brainstorm prompts:

- **`implement/phase_extraction`** — instructs the agent to read the spec from
  `prior_artifacts[0]` (the tmp copy), try all four regex formats, and write a JSON
  file of `[{number, slug, description}]` to the path specified in the system prompt
  (passed via `context_refs` at runtime).  Returns `done` with `artifact_path` set to
  the JSON file.

- **Review prompts** (`plan_review`, `code_review`, `iteration_review`) — instruct the
  agent to return `{"type":"gate","question":"APPROVED","artifact_path":null}` or
  `{"type":"gate","question":"NEEDS_CHANGES: <feedback>","artifact_path":null}`.  The
  runner does NOT register a real gate channel for these; it reads the `question` field
  immediately.

- **Revision prompts** (`plan_revision`, `code_revision`, `iteration_revision`) —
  receive `revision_feedback` (the review `question` text) and are instructed to
  apply it.

- **`implement/implementation`** — receives the plan file path in `prior_artifacts`,
  the spec content path in `context_refs`, and optional `test_command` in the topic
  context.

### Hard-cap advancement

When either `plan_revision_limit` or `code_revision_limit` is reached and the reviewer
still says `NEEDS_CHANGES`, the runner advances anyway and logs a warning.  This
mirrors the `FEEDBACK_DEPTH_LIMIT` behavior in the existing brainstorm/spec/epic
runners (see `phase_runner.rs` line 22).

---

## Open Questions

**Q1 — `spec_content` in `Session`**  
Should `spec_content` (the raw text of the spec file) be added as a field on `Session`
directly (increasing session size for all workflow types) or stored only in
`ImplementState` variants?  Recommendation: store in `ImplementState` variants (e.g.,
in `PhaseExtraction { spec_content: String, spec_path: String }`) to keep `Session`
clean, then drop it from the enum arms after it's written to the temp file.  To be
decided before implementation.

**Q2 — `GateContent` extension for structured phase/config data**  
The `Configuring` gate would benefit from carrying `phases: Vec<ExtractedPhase>` and
`config: ImplementConfig` as typed fields on `GateContent` rather than embedding them
in `summary`.  However, this is a breaking change for the existing gate content schema
returned by `spec_status`.  Should we add optional fields to `GateContent` (and update
all existing `HasGate` impls to return `None` for the new fields), or extend the MCP
snapshot JSON ad-hoc?  Recommendation: extend `GateContent` with
`#[serde(skip_serializing_if = "Option::is_none")]` optional fields.

**Q3 — Test command plumbing**  
The TypeScript reference passes `testCommand` to the implementer so it can verify
tests pass.  Should the Rust implementation accept a `test_command` field in
`SpecStartParams` (for implement workflow) or in the `configure` gate response?
Recommendation: add as an optional field in `SpecStartParams` and store in
`ImplementConfig`.

**Q4 — Plan file paths in session state**  
The plan file paths are only valid while the session loop's `TempDir` is alive.  If
the server restarts mid-pipeline, those paths become stale.  The recovery mechanism
moves the session to `ErrorGate`, so the user must retry.  On retry, the loop creates
a fresh `TempDir` and runs `PlanGeneration` again (the plan is not persisted across
restarts).  Is this acceptable, or should plans be persisted to a stable location
(e.g., `~/.local/share/spec-pipeline/plans/<session-id>/`)?  Recommendation: accept
the current behaviour (plans are ephemeral) for the initial implementation; a future
iteration can add persistence.

**Q5 — `configure` vs reusing `approve` with content**  
Adding a new `GateResponse::Configure` variant requires updating `apply_gate_response`
and the MCP `spec_respond` handler.  An alternative is to overload `approve` with
optional JSON content for the configuration gate only (the runner inspects `content` to
decide whether to advance or stay).  This avoids a new variant but is less explicit.
Recommendation: add the new variant for clarity.
