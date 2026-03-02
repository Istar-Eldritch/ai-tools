---
name: brainstorm
description: "Open-ended divergent exploration and brainstorming sessions with synthesis into structured documents. Invoke on /brainstorm, /brainstorm-done commands."
---

# Brainstorm

Open-ended divergent exploration sessions that surface tradeoffs, risks, and opportunities — then synthesize findings into a structured document.

## 1. Command Reference

| Command | Description |
|---------|-------------|
| `/brainstorm <description>` | Start a brainstorming session |
| `/brainstorm-done` | Synthesize the brainstorm into a document |

## 2. Configuration

Configuration is stored in `.claude/spec-pipeline.json`. All fields are optional — sensible defaults are used when absent.

### Relevant Fields

```json
{
  "specsDir": "docs/specs",
  "specFormat": "md",
  "models": {
    "commitMessageWriter": { "model": "haiku", "thinking": "off" }
  }
}
```

### Default Behavior

When no config file exists:
- **specsDir**: Auto-detect by checking `docs/specs` → `docs` → `specs` → `.` (first that exists)
- **specFormat**: `"md"` (or inferred from template file extension)
- **models**: Use the defaults shown above

### Loading Config

At the start of any command:
1. Check if `.claude/spec-pipeline.json` exists — if so, read it
2. Auto-detect `specsDir` if not configured
3. Gather project context from: `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`

### Model Mapping for Agent Tool

When delegating to agents, map model identifiers to the `Agent` tool's `model` parameter:
- `"opus"` → `model: "opus"`
- `"sonnet"` → `model: "sonnet"`
- `"haiku"` → `model: "haiku"`

## 3. State Management

All state is persisted as JSON files in `.claude/spec-pipeline/`.

### Directory Structure

```
.claude/spec-pipeline/
└── brainstorms/        # Brainstorm states
    └── <id>.json
```

### Initialize State Directory

Before first use, run:
```bash
bash skills/spec-pipeline-core/state.sh init
```

### ID Generation

Pipeline IDs use format `YYMMDDhhmmss_XXXX` where XXXX is random hex. Generate via:
```bash
bash skills/spec-pipeline-core/state.sh generate-id
```

Timestamps for filenames use `YYMMDDhhmm` format:
```bash
bash skills/spec-pipeline-core/state.sh generate-timestamp
```

### State Operations

- **Read state**: Use the `Read` tool to read `.claude/spec-pipeline/brainstorms/<id>.json`
- **Write state**: Use the `Write` tool to write the full JSON state
- **List states**: `bash skills/spec-pipeline-core/state.sh list brainstorms`
- **Find active**: `bash skills/spec-pipeline-core/state.sh find-active brainstorms`

### Save Protocol

Save state at EVERY stage transition and after EVERY significant operation:
1. Update `stage` field
2. Update `updatedAt` to ISO timestamp
3. Write the full state JSON via `Write` tool

### Brainstorm State Schema

```json
{
  "id": "260302170000_g7h8",
  "description": "Explore caching strategies",
  "stage": "brainstorming",
  "exchanges": [],
  "synthesisPath": null,
  "createdAt": "2026-03-02T17:00:00Z",
  "updatedAt": "2026-03-02T17:00:00Z"
}
```

**Stages**: `"brainstorming"` → `"synthesis"` → `"completed"` | `"cancelled"`

## 4. Brainstorming Workflow (`/brainstorm`)

### Entry Points

- `/brainstorm <description>` — Start a brainstorming session
- `/brainstorm-done` — Synthesize the brainstorm into a document

### Step 1: Initialize

1. Generate brainstorm ID and timestamp
2. Create initial brainstorm state with `stage: "brainstorming"`
3. Save state

### Step 2: Brainstorming Session

Enter brainstorming mode. This is a conversational, divergent exploration:

**Rules**:
- Focus on **one concept or problem** per exchange
- Explore it from multiple angles before moving on
- Surface tradeoffs, risks, and opportunities
- Ask open-ended questions that expand thinking
- Challenge assumptions and offer alternative framings
- Reference the codebase — ground proposals in what exists
- Do NOT write specs, plans, or code
- Do NOT try to converge on a solution prematurely

**Codebase exploration**: Before and during brainstorming, explore:
- Relevant existing features and patterns
- Architectural constraints and opportunities
- Integration points and dependencies
- Technical debt or limitations

For each exchange:
1. Record the exchange in `state.exchanges[]`
2. Save state after each exchange

### Step 3: Synthesis (`/brainstorm-done`)

When the user types `/brainstorm-done`:

1. Set `state.stage = "synthesis"`
2. Generate a synthesis document from the conversation:

```markdown
# Brainstorm: <title>

**Status**: Draft
**Created**: YYYY-MM-DD
**Timestamp**: <YYMMDDhhmm>

## Problem / Opportunity
[What problem are we solving or opportunity are we exploring?]

## Context & Background
[Current state, what's in place, relevant constraints]

## Proposed Directions
[Each direction explored, with tradeoffs]

- **Option A: <name>**
  - Description: ...
  - Pros: ...
  - Cons: ...

- **Option B: <name>**
  - ...

## Out of Scope
[What this brainstorm explicitly does NOT cover]

## Open Questions
[Unresolved decisions]

## Rough Scope Assessment
[Feature, epic, or roadmap-level effort — and why]
```

3. Write the document to `{specsDir}/{timestamp}_brainstorm_{short_name}.md`
4. Stage and commit the document
5. Set `state.synthesisPath` to the file path
6. Set `state.stage = "completed"`
7. Save state

## 5. Git Operations

### Scoped Commits

Commits are scoped to specific file sets, not `git add -A`:
1. Get modified files: `git status --porcelain`
2. Stage specific files: `git add <file1> <file2> ...`

### Commit Message Generation

For automated commits, delegate to a haiku agent:

```
Agent(model: haiku, prompt: <commitMessageWriter prompt + diff content>)
```

**Diff truncation**: Limit diff content to 8000 characters to avoid overwhelming the model.

**Message format**:
```
<type>(<scope>): <subject>

<body>
```

- **type**: `feat` | `fix` | `docs` | `refactor` | `test` | `chore`
- **scope**: Component/area affected
- **subject**: Imperative mood, lowercase, no period, max 50 chars
- **body**: Explain what and why, wrap at 72 chars

### Conventional Commit Types by Role

| Role | Default Type | Example |
|------|-------------|---------|
| brainstormAgent | `docs` | `docs(brainstorm): capture brainstorm session` |

## 6. System Prompts

These are the role-specific prompts used when delegating to Agent tool invocations. Include the relevant prompt as the agent's instructions.

### Brainstorm Agent

```
You are a creative thought partner helping to explore and brainstorm ideas before any formal planning begins.

{projectContext}

## Your Role

1. Explore the codebase to understand what exists and what constraints apply
2. Focus each exchange on one concept or problem — explore from multiple angles before moving on
3. Surface tradeoffs, risks, and opportunities the user may not have considered
4. Ask open-ended questions that expand thinking
5. Challenge assumptions and offer alternative framings
6. Connect ideas across different parts of the system

## Approach: Focused Divergence

- One concept per exchange: Pick one theme and explore it fully before moving on
- Multiple angles within that concept: Different framings, tradeoffs, "what if?" questions
- Surface tensions: Identify tradeoffs between different directions
- Build on ideas: Deepen or challenge before pivoting
- Reference the codebase: Ground proposals in what actually exists

Do NOT write specifications, plans, or code. Encourage exploration, not convergence.
```

### Commit Message Writer

```
You are writing git commit messages.

Format:
<type>(<scope>): <subject>

<body>

Rules:
- type: feat | fix | docs | refactor | test | chore
- scope: Component/area affected
- subject: Imperative mood, lowercase, no period, max 50 chars
- body: Explain what and why (not how), wrap at 72 chars

Output ONLY the commit message, nothing else.
```
