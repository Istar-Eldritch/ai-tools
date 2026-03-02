---
name: implement
description: "Implement specifications with AI-driven phased planning, tiered code review, and automated commits. Invoke on /implement, /implement-resume, /implement-status commands."
---

# Implement

Implement a specification with phased planning, tiered review (cheap then expensive), and automated git commits per phase.

## 1. Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `/implement <spec-path-or-description>` | Implement a spec with phased planning + review | `--no-plan`, `--no-review` |
| `/implement-resume` | Resume an active implementation pipeline | |
| `/implement-status` | Show status of all implementation pipelines | |

## 2. Configuration

Configuration is stored in `.claude/spec-pipeline.json`. All fields are optional — sensible defaults are used when absent.

### Schema

```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["README.md", "ARCHITECTURE.md"],
  "specTemplatePath": "docs/specs/TEMPLATE.md",
  "specConventionsPath": "docs/SPEC_CONVENTIONS.md",
  "specFormat": "md",
  "models": {
    "planDrafter": { "model": "opus", "thinking": "high" },
    "planReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    },
    "implementer": { "model": "opus", "thinking": "high" },
    "codeReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    },
    "addressReview": { "model": "sonnet", "thinking": "medium" },
    "commitMessageWriter": { "model": "haiku", "thinking": "off" }
  },
  "reviewCycles": {
    "cheap": 2,
    "expensive": 2
  }
}
```

### Default Behavior

When no config file exists:
- **specsDir**: Auto-detect by checking `docs/specs` → `docs` → `specs` → `.` (first that exists)
- **testCommand**: Auto-detect from: `npm test`, `cargo test`, `pytest`, `go test`, `make test`, `./scripts/test.sh`
- **specFormat**: `"md"` (or inferred from template file extension)
- **models**: Use the defaults shown above
- **reviewCycles**: `{ "cheap": 2, "expensive": 2 }` for both planReviewer and codeReviewer

### Loading Config

At the start of any command:
1. Check if `.claude/spec-pipeline.json` exists — if so, read it
2. Auto-detect `specsDir` and `testCommand` if not configured
3. Discover spec template: search specsDir for files matching `/template/i` with extensions `.md`, `.typ`, `.txt`, `.rst`, `.adoc`
4. Discover spec conventions: search for files matching `/guide.*spec/i`, `/spec.*guide/i`, `/spec.*convention/i`
5. Gather project context from: `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`
6. Merge any user-specified models with defaults (user config overrides)

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
├── implementations/    # Implementation pipeline states
│   └── <id>.json
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

- **Read state**: Use the `Read` tool to read `.claude/spec-pipeline/implementations/<id>.json`
- **Write state**: Use the `Write` tool to write the full JSON state
- **List states**: `bash skills/spec-pipeline-core/state.sh list implementations`
- **Find active**: `bash skills/spec-pipeline-core/state.sh find-active implementations`

### Save Protocol

Save state at EVERY stage transition and after EVERY significant operation:
1. Update `stage` field
2. Update `updatedAt` to ISO timestamp
3. Write the full state JSON via `Write` tool

### Resume Protocol

When resuming (`/implement-resume`):
1. Run `bash skills/spec-pipeline-core/state.sh find-active implementations`
2. If an ID is returned, read its state file
3. Resume from the current `stage` — follow the corresponding section's instructions from that point

### Implementation State Schema

```json
{
  "id": "260302150000_c3d4",
  "implTimestamp": "2603021500",
  "specPath": "docs/specs/2603021430_user_authentication.md",
  "specContent": "...",
  "stage": "plan_generation",
  "phases": [],
  "phasesGenerated": [],
  "currentPhaseIndex": 0,
  "currentReviewCycle": 0,
  "previousReview": "",
  "currentReviewTier": null,
  "cheapCyclesCompleted": 0,
  "expensiveCyclesCompleted": 0,
  "implementerCompletedForPhase": false,
  "phaseCommits": [],
  "skipPlanGeneration": false,
  "createdAt": "2026-03-02T15:00:00Z",
  "updatedAt": "2026-03-02T15:00:00Z",
  "checkpoints": []
}
```

**Stages**: `"plan_generation"` → `"implementation"` → `"completed"` | `"cancelled"`

## 4. Implementation Workflow (`/implement`)

### Entry Points

- `/implement <spec-path>` — Implement from a spec file
- `/implement <description>` — Discovery first, then implement
- `/implement --no-plan` — Skip plan generation, implement directly from spec
- `/implement --no-review` — Skip tiered review cycles
- `/implement-resume` — Resume an active implementation
- `/implement-status` — Show status of all implementations

### Workflow Overview

```
For each phase extracted from the spec:
  1. Plan Drafting (opus agent) ← skip if --no-plan
  2. Plan Review — tiered (cheap then expensive) ← skip if --no-review
  3. Implementation (opus agent)
  4. Code Review — tiered (cheap then expensive) ← skip if --no-review
  5. Git commit per phase
```

#### Step 1: Initialize

1. Load configuration
2. If argument is a file path that exists: read the spec content
3. If argument is a description: run discovery mode first, then the user creates a spec
4. Generate implementation ID and timestamp
5. Create initial implementation state
6. Extract phases from the spec

#### Step 2: Phase Extraction

Parse the spec to find implementation phases. Try these regex patterns in order:

1. **Table with links** (legacy): `| Phase N | ... | [name](path) |`
2. **Table without links** (preferred): `| Phase N | Focus description | Effort |`
3. **Typst table**: `[Phase N], [Focus description], [Effort],`
4. **Inline headers** (fallback): `### Phase N: Name`

For each phase found:
- Generate a phase file path: `{timestamp}_{short_name}/phase{N}_{sanitized_focus}.md`
- Sanitize focus: lowercase, strip non-alphanumeric, remove stop words, take first 4 words, join with `_`

If no phases found, create a single fallback phase: `phase1_implementation.md`

Store phases in `state.phases[]`.

#### Step 3: Per-Phase Pipeline

Use `TaskCreate` to track each phase. For each phase (from `state.currentPhaseIndex`):

##### 3a. Plan Drafting (skip if `--no-plan` or `state.skipPlanGeneration`)

Delegate to Agent:
```
Agent(model: opus, prompt: <planDrafter system prompt + spec content + phase description>)
```

The planDrafter must:
- Explore the codebase first
- Create a detailed, executable phase plan
- Write it to a temp location or include it in output
- Reference real file paths verified via exploration

After drafting, create an agent commit for the plan.

##### 3b. Plan Review (skip if `--no-review`)

Run the **Tiered Review Protocol** (see below) with:
- Role: `planReviewer`
- Review task: the plan content
- Fix role: `addressReview` agent

##### 3c. Implementation

Delegate to Agent:
```
Agent(model: opus, prompt: <implementer system prompt + plan content + spec content>)
```

The implementer must:
- Follow the plan step-by-step
- Write tests if the project uses TDD
- Run the test command at the end
- Report what was completed and test results

If there's previous review feedback (`state.previousReview`), include it in the prompt.

After implementation, create an agent commit.

##### 3d. Code Review (skip if `--no-review`)

Run the **Tiered Review Protocol** with:
- Role: `codeReviewer`
- Review task: the implementation + plan + spec
- Fix role: `addressReview` agent

##### 3e. Phase Commit

If any uncommitted changes remain after the review cycles:
```bash
git add -A && git commit -m "feat(phase-{N}): complete phase {N} implementation"
```

##### 3f. Phase Cleanup

Reset per-phase state:
- `state.currentReviewCycle = 0`
- `state.previousReview = ""`
- `state.currentReviewTier = null`
- `state.cheapCyclesCompleted = 0`
- `state.expensiveCyclesCompleted = 0`
- `state.implementerCompletedForPhase = false`
- `state.currentPhaseIndex += 1`
- Save state

#### Step 4: Completion

After all phases:
1. Set `state.stage = "completed"`
2. Save state
3. Output summary: pipeline ID, spec path, phases completed, total commits

### Tiered Review Protocol

This is the core review mechanism used by both plan review and code review.

**Parameters** (from config):
- `cheapCycles`: Number of cheap-tier review cycles (default: 2)
- `expensiveCycles`: Number of expensive-tier review cycles (default: 2)

**Skip case**: If both `cheapCycles` and `expensiveCycles` are 0, skip review entirely (auto-approve).

**Cheap Tier Loop** (cycles 1 to `cheapCycles`):

1. Run reviewer agent at cheap tier:
   ```
   Agent(model: sonnet, prompt: <reviewer system prompt + content to review>)
   ```
2. Parse verdict from output (see Verdict Parsing below)
3. If `APPROVED`: break out of cheap loop, proceed to expensive tier for final QA
4. If `NEEDS_CHANGES` and more cycles remain:
   - Run fix agent:
     ```
     Agent(model: sonnet, prompt: <addressReview prompt + review feedback>)
     ```
   - Create agent commit after fix
   - Update state: `state.cheapCyclesCompleted += 1`
   - Save state

**Expensive Tier Loop** (cycles 1 to `expensiveCycles`):

1. Run reviewer agent at expensive tier:
   ```
   Agent(model: opus, prompt: <reviewer system prompt + "Perform thorough quality gate review">)
   ```
2. Parse verdict
3. If `APPROVED`: done, return approved
4. If `NEEDS_CHANGES`:
   - Run fix agent (always, even on last cycle)
   - Create agent commit
   - Update state: `state.expensiveCyclesCompleted += 1`
   - Save state

**Max cycles exhaustion**: If expensive tier completes all cycles without approval, proceed anyway (the implementation has been improved by all the fix cycles).

### Verdict Parsing

Parse review agent output to determine `APPROVED` or `NEEDS_CHANGES`:

1. Search for `APPROVED` and `NEEDS_CHANGES` (word boundaries, case-insensitive)
2. If both appear, the one at the **later position** wins (last-wins rule)
3. Also recognize legacy formats: `CHANGES_REQUESTED`, `NEEDS_WORK` → `NEEDS_CHANGES`; `READY` → `APPROVED`
4. **Conservative default**: If no verdict marker found, treat as `NEEDS_CHANGES`

### Agent Commits

After each agent operation that modifies files:

1. Check for modified files: `git status --porcelain`
2. If no changes, skip
3. Stage relevant files: `git add <files>`
4. Generate commit message via Agent:
   ```
   Agent(model: haiku, prompt: <commitMessageWriter prompt + truncated diff (max 8000 chars)>)
   ```
5. Commit with the generated message
6. Record commit hash in `state.checkpoints[]`

**Commit message format**: `<type>(<scope>): <subject>`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Scope: derived from spec name or phase number
- Subject: imperative, lowercase, no period, max 50 chars

**Fallback messages** (if haiku fails):
- planDrafter → `docs({scope}): create implementation plan`
- implementer → `feat({scope}): implement phase changes`
- addressReview → `fix({scope}): address review feedback`
- codeReviewer → `refactor({scope}): apply code review changes`

### Resume Support

When `/implement-resume` is called:
1. Find active implementation: `bash skills/spec-pipeline-core/state.sh find-active implementations`
2. Load state, check `state.stage` and `state.currentPhaseIndex`
3. If `state.implementerCompletedForPhase` is true, skip to code review step
4. Otherwise resume from the current stage within the current phase

## 5. Git Operations

### Branching

The pipeline operates on the current branch. No automatic branch creation — the user manages branches.

### Scoped Commits

Commits are scoped to specific file sets, not `git add -A`:
1. Get modified files: `git status --porcelain`
2. Stage specific files: `git add <file1> <file2> ...`
3. For agent commits, scope to files the agent actually modified
4. For final phase commits, use `git add -A` for any remaining changes

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
- **scope**: Component/area affected, derived from spec name or phase
- **subject**: Imperative mood, lowercase, no period, max 50 chars
- **body**: Explain what and why, wrap at 72 chars

### Conventional Commit Types by Role

| Role | Default Type | Example |
|------|-------------|---------|
| planDrafter | `docs` | `docs(user-auth): create implementation plan` |
| implementer | `feat` | `feat(user-auth): implement phase 1 changes` |
| addressReview | `fix` | `fix(user-auth): address review feedback` |
| codeReviewer | `refactor` | `refactor(user-auth): apply code review changes` |

## 6. System Prompts

These are the role-specific prompts used when delegating to Agent tool invocations. Include the relevant prompt as the agent's instructions.

### Plan Drafter

```
You are creating a detailed implementation plan for a spec phase.

Translate high-level spec requirements into specific, executable steps with file paths and code examples.

{projectContext}

## CRITICAL: Codebase Grounding First

Before writing ANY plan, you MUST explore the existing codebase:
1. Explore project structure
2. Find similar code — look for patterns to follow
3. Read related files — understand existing implementations
4. Check test patterns

## Plan Format

Create a detailed, executable phase plan:

# Phase N: [Phase Name]

**Estimated Effort**: X days

## Overview
Brief description of what this phase accomplishes.

## Prerequisites
- Phase N-1 complete (if applicable)

## Steps

### Step N.1: [Specific Step Name]
- Files: path/to/file (verified exists)
- Pattern Reference: Based on path/to/similar_existing
- Action: Specific changes to make (with before/after code)
- Verify: How to test this step

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| path/to/new | Description | Based on existing_similar |

### Modified Files
| File | Changes |
|------|---------|
| path/to/existing | What sections change |

## Completion Checklist
- [ ] Step N.1 complete
- [ ] All tests pass

Your plan must be executable with minimal interpretation: exact file paths, code examples matching project style, before/after for modifications, real verification commands.
```

### Plan Reviewer

```
You are reviewing an implementation plan for a spec phase.

Check that the plan is detailed, executable, and follows project conventions.

{projectContext}

## Review Checklist

1. Codebase Grounding — Are file paths real? Are similar implementations referenced?
2. Project Convention Compliance — Does it follow existing patterns?
3. Completeness — All necessary steps included? Prerequisites identified?
4. Execution Order — Logical sequence? Test-driven where appropriate?
5. Specificity — Exact file paths? Code examples match project style?
6. Verification — Each step has verification? Final checklist includes tests?

Do NOT run tests — you are reviewing the plan document only.

## Response Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Issues** (if any):
1. Issue description
   - Suggestion: How to fix

**Missing** (if any):
- What's not covered that should be
```

### Implementer

```
You are implementing a phase of a specification.

Follow the implementation plan step-by-step, following project conventions.

{projectContext}

## Implementation Workflow

1. Codebase Grounding: Read related files to understand patterns
2. Follow TDD (if project uses it): Write tests first
3. Make Changes: Implement following existing code style
4. Verify: Run tests after each step

## CRITICAL: Testing Requirement

You MUST run the project's test command at the end of your implementation. Every implementation session must end with:
1. Running the full test suite
2. Analyzing the test results
3. If tests FAIL: Fix issues and re-run until they pass
4. If tests PASS: Proceed to summary

## Summary After Implementation

Report:
- What was completed (which steps)
- Test results (REQUIRED)
- Any issues encountered
- Any deviations from plan (with justification)
```

### Code Reviewer

```
You are a senior code reviewer.

Review the implementation against spec requirements and project conventions.

{projectContext}

## CRITICAL: Do NOT Run Tests

You are a REVIEWER, not an implementer. Do NOT run tests, build commands, or execute code.

## Review Focus Areas

1. Correctness — Does implementation match spec? Logic correct? Edge cases handled?
2. Code Quality — Clean, readable, matches surrounding style?
3. Architecture — Fits project structure? Uses appropriate patterns?
4. Testing — Are test files present and covering the implementation? READ test files, do NOT execute.
5. Organization — Code in right location? Files named appropriately?
6. Security — Input validation? No obvious vulnerabilities?

## Review Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Issues** (if any):
1. [CRITICAL/MAJOR/MINOR] Description
   - File: path/to/file:line
   - Problem: What's wrong
   - Fix: How to address it
```

### Address Review

```
You are addressing code review feedback.

Fix issues raised in the code review, following project conventions.

{projectContext}

## Process

For each issue in the review:
1. Understand the problem
2. Check referenced files/conventions
3. Make the fix following project patterns
4. Verify the fix works

## Priority Order

1. CRITICAL: Blocking issues (tests failing, security, correctness)
2. MAJOR: Significant problems (architecture, patterns, organization)
3. MINOR: Polish (style, naming, comments)

After addressing issues, run the full test suite.

Report: What was fixed, test results, any issues not addressed (with reason).
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
