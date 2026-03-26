# Improve Skill Transitions

**Status**: Implemented
**Created**: 2026-03-26
**Completed**: 2026-03-26

## Problem Statement

Skills registered internal phase-transition signals (`/discovery-done`, `/brainstorm-done`, `/spec-draft-done`, `/draft-done`) as slash commands in frontmatter `description` fields. This polluted the command palette with non-entry-point commands and forced rigid slash-command-based phase transitions instead of natural-language detection.

Additionally, the brainstorm skill lacked operational commands (`-resume`, `-status`, `-list`, `-cancel`) that spec and implement already provided, and there was no structured path from brainstorm synthesis into the spec workflow.

## Solution Overview

Four changes were implemented:

1. **Natural-language transitions** — Removed internal phase signals from skill frontmatter descriptions. Agents now detect natural-language cues ("looks good", "let's draft", "that covers it") to advance phases, with explicit slash commands preserved in workflow docs as a fallback.

2. **Next-step suggestions** — Each skill outputs a "Suggested next step" block at completion with a pre-filled successor command:
   - `/brainstorm` → `/spec --from-brainstorm {synthesisPath}`
   - `/spec` → `/implement {specPath}`
   - `/epic` → `/spec` per child item
   - `/implement` → `/condense-spec {specPath}`

3. **Brainstorm operational commands** — Added `/brainstorm-resume`, `-status`, `-list`, `-cancel` following the same patterns as spec and implement.

4. **`--from-brainstorm` flag on `/spec`** — Reads a brainstorm synthesis, runs 2-4 targeted discovery exchanges focused on technical gaps (edge cases, NFRs, integration specifics), then combines brainstorm content and targeted exchanges into the discovery summary before drafting. This replaces full discovery since the brainstorm already provides divergent exploration.

## Key Design Decisions

- **Natural-language detection as primary, slash commands as fallback**: The agent proactively suggests moving to the next phase when discovery categories are sufficiently covered (typically 3-7 exchanges). This reduces friction while keeping an explicit escape hatch.
- **Targeted discovery for `--from-brainstorm`**: Hardcoded 2-4 exchange range rather than configurable. The brainstorm already covers functional requirements and scope; targeted discovery focuses only on convergent gap-filling (edge cases, NFRs, integration).
- **Cancel sets stage field, does not delete state**: Consistent with the spec/implement pattern — `/brainstorm-cancel` sets `stage: "cancelled"` rather than removing the state file.

## Out of Scope

- Changes to CORE.md shared protocols.
- Changes to the implement skill's internal phase pipeline.
- Automatic phase advancement without any user signal.
- UI/UX for the command palette itself.
