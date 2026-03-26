---
name: brainstorm
description: "Open-ended divergent exploration and brainstorming sessions with synthesis into structured documents. Invoke on /brainstorm commands."
---

# Brainstorm

Open-ended divergent exploration sessions that surface tradeoffs, risks, and opportunities — then synthesize findings into a structured document.

## Prerequisites

**Before executing any command**, read the core protocols:
> Read `skills/spec-pipeline-core/CORE.md`

Configuration, state management, git operations, and shared prompts are defined there.
This file only contains brainstorm-specific workflow and prompts.

## 1. Command Reference

| Command | Description |
|---------|-------------|
| `/brainstorm <description>` | Start a brainstorming session |

## 2. Brainstorm State Schema

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

## 3. Brainstorming Workflow (`/brainstorm`)

### Step 1: Initialize

1. Load configuration: `bash skills/spec-pipeline-core/config.sh load-config`
2. Initialize state directory: `bash skills/spec-pipeline-core/state.sh init`
3. Generate pipeline ID: `bash skills/spec-pipeline-core/state.sh generate-id`
4. Generate timestamp: `bash skills/spec-pipeline-core/state.sh generate-timestamp`
5. Derive short name: `bash skills/spec-pipeline-core/config.sh derive-short-name "<description>"`
6. Create initial brainstorm state with `stage: "brainstorming"`
7. Save state

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

### Step 3: Synthesis

**Transition detection**: Move to synthesis when the user signals they're done exploring. Watch for natural-language cues such as:
- "I think that covers it", "let's wrap up", "I'm done", "let's synthesize"
- "what do we have so far?", "can you summarize?"
- Or the user types `/brainstorm-done` (legacy alternative)

Also proactively suggest moving to synthesis when the brainstorm has covered multiple angles and new exchanges aren't surfacing fresh insights.

When transitioning to synthesis:

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

3. Construct the output path:
   ```bash
   bash skills/spec-pipeline-core/config.sh construct-paths \
     --specs-dir {specsDir} --timestamp {timestamp} \
     --short-name {short_name} --format {specFormat} --type brainstorm
   ```
4. Write the document to the constructed path
5. Commit: `bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --files "{docPath}" --message "{commitMsg}"`
   Generate commit message via `Agent(model: haiku, prompt: <commitMessageWriter prompt + diff>)` — see CORE.md §5 for the prompt.
6. Set `state.synthesisPath` to the file path
7. Set `state.stage = "completed"`
8. Save state

## 4. System Prompts

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
