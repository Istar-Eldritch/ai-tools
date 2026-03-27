# Phase 4: Implement Workflow Migration Plan

**Status**: Planning
**Created**: 2026-03-26

---

## Overview

Migrate the implement skill from its 420-line prose SKILL.md to the engine-driven workflow. This is the most complex workflow: it extracts phases from a spec, then for each phase runs a nested sub-pipeline of plan drafting, plan review, implementation, code review, and commit -- with `--no-plan` and `--no-review` flag support.

## Deliverables

1. `skills/spec-pipeline-core/workflows/implement.json` -- workflow definition with loop stage
2. `skills/spec-pipeline-core/prompts/plan_drafter.md` -- plan drafter prompt template
3. `skills/spec-pipeline-core/prompts/plan_reviewer.md` -- plan reviewer prompt template
4. `skills/spec-pipeline-core/prompts/implementer.md` -- implementer prompt template
5. `skills/spec-pipeline-core/prompts/code_reviewer.md` -- code reviewer prompt template
6. `skills/spec-pipeline-core/prompts/address_review.md` -- address review prompt template
7. Engine changes to `stages.py` and `runner.py` for loop stage, review-inside-loop, phase extraction, and commit-after-agent
8. `skills/implement/SKILL.md` -- thin dispatcher (backup current as `SKILL.md.bak`)

---

## 1. Workflow Definition: `workflows/implement.json`

### Design Decisions

**Phase extraction**: The engine needs to read the spec file and run `parse.sh extract-phases` before entering the loop. This is a two-step initialization: (1) `read_file` to get spec content, (2) `run_command` to extract phases. We model this as an `init` stage with type `init_phases` -- a new stage type specific to implement.

**Alternative considered**: Modeling phase extraction as a pair of agent+command stages before the loop. Rejected because it would require the LLM to participate in a purely mechanical operation (parsing JSON output and setting state), which the engine should handle internally.

**Chosen approach**: Add a new stage type `init_phases` that emits a `read_file` instruction for the spec, then on file-read emits a `run_command` for phase extraction, then on command-done parses the JSON phases into state and transitions to the loop. This keeps the workflow JSON clean and the init logic in one place.

**Loop with nested reviews**: The existing `handle_loop` delegates to sub-stages via `_dispatch_stage`. The sub-stages inside the loop include `review` type stages, which themselves have multi-step cycles (reviewer agent -> verdict parse -> fix agent -> re-review). The current loop handler needs to track which sub-stage is active AND allow sub-stages to run their internal multi-step flows without the loop advancing prematurely.

**Key insight**: The current `handle_loop` dispatches to sub-stages with the incoming `command`. When a sub-stage (like `review`) emits a `call_agent` with a `then` pointing to `agent-done`, the next engine call comes in as `agent-done`. The runner resolves the current stage (still the loop stage name), and dispatches to `handle_loop`, which must then delegate to the correct sub-stage. This works because `_loop_sub_stage` tracks position. But the sub-stage handler needs to know when it is "done" so the loop can advance `_loop_sub_stage`. Currently, stage handlers transition by setting `state["stage"]`, but inside a loop the loop stage name stays constant in `state["stage"]`.

**Solution**: Sub-stages inside a loop signal completion by setting `state["stage"]` to their `transitionTo` value. The loop handler detects that `state["stage"]` changed away from the loop stage name, resets it back to the loop stage name, and advances `_loop_sub_stage`. This requires a small change to `handle_loop`.

**Commit-after-agent**: The implement workflow commits after plan drafting and after implementation (not just at the end). Each agent sub-stage that modifies files needs a commit sub-stage after it. We model these as separate sub-stages inside the loop: `plan_draft` (agent) -> `plan_commit` (commit) -> `plan_review` (review) -> `implement` (agent) -> `impl_commit` (commit) -> `code_review` (review) -> `phase_commit` (commit).

**Skip conditions**: `--no-plan` skips plan_draft, plan_commit, and plan_review. `--no-review` skips plan_review and code_review. These are modeled as `skipWhen` on each sub-stage. The loop handler must check `skipWhen` and advance past skipped sub-stages.

**Review cycles from config**: The `review` sub-stages read `maxCycles` from config (`reviewCycles.planReviewer` and `reviewCycles.codeReviewer`). When cycles is 0, the review is auto-skipped (equivalent to `--no-review` for that specific review type). We add a `maxCyclesConfigKey` field to review stages that the handler reads from config.

**Phase cleanup**: After all sub-stages for a phase complete, the loop resets per-phase state fields. We add an `onIterationComplete` hook to the loop definition that lists state fields to reset.

### File Contents

```json
{
  "name": "implement",
  "stateType": "implementations",
  "commands": {
    "start": {
      "description": "Implement a spec with phased planning + review",
      "args": ["specPathOrDescription"],
      "flags": ["--no-plan", "--no-review"]
    },
    "resume": { "description": "Resume active implementation" },
    "status": { "description": "Show status of all implementations" },
    "list": { "description": "List implementation IDs" },
    "cancel": { "description": "Cancel active implementation" }
  },
  "stateSchema": {
    "description": "string",
    "stage": "string",
    "specPath": "string",
    "specContent": "string",
    "implTimestamp": "string",
    "phases": "array",
    "phasesGenerated": "array",
    "currentPhaseIndex": "number",
    "currentReviewCycle": "number",
    "previousReview": "string",
    "reviewCyclesCompleted": "number",
    "implementerCompletedForPhase": "boolean",
    "phaseCommits": "array",
    "skipPlanGeneration": "boolean",
    "skipReview": "boolean",
    "checkpoints": "array"
  },
  "stages": [
    {
      "name": "init_phases",
      "type": "init_phases",
      "transitionTo": "phase_loop"
    },
    {
      "name": "phase_loop",
      "type": "loop",
      "over": "phases",
      "indexField": "currentPhaseIndex",
      "onIterationComplete": {
        "reset": [
          "currentReviewCycle",
          "previousReview",
          "reviewCyclesCompleted",
          "implementerCompletedForPhase"
        ]
      },
      "stages": [
        {
          "name": "plan_draft",
          "type": "agent",
          "skipWhen": ["--no-plan"],
          "skipWhenState": "skipPlanGeneration",
          "promptTemplate": "plan_drafter.md",
          "modelKey": "planDrafter",
          "outputStateField": "currentPlanDraft",
          "transitionTo": "plan_commit"
        },
        {
          "name": "plan_commit",
          "type": "commit",
          "skipWhen": ["--no-plan"],
          "skipWhenState": "skipPlanGeneration",
          "commitRole": "planDrafter",
          "transitionTo": "plan_review"
        },
        {
          "name": "plan_review",
          "type": "review",
          "skipWhen": ["--no-plan", "--no-review"],
          "skipWhenState": "skipPlanGeneration",
          "reviewerModelKey": "planReviewer",
          "fixModelKey": "addressReview",
          "reviewerPrompt": "plan_reviewer.md",
          "fixPrompt": "address_review.md",
          "maxCyclesConfigKey": "reviewCycles.planReviewer",
          "maxCycles": 0,
          "cycleStateField": "currentReviewCycle",
          "transitionTo": "implement"
        },
        {
          "name": "implement",
          "type": "agent",
          "promptTemplate": "implementer.md",
          "modelKey": "implementer",
          "outputStateField": "implementerOutput",
          "transitionTo": "impl_commit"
        },
        {
          "name": "impl_commit",
          "type": "commit",
          "commitRole": "implementer",
          "transitionTo": "code_review"
        },
        {
          "name": "code_review",
          "type": "review",
          "skipWhen": ["--no-review"],
          "reviewerModelKey": "codeReviewer",
          "fixModelKey": "addressReview",
          "reviewerPrompt": "code_reviewer.md",
          "fixPrompt": "address_review.md",
          "maxCyclesConfigKey": "reviewCycles.codeReviewer",
          "maxCycles": 5,
          "cycleStateField": "currentReviewCycle",
          "transitionTo": "phase_commit"
        },
        {
          "name": "phase_commit",
          "type": "commit",
          "commitRole": "implementer",
          "transitionTo": "next_phase"
        }
      ],
      "transitionTo": "completed"
    }
  ],
  "completion": {
    "message": "Implementation complete for `{specPath}`.",
    "nextStep": "/condense-spec {specPath}"
  }
}
```

### Key Workflow Definition Notes

- `init_phases` is a new stage type that handles spec reading and phase extraction in one stage, keeping the workflow definition clean.
- The `loop` stage's `indexField` maps to `state.currentPhaseIndex` so the existing state schema is honored.
- Each sub-stage's `transitionTo` is used internally by the loop handler to detect sub-stage completion and advance, NOT to set `state["stage"]` globally.
- `skipWhenState` allows skipping based on a boolean state field (set during initialization from flags).
- `maxCyclesConfigKey` on review stages lets the handler read cycle count from config, with `maxCycles` as the default fallback.
- Commit stages inside the loop use `--auto` mode (no explicit file list) since agents modify arbitrary files.

---

## 2. Prompt Templates

### `prompts/plan_drafter.md`

```markdown
You are creating a detailed implementation plan for a spec phase.

Translate high-level spec requirements into specific, executable steps with file paths and code examples.

{projectContext}

## Spec

{specContent}

## Current Phase

Phase {phase_number}: {phase_focus}

## Previous Review Feedback

{previousReview}

## CRITICAL: Codebase Grounding First

Before writing ANY plan, you MUST explore the existing codebase:
1. Explore project structure
2. Find similar code -- look for patterns to follow
3. Read related files -- understand existing implementations
4. Check test patterns

## Plan Format

Create a detailed, executable phase plan:

# Phase {phase_number}: {phase_focus}

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

### `prompts/plan_reviewer.md`

```markdown
You are reviewing an implementation plan for a spec phase.

Check that the plan is detailed, executable, and follows project conventions.

{projectContext}

## Spec

{specContent}

## Phase Being Reviewed

Phase {phase_number}: {phase_focus}

## Plan to Review

{currentPlanDraft}

## Review Checklist

1. **Codebase Grounding** -- Are file paths real? Are similar implementations referenced?
2. **Project Convention Compliance** -- Does it follow existing patterns?
3. **Completeness** -- All necessary steps included? Prerequisites identified?
4. **Execution Order** -- Logical sequence? Test-driven where appropriate?
5. **Specificity** -- Exact file paths? Code examples match project style?
6. **Verification** -- Each step has verification? Final checklist includes tests?

Do NOT run tests -- you are reviewing the plan document only.

## Response Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Issues** (if any):
1. Issue description
   - Suggestion: How to fix

**Missing** (if any):
- What is not covered that should be
```

### `prompts/implementer.md`

```markdown
You are implementing a phase of a specification.

Follow the implementation plan step-by-step, following project conventions.

{projectContext}

## Spec

{specContent}

## Current Phase

Phase {phase_number}: {phase_focus}

## Implementation Plan

{currentPlanDraft}

## Previous Review Feedback

{previousReview}

## Test Command

{testCommand}

## Implementation Workflow

1. **Codebase Grounding**: Read related files to understand patterns
2. **Follow TDD** (if project uses it): Write tests first
3. **Make Changes**: Implement following existing code style
4. **Verify**: Run tests after each step

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

### `prompts/code_reviewer.md`

```markdown
You are a senior code reviewer.

Review the implementation against spec requirements and project conventions.

{projectContext}

## Spec

{specContent}

## Current Phase

Phase {phase_number}: {phase_focus}

## Implementation Plan

{currentPlanDraft}

## CRITICAL: Do NOT Run Tests

You are a REVIEWER, not an implementer. Do NOT run tests, build commands, or execute code.

## Review Focus Areas

1. **Correctness** -- Does implementation match spec? Logic correct? Edge cases handled?
2. **Code Quality** -- Clean, readable, matches surrounding style?
3. **Architecture** -- Fits project structure? Uses appropriate patterns?
4. **Testing** -- Are test files present and covering the implementation? READ test files, do NOT execute.
5. **Organization** -- Code in right location? Files named appropriately?
6. **Security** -- Input validation? No obvious vulnerabilities?

## Review Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Issues** (if any):
1. [CRITICAL/MAJOR/MINOR] Description
   - File: path/to/file:line
   - Problem: What is wrong
   - Fix: How to address it
```

### `prompts/address_review.md`

```markdown
You are addressing code review feedback.

Fix issues raised in the review, following project conventions.

{projectContext}

## Spec

{specContent}

## Current Phase

Phase {phase_number}: {phase_focus}

## Review Feedback

{review_feedback}

## Test Command

{testCommand}

## Process

For each issue in the review:
1. Understand the problem
2. Check referenced files/conventions
3. Make the fix following project patterns
4. Verify the fix works

## Priority Order

1. **CRITICAL**: Blocking issues (tests failing, security, correctness)
2. **MAJOR**: Significant problems (architecture, patterns, organization)
3. **MINOR**: Polish (style, naming, comments)

After addressing issues, run the full test suite.

Report: What was fixed, test results, any issues not addressed (with reason).
```

---

## 3. Engine Changes

### 3a. New Stage Type: `init_phases` in `stages.py`

Add a `handle_init_phases` function that handles the two-step initialization:

```python
def handle_init_phases(stage: dict, state: dict, config: Config,
                       workflow_name: str, command: str,
                       agent_output: Optional[str] = None,
                       command_output: Optional[str] = None,
                       **kwargs) -> inst.Instruction:
    """Handle the 'init_phases' stage for implement workflow.

    Flow:
    1. 'start': If specPath is a file, emit read_file. Otherwise emit error.
    2. 'file-read': Store spec content in state, emit run_command for phase extraction.
    3. 'command-done': Parse phases JSON, store in state, transition to loop.
    """
    state_id = state["id"]
    transition_to = stage.get("transitionTo")
    init_phase = state.get("_init_phase", "read_spec")

    if command in ("start", "next", "resume"):
        spec_path = state.get("specPath", "")
        if not spec_path:
            return inst.Error(message="specPath is required for implement workflow")
        if init_phase == "extract_phases":
            # Resume after spec was read but before phases extracted
            return inst.RunCommand(
                command=f'bash skills/spec-pipeline-core/parse.sh extract-phases "{spec_path}"',
                then=_engine_then(workflow_name, "command-done", state_id, "output"),
            )
        # Start: read the spec file
        state["_init_phase"] = "read_spec"
        return inst.ReadFile(
            path=spec_path,
            then=_engine_then(workflow_name, "file-read", state_id, "content"),
        )

    elif command == "file-read":
        # Spec content received, store it and extract phases
        state["specContent"] = agent_output or ""  # content comes via agent_output mapping
        state["_init_phase"] = "extract_phases"
        spec_path = state.get("specPath", "")
        return inst.RunCommand(
            command=f'bash skills/spec-pipeline-core/parse.sh extract-phases "{spec_path}"',
            then=_engine_then(workflow_name, "command-done", state_id, "output"),
        )

    elif command == "command-done":
        # Parse phases from extract-phases output
        import json as _json
        try:
            phases = _json.loads(command_output or "[]")
        except (ValueError, TypeError):
            phases = []

        if not phases:
            # Fallback: single phase
            phases = [{"number": 1, "focus": "implementation", "sanitizedFocus": "implementation"}]

        state["phases"] = phases
        state["currentPhaseIndex"] = 0
        state.pop("_init_phase", None)
        state["stage"] = transition_to

        phase_summary = "\n".join(
            f"  Phase {p.get('number', i+1)}: {p.get('focus', 'unknown')}"
            for i, p in enumerate(phases)
        )
        return inst.Present(
            text=f"Extracted {len(phases)} phase(s) from spec:\n{phase_summary}\n\nStarting implementation.",
            then=_engine_then(workflow_name, "next", state_id),
        )

    return inst.Error(message=f"Unexpected command '{command}' for init_phases stage")
```

**Registration**: Add `"init_phases": handle_init_phases` to the `_dispatch_stage` handlers dict and to the dispatch dict in `runner.py`'s `_emit_for_stage`.

### 3b. Loop Stage Enhancements in `stages.py`

The current `handle_loop` is a Phase 1 placeholder. It needs these changes:

#### Change 1: Sub-stage completion detection

When a sub-stage handler sets `state["stage"]` to its `transitionTo`, the loop handler must detect this and advance `_loop_sub_stage`. Currently the loop sets `state["stage"]` to the loop stage name, but sub-stages overwrite it. The fix: after calling the sub-stage handler, check if `state["stage"]` differs from the loop stage name. If so, the sub-stage completed -- reset `state["stage"]` to the loop stage name and advance.

But this check cannot happen in the same call that dispatches -- the sub-stage handler emits an instruction and the LLM must execute it first. The transition happens on the NEXT engine call. So the logic is:

1. On each engine call to the loop, check `state["_loop_sub_stage_name"]` against the current sub-stage list
2. If `state["stage"]` does not match the loop stage name, it means a sub-stage transitioned. Find which sub-stage name matches the transition target and advance accordingly.

**Simpler approach**: Do not rely on `state["stage"]` for sub-stage tracking inside loops. Instead, sub-stages inside a loop use the `_loop_sub_stage` index exclusively. The stage handlers' `state["stage"] = transition_to` calls are intercepted: the loop handler saves/restores `state["stage"]` around sub-stage dispatch. When the sub-stage sets `state["stage"]` to its `transitionTo`, the loop handler detects this differs from the loop stage name, increments `_loop_sub_stage`, and resets `state["stage"]` to the loop stage name.

**Implementation**:

```python
def handle_loop(stage: dict, state: dict, config: Config,
                workflow_name: str, command: str,
                **kwargs) -> inst.Instruction:
    state_id = state["id"]
    over_field = stage.get("over", "phases")
    sub_stages = stage.get("stages", [])
    transition_to = stage.get("transitionTo")
    index_field = stage.get("indexField", "_loop_index")
    loop_index = state.get(index_field, 0)
    items = _get_nested(state, over_field, default=[])
    loop_stage_name = stage["name"]
    on_complete = stage.get("onIterationComplete", {})
    active_flags = state.get("_active_flags", [])

    if loop_index >= len(items):
        # Loop complete -- clean up
        state.pop("_loop_sub_stage", None)
        state["stage"] = transition_to
        return inst.Present(
            text=f"All {len(items)} phase(s) complete. Moving to {transition_to}.",
            then=_engine_then(workflow_name, "next", state_id),
        )

    # Set loop variables for current item
    item = items[loop_index]
    if isinstance(item, dict):
        state["current_phase"] = item.get("focus", "")
        state["phase_number"] = item.get("number", loop_index + 1)
        state["phase_focus"] = item.get("focus", "")
        state["phase_sanitizedFocus"] = item.get("sanitizedFocus", "")
    else:
        state["current_phase"] = str(item)
        state["phase_number"] = loop_index + 1
        state["phase_focus"] = str(item)

    # Determine current sub-stage
    sub_stage_index = state.get("_loop_sub_stage", 0)

    # Check if previous sub-stage completed (state["stage"] changed away from loop)
    if state.get("stage") != loop_stage_name and command in ("next",):
        # A sub-stage transitioned -- advance to the next sub-stage
        state["stage"] = loop_stage_name
        sub_stage_index += 1
        state["_loop_sub_stage"] = sub_stage_index

    # Skip sub-stages with skipWhen matching active flags, or skipWhenState
    while sub_stage_index < len(sub_stages):
        ss = sub_stages[sub_stage_index]
        skip_flags = ss.get("skipWhen", [])
        skip_state_field = ss.get("skipWhenState")
        should_skip = any(f in active_flags for f in skip_flags)
        if skip_state_field and state.get(skip_state_field):
            should_skip = True
        # For review stages, also skip if config cycles is 0
        if ss.get("type") == "review":
            cycles_key = ss.get("maxCyclesConfigKey", "")
            if cycles_key:
                parts = cycles_key.split(".")
                cfg_cycles = config.get_nested(*parts, default=ss.get("maxCycles", 3))
                if cfg_cycles == 0:
                    should_skip = True
        if should_skip:
            sub_stage_index += 1
            state["_loop_sub_stage"] = sub_stage_index
            continue
        break

    if sub_stage_index >= len(sub_stages):
        # All sub-stages done for this item -- apply onIterationComplete and advance
        for field in on_complete.get("reset", []):
            if field in state:
                if isinstance(state[field], bool):
                    state[field] = False
                elif isinstance(state[field], int):
                    state[field] = 0
                elif isinstance(state[field], str):
                    state[field] = ""
                elif isinstance(state[field], list):
                    state[field] = []
        state[index_field] = loop_index + 1
        state["_loop_sub_stage"] = 0
        # Present phase completion, then recurse
        return inst.Present(
            text=f"Phase {loop_index + 1} of {len(items)} complete.",
            then=_engine_then(workflow_name, "next", state_id),
        )

    # Dispatch to current sub-stage
    sub_stage = sub_stages[sub_stage_index]
    # For the sub-stage dispatch, use the loop's stage name in state
    state["stage"] = loop_stage_name
    return _dispatch_stage(sub_stage, state, config, workflow_name, command, **kwargs)
```

#### Change 2: Review stage reads maxCycles from config

In `handle_review`, add config-based cycle lookup:

```python
# At the start of handle_review, after reading maxCycles from stage:
cycles_key = stage.get("maxCyclesConfigKey", "")
if cycles_key:
    parts = cycles_key.split(".")
    config_cycles = config.get_nested(*parts, default=max_cycles)
    if config_cycles is not None:
        max_cycles = config_cycles
```

#### Change 3: Commit stage auto-mode for loop sub-stages

The current `handle_commit` expects explicit file lists. Inside the loop, commits use `--auto` mode (commit whatever the agent changed). Add support for an empty `files` list meaning auto-mode:

```python
# In handle_commit, when building the commit command:
if not resolved_files or all(f.strip() == "" for f in resolved_files):
    # Auto mode: commit all staged changes
    commit_cmd = f'bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message {safe_msg}'
else:
    commit_cmd = f'bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --files {safe_files} --message {safe_msg}'
```

### 3c. Runner Changes in `runner.py`

#### Change 1: Register `init_phases` in dispatch

Add to the handler dict in `_emit_for_stage`:

```python
handler = {
    "conversation": stages.handle_conversation,
    "agent": stages.handle_agent,
    "approval": stages.handle_approval,
    "review": stages.handle_review,
    "commit": stages.handle_commit,
    "loop": stages.handle_loop,
    "init_phases": stages.handle_init_phases,  # NEW
}.get(stage_type)
```

#### Change 2: Handle `file-read` command routing for `init_phases`

The `file-read` command is already handled in `_handle_continuation`. The named arg `content` is mapped to `agent_output` in the kwargs building. This already works because of lines 293-294 in the current `runner.py`:

```python
if "content" in named_args:
    kwargs["agent_output"] = named_args["content"]
```

No change needed here.

#### Change 3: Implement-specific start handling

The `_handle_start` function needs special handling for implement: the first positional arg may be a spec file path rather than a description. Add logic:

```python
# In _handle_start, after getting description from args:
if workflow_name == "implement":
    spec_path_or_desc = args[0] if args else named_args.get("description", "")
    # Check if it's a file path
    if os.path.exists(spec_path_or_desc):
        extra_fields["specPath"] = spec_path_or_desc
        # Use the spec filename as the description if no separate description provided
        if not named_args.get("description"):
            description = os.path.basename(spec_path_or_desc)
    else:
        description = spec_path_or_desc

    # Map flags to state fields
    if "--no-plan" in flags:
        extra_fields["skipPlanGeneration"] = True
    if "--no-review" in flags:
        extra_fields["skipReview"] = True
```

**Alternative approach**: Rather than special-casing `workflow_name == "implement"` in `_handle_start`, we can add a `startHooks` field to the workflow JSON that the runner processes generically. However, this adds complexity for a single use case. The pragmatic choice is a small conditional in `_handle_start` for implement.

#### Change 4: Pass `command_output` properly for all command-done scenarios

Currently `command_output` is only set when `stage_type == "commit"`. For `init_phases`, the `command-done` handler needs `command_output` too. Fix the kwargs building:

```python
# Replace the current conditional with:
if "output" in named_args:
    kwargs["agent_output"] = named_args["output"]
    if command == "command-done":
        kwargs["command_output"] = named_args["output"]
```

### 3d. Sub-stage state management within loops

When a review or commit sub-stage runs inside a loop, it uses `state["_review_phase"]` and `state["_commit_phase"]` for its internal flow tracking. These are already cleaned up by each handler on completion. The loop's `onIterationComplete.reset` additionally resets `currentReviewCycle` etc. between phases. No additional changes needed for this -- the existing cleanup in each handler plus the loop's reset list covers it.

### 3e. Adding `handle_init_phases` to `_dispatch_stage`

```python
def _dispatch_stage(stage: dict, state: dict, config: Config,
                    workflow_name: str, command: str, **kwargs) -> inst.Instruction:
    stage_type = stage.get("type")
    handlers = {
        "conversation": handle_conversation,
        "agent": handle_agent,
        "approval": handle_approval,
        "review": handle_review,
        "commit": handle_commit,
        "loop": handle_loop,
        "init_phases": handle_init_phases,  # NEW
    }
    handler = handlers.get(stage_type)
    if not handler:
        return inst.Error(message=f"Unknown stage type: {stage_type}")
    return handler(stage, state, config, workflow_name, command, **kwargs)
```

---

## 4. Thin SKILL.md Dispatcher

### `skills/implement/SKILL.md` (new contents)

```markdown
---
name: implement
description: "Implement specifications with AI-driven phased planning, code review, and automated commits. Invoke on /implement, /implement-resume, /implement-status, /implement-list, /implement-cancel commands."
---

# Implement

## Protocol

Read the instruction execution protocol in `skills/spec-pipeline-core/CORE.md` section "Engine Instruction Protocol".

## Commands

| User Command | Engine Call |
|---|---|
| `/implement <spec-path>` | `python3 skills/spec-pipeline-core/engine.py implement start "<spec-path>"` |
| `/implement --no-plan <spec-path>` | `python3 skills/spec-pipeline-core/engine.py implement start "<spec-path>" --no-plan` |
| `/implement --no-review <spec-path>` | `python3 skills/spec-pipeline-core/engine.py implement start "<spec-path>" --no-review` |
| `/implement --no-plan --no-review <spec-path>` | `python3 skills/spec-pipeline-core/engine.py implement start "<spec-path>" --no-plan --no-review` |
| `/implement <description>` | `python3 skills/spec-pipeline-core/engine.py implement start "<description>"` |
| `/implement-resume` | `python3 skills/spec-pipeline-core/engine.py implement resume` |
| `/implement-status` | `python3 skills/spec-pipeline-core/engine.py implement status` |
| `/implement-list` | `python3 skills/spec-pipeline-core/engine.py implement list` |
| `/implement-cancel` | `python3 skills/spec-pipeline-core/engine.py implement cancel` |

## Execution Loop

1. Parse the user's command and flags from their message
2. Run the matching engine call from the table above
3. Parse the JSON instruction from stdout
4. Execute the instruction per CORE.md "Engine Instruction Protocol"
5. If the instruction has a `then` field, call that command with the result and go to step 3
6. If no `then` field (`done` or `error`), stop
```

### Backup

Before writing the new SKILL.md, copy the current one:
```bash
cp skills/implement/SKILL.md skills/implement/SKILL.md.bak
```

---

## 5. Summary of All File Changes

### New Files

| File | Purpose |
|------|---------|
| `skills/spec-pipeline-core/workflows/implement.json` | Workflow definition |
| `skills/spec-pipeline-core/prompts/plan_drafter.md` | Plan drafter prompt template |
| `skills/spec-pipeline-core/prompts/plan_reviewer.md` | Plan reviewer prompt template |
| `skills/spec-pipeline-core/prompts/implementer.md` | Implementer prompt template |
| `skills/spec-pipeline-core/prompts/code_reviewer.md` | Code reviewer prompt template |
| `skills/spec-pipeline-core/prompts/address_review.md` | Address review prompt template |
| `skills/implement/SKILL.md.bak` | Backup of current prose SKILL.md |

### Modified Files

| File | Changes |
|------|---------|
| `skills/spec-pipeline-core/engine/stages.py` | Add `handle_init_phases`; rewrite `handle_loop` with skipWhen, indexField, onIterationComplete, sub-stage completion detection; add config-based maxCycles to `handle_review`; add auto-mode to `handle_commit`; register `init_phases` in `_dispatch_stage` |
| `skills/spec-pipeline-core/engine/runner.py` | Register `init_phases` in handler dict; add implement-specific logic in `_handle_start` for spec path detection and flag-to-state mapping; fix `command_output` pass-through for all command-done |
| `skills/implement/SKILL.md` | Replace with thin dispatcher |

### Unchanged Files

| File | Reason |
|------|--------|
| `skills/spec-pipeline-core/engine.py` | CLI entry point needs no changes -- already handles all commands |
| `skills/spec-pipeline-core/engine/instructions.py` | No new instruction types needed |
| `skills/spec-pipeline-core/engine/context.py` | Template rendering already handles all needed variables |
| `skills/spec-pipeline-core/engine/state.py` | State operations unchanged |
| `skills/spec-pipeline-core/engine/config.py` | Config loading unchanged; `get_nested` already supports dotted paths |
| `skills/spec-pipeline-core/CORE.md` | Instruction protocol already documented in Phase 1 |

---

## 6. Implementation Order

### Step 1: Prompt templates (no dependencies)

Create all five prompt template files. These are standalone markdown files that can be created immediately. They extract the prompts from the current prose SKILL.md, converting inline `{projectContext}` references to template variables.

### Step 2: Engine changes to `stages.py` (core logic)

1. Add `handle_init_phases` function
2. Rewrite `handle_loop` with full loop support
3. Add `maxCyclesConfigKey` support to `handle_review`
4. Add auto-mode commit support to `handle_commit`
5. Register `init_phases` in `_dispatch_stage`

### Step 3: Engine changes to `runner.py`

1. Register `init_phases` in the handler dict in `_emit_for_stage`
2. Add implement-specific start handling in `_handle_start`
3. Fix `command_output` pass-through

### Step 4: Workflow definition JSON

Create `workflows/implement.json`. This depends on the stage types being registered.

### Step 5: SKILL.md migration

1. Back up current SKILL.md
2. Write new thin dispatcher SKILL.md

### Step 6: Manual validation

1. Run `/implement <spec-path>` end-to-end
2. Test `--no-plan` flag
3. Test `--no-review` flag
4. Test `/implement-resume` mid-phase
5. Test `/implement-status` and `/implement-cancel`
6. Verify state file backward compatibility with any existing implementation states

---

## 7. Risk Areas and Mitigations

### Risk: Loop sub-stage completion detection

The mechanism of detecting sub-stage completion by monitoring `state["stage"]` changes is subtle. If a sub-stage handler does not set `state["stage"]` (e.g., commit stage on the intermediate steps like getting diff or generating message), the loop must not advance.

**Mitigation**: The loop only checks for stage advancement on `command == "next"`. The commit and review handlers only set `state["stage"]` on their final transition, not on intermediate steps. The intermediate steps use `_commit_phase` / `_review_phase` for internal tracking.

### Risk: Review cycles resetting between phases

The `currentReviewCycle` must be reset to 0 between phases. The code review of phase 1 should not "remember" cycles from the plan review.

**Mitigation**: The `onIterationComplete.reset` list includes `currentReviewCycle`, and the loop handler resets it between phases. Additionally, the review handler also uses `_review_phase` which it cleans up on completion.

### Risk: Spec path vs description detection

The start command needs to distinguish file paths from descriptions. A path like `docs/specs/foo.md` should be detected as a file path.

**Mitigation**: Use `os.path.exists()` check. If the first argument is a valid file path, treat it as specPath. Otherwise treat it as a description. This matches the current SKILL.md behavior.

### Risk: Large prompt templates exceeding agent context

The implementer prompt includes `{specContent}` (the full spec) plus `{currentPlanDraft}` (the full plan). For large specs, this could be substantial.

**Mitigation**: The engine uses `--output-file` for large outputs. The prompt templates should be designed to include only what is needed. In practice, specs are typically 1-5 pages and plans are 1-3 pages, well within context limits. If needed, the spec could be truncated to the relevant phase section, but this optimization is deferred.
