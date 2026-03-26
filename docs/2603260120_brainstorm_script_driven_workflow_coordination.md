# Brainstorm: Script-Driven Workflow Coordination for Spec Pipeline Skills

**Status**: Draft
**Created**: 2026-03-26
**Timestamp**: 2603260120

## Problem / Opportunity

The spec pipeline skills (brainstorm, spec, implement) rely on 200-400 line SKILL.md files that the LLM re-reads and re-interprets on every invocation. Workflow orchestration — what step comes next, what context to assemble, when to save state, how to transition stages — is encoded as prose instructions. This leads to inconsistent execution across runs: steps may be skipped, state may not be saved at transitions, agent prompts may be assembled differently, and the same workflow can behave differently depending on how the LLM interprets the instructions.

Meanwhile, the existing shell scripts (`state.sh`, `config.sh`, `git-helpers.sh`, `parse.sh`) prove that deterministic operations can be reliably extracted from prose into code. The opportunity is to extend this pattern to cover workflow orchestration itself, reserving LLM involvement for what actually requires intelligence: understanding user intent, generating content, and writing code.

## Context & Background

### Current Architecture

- **SKILL.md files** serve dual purpose: workflow instructions for the LLM + agent prompt definitions
- **Shell scripts** handle atomic operations: config loading, state queries, git commits, text parsing
- **The LLM** is the orchestrator — it reads SKILL.md, calls scripts, manages state, assembles prompts, and sequences everything

### What Scripts Already Own (Deterministic)

- Config loading, path construction, name derivation (`config.sh`)
- State directory init, ID generation, listing, finding active (`state.sh`)
- Phase extraction from spec documents, verdict parsing (`parse.sh`)
- Git scoped commits, staged diffs (`git-helpers.sh`)

### What the LLM Interprets from Prose (Non-Deterministic)

- The entire workflow sequence (what step comes next)
- State creation, reading, updating, saving at each transition
- Assembling agent prompts with correct context
- Deciding when to invoke which agent and with what model
- The review loop (cycles, branching on verdict)
- Initialization sequences (5-7 steps re-read from prose each time)
- Transition detection (when to move from discovery to drafting)

## Proposed Direction: Shared Workflow Engine with Instruction Protocol

### Core Concept

A Python-based workflow engine that:
1. Owns the state machine — valid transitions, required fields, sequencing
2. Assembles agent prompts from templates + state + config
3. Emits structured JSON instructions that the host LLM executes
4. Receives results back and advances the workflow

The LLM becomes a thin executor of engine instructions rather than an interpreter of prose workflows.

### Instruction Protocol

The engine is a CLI. Each call returns JSON instructions the LLM executes:

| Instruction | LLM Action | Used By |
|---|---|---|
| `call_agent` | Spawn Agent with model + prompt, return output | Drafting, implementing, reviewing |
| `ask_user` | Present text, wait for user input, return it | Discovery, brainstorming, approval |
| `present` | Show text to user (status, summaries) | All |
| `write_file` | Write content to a path | Spec drafting, synthesis |
| `read_file` | Read a file, return contents | Various |
| `done` | Workflow complete, show final message | All |
| `error` | Something went wrong, show message | All |

Each instruction includes a `then` field — the next engine command to call with the result. This creates a chain without the LLM needing to know the workflow:

```
LLM calls: engine.py spec start "add user auth"
Engine returns: { "action": "call_agent", "model": "opus", "prompt": "...", "then": "engine.py spec record-exchange --id ... --agent-response" }
LLM: spawns agent, gets response, calls the `then` command
Engine returns: { "action": "ask_user", "text": "...", "then": "engine.py spec user-responded --id ... --input" }
LLM: presents to user, gets input, calls the `then` command
... engine drives the flow ...
```

### Declarative Workflow Definitions

Each skill defines its stages in a JSON file:

```json
{
  "name": "spec",
  "stateType": "specs",
  "stages": [
    {
      "name": "discovery",
      "type": "conversation",
      "skipWhen": ["--quick"],
      "variant": {
        "default": { "minExchanges": 3, "maxExchanges": 7 },
        "--from-brainstorm": { "minExchanges": 2, "maxExchanges": 4, "preload": "brainstormPath" }
      },
      "agentPrompt": "discovery.md",
      "categories": ["functional", "edge_cases", "nfr", "integration", "scope"],
      "transitionTo": "drafting"
    },
    {
      "name": "drafting",
      "type": "agent",
      "agentPrompt": "spec_drafter.md",
      "model": "specDrafter",
      "outputField": "specDraft",
      "outputFile": "{specPath}",
      "transitionTo": "approval"
    },
    {
      "name": "approval",
      "type": "approval",
      "maxIterations": 5,
      "onRevision": "drafting",
      "transitionTo": "commit"
    },
    {
      "name": "commit",
      "type": "commit",
      "files": ["{specPath}"],
      "transitionTo": "completed"
    }
  ],
  "completion": {
    "message": "Spec approved and saved to `{specPath}`.",
    "nextStep": "/implement {specPath}"
  }
}
```

The implement workflow uses a **loop stage** for its per-phase pipeline:

```json
{
  "name": "phase_loop",
  "type": "loop",
  "over": "phases",
  "stages": [
    { "name": "plan_drafting", "type": "agent", "skipWhen": ["--no-plan"] },
    { "name": "plan_review", "type": "review", "skipWhen": ["--no-review"] },
    { "name": "implementation", "type": "agent" },
    { "name": "code_review", "type": "review", "skipWhen": ["--no-review"] },
    { "name": "phase_commit", "type": "commit" }
  ]
}
```

### Interactive Stages: Stateless Agent Calls with Reconstructed Context

For conversation stages (discovery, brainstorming), each exchange is a discrete agent call. The engine reconstructs context from state each time:

- Prior exchange history (formatted as conversation transcript)
- Remaining discovery categories
- Codebase context (from config)
- The specific prompt template with variables filled in

This means resuming (`/spec-resume`) is trivial — the engine reads state, sees N exchanges completed, assembles context for exchange N+1 identically to a fresh run.

### Intent Detection via Lightweight LLM Call

When the user responds during an interactive stage, the engine needs to classify: continue or transition? The engine emits a cheap haiku classification call before processing:

```json
{ "action": "call_agent", "model": "haiku",
  "prompt": "Classify: CONTINUE or TRANSITION\n\n\"{user_input}\"",
  "then": "engine.py spec user-responded --id ... --input '...' --intent" }
```

The engine receives both the user's input and the classified intent, then decides deterministically what to do next.

### Prompt Templates as Separate Files

Agent prompts move to standalone `.md` files with template variables:

```markdown
You are a requirements discovery expert...

{project_context}

## Current State
Description: {description}
Categories remaining: {remaining_categories}

## Prior Exchanges
{exchange_history}

Propose your next assumption about {next_category}.
```

The engine handles variable substitution from state and config.

### SKILL.md Becomes a Thin Dispatcher

```markdown
---
name: spec
description: "Create specs. Invoke on /spec, /spec-resume, ..."
---
Parse the user's command and flags, then run:
`python skills/spec-pipeline-core/engine.py spec <action> [args]`
Follow the engine's output instructions.
```

From 400 lines to ~5 lines. The LLM has minimal room to deviate.

### Proposed File Structure

```
skills/spec-pipeline-core/
├── engine.py                  # CLI entry point
├── engine/
│   ├── __init__.py
│   ├── workflows.py           # Load and validate workflow definitions
│   ├── stages.py              # Stage type implementations
│   ├── context.py             # Context assembly and template rendering
│   ├── state.py               # State read/write/transition
│   ├── config.py              # Config loading
│   └── instructions.py        # Instruction type definitions
├── workflows/
│   ├── brainstorm.json
│   ├── spec.json
│   └── implement.json
├── prompts/
│   ├── discovery.md
│   ├── brainstorm.md
│   ├── spec_drafter.md
│   ├── plan_drafter.md
│   ├── implementer.md
│   ├── code_reviewer.md
│   ├── plan_reviewer.md
│   ├── address_review.md
│   ├── commit_message.md
│   └── intent_classifier.md
├── git-helpers.sh             # Retained — git ops are naturally shell
├── state.sh                   # Retained during migration, eventually absorbed
├── config.sh                  # Retained during migration, eventually absorbed
└── parse.sh                   # Logic moves to Python
```

## Open Questions

- **Conversation quality under stateless agent calls**: Will brainstorming feel mechanical when each exchange is a fresh agent call with reconstructed context, compared to the current approach where the LLM holds the full conversation in context? Needs experimentation.
- **Instruction protocol granularity**: Should the engine emit one instruction at a time (simpler LLM logic) or batches of independent instructions (more efficient, parallel agent calls)?
- **Error recovery**: When the LLM fails to execute an instruction (agent timeout, file write error), how does the engine handle retry? Does the LLM report the error back and the engine decides?
- **Migration strategy**: Big-bang rewrite or gradual? Could start with one skill (brainstorm, simplest) and migrate spec/implement after validating the approach.

## Rough Scope Assessment

This is **epic-level effort** — probably 2-3 specs worth of work:

1. **Engine core + instruction protocol** — the workflow engine, state management, config loading, instruction types, context assembly
2. **Workflow migration** — convert brainstorm, spec, and implement to declarative workflow definitions + prompt templates
3. **Polish + validation** — test all flows end-to-end, handle edge cases (resume, cancel, error recovery), retire old bash scripts

Each spec would be roughly 2-3 days of implementation, so ~1-1.5 weeks total.
