---
name: implement
description: "Implement specifications with AI-driven phased planning, code review, and automated commits. Invoke on /implement, /implement-resume, /implement-status commands."
---

# Implement

Implement a specification with phased planning, configurable review cycles, and automated git commits per phase.

## Prerequisites

**Before executing any command**, read the core protocols:
> Read `skills/spec-pipeline-core/CORE.md`

Configuration, state management, git operations, and shared prompts are defined there.
This file only contains implementation-specific workflow and prompts.

## 1. Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `/implement <spec-path-or-description>` | Implement a spec with phased planning + review | `--no-plan`, `--no-review` |
| `/implement-resume` | Resume an active implementation pipeline | |
| `/implement-status` | Show status of all implementation pipelines | |

## 2. Implementation State Schema

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
  "reviewCyclesCompleted": 0,
  "implementerCompletedForPhase": false,
  "phaseCommits": [],
  "skipPlanGeneration": false,
  "createdAt": "2026-03-02T15:00:00Z",
  "updatedAt": "2026-03-02T15:00:00Z",
  "checkpoints": []
}
```

**Stages**: `"plan_generation"` → `"implementation"` → `"completed"` | `"cancelled"`

## 3. Implementation Workflow (`/implement`)

### Entry Points

- `/implement <spec-path>` — Implement from a spec file
- `/implement <description>` — Discovery first, then implement
- `/implement --no-plan` — Skip plan generation, implement directly from spec
- `/implement --no-review` — Skip review cycles
- `/implement-resume` — Resume an active implementation (see CORE.md §2 Resume Protocol)
- `/implement-status` — Show status of all implementations

### Workflow Overview

```
For each phase extracted from the spec:
  1. Plan Drafting (opus agent) ← skip if --no-plan
  2. Plan Review ← skip if --no-review
  3. Implementation (opus agent)
  4. Code Review ← skip if --no-review
  5. Git commit per phase
```

#### Step 1: Initialize

1. Load configuration:
   ```bash
   bash skills/spec-pipeline-core/config.sh load-config --needs-test-command --needs-template
   ```
2. If argument is a file path that exists: read the spec content
3. If argument is a description: run discovery mode first, then the user creates a spec
4. Generate implementation ID and timestamp
5. Create initial implementation state

#### Step 2: Phase Extraction

Extract phases from the spec:
```bash
bash skills/spec-pipeline-core/parse.sh extract-phases "{specPath}"
```

Returns a JSON array of phases: `[{"number": 1, "focus": "...", "sanitizedFocus": "..."}]`

For each phase, generate a phase file path: `{timestamp}_{short_name}/phase{N}_{sanitizedFocus}.md`

If no phases found (empty array), create a single fallback phase: `phase1_implementation.md`

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

After drafting, commit: `bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message "{commitMsg}"`

##### 3b. Plan Review (skip if `--no-review`)

Run the **Review Protocol** (see below) with:
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

After implementation, commit: `bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message "{commitMsg}"`

##### 3d. Code Review (skip if `--no-review`)

Run the **Review Protocol** with:
- Role: `codeReviewer`
- Review task: the implementation + plan + spec
- Fix role: `addressReview` agent

##### 3e. Phase Commit

If any uncommitted changes remain after the review cycles:
```bash
bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message "feat(phase-{N}): complete phase {N} implementation"
```

##### 3f. Phase Cleanup

Reset per-phase state using the state script:
```bash
bash skills/spec-pipeline-core/state.sh reset-phase-state "{stateFilePath}"
```

This outputs updated JSON to stdout. Write it to the state file via the `Write` tool.

#### Step 4: Completion

After all phases:
1. Set `state.stage = "completed"`
2. Save state
3. Output summary: pipeline ID, spec path, phases completed, total commits

### Review Protocol

This is the core review mechanism used by both plan review and code review.

**Parameters** (from config `reviewCycles`):
- `reviewCycles.planReviewer`: Number of review cycles for plan review (default: 0)
- `reviewCycles.codeReviewer`: Number of review cycles for code review (default: 5)

The model for each reviewer role is configured in `models.planReviewer` and `models.codeReviewer`.

**Skip case**: If cycles for the role is 0, skip review entirely (auto-approve).

**Review Loop** (cycles 1 to configured max):

1. Run reviewer agent:
   ```
   Agent(model: <configured model for role>, prompt: <reviewer system prompt + content to review>)
   ```
2. Parse verdict:
   ```bash
   bash skills/spec-pipeline-core/parse.sh parse-verdict "<review output>"
   ```
3. If `APPROVED`: done, return approved
4. If `NEEDS_CHANGES` and more cycles remain:
   - Run fix agent:
     ```
     Agent(model: <configured addressReview model>, prompt: <addressReview prompt + review feedback>)
     ```
   - Commit fix: `bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message "{commitMsg}"`
   - Update state: `state.reviewCyclesCompleted += 1`
   - Save state

**Max cycles exhaustion**: If all cycles complete without approval, proceed anyway (the implementation has been improved by the fix cycles).

### Agent Commits

After each agent operation that modifies files:

1. Check for modified files: `git status --porcelain`
2. If no changes, skip
3. Get truncated diff: `bash skills/spec-pipeline-core/git-helpers.sh staged-diff --max-chars 8000`
4. Generate commit message via `Agent(model: haiku, prompt: <commitMessageWriter prompt + diff>)` — see CORE.md §5 for the prompt.
5. Commit: `bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message "{generatedMsg}"`
6. Record commit hash in `state.checkpoints[]`

**Fallback messages** (if haiku fails) — see CORE.md §4.

### Resume Support

When `/implement-resume` is called:
1. Find active implementation: `bash skills/spec-pipeline-core/state.sh find-active implementations`
2. Load state, check `state.stage` and `state.currentPhaseIndex`
3. If `state.implementerCompletedForPhase` is true, skip to code review step
4. Otherwise resume from the current stage within the current phase

## 4. System Prompts

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
