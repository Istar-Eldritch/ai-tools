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

1. Run the matching engine call from the table above
2. Parse JSON instruction from stdout, execute per CORE.md §6
3. If instruction has `then`, call it with result and go to step 2; otherwise stop
