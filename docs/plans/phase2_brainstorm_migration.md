# Phase 2: Brainstorm Migration Plan

**Status**: Ready for implementation
**Created**: 2026-03-26
**Depends on**: Phase 1 (Engine core) -- completed

---

## Overview

Migrate the brainstorm skill from the prose-driven SKILL.md to the engine-driven workflow. This involves:

1. Creating `workflows/brainstorm.json` -- the declarative workflow definition
2. Creating prompt templates in `prompts/` -- brainstorm agent and synthesis prompts
3. Replacing the current `skills/brainstorm/SKILL.md` with a thin dispatcher
4. Adding the "Engine Instruction Protocol" section to `skills/spec-pipeline-core/CORE.md`
5. Adjusting engine code to handle brainstorm-specific conversation semantics
6. End-to-end validation

---

## Step 1: Create the Workflow Definition

**File**: `skills/spec-pipeline-core/workflows/brainstorm.json`

The brainstorm workflow has three stages: `brainstorming` (conversation), `synthesis` (agent), and `commit`.

The `brainstorming` stage is a `conversation` type, but unlike discovery it uses a different exchange format (`topic`/`discussion` instead of `assumption`/`response`) and different transition semantics (user signals done, rather than categories being covered). The conversation stage handler already supports custom `stateField` and the context module already supports `brainstorm` style formatting.

Key design decisions:
- `stateField` is `"exchanges"` (top-level, not nested under `discovery`) matching the existing brainstorm state schema
- `exchangeStyle` is a new field we add to the conversation stage to tell the engine which format to use for exchange recording and history formatting
- The `modelKey` for the brainstorm agent is `"brainstormAgent"` -- not in default config models, so it defaults to `"sonnet"` via `config.model_for()`
- The synthesis agent writes the document to `{synthesisPath}`, which is computed at start time via `construct-paths` with type `brainstorm`
- Transition detection: user signals done (no intent classifier needed -- just check max exchanges and user cues)

```json
{
  "name": "brainstorm",
  "stateType": "brainstorms",
  "commands": {
    "start": { "description": "Start a brainstorming session", "args": ["description"] },
    "resume": { "description": "Resume active brainstorm" },
    "status": { "description": "Show brainstorm statuses" },
    "list": { "description": "List brainstorm IDs" },
    "cancel": { "description": "Cancel active brainstorm" }
  },
  "stateSchema": {
    "description": "string",
    "stage": "string",
    "exchanges": "array",
    "synthesisPath": "string|null"
  },
  "stages": [
    {
      "name": "brainstorming",
      "type": "conversation",
      "promptTemplate": "brainstorm_agent.md",
      "modelKey": "brainstormAgent",
      "stateField": "exchanges",
      "exchangeStyle": "brainstorm",
      "agentOutputKey": "topic",
      "userInputKey": "discussion",
      "minExchanges": 3,
      "maxExchanges": 10,
      "transitionTo": "synthesis"
    },
    {
      "name": "synthesis",
      "type": "agent",
      "promptTemplate": "brainstorm_synthesis.md",
      "modelKey": "brainstormAgent",
      "outputStateField": "synthesisDraft",
      "outputFile": "{synthesisPath}",
      "transitionTo": "commit"
    },
    {
      "name": "commit",
      "type": "commit",
      "files": ["{synthesisPath}"],
      "commitRole": "brainstormAgent",
      "transitionTo": "completed"
    }
  ],
  "completion": {
    "message": "Brainstorm saved to `{synthesisPath}`.",
    "nextStep": "/spec --from-brainstorm {synthesisPath} \"{description}\""
  }
}
```

**Verification**:
```bash
python3 -c "import json; d=json.load(open('skills/spec-pipeline-core/workflows/brainstorm.json')); print(f'OK: {len(d[\"stages\"])} stages'); assert d['stateType'] == 'brainstorms'"
```

---

## Step 2: Create Prompt Templates

### 2a: Brainstorm Agent Prompt

**File**: `skills/spec-pipeline-core/prompts/brainstorm_agent.md`

This is the prompt sent to the agent for each brainstorming exchange. It includes the project context, the topic description, prior exchange history, and the brainstorming rules from the current SKILL.md.

```markdown
You are a creative thought partner helping to explore and brainstorm ideas before any formal planning begins.

{projectContext}

## Topic

{description}

## Prior Exchanges

{exchange_history}

## Your Role

1. Explore the codebase to understand what exists and what constraints apply
2. Focus this exchange on one concept or problem -- explore from multiple angles before moving on
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

If the conversation has covered multiple angles and new exchanges are not surfacing fresh insights, suggest that the user move to synthesis.
```

### 2b: Brainstorm Synthesis Prompt

**File**: `skills/spec-pipeline-core/prompts/brainstorm_synthesis.md`

This prompt is used for the synthesis stage -- a single agent call that generates the final brainstorm document from the conversation history.

```markdown
You are synthesizing a brainstorming session into a structured document.

{projectContext}

## Topic

{description}

## Conversation History

{exchange_history}

## Task

Generate a synthesis document from the brainstorming session above. Use exactly this structure:

```
# Brainstorm: {description}

**Status**: Draft
**Created**: {createdAt}
**Timestamp**: {brainstormTimestamp}

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
[Feature, epic, or roadmap-level effort -- and why]
```

Output ONLY the document content, nothing else. Do not wrap in code fences.
```

**Verification**:
```bash
test -f skills/spec-pipeline-core/prompts/brainstorm_agent.md && echo "brainstorm_agent.md OK"
test -f skills/spec-pipeline-core/prompts/brainstorm_synthesis.md && echo "brainstorm_synthesis.md OK"
```

---

## Step 3: Engine Code Adjustments

The Phase 1 engine already handles conversation, agent, and commit stages. However, the brainstorm workflow has some specific needs that require small adjustments.

### 3a: Conversation stage -- support `exchangeStyle`, `agentOutputKey`, and `userInputKey`

**File**: `skills/spec-pipeline-core/engine/stages.py`

The conversation handler currently hardcodes exchange recording as `{"assumption": ..., "response": ...}`. For brainstorm, the keys should be `{"topic": ..., "discussion": ...}`. The stage definition now carries `agentOutputKey` and `userInputKey` fields.

**Change in `handle_conversation`** -- find the exchange recording block in `user-responded` and replace:

```python
# CURRENT (line ~90-94):
        exchange = {
            "assumption": state.pop("_pending_agent_output", ""),
            "response": input_text or "",
        }
```

Replace with:

```python
# NEW:
        agent_key = stage.get("agentOutputKey", "assumption")
        user_key = stage.get("userInputKey", "response")
        exchange = {
            agent_key: state.pop("_pending_agent_output", ""),
            user_key: input_text or "",
        }
```

**Change in `handle_conversation`** -- pass the `exchangeStyle` to `format_exchange_history`:

Find where `ctx.format_exchange_history(exchanges)` is called (in the `start`/`next`/`resume` branch) and replace:

```python
# CURRENT (line ~67):
                "exchange_history": ctx.format_exchange_history(exchanges),
```

Replace with:

```python
# NEW:
                "exchange_history": ctx.format_exchange_history(
                    exchanges, style=stage.get("exchangeStyle", "discovery")
                ),
```

### 3b: Handle `synthesisPath` computation in `_handle_start`

**File**: `skills/spec-pipeline-core/engine/runner.py`

The current `_handle_start` computes paths using `construct_paths` with `path_type=workflow_name`. For brainstorm, this produces a path like `docs/specs/2603261234_brainstorm_caching_strategies.md` -- which is correct because `config.sh construct-paths --type brainstorm` adds the `brainstorm_` prefix.

However, the current code only sets path fields that end in `Path` and don't equal `brainstormPath`. The `synthesisPath` field needs to be populated.

**Find** in `_handle_start` (around lines 106-111):

```python
    for key in schema:
        if "Path" in key or "path" in key:
            if key.endswith("Path") and key != "brainstormPath":
                extra_fields[key] = paths.get("path", "")
        if "Filename" in key or "filename" in key:
            extra_fields[key] = paths.get("filename", "")
```

**Replace with**:

```python
    for key in schema:
        if key.endswith("Path") and key != "brainstormPath":
            if "Path" in key or "path" in key:
                extra_fields[key] = paths.get("path", "")
        if "Filename" in key or "filename" in key:
            extra_fields[key] = paths.get("filename", "")
```

Wait -- actually the current code already handles `synthesisPath` correctly. `synthesisPath` ends with `Path` and is not `brainstormPath`, so `extra_fields["synthesisPath"] = paths.get("path", "")` will be set. The condition `"Path" in key or "path" in key` is true for `synthesisPath`, and `key.endswith("Path") and key != "brainstormPath"` is also true. So this works as-is.

Let me verify the flow more carefully. `construct_paths` is called with `path_type=workflow_name` which is `"brainstorm"`. This calls `config.sh construct-paths --type brainstorm` which produces `{timestamp}_brainstorm_{short_name}.md`. The path will be something like `docs/specs/2603261234_brainstorm_caching_strategies.md`. This is correct.

**No change needed in runner.py for path handling.**

### 3c: Context module -- pass `exchangeStyle` to `format_exchange_history` in `handle_agent`

**File**: `skills/spec-pipeline-core/engine/stages.py`

The `handle_agent` stage (used for the synthesis stage) also calls `format_exchange_history` when building the prompt. Currently it hardcodes the discovery style. For brainstorm synthesis, we need the brainstorm style.

**Find** in `handle_agent` (around line 143-148):

```python
        project_context = build_agent_context(model_key)
        exchanges_field = state.get("discovery", {}).get("exchanges", [])
        extra = {
            "project_context": project_context,
            "projectContext": project_context,
            "exchange_history": ctx.format_exchange_history(exchanges_field),
        }
```

The problem here is that `exchanges_field` reads from `state.discovery.exchanges` which is the spec/implement path. For brainstorm, exchanges are at `state.exchanges` (top-level).

**Replace with**:

```python
        project_context = build_agent_context(model_key)
        # Try discovery.exchanges first (spec/implement), then top-level exchanges (brainstorm)
        exchanges_field = state.get("discovery", {}).get("exchanges", [])
        if not exchanges_field:
            exchanges_field = state.get("exchanges", [])
        # Determine exchange formatting style from stage or workflow context
        exchange_style = stage.get("exchangeStyle", "discovery")
        extra = {
            "project_context": project_context,
            "projectContext": project_context,
            "exchange_history": ctx.format_exchange_history(exchanges_field, style=exchange_style),
        }
```

**Verification**:
```bash
cd /home/istar/code/ai_tools && python3 -c "
from skills.spec_pipeline_core_engine_test import *
" 2>&1 || echo "(No test module -- manual verification needed)"

# Verify syntax:
python3 -c "import ast; ast.parse(open('skills/spec-pipeline-core/engine/stages.py').read()); print('stages.py syntax OK')"
python3 -c "import ast; ast.parse(open('skills/spec-pipeline-core/engine/runner.py').read()); print('runner.py syntax OK')"
```

---

## Step 4: Add Engine Instruction Protocol to CORE.md

**File**: `skills/spec-pipeline-core/CORE.md`

Append a new section (section 6) to the end of CORE.md.

**Append the following**:

```markdown

## 6. Engine Instruction Protocol

When a skill uses the workflow engine, the LLM acts as a dispatcher: it calls the engine, receives a JSON instruction, executes it, and loops.

### Engine Location

```
python3 skills/spec-pipeline-core/engine.py <workflow> <command> [args] [flags]
```

### Instruction Envelope

Every engine call prints one JSON object to stdout:

```json
{
  "action": "<instruction_type>",
  "then": "python3 skills/spec-pipeline-core/engine.py <workflow> <next-command> --id <id> [--result-arg]",
  ...action-specific fields...
}
```

### Instruction Execution Mapping

Execute each instruction type as follows:

| Instruction | Fields | LLM Execution |
|---|---|---|
| `call_agent` | `model`, `prompt`, `then` | Use the **Agent** tool with the given `model` and `prompt`. Capture the agent's text output. Pass to `then` as `--output "<text>"` (or write to a temp file and use `--output-file <path>` if output exceeds 10000 characters). |
| `ask_user` | `text`, `then` | Display `text` to the user as markdown. Wait for their reply. Pass the reply to `then` as `--input "<text>"`. |
| `present` | `text`, `then` | Display `text` to the user as markdown. Immediately call `then` (no user input needed). |
| `write_file` | `path`, `content`, `then` | Use the **Write** tool to write `content` to `path`. Then call `then`. |
| `read_file` | `path`, `then` | Use the **Read** tool to read `path`. Pass file contents to `then` as `--content "<text>"` (or `--content-file`). |
| `run_command` | `command`, `then` | Use the **Bash** tool to execute `command`. Pass stdout to `then` as `--output "<text>"` (or `--output-file`). |
| `done` | `text` | Display `text` to the user. **Stop** -- no further engine calls. |
| `error` | `message` | Display `message` as an error to the user. **Stop** -- no further engine calls. |

### Large Output Handling

When an instruction's result exceeds 10000 characters:
1. Write the result to a temporary file (e.g., `/tmp/engine_result_<random>.txt`)
2. Use the `-file` variant of the argument flag (e.g., `--output-file /tmp/engine_result_abc.txt` instead of `--output "..."`)
3. The engine reads the file content and deletes the temp file

### Execution Loop

```
1. Parse the user's command and flags
2. Run the matching engine call (see skill's command table)
3. Parse the JSON instruction from engine stdout
4. Execute the instruction per the table above
5. If the instruction has a `then` field:
   - Substitute the result into the `then` command
   - Run that command
   - Go to step 3
6. If no `then` field (done or error): stop
```

### Error Handling

- If the engine prints invalid JSON, display the raw output as an error and stop.
- If a `run_command` fails (non-zero exit), still pass stdout/stderr to `then` -- the engine decides how to handle failures.
- If an `Agent` tool call fails, pass the error message to `then` as `--output "ERROR: <message>"`.
```

**Verification**:
```bash
grep -c "Engine Instruction Protocol" skills/spec-pipeline-core/CORE.md
# Expected: at least 1
```

---

## Step 5: Create Thin SKILL.md Dispatcher

**File**: `skills/brainstorm/SKILL.md`

Replace the entire current SKILL.md (180 lines) with a thin dispatcher (~25 lines). Save the current one as `SKILL.md.bak` first.

### 5a: Back up current SKILL.md

```bash
cp skills/brainstorm/SKILL.md skills/brainstorm/SKILL.md.bak
```

### 5b: Write new SKILL.md

```markdown
---
name: brainstorm
description: "Open-ended divergent exploration and brainstorming sessions with synthesis into structured documents. Invoke on /brainstorm, /brainstorm-resume, /brainstorm-status, /brainstorm-list, /brainstorm-cancel commands."
---

# Brainstorm

## Protocol

Read the instruction execution protocol in `skills/spec-pipeline-core/CORE.md` section "Engine Instruction Protocol".

## Commands

| User Command | Engine Call |
|---|---|
| `/brainstorm <description>` | `python3 skills/spec-pipeline-core/engine.py brainstorm start "<description>"` |
| `/brainstorm-resume` | `python3 skills/spec-pipeline-core/engine.py brainstorm resume` |
| `/brainstorm-status` | `python3 skills/spec-pipeline-core/engine.py brainstorm status` |
| `/brainstorm-list` | `python3 skills/spec-pipeline-core/engine.py brainstorm list` |
| `/brainstorm-cancel` | `python3 skills/spec-pipeline-core/engine.py brainstorm cancel` |

## Execution Loop

1. Parse the user's command and flags from their message
2. Run the matching engine call from the table above
3. Parse the JSON instruction from stdout
4. Execute the instruction per CORE.md section 6 "Engine Instruction Protocol"
5. If the instruction has a `then` field, call that command with the result and go to step 3
6. If no `then` field (`done` or `error`), stop
```

**Verification**:
```bash
wc -l skills/brainstorm/SKILL.md
# Expected: under 30 lines (success criterion S3)

# Verify backup exists:
test -f skills/brainstorm/SKILL.md.bak && echo "Backup OK"

# Verify frontmatter parses:
head -4 skills/brainstorm/SKILL.md
```

---

## Step 6: End-to-End Validation

### 6a: Dry-run engine start

```bash
cd /home/istar/code/ai_tools
python3 skills/spec-pipeline-core/engine.py brainstorm start "Explore caching strategies for API responses"
```

**Expected output**: A JSON `call_agent` instruction with:
- `action`: `"call_agent"`
- `model`: `"sonnet"` (default for unmapped role)
- `prompt`: Contains "creative thought partner", project context, and the description
- `then`: `"python3 skills/spec-pipeline-core/engine.py brainstorm agent-done --id <id> --output"`

### 6b: Simulate agent-done

Take the `--id` from step 6a and run:

```bash
python3 skills/spec-pipeline-core/engine.py brainstorm agent-done --id <ID> --output "Let me explore the caching strategies. One interesting angle is cache invalidation patterns..."
```

**Expected output**: A JSON `ask_user` instruction with the agent output as `text`.

### 6c: Simulate user-responded

```bash
python3 skills/spec-pipeline-core/engine.py brainstorm user-responded --id <ID> --input "Good point about invalidation. What about TTL-based approaches?"
```

**Expected output**: Another `call_agent` instruction (exchange count < minExchanges, so continues).

### 6d: Simulate transition (after enough exchanges)

After recording minExchanges (3) exchanges, respond with a transition intent:

```bash
python3 skills/spec-pipeline-core/engine.py brainstorm user-responded --id <ID> --input "I think that covers it, let's synthesize" --intent TRANSITION
```

**Expected output**: A `present` instruction saying "Discovery complete (N exchanges). Moving to synthesis." followed by a `then` pointing to `next`.

### 6e: Verify synthesis stage

```bash
python3 skills/spec-pipeline-core/engine.py brainstorm next --id <ID>
```

**Expected output**: A `call_agent` instruction with the synthesis prompt containing the exchange history.

### 6f: Verify state file

```bash
cat .claude/spec-pipeline/brainstorms/<ID>.json | python3 -m json.tool
```

**Expected**: State has `stage`, `exchanges` array with recorded exchanges, `synthesisPath`, etc.

### 6g: Status and list commands

```bash
python3 skills/spec-pipeline-core/engine.py brainstorm status
python3 skills/spec-pipeline-core/engine.py brainstorm list
```

### 6h: Cancel command

```bash
python3 skills/spec-pipeline-core/engine.py brainstorm cancel
```

**Expected**: `done` instruction with cancellation message.

### 6i: Resume command

Start a new brainstorm, then verify resume picks it up:

```bash
python3 skills/spec-pipeline-core/engine.py brainstorm start "Test resume flow"
python3 skills/spec-pipeline-core/engine.py brainstorm resume
```

**Expected**: `call_agent` instruction that continues from the current stage.

---

## Step 7: Verify Backward Compatibility

### 7a: Existing state files

If there are any existing brainstorm state files in `.claude/spec-pipeline/brainstorms/`, verify they load:

```bash
ls .claude/spec-pipeline/brainstorms/*.json 2>/dev/null
# If any exist, try resume:
python3 skills/spec-pipeline-core/engine.py brainstorm resume
```

The engine should apply schema defaults for any missing fields and continue.

### 7b: Old exchange format compatibility

Old brainstorm state files may have exchanges with `{"assumption": "...", "response": "..."}` keys (the old format). The `format_exchange_history` function with `style="brainstorm"` already handles this via fallback: `ex.get("topic", ex.get("assumption", ""))`. No code change needed.

---

## Summary of All File Changes

### New files to create:

| File | Description |
|---|---|
| `skills/spec-pipeline-core/workflows/brainstorm.json` | Workflow definition |
| `skills/spec-pipeline-core/prompts/brainstorm_agent.md` | Brainstorm agent prompt template |
| `skills/spec-pipeline-core/prompts/brainstorm_synthesis.md` | Synthesis agent prompt template |
| `skills/brainstorm/SKILL.md.bak` | Backup of old SKILL.md |

### Files to modify:

| File | Change |
|---|---|
| `skills/brainstorm/SKILL.md` | Replace with thin dispatcher (~25 lines) |
| `skills/spec-pipeline-core/CORE.md` | Append section 6: Engine Instruction Protocol |
| `skills/spec-pipeline-core/engine/stages.py` | Support `exchangeStyle`, `agentOutputKey`, `userInputKey` in conversation handler; support flexible exchange lookup in agent handler |

### Files unchanged:

| File | Reason |
|---|---|
| `skills/spec-pipeline-core/engine.py` | CLI entry point already handles all needed commands |
| `skills/spec-pipeline-core/engine/runner.py` | Path handling already works for `synthesisPath` |
| `skills/spec-pipeline-core/engine/instructions.py` | All needed instruction types exist |
| `skills/spec-pipeline-core/engine/context.py` | Already supports brainstorm-style exchange formatting |
| `skills/spec-pipeline-core/engine/state.py` | State operations work as-is |
| `skills/spec-pipeline-core/engine/config.py` | Config loading works as-is |
| `skills/spec-pipeline-core/config.sh` | Shell script unchanged |
| `skills/spec-pipeline-core/state.sh` | Shell script unchanged |
| `skills/spec-pipeline-core/parse.sh` | Not used by brainstorm |
| `skills/spec-pipeline-core/git-helpers.sh` | Called unchanged via `run_command` |

---

## Completion Checklist

- [ ] `workflows/brainstorm.json` created and valid JSON
- [ ] `prompts/brainstorm_agent.md` created with project context, exchange history, and brainstorm rules
- [ ] `prompts/brainstorm_synthesis.md` created with synthesis document structure
- [ ] `engine/stages.py` updated: conversation handler uses `agentOutputKey`/`userInputKey` for exchange recording
- [ ] `engine/stages.py` updated: conversation handler passes `exchangeStyle` to `format_exchange_history`
- [ ] `engine/stages.py` updated: agent handler finds exchanges from top-level `state.exchanges` as fallback
- [ ] `engine/stages.py` updated: agent handler passes `exchangeStyle` to `format_exchange_history`
- [ ] `CORE.md` section 6 "Engine Instruction Protocol" appended
- [ ] `skills/brainstorm/SKILL.md.bak` backup created
- [ ] `skills/brainstorm/SKILL.md` replaced with thin dispatcher (under 30 lines)
- [ ] Dry-run: `engine.py brainstorm start` returns valid `call_agent` instruction
- [ ] Dry-run: `engine.py brainstorm agent-done` returns valid `ask_user` instruction
- [ ] Dry-run: `engine.py brainstorm user-responded` records exchange and continues
- [ ] Dry-run: transition to synthesis works after enough exchanges
- [ ] Dry-run: synthesis stage emits `call_agent` with proper prompt
- [ ] Dry-run: commit stage emits `run_command` for git commit
- [ ] Dry-run: completion returns `done` with suggested next step
- [ ] `engine.py brainstorm status` works
- [ ] `engine.py brainstorm list` works
- [ ] `engine.py brainstorm cancel` works
- [ ] `engine.py brainstorm resume` works
- [ ] Backward compatibility: old state files load without error
- [ ] SKILL.md is under 30 lines (S3 success criterion)

---

## Implementation Order

Execute steps in this order to minimize risk:

1. **Step 3** (engine code adjustments) -- changes are backward-compatible, nothing breaks
2. **Step 1** (workflow definition) -- just a new JSON file
3. **Step 2** (prompt templates) -- just new .md files
4. **Step 6a-6f** (dry-run validation) -- verify engine works before touching SKILL.md
5. **Step 4** (CORE.md additions) -- documentation only
6. **Step 5** (SKILL.md replacement) -- the actual cutover
7. **Step 6g-6i, Step 7** (remaining validation) -- full validation after cutover
