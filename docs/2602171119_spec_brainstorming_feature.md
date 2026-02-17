# Spec: `/brainstorm` Command for Idea Exploration

**Status**: Draft  
**Created**: 2026-02-17  
**Timestamp**: 2602171119

## Problem Statement

The spec-pipeline extension currently supports structured planning workflows (`/spec`, `/roadmap`, `/epic`) and a scope-assessment tool (`/plan`). However, there is no lightweight entry point for **open-ended idea exploration** — a conversational session where the user and LLM can think through a problem together before committing to any planning level.

**Current state**: Users who want to brainstorm an idea before writing a spec must either start a `/spec` discovery session (which is assumption-oriented and convergent) or reason through the problem outside the tool entirely.

**Key issues**:
1. The `discoveryAgent` mode in `/spec` is designed to *converge* on requirements, not *diverge* into possibilities — it proposes one assumption at a time expecting confirmation, which is the wrong mode for early-stage exploration.
2. There is no pipeline that produces a lightweight exploratory document suitable as input to `/spec`, `/epic`, or `/roadmap`.
3. Users lack a way to capture raw ideation in the same document store as their specs and plans.

---

## Requirements

### R1: New `/brainstorm` command

Add a `/brainstorm <description>` command to the spec-pipeline extension. It must:
- Accept a free-form description (required)
- Reject invocation when another pipeline mode is already active (spec, hierarchy, implement, scoping, or a prior brainstorm)
- Load the project config (`loadPipelineConfig`) to resolve `specsDir` and git settings
- Prompt the user for a short name (same `promptForShortName` helper as other pipelines)
- Create a `BrainstormState` and persist it to `.pi/spec-pipeline/brainstorms/<id>.json`
- Enter `"brainstorm"` pipeline mode and inject the `brainstormAgent` system prompt via `before_agent_start`
- Send an initial `pi.sendUserMessage()` to kick off the brainstorming session
- Update the pipeline widget to show brainstorm mode and exchange count

### R2: Single-phase conversational pipeline

The brainstorm pipeline has **one conversational phase** (no discovery → drafting split). The LLM acts as a thought partner throughout:
- It explores the codebase to understand context and constraints
- It proposes multiple directions, surfaces tradeoffs, and asks open-ended questions
- The conversation continues until the user types `/brainstorm-done`
- No mode transition occurs during the session — it stays in `"brainstorm"` mode from start to finish

### R3: `/brainstorm-done` command

When invoked:
1. Validate that a brainstorm session is active (error if not)
2. Send `pi.sendUserMessage()` instructing the LLM to synthesize the conversation into the brainstorm document and write it to `docPath`
3. After the LLM writes the file, validate the file exists and is non-empty
4. Create a git commit scoped to the brainstorm file (using `createAgentCommit` with a new `"brainstormAgent"` role)
5. Display a success notification with the file path
6. Exit brainstorm mode (call `exitMode()`) and clear the widget — **no approval dialog**

### R4: Brainstorm document format

The LLM must produce a Markdown document with this structure:

```markdown
# Brainstorm: <title>

**Status**: Draft  
**Created**: YYYY-MM-DD  
**Timestamp**: <YYMMDDhhmm>

## Problem / Opportunity
[What problem are we solving or opportunity are we exploring?]

## Context & Background
[What's the current state? What's already in place? Relevant constraints.]

## Proposed Directions
[Each direction explored during the conversation, with tradeoffs]

- **Option A: <name>**
  - Description: ...
  - Pros: ...
  - Cons: ...

- **Option B: <name>**
  - ...

## Out of Scope
[What this brainstorm explicitly does NOT cover]

## Open Questions
[Unresolved decisions that need answering before proceeding]

## Rough Scope Assessment
[A rough sense of size: feature, epic, or roadmap-level effort — and why]
```

### R5: File storage and naming

- **Document file**: stored in `specsDir` (same directory as specs, roadmaps, epics), named `<timestamp>_brainstorm_<shortname>.<format>` (e.g., `2602171000_brainstorm_billing_redesign.md`)
- **Pipeline state**: stored in `.pi/spec-pipeline/brainstorms/<id>.json`
- The format follows `projectConfig.specFormat` (defaults to `"md"`)

### R6: New `BrainstormState` type in `types.ts`

```typescript
export interface BrainstormState {
  id: string;
  description: string;
  stage: BrainstormStage;   // "brainstorming" | "completed" | "cancelled"
  createdAt: string;
  updatedAt: string;
  stageBeforeCancellation?: BrainstormStage;

  // Document details
  docTimestamp: string;     // YYMMDDhhmm format
  docFilename: string;      // e.g. "2602171119_brainstorm_billing_redesign.md"
  docPath: string;          // relative path to document
  docContent: string;       // written at completion

  // Conversation history
  conversationHistory: ConversationalExchange[];

  // Git state
  checkpoints?: string[];

  // Error tracking
  lastError?: string;
}

export type BrainstormStage = "brainstorming" | "completed" | "cancelled";
export const BRAINSTORM_STATE_DIR = ".pi/spec-pipeline/brainstorms";
```

### R7: Extend `PipelineMode` and `activePipelineKind`

- Add `"brainstorm"` to the `PipelineMode` union in `types.ts`: `"idle" | "scoping" | "discovery" | "drafting" | "brainstorm"`
- Add `"brainstorm"` to the `activePipelineKind` union in `index.ts`: `"spec" | "hierarchy" | "implement" | "brainstorm" | null`
- Add `enterBrainstormMode()` helper in `index.ts` (parallel to `enterSpecMode`, `enterHierarchyMode`, `enterScopingMode`)
- Add `getActiveBrainstormState()` helper in `index.ts`

### R8: New `brainstormAgent` system prompt in `agents-config.ts`

A new system prompt (alongside `discoveryAgent`, `scopingAgent`, etc.) with thought-partner style behavior:
- Explores the codebase freely to understand context
- Proposes multiple directions and angles simultaneously (not one assumption at a time)
- Asks open-ended questions to uncover angles the user hasn't considered
- Does **not** converge prematurely — encourages exploration
- Tells the user to type `/brainstorm-done` when ready to capture the ideas
- Knows the output format (the six sections from R4) so it can synthesize correctly at `/brainstorm-done`

### R9: Wire `before_agent_start` event handler for brainstorm mode

Extend the existing `before_agent_start` handler in `index.ts` to inject the `brainstormAgent` prompt when `pipelineMode === "brainstorm"`. The injected context should include:
- The full `brainstormAgent` system prompt
- The description
- Previous conversation exchanges (if resuming)
- The target file path
- A `customType: "spec-brainstorm-context"` message (filtered by the `context` event handler when not in brainstorm mode)

### R10: Wire `agent_end` event handler for brainstorm mode

Extend the existing `agent_end` handler to append conversation exchanges to `BrainstormState.conversationHistory` and persist state when `pipelineMode === "brainstorm"`.

### R11: Companion commands

| Command | Behavior |
|---------|----------|
| `/brainstorm-status` | Show status of the latest active brainstorm session (stage, exchanges, file path) |
| `/brainstorm-list` | List all brainstorm pipelines (id, description, stage, created) |
| `/brainstorm-cancel` | Cancel the active brainstorm session; mark stage as `"cancelled"` |

### R12: State CRUD functions in `state.ts`

Add the following functions (parallel to existing roadmap/epic state functions):
- `getBrainstormStateDir(cwd)` — returns path to `.pi/spec-pipeline/brainstorms/`
- `getBrainstormStatePath(cwd, id)` — returns path to specific state file
- `loadBrainstormState(cwd, id)` — loads and parses state JSON
- `saveBrainstormState(cwd, state)` — writes state JSON (creates directory if needed)
- `listBrainstormStates(cwd)` — returns all brainstorm states sorted by `createdAt` descending
- `getLatestActiveBrainstormPipeline(cwd)` — returns the most recent non-cancelled/completed state
- `createInitialBrainstormState(description, timestamp, shortName, specsDir, specFormat)` — creates a fresh state

### R13: Widget display for brainstorm mode

Show a widget during the brainstorm session:

```
🧠 Brainstorm Mode
────────────────────────────────────
Exchanges: <n>

Chat freely to explore ideas.
Type /brainstorm-done when ready.
```

### R14: `"brainstormAgent"` role for commit messages

Add `"brainstormAgent"` as a recognized role in `commit-agent.ts` so that `createAgentCommit` generates an appropriate commit message (e.g., `docs(brainstorm): capture billing redesign brainstorm`).

---

## Success Criteria

- [ ] `/brainstorm "Redesign the billing system"` starts a brainstorm session, creates state in `.pi/spec-pipeline/brainstorms/`, and enters brainstorm pipeline mode
- [ ] The LLM receives the `brainstormAgent` system prompt (thought-partner style, not assumption-by-assumption)
- [ ] The widget shows brainstorm mode with exchange count, updating after each turn
- [ ] `/brainstorm-done` sends a synthesis message to the LLM, which writes the document to `specsDir/<timestamp>_brainstorm_<name>.md`
- [ ] The written document contains all six sections (Problem/Opportunity, Context & Background, Proposed Directions, Out of Scope, Open Questions, Rough Scope Assessment)
- [ ] After document write, a git commit is created scoped to the brainstorm file
- [ ] No approval dialog is shown — the pipeline completes immediately after commit
- [ ] `/brainstorm-status` shows the active session's state
- [ ] `/brainstorm-list` lists all brainstorm sessions
- [ ] `/brainstorm-cancel` cancels the active session without writing a file
- [ ] Starting `/brainstorm` while another pipeline mode is active shows a clear error
- [ ] All conversation exchanges are persisted to state after each turn
- [ ] Existing pipelines (`/spec`, `/roadmap`, `/epic`, `/plan`, `/implement`) are unaffected
- [ ] The `context` event handler filters `"spec-brainstorm-context"` messages correctly (present only in brainstorm mode)

---

## Out of Scope

- Resume (`/brainstorm-resume`) — not included in this iteration; the session is ephemeral enough that restart is acceptable
- Linking brainstorm documents to downstream pipelines (e.g., passing brainstorm file as context to `/spec`) — the user can reference the file manually
- AI review of the brainstorm document — it is exploratory output, not a technical commitment
- `--quick` flag — brainstorm has no phases to skip
- Multi-brainstorm sessions running concurrently

---

## Open Questions

- ~~Should the command be `/brainstorm` or `/rfc`?~~ → `/brainstorm`
- ~~Should it have a discovery → drafting split?~~ → No, single phase
- ~~Should there be an approval dialog at the end?~~ → No
- Should `/brainstorm-done` wait for the LLM to finish writing before committing, or should the commit be triggered by a file-existence check? (Current assumption: file-existence check after LLM turn completes, same pattern as `/spec-draft-done`)
- Should the `brainstormAgent` prompt explicitly list the six output sections so the LLM knows what to produce at synthesis time? (Recommended: yes, include the template in the prompt)

---

## Rough Scope Assessment

This is a **feature-level** effort. It follows well-established patterns in the codebase and does not require architectural changes. The work is:

- **New type definitions** in `types.ts`: ~30 lines
- **New state CRUD functions** in `state.ts`: ~80 lines (copy-adapt from epic pattern)
- **New `brainstormAgent` system prompt** in `agents-config.ts`: ~40 lines
- **New commit role** in `commit-agent.ts`: ~5 lines
- **New command handlers and mode helpers** in `index.ts`: ~200 lines
- **Widget and event handler extensions** in `index.ts`: ~30 lines (extend existing handlers)

**Estimated total**: 2–3 days of implementation work.

---

## High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Type system and state management (`types.ts`, `state.ts`) | 0.5 days |
| Phase 2 | `brainstormAgent` system prompt and commit role (`agents-config.ts`, `commit-agent.ts`) | 0.5 days |
| Phase 3 | Command handlers, mode helpers, and event handler extensions (`index.ts`) | 1.5 days |

## High-Level Guidance

- **Follow the `ScopingState` / ephemeral pattern** for the brainstorm state structure in `index.ts` — but unlike scoping, brainstorm state IS persisted to disk (it produces an output file)
- **Follow the `RoadmapState` / `EpicState` CRUD pattern** in `state.ts` for the new brainstorm state functions — the pattern is nearly identical
- **`/brainstorm-done` flow** should mirror the end of `endSpecDrafting()` but without the `ctx.ui.select()` approval step and without reading the file into `state.specDraft` — just validate existence, commit, notify, and exit
- **`before_agent_start`** injection for brainstorm mode should be a new `else if` branch in the existing handler, producing `customType: "spec-brainstorm-context"`
- **`context` event handler** must add `"spec-brainstorm-context"` to the filter map (return true only when `pipelineMode === "brainstorm"`)
- The `brainstormAgent` prompt should explicitly include the six-section output template so the LLM knows exactly what to produce when `/brainstorm-done` triggers synthesis
