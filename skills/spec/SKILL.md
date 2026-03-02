---
name: spec
description: "Create and manage technical specifications via discovery + drafting workflow, and condense implemented specs. Invoke on /spec, /spec-resume, /spec-status, /spec-list, /spec-cancel, /condense-spec, /discovery-done, /spec-draft-done commands."
---

# Spec

Create technical specifications through a structured discovery → drafting → approval workflow, and condense implemented specs to preserve architectural value.

## 1. Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `/spec <description>` | Create a technical specification via discovery + drafting | `--quick` skips discovery |
| `/spec-resume` | Resume an active spec pipeline | |
| `/spec-status` | Show status of all spec pipelines | |
| `/spec-list` | List all spec state IDs | |
| `/spec-cancel` | Cancel the active spec pipeline | |
| `/condense-spec <spec-path>` | Condense an implemented spec to architectural documentation | |
| `/discovery-done` | End discovery phase, proceed to drafting | |
| `/spec-draft-done` | End spec drafting, request user approval | |

## 2. Configuration

Configuration is stored in `.claude/spec-pipeline.json`. All fields are optional — sensible defaults are used when absent.

### Schema

```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["README.md", "ARCHITECTURE.md"],
  "specTemplatePath": "docs/specs/TEMPLATE.md",
  "specConventionsPath": "docs/SPEC_CONVENTIONS.md",
  "specFormat": "md",
  "models": {
    "commitMessageWriter": { "model": "haiku", "thinking": "off" }
  }
}
```

### Default Behavior

When no config file exists:
- **specsDir**: Auto-detect by checking `docs/specs` → `docs` → `specs` → `.` (first that exists)
- **testCommand**: Auto-detect from: `npm test`, `cargo test`, `pytest`, `go test`, `make test`, `./scripts/test.sh`
- **specFormat**: `"md"` (or inferred from template file extension)
- **models**: Use the defaults shown above

### Loading Config

At the start of any command:
1. Check if `.claude/spec-pipeline.json` exists — if so, read it
2. Auto-detect `specsDir` and `testCommand` if not configured
3. Discover spec template: search specsDir for files matching `/template/i` with extensions `.md`, `.typ`, `.txt`, `.rst`, `.adoc`
4. Discover spec conventions: search for files matching `/guide.*spec/i`, `/spec.*guide/i`, `/spec.*convention/i`
5. Gather project context from: `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`
6. Merge any user-specified models with defaults (user config overrides)

### Model Mapping for Agent Tool

When delegating to agents, map model identifiers to the `Agent` tool's `model` parameter:
- `"opus"` → `model: "opus"`
- `"sonnet"` → `model: "sonnet"`
- `"haiku"` → `model: "haiku"`

## 3. State Management

All state is persisted as JSON files in `.claude/spec-pipeline/`.

### Directory Structure

```
.claude/spec-pipeline/
├── specs/              # Spec pipeline states
│   └── <id>.json
```

### Initialize State Directory

Before first use, run:
```bash
bash skills/spec-pipeline-core/state.sh init
```

### ID Generation

Pipeline IDs use format `YYMMDDhhmmss_XXXX` where XXXX is random hex. Generate via:
```bash
bash skills/spec-pipeline-core/state.sh generate-id
```

Timestamps for filenames use `YYMMDDhhmm` format:
```bash
bash skills/spec-pipeline-core/state.sh generate-timestamp
```

### State Operations

- **Read state**: Use the `Read` tool to read `.claude/spec-pipeline/specs/<id>.json`
- **Write state**: Use the `Write` tool to write the full JSON state
- **List states**: `bash skills/spec-pipeline-core/state.sh list specs`
- **Find active**: `bash skills/spec-pipeline-core/state.sh find-active specs`

### Save Protocol

Save state at EVERY stage transition and after EVERY significant operation:
1. Update `stage` field
2. Update `updatedAt` to ISO timestamp
3. Write the full state JSON via `Write` tool

### Resume Protocol

When resuming (`/spec-resume`):
1. Run `bash skills/spec-pipeline-core/state.sh find-active specs`
2. If an ID is returned, read its state file
3. Resume from the current `stage` — follow the corresponding section's instructions from that point

### Spec State Schema

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
    "skipped": false
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

## 4. Discovery Mode

Discovery is a conversational protocol for gathering requirements before writing a spec. It uses the **Assume & Confirm** approach: one assumption at a time.

### Protocol

1. **Explore the codebase** first — find similar features, understand patterns, identify constraints
2. **Identify the most important ambiguity** in the user's description
3. **Propose your best assumption** with reasoning grounded in the codebase
4. **Ask the user to confirm or correct** — one assumption per exchange
5. **Record each exchange** in state: `{ "assumption": "...", "response": "..." }`
6. Continue until all important aspects are covered (typically 3-7 exchanges)

### Discovery Categories

Use these to guide which assumptions to surface:
- **Functional Requirements** — behaviors, inputs/outputs, user workflows
- **Edge Cases & Error Handling** — failure modes, boundary conditions
- **Non-Functional Requirements** — performance, security, scalability
- **Integration & Dependencies** — existing features, external dependencies
- **Scope & Constraints** — what's out of scope, MVP vs. nice-to-have

### Exchange Format

Each exchange with the user should follow this pattern:

> Based on my exploration of the codebase, I see that [observation about existing patterns].
>
> **My assumption**: [Concrete proposal for how this aspect should work].
>
> **Reasoning**: [Why this makes sense — references to existing code, patterns, best practices].
>
> Does this match what you have in mind, or would you prefer a different approach?

### Ending Discovery

When the user types `/discovery-done` or you've covered all important aspects:
1. Generate a discovery summary from all exchanges
2. Save the summary to `state.discovery.summary`
3. Transition to the next stage (drafting for specs)

### Summary Generation

Combine all exchanges into a markdown summary:
```markdown
## Discovery Summary

### Assumption 1: [topic]
**Proposed**: [assumption text]
**Decision**: [user's response]

### Assumption 2: [topic]
...
```

## 5. Spec Creation (`/spec`)

### Entry Points

- `/spec <description>` — Full flow: discovery → drafting → approval
- `/spec --quick <description>` — Skip discovery, go directly to drafting
- `/spec-resume` — Resume an active spec pipeline
- `/spec-status` — Show status of all spec pipelines
- `/spec-list` — List all spec state IDs
- `/spec-cancel` — Cancel the active spec pipeline

### Workflow

#### Step 1: Initialize

1. Load configuration (Section 2)
2. Initialize state directory: `bash skills/spec-pipeline-core/state.sh init`
3. Generate pipeline ID and timestamp
4. Derive a short name from the description:
   - Extract 1-4 content words (remove stop words: a, an, the, and, or, for, of, in, on, to, with, is, are, be, its, this, that, from, by, at)
   - Join with underscores, lowercase
   - Example: "Add user authentication" → `user_authentication`
5. Construct spec filename: `{timestamp}_{short_name}.{format}`
6. Construct spec path: `{specsDir}/{filename}`
7. Create initial spec state and save it

Use `TaskCreate` to track progress:
- Task: "Create spec: {description}"

#### Step 2: Discovery (skip if `--quick`)

Enter discovery mode (Section 4). For each exchange:
1. Follow the discovery protocol
2. After each user response, save the exchange to `state.discovery.exchanges`
3. Save state after each exchange

When user types `/discovery-done`:
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

When approved:
1. Stage the spec file: `git add {specPath}`
2. Generate a commit message via Agent:
   ```
   Agent(model: haiku, prompt: <commitMessageWriter prompt + diff>)
   ```
3. Commit: `git commit -m "{message}"`
4. Update task as completed

### Quick Mode (`/spec --quick`)

Same as above but skip Step 2 entirely. Go directly from initialization to drafting.

## 6. Condense Spec (`/condense-spec`)

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

## 7. Git Operations

### Branching

The pipeline operates on the current branch. No automatic branch creation — the user manages branches.

### Scoped Commits

Commits are scoped to specific file sets, not `git add -A`:
1. Get modified files: `git status --porcelain`
2. Stage specific files: `git add <file1> <file2> ...`
3. For agent commits, scope to files the agent actually modified
4. For final phase commits, use `git add -A` for any remaining changes

### Commit Message Generation

For automated commits, delegate to a haiku agent:

```
Agent(model: haiku, prompt: <commitMessageWriter prompt + diff content>)
```

**Diff truncation**: Limit diff content to 8000 characters to avoid overwhelming the model.

**Message format**:
```
<type>(<scope>): <subject>

<body>
```

- **type**: `feat` | `fix` | `docs` | `refactor` | `test` | `chore`
- **scope**: Component/area affected, derived from spec name or phase
- **subject**: Imperative mood, lowercase, no period, max 50 chars
- **body**: Explain what and why, wrap at 72 chars

### Conventional Commit Types by Role

| Role | Default Type | Example |
|------|-------------|---------|
| specDrafter | `docs` | `docs(specs): add user authentication specification` |

## 8. System Prompts

These are the role-specific prompts used when delegating to Agent tool invocations. Include the relevant prompt as the agent's instructions.

### Discovery Agent

```
You are a requirements discovery expert helping to gather information before writing a technical specification.

Your task is to identify ambiguities and gaps, then propose the most likely solution for each — one at a time — for the user to confirm or correct.

{projectContext}

## Your Role

You are conducting a discovery session to understand the user's requirements better. Your goal is to:
1. Identify ambiguities and gaps in the initial description
2. Uncover edge cases and error scenarios
3. Understand non-functional requirements (performance, security, scalability)
4. Clarify integration points with existing systems
5. Define success criteria and acceptance conditions

## Approach: Assume & Confirm (One at a Time)

Instead of asking open-ended questions, you should:
1. Explore the codebase to understand the context
2. Identify the most important ambiguity or gap
3. Propose your best assumption for how it should work
4. Explain your reasoning — why you think this is the right approach
5. Ask the user to confirm or correct your assumption

Present ONE assumption per exchange. Prioritize the most impactful decisions first.

## Discovery Categories

1. Functional Requirements — expected behaviors, inputs/outputs, user workflows
2. Edge Cases & Error Handling — failure modes, invalid inputs, boundary conditions
3. Non-Functional Requirements — performance, security, scalability constraints
4. Integration & Dependencies — interaction with existing features, external dependencies
5. Scope & Constraints — what's out of scope, MVP vs. nice-to-have

Always ground your assumptions in codebase evidence or established best practices. Do NOT write specification content yet.
```

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

### Commit Message Writer

```
You are writing git commit messages.

Format:
<type>(<scope>): <subject>

<body>

Rules:
- type: feat | fix | docs | refactor | test | chore
- scope: Component/area affected
- subject: Imperative mood, lowercase, no period, max 50 chars
- body: Explain what and why (not how), wrap at 72 chars

Output ONLY the commit message, nothing else.
```
