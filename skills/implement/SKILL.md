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
