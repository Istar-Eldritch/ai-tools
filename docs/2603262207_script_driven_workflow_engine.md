# Script-Driven Workflow Engine for Spec Pipeline Skills

**Status**: Draft
**Created**: 2026-03-26
**Timestamp**: 2603262207

---

## PART I: Requirements

### Problem Statement

The spec pipeline skills (brainstorm, spec, implement) rely on 200-400 line SKILL.md files that the LLM re-reads and re-interprets on every invocation. Workflow orchestration -- stage sequencing, state management, context assembly, agent prompt construction, transition detection -- is encoded as prose instructions. This produces three concrete failure modes:

1. **Non-deterministic execution**: The same workflow can skip steps, miss state saves, or assemble prompts differently depending on how the LLM interprets the prose on a given run.
2. **Duplication**: Shared patterns (review loop, commit protocol, discovery exchange) are copied across SKILL.md files rather than defined once.
3. **Fragile resume**: Resuming a pipeline requires the LLM to re-read the full SKILL.md, locate the current stage, and reconstruct what to do next -- a process that regularly drops context.

The existing shell scripts (`config.sh`, `state.sh`, `parse.sh`, `git-helpers.sh`) demonstrate that deterministic operations extracted into code execute reliably. The workflow engine extends this pattern to cover orchestration itself: the engine decides what happens next, and the LLM executes the engine's instructions.

### Requirements

**R1: Instruction Protocol**
The engine communicates with the host LLM via typed JSON instructions. Each instruction specifies exactly one action for the LLM to perform, plus a `then` field that chains the next engine call. The LLM executes the action, captures the result, and calls `then` with that result. The set of instruction types is fixed and small enough to document in a single protocol block in CORE.md.

**R2: Declarative Workflow Definitions**
Each skill's workflow (brainstorm, spec, implement) is defined as a JSON file listing stages, their types, transition rules, skip conditions, and variants. The engine loads the workflow definition and walks it deterministically. Adding a new skill means adding a JSON file and prompt templates -- no engine code changes required for standard stage types.

**R3: Engine CLI Interface**
The engine is a Python CLI (`engine.py`) that accepts commands like `engine.py spec start "description" --quick` or `engine.py spec next --id <id> --input "user response"`. Every call reads state from disk, computes the next instruction, saves state, and prints the instruction as JSON to stdout. The engine is stateless between calls -- all state lives on disk.

**R4: Context Assembly from Templates**
Agent prompts are `.md` template files with variables (`{project_context}`, `{description}`, `{exchange_history}`, etc.). The engine fills variables from state, config, and disk (reading context files). This replaces prompt assembly scattered across SKILL.md prose with a single deterministic rendering step.

**R5: Backward-Compatible State Management**
State files remain JSON in `.claude/spec-pipeline/`. The engine reads and writes state using the same directory structure and file format as today. Existing state files from in-progress pipelines must remain loadable. New fields may be added but no existing fields are removed or renamed.

**R6: SKILL.md Dispatcher Protocol**
Each SKILL.md shrinks to frontmatter (for slash command registration) plus a short shared protocol body: parse the command and flags, call the engine, execute the returned instruction, repeat until `done`. The instruction execution mapping is documented once in CORE.md.

**R7: Gradual Migration**
Engine-driven and prose-driven skills coexist. Migration happens one skill at a time (brainstorm first, then spec, then implement). At any point, some skills use the engine while others still use prose SKILL.md files. Shared shell scripts remain available throughout.

**R8: Python Stdlib Only**
The engine uses Python 3.x standard library only. No pip packages, no virtual environments, no external dependencies beyond Python itself and the existing shell scripts.

### Success Criteria

- S1: Running `/brainstorm "topic"` through the engine produces the same outputs (state files, synthesis document, git commit) as the current prose-driven flow.
- S2: `/spec-resume` on an in-progress spec created before the engine migration loads state and continues correctly.
- S3: The brainstorm SKILL.md body is under 30 lines (currently ~180).
- S4: Adding a hypothetical new skill (e.g., "review") requires only a workflow JSON file, prompt templates, and a thin SKILL.md -- no changes to engine Python code.
- S5: All instruction types are documented with JSON schemas in CORE.md.

### Out of Scope

- Rewriting `git-helpers.sh` in Python. Git operations stay as bash.
- Changing the `.claude/spec-pipeline.json` config format.
- Parallel instruction execution (batch instructions). The engine emits one instruction at a time. Batching is a future optimization.
- UI/UX changes to the Claude Code command palette or slash command registration.
- Automated end-to-end testing framework. Validation is manual during migration.
- Absorbing `config.sh` and `state.sh` into Python during this spec's scope. The engine calls them via subprocess initially; absorption happens in a future pass.

### Open Questions

- **Q1: Conversation quality under stateless agent calls.** Will brainstorming feel mechanical when each exchange is a fresh agent call with reconstructed context? This must be validated empirically during brainstorm migration. Mitigation: if quality degrades, the engine can emit a single `ask_user` with prior context embedded, letting the LLM hold the full conversation without agent delegation.
- **Q2: Intent classification accuracy.** The haiku-based intent classifier for transition detection (CONTINUE vs TRANSITION) may misclassify ambiguous user responses. Mitigation: the engine can apply heuristics (minimum exchange count, explicit `/done` command) as a fallback alongside the classifier.

---

## PART II: High-Level Implementation Plan

### Architecture Overview

```
Host LLM (Claude Code)
    │
    │  1. User types /spec "add auth"
    │  2. LLM reads thin SKILL.md, calls engine
    │  3. Engine returns JSON instruction
    │  4. LLM executes instruction (agent call, ask user, write file, etc.)
    │  5. LLM calls engine.then with result
    │  6. Repeat 3-5 until engine returns "done"
    │
    ▼
engine.py CLI
    ├── Reads workflow definition (JSON)
    ├── Reads/writes state (.claude/spec-pipeline/)
    ├── Reads config (via config.sh subprocess)
    ├── Renders prompt templates (.md files)
    └── Returns one JSON instruction per call

File Layout:
skills/spec-pipeline-core/
├── engine.py                  # CLI entry point
├── engine/
│   ├── __init__.py
│   ├── runner.py              # Workflow runner: load definition, advance state, emit instruction
│   ├── stages.py              # Stage type handlers (conversation, agent, approval, review, commit, loop)
│   ├── context.py             # Template rendering + context assembly
│   ├── state.py               # State read/write (JSON files in .claude/spec-pipeline/)
│   ├── config.py              # Config loading (wraps config.sh initially)
│   └── instructions.py        # Instruction dataclasses and JSON serialization
├── workflows/
│   ├── brainstorm.json
│   ├── spec.json
│   └── implement.json
├── prompts/
│   ├── discovery.md
│   ├── brainstorm_agent.md
│   ├── spec_drafter.md
│   ├── plan_drafter.md
│   ├── plan_reviewer.md
│   ├── implementer.md
│   ├── code_reviewer.md
│   ├── address_review.md
│   ├── commit_message.md
│   └── intent_classifier.md
├── git-helpers.sh             # Unchanged
├── config.sh                  # Unchanged (called via subprocess)
├── state.sh                   # Unchanged (called via subprocess)
└── parse.sh                   # Unchanged (called via subprocess)
```

### Instruction Protocol

The engine returns exactly one JSON object per call. Every instruction has this envelope:

```json
{
  "action": "<instruction_type>",
  "then": "engine.py <skill> <next-command> --id <id> [--result-arg <placeholder>]",
  ...action-specific fields...
}
```

The `then` field tells the LLM what engine command to call next, with a placeholder for the result of the current action. The LLM substitutes the actual result and calls the command.

#### Instruction Types

**`call_agent`** -- Delegate work to an LLM agent.
```json
{
  "action": "call_agent",
  "model": "opus | sonnet | haiku",
  "prompt": "Full agent prompt with all context filled in",
  "then": "engine.py spec agent-done --id 260326... --output"
}
```
The LLM spawns an Agent tool call with the given model and prompt, captures the agent's text output, and passes it to `then` as the `--output` argument.

**`ask_user`** -- Present text to the user and wait for their response.
```json
{
  "action": "ask_user",
  "text": "Markdown text to present to the user",
  "then": "engine.py spec user-responded --id 260326... --input"
}
```
The LLM displays `text` to the user, waits for their reply, and passes the reply to `then` as the `--input` argument.

**`present`** -- Show text to the user (no response expected).
```json
{
  "action": "present",
  "text": "Status update or summary",
  "then": "engine.py spec next --id 260326..."
}
```
The LLM displays the text and immediately calls `then`.

**`write_file`** -- Write content to a file path.
```json
{
  "action": "write_file",
  "path": "docs/specs/2603262207_auth.md",
  "content": "# Spec content...",
  "then": "engine.py spec file-written --id 260326..."
}
```
The LLM writes the content using its Write tool and calls `then`.

**`read_file`** -- Read a file and return its contents.
```json
{
  "action": "read_file",
  "path": "docs/brainstorm.md",
  "then": "engine.py spec file-read --id 260326... --content"
}
```
The LLM reads the file and passes contents to `then` as `--content`.

**`run_command`** -- Execute a shell command and return output.
```json
{
  "action": "run_command",
  "command": "bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message \"docs(spec): add auth spec\"",
  "then": "engine.py spec command-done --id 260326... --output"
}
```
The LLM runs the command via Bash tool and passes stdout to `then`.

**`done`** -- Workflow is complete.
```json
{
  "action": "done",
  "text": "Spec approved and saved to `docs/specs/2603262207_auth.md`.\n\n**Suggested next step**: `/implement docs/specs/2603262207_auth.md`"
}
```
No `then` field. The LLM displays the text and stops.

**`error`** -- Something went wrong.
```json
{
  "action": "error",
  "message": "State file not found: .claude/spec-pipeline/specs/260326220728_3b66.json"
}
```
No `then` field. The LLM displays the error message and stops.

### Workflow Definition Format

Each workflow is a JSON file in `workflows/`. Structure:

```json
{
  "name": "spec",
  "stateType": "specs",
  "commands": {
    "start": { "description": "Create a new spec", "args": ["description"], "flags": ["--quick", "--from-brainstorm"] },
    "resume": { "description": "Resume active spec" },
    "status": { "description": "Show all spec statuses" },
    "list": { "description": "List spec IDs" },
    "cancel": { "description": "Cancel active spec" }
  },
  "stateSchema": {
    "description": "string",
    "stage": "string",
    "discovery": { "exchanges": "array", "summary": "string|null", "skipped": "boolean", "brainstormPath": "string|null" },
    "specTimestamp": "string",
    "specPath": "string",
    "specDraft": "string",
    "specApproved": "boolean",
    "specIteration": "number"
  },
  "stages": [
    {
      "name": "discovery",
      "type": "conversation",
      "skipWhen": ["--quick"],
      "variant": {
        "default": { "minExchanges": 3, "maxExchanges": 7, "promptTemplate": "discovery.md" },
        "--from-brainstorm": { "minExchanges": 2, "maxExchanges": 4, "promptTemplate": "discovery.md", "preload": "brainstormPath" }
      },
      "categories": ["functional", "edge_cases", "nfr", "integration", "scope"],
      "intentClassifier": "intent_classifier.md",
      "stateField": "discovery.exchanges",
      "transitionTo": "drafting"
    },
    {
      "name": "drafting",
      "type": "agent",
      "promptTemplate": "spec_drafter.md",
      "modelKey": "specDrafter",
      "outputStateField": "specDraft",
      "outputFile": "{specPath}",
      "transitionTo": "approval"
    },
    {
      "name": "approval",
      "type": "approval",
      "maxIterations": 5,
      "onRevision": "drafting",
      "approvalStateField": "specApproved",
      "iterationStateField": "specIteration",
      "transitionTo": "commit"
    },
    {
      "name": "commit",
      "type": "commit",
      "files": ["{specPath}"],
      "commitRole": "specDrafter",
      "transitionTo": "completed"
    }
  ],
  "completion": {
    "message": "Spec approved and saved to `{specPath}`.",
    "nextStep": "/implement {specPath}"
  }
}
```

#### Stage Types

| Type | Behavior | Key Fields |
|------|----------|------------|
| `conversation` | Interactive exchange loop. Engine emits `call_agent` for each exchange, then `ask_user` for user response. Uses intent classifier to detect transitions. | `minExchanges`, `maxExchanges`, `categories`, `promptTemplate`, `intentClassifier` |
| `agent` | Single agent delegation. Engine assembles prompt from template + state + config, emits `call_agent`. | `promptTemplate`, `modelKey`, `outputStateField`, `outputFile` |
| `approval` | User approval loop. Engine emits `ask_user` with draft content. User approves or requests changes (returns to `onRevision` stage). | `maxIterations`, `onRevision`, `approvalStateField` |
| `review` | Automated review cycle. Engine emits `call_agent` for reviewer, parses verdict, emits `call_agent` for fix agent if needed. Repeats up to configured cycles. | `reviewerModelKey`, `fixModelKey`, `reviewerPrompt`, `fixPrompt`, `maxCycles` |
| `commit` | Git commit. Engine emits `run_command` for `git-helpers.sh scoped-commit`. Optionally generates commit message via haiku agent first. | `files`, `commitRole` |
| `loop` | Iterate over a list from state (e.g., phases). Runs a sub-pipeline of stages for each item. | `over`, `stages` (nested stage list) |

#### Variable Substitution

Template variables in workflow definitions and prompt templates use `{variableName}` syntax. The engine resolves them from:

1. **State fields**: `{description}`, `{specPath}`, `{specDraft}`, etc.
2. **Config fields**: `{specsDir}`, `{testCommand}`, etc.
3. **Computed values**: `{project_context}` (assembled from context files), `{exchange_history}` (formatted from state exchanges), `{timestamp}` (generated).
4. **Loop variables**: `{current_phase}`, `{phase_number}`, `{phase_focus}` (set by loop stage).

### Engine CLI Interface

```
python skills/spec-pipeline-core/engine.py <workflow> <command> [args] [flags]
```

#### Commands

| Command | Description | Output |
|---------|-------------|--------|
| `<workflow> start "<description>" [--flags]` | Initialize state, return first instruction | JSON instruction |
| `<workflow> next --id <id>` | Advance to next stage (used after `present` or `run_command`) | JSON instruction |
| `<workflow> agent-done --id <id> --output "<text>"` | Process agent result, advance | JSON instruction |
| `<workflow> user-responded --id <id> --input "<text>" [--intent "CONTINUE\|TRANSITION"]` | Process user input, advance | JSON instruction |
| `<workflow> file-read --id <id> --content "<text>"` | Process file content, advance | JSON instruction |
| `<workflow> file-written --id <id>` | Acknowledge file write, advance | JSON instruction |
| `<workflow> command-done --id <id> --output "<text>"` | Process command output, advance | JSON instruction |
| `<workflow> resume` | Find active state, return instruction for current position | JSON instruction |
| `<workflow> status` | Return `present` instruction with status of all pipelines | JSON instruction |
| `<workflow> list` | Return `present` instruction with list of IDs | JSON instruction |
| `<workflow> cancel` | Cancel active pipeline, return `done` instruction | JSON instruction |

All commands write state before returning. All commands return exactly one JSON instruction to stdout.

For large arguments (`--output`, `--content`, `--input`), the engine also accepts `--output-file`, `--content-file`, `--input-file` that read from a temp file instead of a command-line argument. The `then` field in instructions uses the file variant when the expected output may be large.

### Context Assembly

The engine's context module handles:

1. **Config loading**: Calls `config.sh load-config` via subprocess, caches the result for the duration of the engine call.
2. **Project context**: Reads each file listed in `config.contextFiles` and `config.agentContext[role]`, concatenates into a `{project_context}` string.
3. **Template rendering**: Reads the prompt template `.md` file, substitutes all `{variable}` placeholders with values from state, config, and computed context.
4. **Exchange history**: Formats `state.discovery.exchanges` (or `state.exchanges` for brainstorm) into a markdown conversation transcript for inclusion in prompts.

### State Management

The engine manages state through its `state.py` module:

- **Read**: Load JSON from `.claude/spec-pipeline/<stateType>/<id>.json`
- **Write**: Serialize state dict to JSON, write atomically (write to `.tmp`, rename)
- **Transition**: Update `stage` field, update `updatedAt` timestamp, write
- **Initialize**: Generate ID (via `state.sh generate-id` subprocess), create initial state dict from workflow's `stateSchema`, write

State is saved before every instruction is emitted. If the LLM crashes after receiving an instruction but before executing it, the state reflects the pre-instruction position and the engine can re-emit the same instruction on resume.

Backward compatibility: the engine reads any existing state file. If a state file lacks fields expected by the workflow definition, the engine uses defaults from the `stateSchema`. No existing fields are removed.

### SKILL.md Dispatcher Protocol

After migration, each SKILL.md contains:

```markdown
---
name: spec
description: "Create and manage technical specifications. Invoke on /spec, /spec-resume, /spec-status, /spec-list, /spec-cancel, /condense-spec commands."
---

# Spec

## Protocol

Read the instruction execution protocol in `skills/spec-pipeline-core/CORE.md` section "Engine Instruction Protocol".

## Commands

| User Command | Engine Call |
|---|---|
| `/spec <description>` | `python skills/spec-pipeline-core/engine.py spec start "<description>"` |
| `/spec --quick <description>` | `python skills/spec-pipeline-core/engine.py spec start "<description>" --quick` |
| `/spec --from-brainstorm <path> <description>` | `python skills/spec-pipeline-core/engine.py spec start "<description>" --from-brainstorm <path>` |
| `/spec-resume` | `python skills/spec-pipeline-core/engine.py spec resume` |
| `/spec-status` | `python skills/spec-pipeline-core/engine.py spec status` |
| `/spec-list` | `python skills/spec-pipeline-core/engine.py spec list` |
| `/spec-cancel` | `python skills/spec-pipeline-core/engine.py spec cancel` |

## Execution Loop

1. Parse the user's command and flags from their message
2. Run the matching engine call from the table above
3. Parse the JSON instruction from stdout
4. Execute the instruction per CORE.md "Engine Instruction Protocol"
5. If the instruction has a `then` field, call that command with the result and go to step 3
6. If no `then` field (`done` or `error`), stop
```

### CORE.md Additions

A new section is added to CORE.md:

**Section N: Engine Instruction Protocol**

Documents the execution mapping for each instruction type:

| Instruction | LLM Execution |
|---|---|
| `call_agent` | Use Agent tool with `model` and `prompt`. Capture the agent's text output. Pass to `then` as `--output` (or write to temp file and use `--output-file` if output exceeds 10000 chars). |
| `ask_user` | Display `text` to the user. Wait for their response. Pass response to `then` as `--input`. |
| `present` | Display `text` to the user. Immediately call `then`. |
| `write_file` | Use Write tool to write `content` to `path`. Call `then`. |
| `read_file` | Use Read tool to read `path`. Pass contents to `then` as `--content` (or `--content-file`). |
| `run_command` | Use Bash tool to run `command`. Pass stdout to `then` as `--output` (or `--output-file`). |
| `done` | Display `text`. Stop. |
| `error` | Display `message`. Stop. |

### Migration Strategy

Migration proceeds one skill at a time, with the engine and prose-based skills coexisting:

1. **Phase 1**: Build engine core, migrate brainstorm (simplest workflow -- 3 stages, no review loops, no phase iteration).
2. **Phase 2**: Migrate spec (adds approval loop, discovery variants, `--from-brainstorm` flag).
3. **Phase 3**: Migrate implement (adds review cycles, phase loop, multi-agent coordination).

At each phase:
- The old SKILL.md is preserved as `SKILL.md.bak` until the engine-driven version is validated.
- Existing in-progress pipelines continue to work because state format is backward compatible.
- Shell scripts remain available and callable by both the engine and any remaining prose-driven skills.
- CORE.md gains the instruction protocol section in Phase 1 and does not change in later phases.

After all three skills are migrated, a cleanup pass retires the `.bak` files and optionally absorbs `config.sh`/`state.sh`/`parse.sh` logic into Python.

---

### Implementation Phases

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Engine core: CLI entry point, workflow loader, stage handlers, instruction emitter, state management, config integration, and prompt template renderer | 3 days |
| Phase 2 | Brainstorm migration: workflow definition, prompt templates, SKILL.md dispatcher, CORE.md instruction protocol section, and end-to-end validation | 2 days |
| Phase 3 | Spec migration: workflow definition with approval loop and discovery variants, prompt templates, and SKILL.md dispatcher | 2 days |
| Phase 4 | Implement migration: workflow definition with review cycles and phase loop, prompt templates, and SKILL.md dispatcher | 3 days |
| Phase 5 | Validation and cleanup: end-to-end testing of all three workflows, resume/cancel flows, backward compatibility verification, retire prose SKILL.md backups | 1 day |
