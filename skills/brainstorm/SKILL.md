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
