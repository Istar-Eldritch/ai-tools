---
name: spec
description: "Create and manage technical specifications via discovery + drafting workflow, and condense implemented specs. Invoke on /spec, /spec-resume, /spec-status, /spec-list, /spec-cancel, /condense-spec commands."
---

# Spec

Create technical specifications through a structured discovery → drafting → approval workflow, and condense implemented specs to preserve architectural value.

## Prerequisites

**Before executing any command**, read the core protocols:
> Read `skills/spec-pipeline-core/CORE.md`

Configuration, state management, discovery mode, git operations, and shared prompts are defined there.
This file only contains spec-specific workflow and prompts.

## 1. Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `/spec <description>` | Create a technical specification via discovery + drafting | `--quick`, `--from-brainstorm <path>` |
| `/spec-resume` | Resume an active spec pipeline | |
| `/spec-status` | Show status of all spec pipelines | |
| `/spec-list` | List all spec state IDs | |
| `/spec-cancel` | Cancel the active spec pipeline | |
| `/condense-spec <spec-path>` | Condense an implemented spec to architectural documentation | |

## 2. Spec State Schema

```json
{
  "id": "260302143022_a1b2",
  "description": "Add user authentication",
  "stage": "discovery",
  "createdAt": "2026-03-02T14:30:22Z",
  "updatedAt": "2026-03-02T14:35:00Z",
  "discovery": {
    "exchanges": [
      { "assumption": "We should use JWT tokens...", "response": "Yes, that works" }
    ],
    "summary": null,
    "skipped": false,
    "brainstormPath": null
  },
  "drafting": {
    "exchanges": [],
    "specContent": null
  },
  "specTimestamp": "2603021430",
  "specFilename": "2603021430_user_authentication.md",
  "specPath": "docs/specs/2603021430_user_authentication.md",
  "specDraft": "",
  "specApproved": false,
  "specIteration": 0,
  "checkpoints": []
}
```

**Stages**: `"discovery"` → `"spec_drafting"` → `"user_approval"` → `"completed"` | `"cancelled"`

## 3. Spec Creation (`/spec`)

### Entry Points

- `/spec <description>` — Full flow: discovery → drafting → approval
- `/spec --quick <description>` — Skip discovery, go directly to drafting
- `/spec --from-brainstorm <path> <description>` — Targeted discovery from brainstorm, then drafting
- `/spec-resume` — Resume an active spec pipeline (see CORE.md §2 Resume Protocol)
- `/spec-status` — Show status of all spec pipelines
- `/spec-list` — List all spec state IDs
- `/spec-cancel` — Cancel the active spec pipeline

### Workflow

#### Step 1: Initialize

1. Load configuration:
   ```bash
   bash skills/spec-pipeline-core/config.sh load-config --needs-test-command --needs-template
   ```
2. Initialize state directory: `bash skills/spec-pipeline-core/state.sh init`
3. Generate pipeline ID: `bash skills/spec-pipeline-core/state.sh generate-id`
4. Generate timestamp: `bash skills/spec-pipeline-core/state.sh generate-timestamp`
5. Derive short name:
   ```bash
   bash skills/spec-pipeline-core/config.sh derive-short-name "<description>"
   ```
6. Construct spec path:
   ```bash
   bash skills/spec-pipeline-core/config.sh construct-paths \
     --specs-dir {specsDir} --timestamp {timestamp} \
     --short-name {short_name} --format {specFormat} --type spec
   ```
7. Create initial spec state and save it

Use `TaskCreate` to track progress: "Create spec: {description}"

#### Step 2: Discovery (skip if `--quick`)

Follow CORE.md §3 Discovery Mode. For each exchange:
1. Follow the discovery protocol
2. After each user response, save the exchange to `state.discovery.exchanges`
3. Save state after each exchange

**Transition detection**: Move to drafting when the user signals discovery is complete. Watch for natural-language cues such as:
- "that covers it", "let's draft", "I'm happy with these decisions", "move on to the spec"
- Or the user types `/discovery-done` (legacy alternative)

Also proactively suggest moving to drafting when all major discovery categories have been covered (typically 3-7 exchanges).

When transitioning to drafting:
1. Generate discovery summary
2. Save to `state.discovery.summary`
3. Set `state.stage = "spec_drafting"`
4. Save state

#### Step 3: Spec Drafting

Use `TaskUpdate` to show progress: "Drafting spec: {short_name}"

Delegate to an Agent for drafting:

```
Agent(model: opus, prompt: <specDrafter system prompt>)
```

The agent's task should include:
- The user's description
- Discovery summary (if available)
- Project context (from config loading)
- Spec template content (if discovered)
- Spec conventions (if discovered)
- The exact file path to write the spec to
- The spec format to use

After the agent writes the spec:
1. Read the spec file to verify it was created
2. Save spec content to `state.specDraft`
3. Increment `state.specIteration`
4. Set `state.stage = "user_approval"`
5. Save state
6. Show the user a summary and ask for approval

#### Step 4: User Approval

Present the spec to the user. They can:
- **Approve**: Set `state.specApproved = true`, `state.stage = "completed"`, save, commit
- **Request changes**: Provide feedback, return to Step 3 with feedback context (max 5 iterations)
- **Cancel**: Set `state.stage = "cancelled"`, save

#### Step 5: Commit

When approved, commit using git-helpers (see CORE.md §4):
```bash
bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --files "{specPath}" --message "{commitMsg}"
```
Generate commit message via `Agent(model: haiku, prompt: <commitMessageWriter prompt + diff>)` — see CORE.md §5 for the prompt.

After commit, output a **Suggested next step** block:
```
Spec approved and saved to `{specPath}`.

**Suggested next step**: To implement this spec:
`/implement {specPath}`
```

### Quick Mode (`/spec --quick`)

Same as above but skip Step 2 entirely. Go directly from initialization to drafting.

### From Brainstorm Mode (`/spec --from-brainstorm <path>`)

Uses a brainstorm synthesis document as the starting point, then runs a short targeted discovery to fill technical gaps before drafting.

#### Step 1: Initialize

Same as the standard flow (load config, generate ID, etc.), plus:
1. Read the brainstorm synthesis document at `<path>`
2. Set `state.discovery.brainstormPath` to `<path>`

#### Step 2: Targeted Discovery

Instead of full discovery (CORE.md §3), run a **short, gap-focused discovery** (2-4 exchanges):

1. Read the brainstorm document and identify which discovery categories are already well-covered:
   - **Functional Requirements** — typically covered by brainstorm
   - **Scope & Constraints** — typically covered by brainstorm
   - **Edge Cases & Error Handling** — often missing from brainstorm
   - **Non-Functional Requirements** — often missing from brainstorm
   - **Integration & Dependencies** — often missing from brainstorm

2. For each gap category, follow the Assume & Confirm protocol (one exchange per gap):
   - Propose an assumption grounded in the codebase
   - Ask the user to confirm or correct
   - Record exchange in `state.discovery.exchanges`
   - Save state after each exchange

3. **Transition detection**: After 2-4 exchanges (or when all gaps are covered), proactively suggest moving to drafting. Watch for the same natural-language cues as standard discovery.

4. Generate a combined discovery summary that includes:
   - A "From Brainstorm" section summarizing the brainstorm's key findings (directions, tradeoffs, scope assessment)
   - A "Targeted Discovery" section with the gap-filling exchanges
5. Save to `state.discovery.summary`
6. Set `state.stage = "spec_drafting"`
7. Save state

#### Steps 3-5: Drafting, Approval, Commit

Same as the standard flow. The spec drafter agent receives the combined discovery summary (brainstorm + targeted exchanges) as context.

## 4. Condense Spec (`/condense-spec`)

Condense a specification by removing implementation details while preserving architectural value.

### Target

Spec file path: `$1`

### When to Use

Use this when a spec transitions from "Draft/Approved" to "Implemented" status. The code becomes the source of truth for implementation details, and the spec should serve as architectural documentation explaining WHY decisions were made.

### Workflow

1. **Detect Format**
   - Read the file at `$1`
   - Determine if it is Markdown (`.md`) or Typst (`.typ`) based on extension
   - All edits must preserve the original format — do not convert between formats

2. **Verify Pre-conditions**
   - Spec status is "Implemented" or "Complete"
   - Feature is merged to main branch
   - Tests exist in codebase

3. **Read the Spec**
   - Load the full specification file at `$1`
   - Identify current structure and sections

4. **Remove Implementation Details**
   Remove these sections entirely:
   - "Files to Modify" / file lists — Git history shows this
   - "Implementation Plan" (with phases/TDD steps) — Already done
   - "Test Cases" detailed lists — Tests exist in code
   - "Testing Strategy" step-by-step — Tests exist in code
   - "Success Criteria" checklists — Already met
   - Detailed code snippets showing line-by-line changes
   - "Migration Guide" sections — Move to CHANGELOG if still relevant
   - "Current State" / "Current Implementation" sections — Outdated after implementation

5. **Condense Sections**
   Keep essence, remove details from:
   - "API Changes" — Show final signature, not before/after/migration
   - "Database Schema" — Show final schema, not migration steps
   - "Usage Examples" — One clear example, not exhaustive variations

6. **Preserve Architecture**
   Keep these sections in full:
   - "Problem Statement" / "Overview" — Context for why this was needed
   - "Solution Overview" / "Solution Design" — High-level approach taken
   - "Key Design Decisions" — Rationale for specific choices
   - "Alternatives Considered" — Why not other approaches
   - "Breaking Changes" — User impact summary
   - "Future Enhancements" / "Out of Scope" — Deliberately deferred features
   - "Requirements" — What was needed and why (R1, R2, etc.)

7. **Restructure**

   Preserve the original format. Use the appropriate structure:

   ### For Typst (`.typ`) specs:
   1. Keep the `#import "_template.typ": *` and `#show: doc-setup.with(...)` header
   2. Update `status: "IMPLEMENTED"` and add/update `revision:` field
   3. Use Typst headings (`= SECTION`, `== SUBSECTION`)
   4. Use `#table(...)`, `#note-box[...]`, `#field-list(...)`, `#hr()` as appropriate
   5. Sections in order: Overview → Problem Statement → Requirements (condensed) → Solution Design → Key Decisions → API/Schema (final form) → Edge Cases → Future Enhancements

   ### For Markdown (`.md`) specs:
   1. Header (Status: Implemented, Created, Completed dates)
   2. Problem Statement
   3. Solution Overview (with implementation phases if multi-phase)
   4. Key Design Decisions (with code examples only where essential)
   5. API/Schema (final form, condensed)
   6. Alternatives Considered
   7. Breaking Changes (summary)
   8. Future Enhancements (optional)

8. **Apply Style Guidelines**
   - Focus on "what" and "why", not "how"
   - Code examples: Only show final API signature, not migration paths
   - Target length: ~20-30% of original (or leave as-is if already concise)
   - Remove phrases like "we will", "should be", "needs to" (implementation language)
   - Use past tense: "Implemented X", "Added Y", not "Will add Y"
   - For Typst: use `#table()` for structured data, `#note-box[]` for callouts
   - For Markdown: use tables and bullet points over prose

9. **Write Condensed Version**
   - Save the condensed spec back to `$1`
   - Verify length is reduced (or unchanged if already concise)
   - For Typst: ensure `status: "IMPLEMENTED"` in `doc-setup` header
   - For Markdown: ensure header shows "Status: Implemented"

### Anti-Patterns to Avoid

#### Don't: Include step-by-step migration instructions
```
Step 1: Update `Cargo.toml` to add...
Step 2: Modify `src/lib.rs` line 42...
```

#### Do: Summarize breaking changes
```
Breaking Changes:
- `EventBus::publish` now takes `Arc<Event<T>>`
- Users must wrap events before publishing
```

---

#### Don't: Show before/after code comparisons
```rust
// Before:
fn old_api() { }

// After:
fn new_api() { }
```

#### Do: Show final API with rationale
```rust
// Final API uses Arc for shared ownership
fn publish(&self, event: Arc<Event<T>>) -> Result<()>
// Enables efficient fan-out to multiple observers (O(1) vs O(n) cloning)
```

---

#### Don't: List every file that was modified
```
Files to Modify:
1. `epoch_core/src/event_store.rs` - Update EventBus trait
2. `epoch_core/src/projection.rs` - Update apply signature
3. `epoch_pg/src/event_bus.rs` - Implement new publish
```

#### Do: Summarize scope
```
Changed event ownership model across:
- Core traits (EventBus, EventObserver)
- All backend implementations (Pg, InMemory)
- Event streaming utilities
```

---

#### Don't: Convert between formats
Don't rewrite a `.typ` spec as Markdown or vice versa. Preserve the original format.

### Post-Condensing Checklist

- [ ] Status updated to "Implemented" / "IMPLEMENTED" (format-appropriate)
- [ ] No "Files to Modify" or "Implementation Plan" sections remain
- [ ] No detailed test case lists (just high-level testing approach if relevant)
- [ ] Code examples show final state, not migration paths
- [ ] Length reduced to ~20-30% of original (or left as-is if already concise)
- [ ] All "why" explanations preserved
- [ ] Original file format (`.md` or `.typ`) preserved
- [ ] Update docs/README.md if needed

### Key Principle

If in doubt, ask: "Does this help someone understand the architecture?"
- If yes → keep
- If no → remove

## 5. System Prompts

### Spec Drafter

```
You are an expert software architect drafting technical specifications.

Your task is to create a clear, actionable technical specification.

{projectContext}

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

## Output Format

After creating the spec content, use the write tool to save it to the EXACT path provided in your task. Do NOT output the spec as text.
```
