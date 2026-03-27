# Script-Driven Workflow Engine for Spec Pipeline Skills

**Status**: Implemented
**Created**: 2026-03-26
**Completed**: 2026-03-27

---

## Problem Statement

The spec pipeline skills (brainstorm, spec, implement) relied on 200-400 line SKILL.md files that the LLM re-read and re-interpreted on every invocation. Workflow orchestration -- stage sequencing, state management, context assembly, agent prompt construction, transition detection -- was encoded as prose instructions. This produced three failure modes:

1. **Non-deterministic execution**: The same workflow could skip steps, miss state saves, or assemble prompts differently depending on how the LLM interpreted the prose on a given run.
2. **Duplication**: Shared patterns (review loop, commit protocol, discovery exchange) were copied across SKILL.md files rather than defined once.
3. **Fragile resume**: Resuming a pipeline required the LLM to re-read the full SKILL.md, locate the current stage, and reconstruct what to do next -- a process that regularly dropped context.

The existing shell scripts (`config.sh`, `state.sh`, `parse.sh`, `git-helpers.sh`) demonstrated that deterministic operations extracted into code execute reliably. The workflow engine extended this pattern to cover orchestration itself: the engine decides what happens next, and the LLM executes the engine's instructions.

## Solution Design

### Architecture

The engine is a stateless Python CLI (`engine.py`) that sits between the host LLM and the workflow state on disk. Each invocation reads state, computes the next instruction, saves state, and prints a single JSON instruction to stdout. The LLM executes the instruction and calls back with the result.

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
```

### Instruction Protocol

The engine communicates via 8 typed JSON instructions: `call_agent`, `ask_user`, `present`, `write_file`, `read_file`, `run_command`, `done`, `error`. Each non-terminal instruction includes a `then` field chaining the next engine call. This protocol is documented in CORE.md section 6.

### Declarative Workflow Definitions

Each skill's workflow is a JSON file listing stages, their types, transition rules, skip conditions, and variants. Seven stage types cover all patterns: `conversation`, `agent`, `approval`, `review`, `commit`, `loop`, `init_phases`. Adding a new skill requires only a workflow JSON file and prompt templates -- no engine code changes for standard stage types.

### SKILL.md Dispatcher Protocol

Each SKILL.md shrank from 180-420 lines of prose to under 30 lines: frontmatter plus a command table mapping user commands to engine CLI calls and a 3-step execution loop referencing CORE.md.

## Key Design Decisions

1. **Stateless engine, state on disk**: The engine holds no state between calls. All state lives as JSON in `.claude/spec-pipeline/`. State is saved atomically (write `.tmp`, then rename) before every instruction is emitted. If the LLM crashes after receiving an instruction, `resume` re-emits the same instruction.

2. **Subprocess delegation to shell scripts**: `config.sh`, `state.sh`, `parse.sh`, and `git-helpers.sh` are called via `subprocess.run()` rather than rewritten in Python. This kept the migration focused on orchestration.

3. **Python stdlib only (R8)**: No pip packages, no virtual environments. The engine uses only Python 3.x standard library plus the existing shell scripts.

4. **Flat variable namespace for templates**: Template variables use `{variableName}` syntax. State fields are flattened one level (e.g., `discovery.summary` becomes `discovery_summary`). This avoids nested access syntax while covering common cases.

5. **Keyword-based transition detection**: Instead of a haiku-based intent classifier (spec Q2), transition detection uses keyword heuristics with minimum exchange count guards. This proved simpler and reliable enough for the brainstorm and discovery flows.

6. **Stage aliases for backward compatibility**: Workflow definitions support a `stageAliases` map (e.g., `spec_drafting` -> `drafting`) so in-flight pipelines created before the migration can resume under the new engine.

7. **Separate review cycle counters**: The implement workflow uses distinct `planReviewCycle` and `codeReviewCycle` state fields to prevent budget bleed between plan review and code review within the same phase.

8. **Loop sub-stage routing**: When a sub-stage within a loop sets `state["stage"]` to its `transitionTo` value, the runner falls back to `_find_parent_loop_stage()` to route back through the parent loop handler, which detects the stage change and advances.

## Scope

### Implemented
- Engine core: CLI, workflow loader, 7 stage handlers, instruction emitter, state management, config integration, template renderer
- Brainstorm workflow: 3-stage (conversation → synthesis → commit)
- Spec workflow: 4-stage with `--quick` and `--from-brainstorm` variants
- Implement workflow: 2-stage with loop containing 7 sub-stages, review cycles, `--no-plan`/`--no-review` flags
- 11 prompt templates
- CORE.md Engine Instruction Protocol section

### Out of Scope (deferred)
- Absorbing `config.sh`/`state.sh`/`parse.sh` into Python
- Parallel instruction execution (batch instructions)
- Automated end-to-end testing framework
- Haiku-based intent classifier (keyword heuristics used instead)

## Open Questions Resolved

- **Q1 (Conversation quality)**: Brainstorming under stateless agent calls works acceptably. Exchange history is reconstructed from state and included in each agent prompt, maintaining conversation continuity.
- **Q2 (Intent classification)**: Keyword heuristics with minimum exchange count guards proved sufficient. The `intentClassifier` field exists in workflow definitions for future haiku-based classification if needed.
