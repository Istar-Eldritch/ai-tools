# Specification: `implement` Workflow for spec-pipeline-mcp

**Status**: Draft  
**Created**: 2026-04-09  
**Topic**: Add an "implement" workflow type to the Rust MCP spec-pipeline server

---

## Overview

The `implement` workflow takes a completed spec file, extracts its implementation
phases, and then autonomously executes a per-phase loop of:

```
PlanGeneration → PlanReview ⇄ PlanRevision → Implementation → CodeReview ⇄ CodeRevision
```

This repeats for every phase extracted from the spec.  Two user gates bound the
autonomous section:

1. **Configuring gate** (start) — user sees the extracted phases and the four
   model assignments (planner, implementer, reviewer, reviser) with sane
   defaults and may override any of them before firing.
2. **AwaitingApproval gate** (end) — user reviews the completed implementation
   and either approves (→ Complete) or requests additional review/revision
   iterations (→ IterationReview ⇄ IterationRevision).

Everything between the two gates runs autonomously.  Each agent invocation is a
separate `run_phase()` call, which means the session is persisted to disk after
every step and interrupted sessions can be recovered with `ErrorGate` at the
exact point of failure.

---

## Full State Machine

```
Configuring
  └─(approve)─► PlanGeneration(phase=0)
                    └─(done)─► PlanReview(phase=0, cycle=0)
                                  ├─(APPROVED)──────────────► Implementation(phase=0)
                                  └─(NEEDS_CHANGES)─► PlanRevision(phase=0, cycle=0)
                                                          └─(done)─► PlanReview(phase=0, cycle=1)
                                                                         └─ … (up to PLAN_REVIEW_LIMIT)
                Implementation(phase=0)
                    └─(done)─► CodeReview(phase=0, cycle=0)
                                  ├─(APPROVED)──────────────► [next phase or AwaitingApproval]
                                  └─(NEEDS_CHANGES)─► CodeRevision(phase=0, cycle=0)
                                                          └─(done)─► CodeReview(phase=0, cycle=1)
                                                                         └─ … (up to CODE_REVIEW_LIMIT)
  … repeated for phase=1 … phase=N-1 …

AwaitingApproval
  ├─(approve)─► Complete
  ├─(cancel)──► Cancelled
  └─(revise)──► IterationReview(iteration=N)
                    ├─(APPROVED)──► AwaitingApproval (iteration+1)
                    └─(NEEDS_CHANGES)─► IterationRevision(iteration=N)
                                            └─(done)─► AwaitingApproval (iteration+1)

ErrorGate (wraps any failing state) ──(retry)──► failed state
                                    ──(cancel)─► Cancelled
```

---

## Requirements

### R1 — New workflow type
Add `WorkflowType::Implement` and the string token `"implement"` throughout the
codebase (types, session registry cancellation, MCP tool handler, `to_error_gate`,
`session_state()` dispatch, etc.).

### R2 — Phase extraction
When a session is created with `workflow_type = "implement"`, the `spec_start`
MCP handler reads the spec file path from `context_refs[0]` (or `topic` if it
looks like a file path), reads the spec content from disk, and runs the regex
extractor in-process (no subprocess) to build a `Vec<PhaseInfo>`.  If the spec
contains no detectable phases, synthesize a single phase `phase1_implementation`.

Four phase-table formats must be recognised (ported from the TypeScript reference):

| Priority | Format | Example |
|----------|--------|---------|
| 1 | Linked table | `\| Phase N \| Focus \| Effort \| [name](./path) \|` |
| 2 | Plain table | `\| Phase N \| Focus description \| Effort \|` |
| 3 | Typst table | `[Phase N], [Focus description], [Effort],` |
| 4 | Inline headers | `### Phase N: Name` |

Phase slugs are generated from the focus description: lowercase, strip
punctuation, drop stop-words, take first four meaningful words, join with `_`.
Maximum slug length: 30 characters.

### R3 — Configuring gate
After extraction, the session enters `Configuring`.  The `gate_content()` for
this state returns:

- `summary` — a human-readable list of extracted phases plus current model
  assignments.
- `artifact_path` — `Some(spec_path)` so the user can review the spec.
- `suggested_actions` — `["approve", "configure", "cancel"]`.

The user may respond:
- `approve` (no `content`) → accept default `ImplementModelConfig`.
- `approve` with `content` containing a JSON object → merge supplied fields into
  the default config.  Any unrecognised or missing keys are silently kept at
  their defaults.  Example: `{"planner":"opus","reviewer":"sonnet"}`.
- `cancel` → `Cancelled`.

### R4 — ImplementModelConfig
New struct (in `src/workflow/implement.rs`) with four fields and sane defaults:

```rust
pub struct ImplementModelConfig {
    pub planner:     String,   // default "sonnet"
    pub implementer: String,   // default "sonnet"
    pub reviewer:    String,   // default "haiku"
    pub reviser:     String,   // default "sonnet"
}
```

Model assignment per phase:

| Phase | Model field |
|-------|-------------|
| PlanGeneration | `planner` |
| PlanReview | `reviewer` |
| PlanRevision | `reviser` |
| Implementation | `implementer` |
| CodeReview | `reviewer` |
| CodeRevision | `reviser` |
| IterationReview | `reviewer` |
| IterationRevision | `reviser` |

### R5 — PhaseInfo struct
New struct representing one extracted phase:

```rust
pub struct PhaseInfo {
    pub number: u32,
    pub slug: String,          // filesystem-safe slug
    pub description: String,   // human-readable focus description
}
```

Phase plan files are written to a **temporary directory** created when the
session loop starts.  The `TempDir` is held in the runner's heap for the
lifetime of the session; plan paths are NOT stored in persisted state.
When the loop resumes after an `ErrorGate`, a new temp dir is created and the
planner re-generates any missing plan files.

### R6 — ImplementState enum
Full enum (serde `#[serde(tag = "phase")]`):

```rust
pub enum ImplementState {
    // Gate states
    Configuring {
        spec_path: PathBuf,
        phases: Vec<PhaseInfo>,
        model_config: ImplementModelConfig,
    },
    AwaitingApproval {
        spec_path: PathBuf,
        #[serde(default)]
        iteration: u32,
    },

    // Autonomous per-phase states
    PlanGeneration {
        spec_path: PathBuf,
        phases: Vec<PhaseInfo>,
        phase_idx: usize,
        model_config: ImplementModelConfig,
    },
    PlanReview {
        spec_path: PathBuf,
        phases: Vec<PhaseInfo>,
        phase_idx: usize,
        review_cycle: u32,
        model_config: ImplementModelConfig,
    },
    PlanRevision {
        spec_path: PathBuf,
        phases: Vec<PhaseInfo>,
        phase_idx: usize,
        review_cycle: u32,
        review_feedback: String,
        model_config: ImplementModelConfig,
    },
    Implementation {
        spec_path: PathBuf,
        phases: Vec<PhaseInfo>,
        phase_idx: usize,
        model_config: ImplementModelConfig,
        /// Most recent code-review feedback; None on first attempt
        #[serde(default, skip_serializing_if = "Option::is_none")]
        previous_code_review: Option<String>,
    },
    CodeReview {
        spec_path: PathBuf,
        phases: Vec<PhaseInfo>,
        phase_idx: usize,
        review_cycle: u32,
        model_config: ImplementModelConfig,
    },
    CodeRevision {
        spec_path: PathBuf,
        phases: Vec<PhaseInfo>,
        phase_idx: usize,
        review_cycle: u32,
        review_feedback: String,
        model_config: ImplementModelConfig,
    },

    // Post-approval iteration states
    IterationReview {
        spec_path: PathBuf,
        iteration: u32,
        user_feedback: String,
    },
    IterationRevision {
        spec_path: PathBuf,
        iteration: u32,
        review_output: String,
    },

    // Terminal / error
    Complete { spec_path: PathBuf },
    Cancelled,
    ErrorGate {
        message: String,
        failed_phase: String,
        exit_code: Option<i32>,
    },
}
```

### R7 — Review verdict protocol
Review agents (`PlanReview`, `CodeReview`, `IterationReview`) emit `RawPhaseOutput::Done`
where the `summary` field begins with one of two tokens:

- `APPROVED:` — review passed; the session runner advances to the next state.
- `NEEDS_CHANGES:` — review failed; the remainder of `summary` is the feedback
  used to construct the revision state.

The `run_implement_session()` loop inspects `summary.starts_with("APPROVED")`
(case-insensitive) after a `Done` output from any review phase.  Any other value
is treated as `NEEDS_CHANGES` (safe fallback).

### R8 — Review cycle limits
Two constants in `src/phase_runner.rs`:

```rust
pub const PLAN_REVIEW_LIMIT: u32 = 3;
pub const CODE_REVIEW_LIMIT: u32 = 3;
```

When `review_cycle >= PLAN_REVIEW_LIMIT` (or `CODE_REVIEW_LIMIT`), a
`NEEDS_CHANGES` verdict still triggers a revision, but the next review cycle's
prompt carries a note: "This is the final allowed review cycle; accept minor
issues that would require significant rework."

### R9 — PhaseContext fields for implement phases
The `PhaseContext` passed to `runner.run_phase()` is populated as follows for
each implement phase:

| Field | Value |
|-------|-------|
| `workflow_type` | `"implement"` |
| `phase` | variant name snake_case (e.g. `"plan_generation"`) |
| `sub_phase` | `Some("phase_N")` where N is 1-indexed `phase_idx+1` |
| `topic` | session `topic` (usually the spec path or description) |
| `prior_artifacts` | `[spec_path]` always; plus plan temp path when reviewing/revising |
| `context_refs` | session `context_refs` unchanged |
| `revision` | `review_cycle` for review/revision states; `0` otherwise |
| `revision_feedback` | `Some(review_feedback)` for revision states; `None` otherwise |
| `gate_history` | empty `vec![]` (history not tracked within implement loop) |

### R10 — Configuring gate response handling (apply_gate_response)
Add a new arm in `apply_gate_response()` for `workflow_type == "implement"` and
`ImplementState::Configuring`:

```
Approve { content: None }      → advance to PlanGeneration(phase_idx=0) with default model_config
Approve { content: Some(json) }→ merge json into model_config, then advance
Revise { .. }                  → ignored (Configuring does not accept revise)
Cancel                         → Cancelled
Retry                          → re-enter Configuring (no-op if already there)
```

### R11 — AwaitingApproval gate response handling
In `apply_gate_response()` for `ImplementState::AwaitingApproval`:

```
Approve              → Complete { spec_path }
Revise { feedback }  → IterationReview { iteration: current+1, user_feedback: feedback }
Cancel               → Cancelled
Retry                → Configuring (re-runs extraction — allows changing models)
```

### R12 — Session cancellation
In `SessionRegistry::cancel()`, add:

```rust
WorkflowType::Implement => WorkflowState::Implement(ImplementState::Cancelled),
```

### R13 — session_state() mapping
In `WorkflowState::session_state()` for `WorkflowState::Implement(s)`:

| ImplementState variant | SessionState |
|------------------------|--------------|
| PlanGeneration, PlanRevision, Implementation, CodeRevision, IterationRevision | Running |
| PlanReview, CodeReview, IterationReview | Running |
| Configuring, AwaitingApproval | WaitingAtGate |
| ErrorGate | ErrorGate |
| Complete | Complete |
| Cancelled | Cancelled |

All autonomous phases (including review phases) map to `Running` because they
execute without user input.

### R14 — MCP spec_start handler
Add `"implement"` to `parse_workflow_type()`.

In the `spec_start` handler, for `WorkflowType::Implement`:

1. Determine `spec_path` from `context_refs[0]` if provided and looks like a
   file path; otherwise treat `topic` as the path.
2. Read the file content from disk.  If the file does not exist, return an
   `McpError::invalid_params`.
3. Run in-process phase extraction → `Vec<PhaseInfo>`.
4. Create initial state `ImplementState::Configuring { spec_path, phases, model_config: Default::default() }`.
5. Register session, create watch channel, spawn `run_implement_session()`.

### R15 — Prompt keys and PromptStore
Add the following entries to `PromptStore::new()` and their corresponding
prompt constants:

| Key | Description |
|-----|-------------|
| `implement/plan_generation` | Planner agent — creates detailed plan file for a phase |
| `implement/plan_review` | Plan reviewer — outputs APPROVED/NEEDS_CHANGES verdict |
| `implement/plan_revision` | Plan reviser — addresses plan review feedback |
| `implement/implementation` | Implementer — writes code changes for a phase |
| `implement/code_review` | Code reviewer — outputs APPROVED/NEEDS_CHANGES verdict |
| `implement/code_revision` | Code reviser — addresses code review feedback |
| `implement/iteration_review` | Post-approval reviewer — broad sweep of implementation |
| `implement/iteration_revision` | Post-approval reviser — addresses iteration review |

Prompt texts are derived from the TypeScript `agents-config.ts` counterparts
(`planDrafter`, `planReviewer`, `implementer`, `codeReviewer`, `addressReview`)
with adaptations for the JSON stdin/stdout protocol used by all other prompts.
Review prompts must include the explicit instruction:

```
Output ONLY a JSON object: {"type":"done","summary":"APPROVED: <reason>","artifact_path":""}
or {"type":"done","summary":"NEEDS_CHANGES: <detailed feedback>","artifact_path":""}
```

### R16 — run_implement_session()
New async function in `src/phase_runner.rs`:

```rust
pub async fn run_implement_session(
    session_id: Uuid,
    registry: Arc<SessionRegistry>,
    runner: Arc<ClaudeRunner>,
    gate_channels: Arc<GateChannelMap>,
    model_config: ModelConfig,   // global defaults (unused; ImplementModelConfig takes priority)
    prompts: Arc<PromptStore>,
    notifier: SessionNotifier,
)
```

The function follows the same loop structure as existing session runners but
handles state transitions manually instead of delegating to the generic
`process_phase_output()`.  High-level loop logic:

```
loop {
    let (state_snapshot, context, model, prompt_key) = read_state_and_build_setup(session_id, registry);
    match state_snapshot {
        Configuring | AwaitingApproval | ErrorGate | Complete | Cancelled => return,  // gate / terminal
        _ => {}  // autonomous — proceed to run_phase
    }

    match run_phase_and_process_implement(session_id, &registry, &runner, &gate_channels,
                                          &prompts, setup, &notifier).await {
        LoopAction::Continue => continue,
        LoopAction::Break => break,
    }
}
```

`run_phase_and_process_implement()` is a private function that:
1. Calls `runner.run_phase()` (same as existing phases).
2. On `Ok(result)` → calls `process_implement_output()` which contains all
   state-transition logic (see §R17).
3. On `Err(err)` → transitions to `ImplementState::ErrorGate`, notifies,
   awaits gate response, applies `apply_gate_response`.

### R17 — process_implement_output() state transitions
State transition table for `process_implement_output()`:

| Current state | Output | → Next state |
|---------------|--------|--------------|
| PlanGeneration(idx) | Done(_) | PlanReview(idx, cycle=0) |
| PlanGeneration(idx) | Continue | PlanGeneration(idx) (turn++) |
| PlanReview(idx, c) | Done(APPROVED) | Implementation(idx, prev_review=None) |
| PlanReview(idx, c) | Done(NEEDS_CHANGES: fb) | PlanRevision(idx, cycle=c, feedback=fb) |
| PlanRevision(idx, c) | Done(_) | PlanReview(idx, cycle=c+1) |
| PlanRevision(idx, c) | Continue | PlanRevision(idx, c) (turn++) |
| Implementation(idx) | Done(_) | CodeReview(idx, cycle=0) |
| Implementation(idx) | Continue | Implementation(idx) |
| CodeReview(idx, c) | Done(APPROVED) | PlanGeneration(idx+1) if idx+1 < phases.len(); else AwaitingApproval(iteration=0) |
| CodeReview(idx, c) | Done(NEEDS_CHANGES: fb) | CodeRevision(idx, cycle=c, feedback=fb) |
| CodeRevision(idx, c) | Done(_) | CodeReview(idx, cycle=c+1) |
| CodeRevision(idx, c) | Continue | CodeRevision(idx, c) |
| IterationReview(n) | Done(APPROVED) | AwaitingApproval(iteration=n) |
| IterationReview(n) | Done(NEEDS_CHANGES: fb) | IterationRevision(n, review_output=fb) |
| IterationRevision(n) | Done(_) | AwaitingApproval(iteration=n) |
| IterationRevision(n) | Continue | IterationRevision(n) |
| any | Gate { question } | ErrorGate(message="unexpected Gate from …") |

All `Done` transitions include `cost_usd` accumulation via `registry.update()`.

### R18 — WorkflowState extension
In `src/workflow/mod.rs`:

1. Add `Implement(ImplementState)` to `WorkflowState`.
2. Implement `WorkflowPhase` and `HasGate` for `ImplementState`.
3. Add `WorkflowState::Implement` arms to `session_state()`, `phase_name()`,
   `sub_phase_name()`, `phase_role()`, `artifact_paths()`, `gate_content()`,
   `is_error_gate()`, `to_error_gate()`.

`phase_role()` for implement states (used only for logging/display; actual model
selection uses `ImplementModelConfig`):

| State | PhaseRole |
|-------|-----------|
| PlanGeneration, PlanRevision, Implementation, CodeRevision, IterationRevision | Synthesis |
| PlanReview, CodeReview, IterationReview | Review |
| Configuring, AwaitingApproval | Review |
| Complete, Cancelled, ErrorGate | Review |

### R19 — gate_content() for ImplementState

**Configuring gate:**
```
summary:           "Ready to implement: <N> phases extracted.\n\n<phase list>\n\nModel assignments:\n  planner: <model>\n  implementer: <model>\n  reviewer: <model>\n  reviser: <model>\n\nApprove to start with these defaults, or pass a JSON object in `content` to override any model."
artifact_path:     Some(spec_path)
suggested_actions: ["approve", "cancel"]
```

**AwaitingApproval gate:**
```
summary:           "All <N> phases implemented (iteration <M>). Review the changes and approve or request further review."
artifact_path:     Some(spec_path)
suggested_actions: ["approve", "revise", "cancel"] (revise suppressed if iteration >= FEEDBACK_DEPTH_LIMIT)
```

**ErrorGate:**
```
summary:           "Error in <failed_phase>: <message>"
artifact_path:     None
suggested_actions: ["retry", "cancel"]
```

### R20 — artifact_paths() for ImplementState
Returns `[spec_path]` for all non-terminal states.
Returns `[spec_path]` for `Complete`.
Returns `[]` for `Cancelled` and `ErrorGate`.

### R21 — sub_phase_name() for ImplementState
Returns `Some("phase_N")` (1-indexed) when `phase_idx` is available, otherwise
`None`.  Examples: `"phase_1"`, `"phase_2"`, etc.

### R22 — notifier progress reporting
In `notifier.rs` (or `phase_runner.rs`), extend `progress_for()` to handle
`workflow_type == "implement"`:

```
progress = phase_idx * STEPS_PER_PHASE + step_within_phase
total    = phases.len() * STEPS_PER_PHASE
```

where `STEPS_PER_PHASE = 4` (plan, plan-review, implement, code-review).
This allows progress bars to track per-phase advancement.

---

## Design

### File layout

```
src/
  workflow/
    mod.rs          — add Implement arm everywhere (R18)
    types.rs        — add WorkflowType::Implement, PhaseRole stays unchanged
    implement.rs    — NEW: ImplementState, ImplementModelConfig, PhaseInfo,
                          phase extraction fn, WorkflowPhase impl, HasGate impl
  phase_runner.rs   — add run_implement_session(), process_implement_output(),
                      PLAN_REVIEW_LIMIT, CODE_REVIEW_LIMIT, extend apply_gate_response()
  prompts.rs        — add 8 new prompt constants + PromptStore registration
  session.rs        — add Implement arm in cancel()
  mcp/mod.rs        — add "implement" parsing + spec_start arm
```

### Phase extraction algorithm

```rust
/// Extract implementation phases from spec content.
/// Returns a Vec<PhaseInfo> in phase-number order.
pub fn extract_phases(content: &str) -> Vec<PhaseInfo> {
    // Try format 1: linked table  | Phase N | ... | [name](path) |
    // Try format 2: plain table   | Phase N | Focus | Effort |
    // Try format 3: Typst         [Phase N], [Focus], [Effort],
    // Try format 4: inline header ### Phase N: Name
    // Fallback: single phase      PhaseInfo { number: 1, slug: "implementation", description: "" }
}

fn slugify(description: &str) -> String {
    // lowercase → strip non-alnum-space → split → drop stop-words + len<=1
    // → take first 4 → join "_" → truncate to 30
}
```

Stop words: `{"a","an","the","and","or","for","of","in","on","to","with","is","are","be","its","this","that","from","by","at"}`.

### ImplementModelConfig parsing from gate response

```rust
impl ImplementModelConfig {
    pub fn apply_overrides(&mut self, json_str: &str) {
        if let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(json_str) {
            if let Some(v) = map.get("planner").and_then(|v| v.as_str()) {
                self.planner = v.to_string();
            }
            // … repeat for implementer, reviewer, reviser
        }
    }
}
```

### Plan temp-file management

Plan files must NOT be committed to the repository.  The runner creates a
`tempfile::TempDir` at the start of each session loop invocation.  The temp
dir's path is passed into `build_plan_context()` helper:

```rust
fn plan_tmp_path(tmp_dir: &Path, phases: &[PhaseInfo], phase_idx: usize) -> PathBuf {
    tmp_dir.join(format!("phase{}_{}.md", phases[phase_idx].number, phases[phase_idx].slug))
}
```

Plan paths are reconstructed from state on each loop iteration; they do not need
to be serialised.

### prior_artifacts construction per phase

| State | prior_artifacts |
|-------|----------------|
| PlanGeneration | `[spec_path]` |
| PlanReview | `[spec_path, plan_tmp_path]` |
| PlanRevision | `[spec_path, plan_tmp_path]` |
| Implementation | `[spec_path, plan_tmp_path]` |
| CodeReview | `[spec_path, plan_tmp_path]` |
| CodeRevision | `[spec_path, plan_tmp_path]` |
| IterationReview | `[spec_path]` |
| IterationRevision | `[spec_path]` |

### Interaction with the existing generic run_phase_and_process()
`run_implement_session()` does **not** use `run_phase_and_process()`.  It has its
own loop and calls `runner.run_phase()` directly.  This avoids coupling to the
generic state-transition logic, which does not fit the multi-phase implement
workflow.

Error handling in `run_implement_session()` mirrors the existing pattern:
- On `RunnerError`, capture phase name and exit code.
- `registry.update()` → `ImplementState::ErrorGate { message, failed_phase, exit_code }`.
- `notify_current_state()`, then `await_gate_response()`.
- If `GateResponse::Retry` → re-enter the same failed state and `LoopAction::Continue`.
- If `GateResponse::Cancel` → `ImplementState::Cancelled`, `LoopAction::Break`.

---

## Implementation Notes

### 1. Add WorkflowType::Implement

`src/workflow/types.rs` — add variant and `Display` arm:
```rust
pub enum WorkflowType { Brainstorm, Spec, Epic, Implement }

impl Display for WorkflowType {
    fn fmt(...) { match self { Self::Implement => write!(f, "implement"), ... } }
}
```

### 2. Create src/workflow/implement.rs

Declare `PhaseInfo`, `ImplementModelConfig`, `ImplementState`.
Implement:
- `WorkflowPhase` trait (phase_name, sub_phase_name, phase_role, artifact_paths)
- `HasGate` trait (gate_content, is_error_gate)
- `extract_phases(content: &str) -> Vec<PhaseInfo>`
- `slugify(description: &str) -> String`

### 3. Update src/workflow/mod.rs

- `pub mod implement;`
- `pub use implement::ImplementState;`
- Re-export `ImplementModelConfig`, `PhaseInfo` if needed externally.
- Add `WorkflowState::Implement(ImplementState)` variant.
- Add all `match self` arms for the new variant across every `WorkflowState`
  method: `workflow_type()`, `session_state()`, `phase_name()`, `sub_phase_name()`,
  `phase_role()`, `artifact_paths()`, `gate_content()`, `is_error_gate()`,
  `to_error_gate()`.

`to_error_gate()` for Implement:
```rust
Self::Implement(s) => {
    let phase = s.phase_name().to_string();
    Self::Implement(ImplementState::ErrorGate {
        message: "Session interrupted; recovered after restart.".to_string(),
        failed_phase: phase,
        exit_code: None,
    })
}
```

### 4. Update src/session.rs

In `SessionRegistry::cancel()`:
```rust
WorkflowType::Implement => {
    WorkflowState::Implement(crate::workflow::ImplementState::Cancelled)
}
```

### 5. Update src/mcp/mod.rs

**parse_workflow_type():**
```rust
"implement" => Ok(WorkflowType::Implement),
```

**spec_start handler:**
```rust
WorkflowType::Implement => {
    // Determine spec_path
    let spec_path_str = params.context_refs
        .as_ref()
        .and_then(|refs| refs.first())
        .cloned()
        .unwrap_or_else(|| params.topic.clone());
    let spec_path = PathBuf::from(&spec_path_str);
    let spec_content = std::fs::read_to_string(&spec_path)
        .map_err(|e| McpError::invalid_params(format!("Cannot read spec: {e}"), None))?;
    let phases = crate::workflow::implement::extract_phases(&spec_content);
    WorkflowState::Implement(ImplementState::Configuring {
        spec_path,
        phases,
        model_config: ImplementModelConfig::default(),
    })
}
```

**spawn_session_loop():**
```rust
WorkflowType::Implement => {
    tokio::spawn(async move {
        phase_runner::run_implement_session(
            session_id, registry, runner, gate_channels,
            model_config, prompts, notifier,
        ).await;
    });
}
```

**Important:** The initial Configuring state is a gate, so the spawned loop
will immediately return (the loop exits on terminal/gate states).  The first
real work begins after the user calls `spec_respond` with `"approve"`.

### 6. Update src/phase_runner.rs

Add:
- `pub const PLAN_REVIEW_LIMIT: u32 = 3;`
- `pub const CODE_REVIEW_LIMIT: u32 = 3;`
- `pub async fn run_implement_session(…)`
- `async fn process_implement_output(…) -> InternalAction` (private)
- Arm in `apply_gate_response()` for `"implement"` workflow type.
- Arm in `process_phase_output()` dispatch (or call it directly without the
  generic dispatcher; the latter is simpler).

**apply_gate_response() for implement:**
```rust
"implement" => apply_implement_gate_response(session_id, response, registry, notifier).await,
```

`apply_implement_gate_response()` reads current `ImplementState`, matches on it:
```
Configuring { phases, model_config, spec_path }:
    Approve { content }     → merge content into model_config → PlanGeneration(idx=0)
    Cancel                  → Cancelled → return false
    Retry                   → no-op (already Configuring) → return true
    Revise                  → no-op (ignored) → return true

AwaitingApproval { spec_path, iteration }:
    Approve                 → Complete { spec_path } → return false
    Revise { feedback }     → IterationReview { iteration: iteration+1, user_feedback: feedback }
    Cancel                  → Cancelled → return false
    Retry                   → Configuring (re-extract phases)  [resets fully]

ErrorGate { .. }:
    Retry  → restore previous running state (use the `failed_phase` field to
             determine which phase to re-enter; see §Error Recovery note)
    Cancel → Cancelled → return false
```

### 7. Update src/prompts.rs

Eight new `const` prompt strings (inline `r#"…"#`) for the keys listed in R15.
Each prompt follows the same stdin/stdout JSON protocol as existing prompts.
Review prompts explicitly instruct the agent to emit:
```
{"type":"done","summary":"APPROVED: <brief reason>","artifact_path":""}
or
{"type":"done","summary":"NEEDS_CHANGES: <detailed feedback with file paths and line numbers>","artifact_path":""}
```

### Error Recovery Note
`ErrorGate::failed_phase` stores the `phase_name()` string of the state that
failed (e.g. `"plan_generation"`, `"code_review"`).  On retry, `apply_implement_gate_response()`
must reconstruct the pre-error state.  Because phase-level context (`phases`,
`phase_idx`, `model_config`) is stored in adjacent state variants, the simplest
approach is to store a `pre_error_state` snapshot directly in `ErrorGate`:

```rust
ErrorGate {
    message: String,
    failed_phase: String,
    exit_code: Option<i32>,
    /// Snapshot of the state that failed, used to reconstruct on retry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    retry_state: Option<Box<ImplementState>>,
}
```

On retry: `session.workflow_state = WorkflowState::Implement(*retry_state)`.
If `retry_state` is `None` (legacy recovery), fall back to `Configuring`.

---

## Open Questions

1. **Model name validation** — should `apply_overrides()` validate that the
   supplied model strings are in a known set, or accept any string and let the
   subprocess fail with an `ErrorGate`?  Failing fast gives a better UX.

2. **Plan file persistence across ErrorGate** — currently plan files live in a
   tempdir and are lost on process restart.  Should we serialise the generated
   plan content into the state itself (expensive) or re-generate the plan on
   retry (simpler but costs tokens)?  The current design chooses re-generation.

3. **IterationReview scope** — should `IterationReview` receive the full
   implementation diff as `prior_artifacts`, or only the spec path?  Including
   a diff would require git integration.  For now it receives `[spec_path]`
   and reviews the working tree directly.

4. **Progress reporting granularity** — `STEPS_PER_PHASE = 4` ignores revision
   cycles.  Is approximate progress (ignoring review loops) good enough, or do
   we want to compute over `review_cycle` counts too?

5. **`spec_start` topic vs context_refs ambiguity** — the convention for other
   workflow types is that `topic` is a description string and `context_refs` is
   a list of file paths.  For `implement`, the spec file path must be provided.
   Should it always go in `context_refs[0]`, or should we accept it in `topic`
   when it looks like a path?  The spec currently accepts either, but a stricter
   convention would simplify the MCP tool description.

6. **Test command integration** — the TypeScript reference supports a
   `testCommand` that the implementer runs after each phase.  Should this be
   passed via `context_refs`, the session `topic`, or a new `spec_start` param?

7. **Commit integration** — the TypeScript reference creates git commits after
   each plan and implementation step.  The Rust server has no git integration.
   Should that be added (as a separate story), or omitted for v1?
