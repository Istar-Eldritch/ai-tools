# Phase 3: Spec Migration Plan

**Status**: Ready for implementation
**Created**: 2026-03-26
**Depends on**: Phase 2 (Brainstorm migration) -- completed

---

## Overview

Migrate the spec skill from the prose-driven SKILL.md to the engine-driven workflow. This involves:

1. Creating `workflows/spec.json` -- the declarative workflow definition with discovery variants, approval loop, and commit
2. Creating prompt templates: `prompts/discovery.md`, `prompts/spec_drafter.md`, `prompts/intent_classifier.md`
3. Replacing the current `skills/spec/SKILL.md` with a thin engine dispatcher
4. Adjusting engine code to handle `--from-brainstorm` preload and approval-to-drafting revision feedback
5. End-to-end validation of all three entry points (`/spec`, `/spec --quick`, `/spec --from-brainstorm`)

The condense-spec workflow is NOT migrated in this phase. It remains as prose instructions in the spec SKILL.md or is handled separately, since it has no state management, no stages, and no engine benefit.

---

## Step 1: Create the Workflow Definition

**File**: `skills/spec-pipeline-core/workflows/spec.json`

The spec workflow has four stages: `discovery` (conversation), `drafting` (agent), `approval` (approval loop), and `commit`.

Key design decisions:
- `stateType` is `"specs"`, matching the existing state directory `.claude/spec-pipeline/specs/`
- `discovery` stage uses the `variant` mechanism already implemented in `_get_variant_field()` in `stages.py`:
  - `default` variant: standard discovery (3-7 exchanges, `discovery.md` prompt)
  - `--from-brainstorm` variant: targeted discovery (2-4 exchanges, same `discovery.md` prompt but with `preload: "brainstormPath"` to read the brainstorm document into context)
  - `skipWhen: ["--quick"]` skips discovery entirely
- `drafting` stage uses `spec_drafter.md` prompt template, model role `specDrafter` (defaults to `opus` in typical configs, falls back to `sonnet`)
- `approval` stage loops back to `drafting` on revision (max 5 iterations), using `_revision_feedback` state field already handled by `handle_approval()` in `stages.py`
- `commit` stage uses `commitRole: "specDrafter"` for conventional commit type resolution
- State schema matches the existing spec state format from the current prose SKILL.md for backward compatibility
- Discovery exchanges use the standard `assumption`/`response` format (not brainstorm's `topic`/`discussion`)
- `intentClassifier` field is declared but the engine currently uses keyword heuristics in `_detect_transition_intent()` -- the haiku-based classifier is a future enhancement per Q2 in the spec

```json
{
  "name": "spec",
  "stateType": "specs",
  "commands": {
    "start": {
      "description": "Create a new spec",
      "args": ["description"],
      "flags": ["--quick", "--from-brainstorm"]
    },
    "resume": { "description": "Resume active spec" },
    "status": { "description": "Show all spec statuses" },
    "list": { "description": "List spec IDs" },
    "cancel": { "description": "Cancel active spec" }
  },
  "stateSchema": {
    "description": "string",
    "stage": "string",
    "discovery": {
      "exchanges": "array",
      "summary": "string|null",
      "skipped": "boolean",
      "brainstormPath": "string|null"
    },
    "specTimestamp": "string",
    "specFilename": "string",
    "specPath": "string",
    "specDraft": "string",
    "specApproved": "boolean",
    "specIteration": "number",
    "checkpoints": "array"
  },
  "stages": [
    {
      "name": "discovery",
      "type": "conversation",
      "skipWhen": ["--quick"],
      "variant": {
        "default": {
          "minExchanges": 3,
          "maxExchanges": 7,
          "promptTemplate": "discovery.md"
        },
        "--from-brainstorm": {
          "minExchanges": 2,
          "maxExchanges": 4,
          "promptTemplate": "discovery.md",
          "preload": "brainstormPath"
        }
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

---

## Step 2: Create Prompt Templates

### 2a. Discovery Prompt

**File**: `skills/spec-pipeline-core/prompts/discovery.md`

This prompt serves both the default discovery flow and the `--from-brainstorm` targeted discovery. The engine resolves `{brainstorm_content}` from the preloaded brainstorm document when the `--from-brainstorm` flag is active; otherwise it resolves to an empty string.

The `{discovery_mode_instructions}` variable is computed by the engine based on active flags:
- Default mode: full discovery instructions (all 5 categories)
- From-brainstorm mode: targeted gap-filling instructions (focus on edge cases, NFRs, integration)

Since the engine's context module currently does not compute mode-specific instructions, we handle this by embedding both modes in the template with conditional-style guidance. The agent sees the brainstorm content (if present) and adjusts its behavior accordingly.

```markdown
You are a requirements discovery expert helping to gather information before writing a technical specification.

Your task is to identify ambiguities and gaps, then propose the most likely solution for each -- one at a time -- for the user to confirm or correct.

{projectContext}

## Description

{description}

## Prior Exchanges

{exchange_history}

## Brainstorm Context

{brainstorm_content}

## Your Role

You are conducting a discovery session to understand the user's requirements better. Your goal is to:
1. Identify ambiguities and gaps in the initial description
2. Uncover edge cases and error scenarios
3. Understand non-functional requirements (performance, security, scalability)
4. Clarify integration points with existing systems
5. Define scope boundaries (what is in scope vs. out of scope)

## Approach: Assume & Confirm (One at a Time)

1. Explore the codebase to understand the context
2. Identify the most important ambiguity or gap
3. Propose your best assumption for how it should work
4. Explain your reasoning -- why you think this is the right approach (reference codebase evidence)
5. Ask the user to confirm or correct your assumption

Present ONE assumption per exchange. Prioritize the most impactful decisions first.

## Discovery Categories

1. **Functional Requirements** -- expected behaviors, inputs/outputs, user workflows
2. **Edge Cases & Error Handling** -- failure modes, invalid inputs, boundary conditions
3. **Non-Functional Requirements** -- performance, security, scalability constraints
4. **Integration & Dependencies** -- interaction with existing features, external dependencies
5. **Scope & Constraints** -- what is out of scope, MVP vs. nice-to-have

## Mode-Specific Guidance

If brainstorm context is provided above, this is a **targeted discovery** session:
- The brainstorm has already covered high-level directions, scope, and functional requirements
- Focus your assumptions on the **gaps** the brainstorm likely missed: edge cases, error handling, non-functional requirements, and integration details
- Keep the session short (2-4 exchanges) -- do not re-explore what the brainstorm already covered
- Reference specific findings from the brainstorm when grounding your assumptions

If no brainstorm context is provided, this is a **full discovery** session:
- Cover all five discovery categories
- Aim for 3-7 exchanges covering the most important ambiguities
- Start with the highest-impact decisions (usually functional requirements and scope)

Always ground your assumptions in codebase evidence or established best practices. Do NOT write specification content yet.

If the conversation has covered the important gaps and new exchanges are not surfacing fresh insights, suggest that the user move to drafting.
```

### 2b. Spec Drafter Prompt

**File**: `skills/spec-pipeline-core/prompts/spec_drafter.md`

This prompt is used by the `drafting` agent stage. It receives the discovery summary (or brainstorm + targeted discovery), project context, and any revision feedback from a prior approval iteration.

```markdown
You are an expert software architect drafting technical specifications.

Your task is to create a clear, actionable technical specification.

{projectContext}

## Description

{description}

## Discovery Summary

{discovery_summary}

## Revision Feedback

{revision_feedback}

## Spec Structure

The spec should contain:
- PART I: Requirements (Problem Statement, Requirements R1/R2/R3, Success Criteria, Out of Scope, Open Questions)
- PART II: High-Level Implementation Plan (phases by capability/feature)

If a project-specific template exists, follow that template's structure and format exactly.

## CRITICAL: Use Phase Table Format

You MUST use this table format in your Implementation Plan section:

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | [Capability description] | X days |
| Phase 2 | [Capability description] | X days |

Important:
- DO NOT create links to phase files
- DO NOT create actual phase plan files
- Just list phases with focus area and estimated effort
- Phase descriptions should be high-level capabilities, not implementation details

Good: "Backend API endpoints for job cancellation"
Bad: "Add cancel_job method to JobManager class"

## Spec Header

Use this header format:

```
# {description}

**Status**: Draft
**Created**: {createdAt}
**Timestamp**: {specTimestamp}
```

## Output Instructions

Write the spec to the EXACT path: {specPath}

Use the Write tool to save the file. Do NOT output the spec as text -- write it to the file.

The spec format is: {specFormat}
```

### 2c. Intent Classifier Prompt

**File**: `skills/spec-pipeline-core/prompts/intent_classifier.md`

This prompt is for the haiku-based intent classifier referenced in the spec's Q2. The engine does not use it yet (keyword heuristics in `_detect_transition_intent()` are used instead), but we create the template now so it is ready when the engine gains classifier support.

```markdown
You are classifying user intent in a discovery conversation.

The user has just responded to a discovery assumption. Determine whether they want to:
- CONTINUE: Keep exploring more assumptions and requirements
- TRANSITION: Move on to the next phase (drafting the spec)

## User Response

{user_input}

## Exchange Count

{exchange_count} exchanges so far (minimum: {min_exchanges})

## Classification Rules

- If the user explicitly says to move on, draft, proceed, or similar: TRANSITION
- If the user asks a follow-up question or provides detailed feedback: CONTINUE
- If the user gives a brief acknowledgment with no new questions: lean toward TRANSITION if exchange count >= minimum
- If exchange count < minimum: always CONTINUE regardless of user signal

Output ONLY one word: CONTINUE or TRANSITION
```

---

## Step 3: Create the Thin SKILL.md Dispatcher

**File**: `skills/spec/SKILL.md`

The current SKILL.md is ~370 lines of prose instructions. It is replaced with a thin dispatcher following the same pattern as `skills/brainstorm/SKILL.md`.

The condense-spec workflow stays as prose instructions because it has no multi-stage state machine -- it is a single-shot agent task with no discovery, approval, or commit stages. It could be migrated later or kept as-is.

```markdown
---
name: spec
description: "Create and manage technical specifications via discovery + drafting workflow, and condense implemented specs. Invoke on /spec, /spec-resume, /spec-status, /spec-list, /spec-cancel, /condense-spec commands."
---

# Spec

## Protocol

Read the instruction execution protocol in `skills/spec-pipeline-core/CORE.md` section "Engine Instruction Protocol".

## Commands

| User Command | Engine Call |
|---|---|
| `/spec <description>` | `python3 skills/spec-pipeline-core/engine.py spec start "<description>"` |
| `/spec --quick <description>` | `python3 skills/spec-pipeline-core/engine.py spec start "<description>" --quick` |
| `/spec --from-brainstorm <path> <description>` | `python3 skills/spec-pipeline-core/engine.py spec start "<description>" --from-brainstorm <path>` |
| `/spec-resume` | `python3 skills/spec-pipeline-core/engine.py spec resume` |
| `/spec-status` | `python3 skills/spec-pipeline-core/engine.py spec status` |
| `/spec-list` | `python3 skills/spec-pipeline-core/engine.py spec list` |
| `/spec-cancel` | `python3 skills/spec-pipeline-core/engine.py spec cancel` |

## Execution Loop

1. Run the matching engine call from the table above
2. Parse JSON instruction from stdout, execute per CORE.md section 6
3. If instruction has `then`, call it with result and go to step 2; otherwise stop

## Condense Spec (`/condense-spec`)

The condense-spec workflow is not engine-driven. Follow the instructions below directly.

### Target

Spec file path: `$1` (the argument after `/condense-spec`)

### When to Use

Use when a spec transitions from "Draft/Approved" to "Implemented" status. The code becomes the source of truth for implementation details; the spec should serve as architectural documentation explaining WHY decisions were made.

### Workflow

1. **Read** the spec file at `$1`, determine format (`.md` or `.typ`) from extension
2. **Verify** pre-conditions: spec status is "Implemented" or "Complete", feature is merged, tests exist
3. **Remove** implementation details: "Files to Modify", "Implementation Plan", "Test Cases" detailed lists, "Success Criteria" checklists, detailed code snippets, "Migration Guide", "Current State" sections
4. **Condense** sections: "API Changes" (final signature only), "Database Schema" (final form), "Usage Examples" (one clear example)
5. **Preserve** architecture: "Problem Statement", "Solution Overview", "Key Design Decisions", "Alternatives Considered", "Breaking Changes", "Future Enhancements", "Requirements"
6. **Restructure**: update status to "Implemented", target ~20-30% of original length
7. **Write** condensed version back to `$1`

### Key Principle

If in doubt: "Does this help someone understand the architecture?" If yes, keep. If no, remove.
```

---

## Step 4: Engine Code Adjustments

The existing engine code handles most of what the spec workflow needs. The following adjustments are required:

### 4a. Brainstorm Preload in Conversation Stage

**File**: `skills/spec-pipeline-core/engine/stages.py`

**Change**: In `handle_conversation()`, when the stage variant has a `preload` field pointing to a state field (e.g., `brainstormPath`), the engine needs to read that file and inject its content into the prompt context as `{brainstorm_content}`.

Current behavior: The conversation handler builds the prompt from `promptTemplate`, `project_context`, and `exchange_history`. It does not load any preload files.

Required change: Before rendering the prompt, check if the active variant has a `preload` field. If so, resolve the path from state, read the file, and add its content to the `extra` dict as `brainstorm_content`.

**Location**: `handle_conversation()`, in the `command in ("start", "next", "resume")` branch, after line 62 (`project_context = build_agent_context(...)`) and before `prompt = ctx.render_prompt(...)`.

Add:

```python
# Check for preload file (e.g., brainstorm document for --from-brainstorm variant)
preload_field = _get_variant_field(stage, state, "preload", None)
brainstorm_content = ""
if preload_field:
    preload_path = _get_nested(state, preload_field)
    if not preload_path:
        # Also check under discovery.brainstormPath
        preload_path = _get_nested(state, f"discovery.{preload_field}")
    if preload_path and os.path.exists(preload_path):
        with open(preload_path, "r") as f:
            brainstorm_content = f.read()
```

Then add `"brainstorm_content": brainstorm_content` to the `extra` dict.

This requires adding `import os` at the top of stages.py.

### 4b. Revision Feedback in Agent Stage

**File**: `skills/spec-pipeline-core/engine/stages.py`

**Change**: In `handle_agent()`, the prompt rendering should include `_revision_feedback` from state so the spec drafter can see what the user wants changed on revision iterations.

Current behavior: The agent handler assembles `project_context` and `exchange_history` in the extra dict. It does not include revision feedback.

Required change: In `handle_agent()`, in the `command in ("start", "next", "resume")` branch, add `_revision_feedback` to the extra dict:

```python
extra = {
    "project_context": project_context,
    "projectContext": project_context,
    "exchange_history": ctx.format_exchange_history(exchanges_field, style=exchange_style),
    "revision_feedback": state.get("_revision_feedback", ""),
}
```

This is a one-line addition to the existing `extra` dict at line 158.

### 4c. Discovery Summary in Agent Stage Extra Variables

**File**: `skills/spec-pipeline-core/engine/stages.py`

**Change**: The `handle_agent()` function needs to include `discovery_summary` in the extra variables so the spec drafter prompt's `{discovery_summary}` placeholder gets resolved.

Current behavior: The `build_variables()` function in `context.py` already flattens `state.discovery.summary` into `discovery_summary`. So `{discovery_summary}` should already resolve via the standard variable building in `render_prompt()`. No change needed here -- this is handled automatically.

However, we should verify this works by confirming that `render_prompt()` calls `build_variables()` which does the flattening. Reading `context.py` line 68: yes, it flattens nested dicts one level, so `state["discovery"]["summary"]` becomes `variables["discovery_summary"]`. This is correct.

### 4d. Transition Detection Phrases for Spec Discovery

**File**: `skills/spec-pipeline-core/engine/stages.py`

**Change**: The `_detect_transition_intent()` function has transition phrases oriented toward brainstorming ("done brainstorming", "let's synthesize"). Add spec-relevant phrases.

Current phrases already include: "move on", "let's proceed", "that covers it", "let's move to" -- these work for spec discovery too.

Add these additional phrases to the list:

```python
"let's draft", "lets draft", "ready to draft",
"start drafting", "draft the spec", "write the spec",
"/discovery-done", "discovery done",
```

### 4e. Approval Stage Draft Display

**File**: `skills/spec-pipeline-core/engine/stages.py`

**Change**: In `handle_approval()`, the current implementation includes the full draft content in the `ask_user` text (lines 216-223). For spec drafts, the content is already written to a file by the drafting agent. The approval stage should reference the file path instead of embedding the full draft (which could be very long).

Required change: Instead of embedding the full `specDraft` content, display a summary with the file path:

```python
if command in ("start", "next", "resume"):
    draft_field = stage.get("draftStateField", stage.get("outputStateField", "specDraft"))
    draft_content = state.get(draft_field, "")
    spec_path = state.get("specPath", "")

    review_text = ""
    if spec_path:
        review_text = (f"The spec has been written to `{spec_path}`. "
                      f"Please review it.\n\n---\n\n")
    elif draft_content:
        # Truncate if too long
        if len(draft_content) > 2000:
            review_text = f"## Draft (truncated)\n\n{draft_content[:2000]}...\n\n---\n\n"
        else:
            review_text = f"## Draft\n\n{draft_content}\n\n---\n\n"

    review_text += ("Please review the draft. Reply with:\n"
                   "- **approve** to accept\n"
                   "- Or describe the changes you'd like to see")
```

Actually, the simpler approach is to keep the current behavior. The spec drafter agent writes the file AND the agent output is stored in `specDraft`. The approval stage can just reference the file. But the current code already works -- it shows the draft and asks for approval. The LLM will have already seen the file written by the agent. So we leave the approval handler mostly as-is but make one small improvement: if `specPath` is in state, mention it in the review text.

This is a minor quality improvement, not a blocker. The current approval handler works correctly for the spec workflow without changes.

### Summary of Engine Changes

| File | Change | Priority |
|------|--------|----------|
| `stages.py` | Add preload file reading in `handle_conversation()` for `--from-brainstorm` | Required |
| `stages.py` | Add `revision_feedback` to extra dict in `handle_agent()` | Required |
| `stages.py` | Add spec discovery transition phrases to `_detect_transition_intent()` | Required |
| `stages.py` | Add `import os` at top | Required (for preload) |

No changes needed to `runner.py`, `context.py`, `state.py`, `instructions.py`, `config.py`, or `CORE.md`.

---

## Step 5: Exact File Contents

Below are the exact contents for each new or modified file.

### 5a. `skills/spec-pipeline-core/workflows/spec.json`

```json
{
  "name": "spec",
  "stateType": "specs",
  "commands": {
    "start": {
      "description": "Create a new spec",
      "args": ["description"],
      "flags": ["--quick", "--from-brainstorm"]
    },
    "resume": { "description": "Resume active spec" },
    "status": { "description": "Show all spec statuses" },
    "list": { "description": "List spec IDs" },
    "cancel": { "description": "Cancel active spec" }
  },
  "stateSchema": {
    "description": "string",
    "stage": "string",
    "discovery": {
      "exchanges": "array",
      "summary": "string|null",
      "skipped": "boolean",
      "brainstormPath": "string|null"
    },
    "specTimestamp": "string",
    "specFilename": "string",
    "specPath": "string",
    "specDraft": "string",
    "specApproved": "boolean",
    "specIteration": "number",
    "checkpoints": "array"
  },
  "stages": [
    {
      "name": "discovery",
      "type": "conversation",
      "skipWhen": ["--quick"],
      "variant": {
        "default": {
          "minExchanges": 3,
          "maxExchanges": 7,
          "promptTemplate": "discovery.md"
        },
        "--from-brainstorm": {
          "minExchanges": 2,
          "maxExchanges": 4,
          "promptTemplate": "discovery.md",
          "preload": "brainstormPath"
        }
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

### 5b. `skills/spec-pipeline-core/prompts/discovery.md`

```markdown
You are a requirements discovery expert helping to gather information before writing a technical specification.

Your task is to identify ambiguities and gaps, then propose the most likely solution for each -- one at a time -- for the user to confirm or correct.

{projectContext}

## Description

{description}

## Prior Exchanges

{exchange_history}

## Brainstorm Context

{brainstorm_content}

## Your Role

You are conducting a discovery session to understand the user's requirements better. Your goal is to:
1. Identify ambiguities and gaps in the initial description
2. Uncover edge cases and error scenarios
3. Understand non-functional requirements (performance, security, scalability)
4. Clarify integration points with existing systems
5. Define scope boundaries (what is in scope vs. out of scope)

## Approach: Assume & Confirm (One at a Time)

1. Explore the codebase to understand the context
2. Identify the most important ambiguity or gap
3. Propose your best assumption for how it should work
4. Explain your reasoning -- why you think this is the right approach (reference codebase evidence)
5. Ask the user to confirm or correct your assumption

Present ONE assumption per exchange. Prioritize the most impactful decisions first.

## Discovery Categories

1. **Functional Requirements** -- expected behaviors, inputs/outputs, user workflows
2. **Edge Cases & Error Handling** -- failure modes, invalid inputs, boundary conditions
3. **Non-Functional Requirements** -- performance, security, scalability constraints
4. **Integration & Dependencies** -- interaction with existing features, external dependencies
5. **Scope & Constraints** -- what is out of scope, MVP vs. nice-to-have

## Mode-Specific Guidance

If brainstorm context is provided above, this is a **targeted discovery** session:
- The brainstorm has already covered high-level directions, scope, and functional requirements
- Focus your assumptions on the **gaps** the brainstorm likely missed: edge cases, error handling, non-functional requirements, and integration details
- Keep the session short (2-4 exchanges) -- do not re-explore what the brainstorm already covered
- Reference specific findings from the brainstorm when grounding your assumptions

If no brainstorm context is provided, this is a **full discovery** session:
- Cover all five discovery categories
- Aim for 3-7 exchanges covering the most important ambiguities
- Start with the highest-impact decisions (usually functional requirements and scope)

Always ground your assumptions in codebase evidence or established best practices. Do NOT write specification content yet.

If the conversation has covered the important gaps and new exchanges are not surfacing fresh insights, suggest that the user move to drafting.
```

### 5c. `skills/spec-pipeline-core/prompts/spec_drafter.md`

```markdown
You are an expert software architect drafting technical specifications.

Your task is to create a clear, actionable technical specification.

{projectContext}

## Description

{description}

## Discovery Summary

{discovery_summary}

## Revision Feedback

{revision_feedback}

## Spec Structure

The spec should contain:
- PART I: Requirements (Problem Statement, Requirements R1/R2/R3, Success Criteria, Out of Scope, Open Questions)
- PART II: High-Level Implementation Plan (phases by capability/feature)

If a project-specific template exists, follow that template's structure and format exactly.

## CRITICAL: Use Phase Table Format

You MUST use this table format in your Implementation Plan section:

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | [Capability description] | X days |
| Phase 2 | [Capability description] | X days |

Important:
- DO NOT create links to phase files
- DO NOT create actual phase plan files
- Just list phases with focus area and estimated effort
- Phase descriptions should be high-level capabilities, not implementation details

Good: "Backend API endpoints for job cancellation"
Bad: "Add cancel_job method to JobManager class"

## Spec Header

Use this header format:

```
# {description}

**Status**: Draft
**Created**: {createdAt}
**Timestamp**: {specTimestamp}
```

## Output Instructions

Write the spec to the EXACT path: {specPath}

Use the Write tool to save the file. Do NOT output the spec as text -- write it to the file.

The spec format is: {specFormat}
```

### 5d. `skills/spec-pipeline-core/prompts/intent_classifier.md`

```markdown
You are classifying user intent in a discovery conversation.

The user has just responded to a discovery assumption. Determine whether they want to:
- CONTINUE: Keep exploring more assumptions and requirements
- TRANSITION: Move on to the next phase (drafting the spec)

## User Response

{user_input}

## Exchange Count

{exchange_count} exchanges so far (minimum: {min_exchanges})

## Classification Rules

- If the user explicitly says to move on, draft, proceed, or similar: TRANSITION
- If the user asks a follow-up question or provides detailed feedback: CONTINUE
- If the user gives a brief acknowledgment with no new questions: lean toward TRANSITION if exchange count >= minimum
- If exchange count < minimum: always CONTINUE regardless of user signal

Output ONLY one word: CONTINUE or TRANSITION
```

### 5e. Engine Code Changes to `stages.py`

**Change 1**: Add `import os` to imports (line 4 area):

```python
# Add after existing imports
import os
```

**Change 2**: Add preload file reading in `handle_conversation()`. In the `command in ("start", "next", "resume")` branch, after line 62 and before the `extra` dict construction at line 63:

```python
        # Check for preload file (e.g., brainstorm document for --from-brainstorm)
        preload_field = _get_variant_field(stage, state, "preload", None)
        brainstorm_content = ""
        if preload_field:
            preload_path = _get_nested(state, f"discovery.{preload_field}")
            if not preload_path:
                preload_path = _get_nested(state, preload_field)
            if preload_path and os.path.exists(preload_path):
                with open(preload_path, "r") as f:
                    brainstorm_content = f.read()
```

Then add to the `extra` dict:

```python
            extra = {
                "project_context": project_context,
                "projectContext": project_context,
                "exchange_history": ctx.format_exchange_history(
                    exchanges, style=stage.get("exchangeStyle", "discovery")
                ),
                "brainstorm_content": brainstorm_content,
            }
```

**Change 3**: Add `revision_feedback` to the extra dict in `handle_agent()`, at line ~158:

```python
        extra = {
            "project_context": project_context,
            "projectContext": project_context,
            "exchange_history": ctx.format_exchange_history(exchanges_field, style=exchange_style),
            "revision_feedback": state.get("_revision_feedback", ""),
        }
```

**Change 4**: Add spec-oriented transition phrases to `_detect_transition_intent()`, extending the list at line ~577:

```python
        "let's draft", "lets draft", "ready to draft",
        "start drafting", "draft the spec", "write the spec",
        "/discovery-done", "discovery done",
        "let's move to drafting", "lets move to drafting",
```

### 5f. New SKILL.md for Spec

**File**: `skills/spec/SKILL.md` (replaces existing file)

See section 3 above for exact contents. The current SKILL.md should be preserved as `skills/spec/SKILL.md.bak` before replacement, per the migration strategy in the spec.

---

## Step 6: Validation Plan

After implementing all changes:

1. **Start flow** (`/spec "add user authentication"`):
   - Verify engine starts discovery stage
   - Verify 3-7 exchanges with assume-and-confirm pattern
   - Verify transition detection works (keyword "let's draft")
   - Verify drafting agent receives discovery summary
   - Verify approval loop presents draft and accepts "approve"
   - Verify commit stage generates message and commits

2. **Quick mode** (`/spec --quick "add user authentication"`):
   - Verify discovery is skipped entirely
   - Verify state shows `discovery.skipped: true`
   - Verify drafting starts immediately with empty discovery summary

3. **From-brainstorm mode** (`/spec --from-brainstorm docs/brainstorm.md "add user authentication"`):
   - Verify brainstorm document is read and injected into discovery prompt
   - Verify targeted discovery (2-4 exchanges, gap-focused)
   - Verify discovery summary includes brainstorm context

4. **Approval revision loop**:
   - Reject the first draft with feedback
   - Verify drafting agent receives revision feedback
   - Verify iteration counter increments
   - Approve on second attempt
   - Verify commit proceeds

5. **Resume** (`/spec-resume`):
   - Start a spec, interrupt mid-discovery
   - Resume and verify it picks up at the correct exchange

6. **Backward compatibility**:
   - Verify existing spec state files (if any) load without errors
   - Verify `apply_schema_defaults()` fills missing fields

---

## Execution Order

1. Back up `skills/spec/SKILL.md` to `skills/spec/SKILL.md.bak`
2. Create `skills/spec-pipeline-core/workflows/spec.json`
3. Create `skills/spec-pipeline-core/prompts/discovery.md`
4. Create `skills/spec-pipeline-core/prompts/spec_drafter.md`
5. Create `skills/spec-pipeline-core/prompts/intent_classifier.md`
6. Apply engine changes to `skills/spec-pipeline-core/engine/stages.py`
7. Replace `skills/spec/SKILL.md` with thin dispatcher
8. Run validation tests (manual)

Steps 2-5 can be done in parallel. Step 6 depends on reading the current stages.py. Step 7 depends on step 1. Step 8 depends on all prior steps.
