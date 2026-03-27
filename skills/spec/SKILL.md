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
