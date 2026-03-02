---
name: spec-pipeline
description: "Software development lifecycle automation: writing technical specifications (/spec), implementing specs with AI-driven planning and code review (/implement), hierarchical planning (/plan, /roadmap, /epic), and brainstorming (/brainstorm). Invoke when user mentions specs, implement, planning, roadmaps, epics, brainstorm, or uses /spec, /implement, /plan, /roadmap, /epic, /brainstorm commands."
---

# Spec Pipeline

A complete software development lifecycle skill that manages specification creation, implementation with tiered review, hierarchical planning, and brainstorming — all with persistent state for pause/resume across sessions.

## 1. Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `/spec <description>` | Create a technical specification via discovery + drafting | `--quick` skips discovery |
| `/spec-resume` | Resume an active spec pipeline | |
| `/spec-status` | Show status of all spec pipelines | |
| `/spec-list` | List all spec state IDs | |
| `/spec-cancel` | Cancel the active spec pipeline | |
| `/implement <spec-path-or-description>` | Implement a spec with phased planning + review | `--no-plan`, `--no-review` |
| `/implement-resume` | Resume an active implementation pipeline | |
| `/implement-status` | Show status of all implementation pipelines | |
| `/plan <description>` | Scoping assessment → recommends roadmap/epic/feature | `--roadmap`, `--epic`, `--feature` |
| `/plan-overview` | Show hierarchy: roadmaps → epics → specs | |
| `/roadmap <description>` | Create a roadmap (decomposes into epics) | |
| `/epic <description>` | Create an epic (decomposes into feature specs) | |
| `/brainstorm <description>` | Open-ended divergent exploration | |
| `/brainstorm-done` | Synthesize brainstorm into a document | |
| `/discovery-done` | End discovery phase, proceed to drafting | |
| `/spec-draft-done` | End spec drafting, request user approval | |
| `/draft-done` | End hierarchy (roadmap/epic) drafting, request approval | |

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
    "planDrafter": { "model": "opus", "thinking": "high" },
    "planReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    },
    "implementer": { "model": "opus", "thinking": "high" },
    "codeReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    },
    "addressReview": { "model": "sonnet", "thinking": "medium" },
    "commitMessageWriter": { "model": "haiku", "thinking": "off" }
  },
  "reviewCycles": {
    "cheap": 2,
    "expensive": 2
  }
}
```

### Default Behavior

When no config file exists:
- **specsDir**: Auto-detect by checking `docs/specs` → `docs` → `specs` → `.` (first that exists)
- **testCommand**: Auto-detect from: `npm test`, `cargo test`, `pytest`, `go test`, `make test`, `./scripts/test.sh`
- **specFormat**: `"md"` (or inferred from template file extension)
- **models**: Use the defaults shown above
- **reviewCycles**: `{ "cheap": 2, "expensive": 2 }` for both planReviewer and codeReviewer

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
├── implementations/    # Implementation pipeline states
│   └── <id>.json
├── roadmaps/           # Roadmap states
│   └── <id>.json
├── epics/              # Epic states
│   └── <id>.json
└── brainstorms/        # Brainstorm states
    └── <id>.json
```

### Initialize State Directory

Before first use, run:
```bash
bash skills/spec-pipeline/state.sh init
```

### ID Generation

Pipeline IDs use format `YYMMDDhhmmss_XXXX` where XXXX is random hex. Generate via:
```bash
bash skills/spec-pipeline/state.sh generate-id
```

Timestamps for filenames use `YYMMDDhhmm` format:
```bash
bash skills/spec-pipeline/state.sh generate-timestamp
```

### State Operations

- **Read state**: Use the `Read` tool to read `.claude/spec-pipeline/<type>/<id>.json`
- **Write state**: Use the `Write` tool to write the full JSON state
- **List states**: `bash skills/spec-pipeline/state.sh list <type>`
- **Find active**: `bash skills/spec-pipeline/state.sh find-active <type>`

### Save Protocol

Save state at EVERY stage transition and after EVERY significant operation:
1. Update `stage` field
2. Update `updatedAt` to ISO timestamp
3. Write the full state JSON via `Write` tool

### Resume Protocol

When resuming (`/spec-resume`, `/implement-resume`):
1. Run `bash skills/spec-pipeline/state.sh find-active <type>`
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

### Implementation State Schema

```json
{
  "id": "260302150000_c3d4",
  "implTimestamp": "2603021500",
  "specPath": "docs/specs/2603021430_user_authentication.md",
  "specContent": "...",
  "stage": "plan_generation",
  "phases": [],
  "phasesGenerated": [],
  "currentPhaseIndex": 0,
  "currentReviewCycle": 0,
  "previousReview": "",
  "currentReviewTier": null,
  "cheapCyclesCompleted": 0,
  "expensiveCyclesCompleted": 0,
  "implementerCompletedForPhase": false,
  "phaseCommits": [],
  "skipPlanGeneration": false,
  "createdAt": "2026-03-02T15:00:00Z",
  "updatedAt": "2026-03-02T15:00:00Z",
  "checkpoints": []
}
```

**Stages**: `"plan_generation"` → `"implementation"` → `"completed"` | `"cancelled"`

### Hierarchy State Schema (Roadmap/Epic)

```json
{
  "id": "260302160000_e5f6",
  "description": "Platform modernization",
  "stage": "discovery",
  "level": "roadmap",
  "parentId": null,
  "docTimestamp": "2603021600",
  "docFilename": "2603021600_platform_modernization.md",
  "docPath": "docs/specs/2603021600_platform_modernization.md",
  "childItems": [],
  "discovery": { "exchanges": [], "summary": null, "skipped": false },
  "drafting": { "exchanges": [] },
  "createdAt": "2026-03-02T16:00:00Z",
  "updatedAt": "2026-03-02T16:00:00Z",
  "checkpoints": []
}
```

**Stages**: `"discovery"` → `"drafting"` → `"user_approval"` → `"child_extraction"` → `"completed"` | `"cancelled"`

### Brainstorm State Schema

```json
{
  "id": "260302170000_g7h8",
  "description": "Explore caching strategies",
  "stage": "brainstorming",
  "exchanges": [],
  "synthesisPath": null,
  "createdAt": "2026-03-02T17:00:00Z",
  "updatedAt": "2026-03-02T17:00:00Z"
}
```

**Stages**: `"brainstorming"` → `"synthesis"` → `"completed"` | `"cancelled"`

## 4. Discovery Mode

Discovery is a conversational protocol for gathering requirements before writing a spec, roadmap, or epic. It uses the **Assume & Confirm** approach: one assumption at a time.

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
3. Transition to the next stage (drafting for specs/hierarchies, implementation for `/implement`)

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
2. Initialize state directory: `bash skills/spec-pipeline/state.sh init`
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

## 6. Implementation (`/implement`)

### Entry Points

- `/implement <spec-path>` — Implement from a spec file
- `/implement <description>` — Discovery first, then implement
- `/implement --no-plan` — Skip plan generation, implement directly from spec
- `/implement --no-review` — Skip tiered review cycles
- `/implement-resume` — Resume an active implementation
- `/implement-status` — Show status of all implementations

### Workflow Overview

```
For each phase extracted from the spec:
  1. Plan Drafting (opus agent) ← skip if --no-plan
  2. Plan Review — tiered (cheap then expensive) ← skip if --no-review
  3. Implementation (opus agent)
  4. Code Review — tiered (cheap then expensive) ← skip if --no-review
  5. Git commit per phase
```

#### Step 1: Initialize

1. Load configuration
2. If argument is a file path that exists: read the spec content
3. If argument is a description: run discovery mode first, then the user creates a spec
4. Generate implementation ID and timestamp
5. Create initial implementation state
6. Extract phases from the spec

#### Step 2: Phase Extraction

Parse the spec to find implementation phases. Try these regex patterns in order:

1. **Table with links** (legacy): `| Phase N | ... | [name](path) |`
2. **Table without links** (preferred): `| Phase N | Focus description | Effort |`
3. **Typst table**: `[Phase N], [Focus description], [Effort],`
4. **Inline headers** (fallback): `### Phase N: Name`

For each phase found:
- Generate a phase file path: `{timestamp}_{short_name}/phase{N}_{sanitized_focus}.md`
- Sanitize focus: lowercase, strip non-alphanumeric, remove stop words, take first 4 words, join with `_`

If no phases found, create a single fallback phase: `phase1_implementation.md`

Store phases in `state.phases[]`.

#### Step 3: Per-Phase Pipeline

Use `TaskCreate` to track each phase. For each phase (from `state.currentPhaseIndex`):

##### 3a. Plan Drafting (skip if `--no-plan` or `state.skipPlanGeneration`)

Delegate to Agent:
```
Agent(model: opus, prompt: <planDrafter system prompt + spec content + phase description>)
```

The planDrafter must:
- Explore the codebase first
- Create a detailed, executable phase plan
- Write it to a temp location or include it in output
- Reference real file paths verified via exploration

After drafting, create an agent commit for the plan.

##### 3b. Plan Review (skip if `--no-review`)

Run the **Tiered Review Protocol** (see below) with:
- Role: `planReviewer`
- Review task: the plan content
- Fix role: `addressReview` agent

##### 3c. Implementation

Delegate to Agent:
```
Agent(model: opus, prompt: <implementer system prompt + plan content + spec content>)
```

The implementer must:
- Follow the plan step-by-step
- Write tests if the project uses TDD
- Run the test command at the end
- Report what was completed and test results

If there's previous review feedback (`state.previousReview`), include it in the prompt.

After implementation, create an agent commit.

##### 3d. Code Review (skip if `--no-review`)

Run the **Tiered Review Protocol** with:
- Role: `codeReviewer`
- Review task: the implementation + plan + spec
- Fix role: `addressReview` agent

##### 3e. Phase Commit

If any uncommitted changes remain after the review cycles:
```bash
git add -A && git commit -m "feat(phase-{N}): complete phase {N} implementation"
```

##### 3f. Phase Cleanup

Reset per-phase state:
- `state.currentReviewCycle = 0`
- `state.previousReview = ""`
- `state.currentReviewTier = null`
- `state.cheapCyclesCompleted = 0`
- `state.expensiveCyclesCompleted = 0`
- `state.implementerCompletedForPhase = false`
- `state.currentPhaseIndex += 1`
- Save state

#### Step 4: Completion

After all phases:
1. Set `state.stage = "completed"`
2. Save state
3. Output summary: pipeline ID, spec path, phases completed, total commits

### Tiered Review Protocol

This is the core review mechanism used by both plan review and code review.

**Parameters** (from config):
- `cheapCycles`: Number of cheap-tier review cycles (default: 2)
- `expensiveCycles`: Number of expensive-tier review cycles (default: 2)

**Skip case**: If both `cheapCycles` and `expensiveCycles` are 0, skip review entirely (auto-approve).

**Cheap Tier Loop** (cycles 1 to `cheapCycles`):

1. Run reviewer agent at cheap tier:
   ```
   Agent(model: sonnet, prompt: <reviewer system prompt + content to review>)
   ```
2. Parse verdict from output (see Verdict Parsing below)
3. If `APPROVED`: break out of cheap loop, proceed to expensive tier for final QA
4. If `NEEDS_CHANGES` and more cycles remain:
   - Run fix agent:
     ```
     Agent(model: sonnet, prompt: <addressReview prompt + review feedback>)
     ```
   - Create agent commit after fix
   - Update state: `state.cheapCyclesCompleted += 1`
   - Save state

**Expensive Tier Loop** (cycles 1 to `expensiveCycles`):

1. Run reviewer agent at expensive tier:
   ```
   Agent(model: opus, prompt: <reviewer system prompt + "Perform thorough quality gate review">)
   ```
2. Parse verdict
3. If `APPROVED`: done, return approved
4. If `NEEDS_CHANGES`:
   - Run fix agent (always, even on last cycle)
   - Create agent commit
   - Update state: `state.expensiveCyclesCompleted += 1`
   - Save state

**Max cycles exhaustion**: If expensive tier completes all cycles without approval, proceed anyway (the implementation has been improved by all the fix cycles).

### Verdict Parsing

Parse review agent output to determine `APPROVED` or `NEEDS_CHANGES`:

1. Search for `APPROVED` and `NEEDS_CHANGES` (word boundaries, case-insensitive)
2. If both appear, the one at the **later position** wins (last-wins rule)
3. Also recognize legacy formats: `CHANGES_REQUESTED`, `NEEDS_WORK` → `NEEDS_CHANGES`; `READY` → `APPROVED`
4. **Conservative default**: If no verdict marker found, treat as `NEEDS_CHANGES`

### Agent Commits

After each agent operation that modifies files:

1. Check for modified files: `git status --porcelain`
2. If no changes, skip
3. Stage relevant files: `git add <files>`
4. Generate commit message via Agent:
   ```
   Agent(model: haiku, prompt: <commitMessageWriter prompt + truncated diff (max 8000 chars)>)
   ```
5. Commit with the generated message
6. Record commit hash in `state.checkpoints[]`

**Commit message format**: `<type>(<scope>): <subject>`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Scope: derived from spec name or phase number
- Subject: imperative, lowercase, no period, max 50 chars

**Fallback messages** (if haiku fails):
- planDrafter → `docs({scope}): create implementation plan`
- implementer → `feat({scope}): implement phase changes`
- addressReview → `fix({scope}): address review feedback`
- codeReviewer → `refactor({scope}): apply code review changes`

### Resume Support

When `/implement-resume` is called:
1. Find active implementation: `bash skills/spec-pipeline/state.sh find-active implementations`
2. Load state, check `state.stage` and `state.currentPhaseIndex`
3. If `state.implementerCompletedForPhase` is true, skip to code review step
4. Otherwise resume from the current stage within the current phase

## 7. Hierarchical Planning (`/plan`, `/roadmap`, `/epic`)

### Scoping Assessment (`/plan`)

The `/plan` command helps determine the right level for the user's work.

#### Direct Level Flags

- `/plan --roadmap <desc>` → Skip scoping, create roadmap directly
- `/plan --epic <desc>` → Skip scoping, create epic directly
- `/plan --feature <desc>` → Skip scoping, create spec directly (delegates to `/spec`)

#### Scoping Flow

1. Enter scoping mode — ask the user targeted questions **one at a time**:
   - How many distinct functional areas does this touch?
   - Can this be delivered as a single coherent change?
   - Estimated total effort: days, weeks, or months?
   - Does it require coordination across multiple subsystems?

2. Based on answers, recommend a level:
   - **Roadmap**: Months of work, multiple teams/subsystems, 5+ independent deliverables
   - **Epic**: Weeks of work, 2-5 independent features
   - **Feature**: Days of work, one coherent change

3. Present recommendation:
   ```
   **Recommended Level**: roadmap | epic | feature
   **Justification**: Brief explanation
   **Proposed Decomposition**: Sketch of child items (if roadmap/epic)
   ```

4. User confirms or overrides → proceed to the appropriate workflow

### Plan Overview (`/plan-overview`)

Show the full hierarchy of existing plans:

1. List all roadmaps: `bash skills/spec-pipeline/state.sh list roadmaps`
2. List all epics: `bash skills/spec-pipeline/state.sh list epics`
3. List all specs: `bash skills/spec-pipeline/state.sh list specs`
4. Read each state file and display a tree:

```
📋 Roadmap: Platform Modernization (260302_abc)
  ├─ Epic: API Redesign (260302_def) [completed]
  │  ├─ Spec: REST endpoints (260302_ghi) [completed]
  │  └─ Spec: Auth middleware (260302_jkl) [in progress]
  └─ Epic: Frontend Migration (260302_mno) [pending]
```

### Roadmap Creation (`/roadmap`)

#### Workflow

1. **Initialize**: Generate ID, timestamp, short name. Create state with `level: "roadmap"`.
2. **Discovery**: Same as spec discovery (Section 4) but focused on initiative scope.
3. **Drafting**: Delegate to Agent:
   ```
   Agent(model: opus, prompt: <roadmapDrafter system prompt + discovery summary + project context>)
   ```
   The agent writes a roadmap document with:
   - PART I: Vision & Context (overview, success criteria, scope)
   - PART II: Epic Decomposition (child items table)
   - PART III: Timeline & Risks

   **Child Items Table Format** (CRITICAL):
   ```
   | # | Item | Description | Priority | Dependencies |
   |---|------|-------------|----------|--------------|
   | 1 | Epic name | Brief description | High | - |
   | 2 | Epic name | Brief description | High | 1 |
   ```

4. **User Approval**: Present document, user approves or requests changes.
5. **Child Extraction**: Parse the child items table from the approved document.
   - Match table rows with columns: #, Item, Description, Priority, Dependencies
   - Extract each row as a child item
   - Save to `state.childItems[]`
6. **Commit**: Stage and commit the roadmap document.
7. **Next Steps**: Inform user they can now create epics for each child item:
   ```
   To create an epic for item 1: /epic "Epic name - Brief description"
   ```

### Epic Creation (`/epic`)

Same workflow as roadmap but:
- Uses `epicDrafter` and `epicReviewer` prompts instead
- Document structure:
  - PART I: Epic Overview (goal, requirements, success criteria, scope)
  - PART II: Feature Decomposition (child items table)
  - PART III: Technical Considerations
- Child items decompose into feature specs (not epics)
- After approval, inform user they can create specs:
  ```
  To create a spec for item 1: /spec "Feature name - Brief description"
  ```
- If this epic is a child of a roadmap, record `parentId` in state

### Child Item Extraction

Parse a markdown table to extract child items:

1. Find table with columns: `#`, `Item`, `Description`, `Priority`, `Dependencies`
2. For each data row:
   - Extract: number, item name, description, priority (High/Medium/Low)
   - Parse dependencies as comma-separated numbers
3. Return as array of child items

## 8. Brainstorming (`/brainstorm`)

### Entry Points

- `/brainstorm <description>` — Start a brainstorming session
- `/brainstorm-done` — Synthesize the brainstorm into a document

### Workflow

#### Step 1: Initialize

1. Generate brainstorm ID and timestamp
2. Create initial brainstorm state with `stage: "brainstorming"`
3. Save state

#### Step 2: Brainstorming Session

Enter brainstorming mode. This is a conversational, divergent exploration:

**Rules**:
- Focus on **one concept or problem** per exchange
- Explore it from multiple angles before moving on
- Surface tradeoffs, risks, and opportunities
- Ask open-ended questions that expand thinking
- Challenge assumptions and offer alternative framings
- Reference the codebase — ground proposals in what exists
- Do NOT write specs, plans, or code
- Do NOT try to converge on a solution prematurely

**Codebase exploration**: Before and during brainstorming, explore:
- Relevant existing features and patterns
- Architectural constraints and opportunities
- Integration points and dependencies
- Technical debt or limitations

For each exchange:
1. Record the exchange in `state.exchanges[]`
2. Save state after each exchange

#### Step 3: Synthesis (`/brainstorm-done`)

When the user types `/brainstorm-done`:

1. Set `state.stage = "synthesis"`
2. Generate a synthesis document from the conversation:

```markdown
# Brainstorm: <title>

**Status**: Draft
**Created**: YYYY-MM-DD
**Timestamp**: <YYMMDDhhmm>

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
[Feature, epic, or roadmap-level effort — and why]
```

3. Write the document to `{specsDir}/{timestamp}_brainstorm_{short_name}.md`
4. Stage and commit the document
5. Set `state.synthesisPath` to the file path
6. Set `state.stage = "completed"`
7. Save state

## 9. Git Operations

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
| planDrafter | `docs` | `docs(user-auth): create implementation plan` |
| implementer | `feat` | `feat(user-auth): implement phase 1 changes` |
| addressReview | `fix` | `fix(user-auth): address review feedback` |
| codeReviewer | `refactor` | `refactor(user-auth): apply code review changes` |
| specDrafter | `docs` | `docs(specs): add user authentication specification` |
| brainstormAgent | `docs` | `docs(brainstorm): capture brainstorm session` |

## 10. System Prompts

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

### Plan Drafter

```
You are creating a detailed implementation plan for a spec phase.

Translate high-level spec requirements into specific, executable steps with file paths and code examples.

{projectContext}

## CRITICAL: Codebase Grounding First

Before writing ANY plan, you MUST explore the existing codebase:
1. Explore project structure
2. Find similar code — look for patterns to follow
3. Read related files — understand existing implementations
4. Check test patterns

## Plan Format

Create a detailed, executable phase plan:

# Phase N: [Phase Name]

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

### Plan Reviewer

```
You are reviewing an implementation plan for a spec phase.

Check that the plan is detailed, executable, and follows project conventions.

{projectContext}

## Review Checklist

1. Codebase Grounding — Are file paths real? Are similar implementations referenced?
2. Project Convention Compliance — Does it follow existing patterns?
3. Completeness — All necessary steps included? Prerequisites identified?
4. Execution Order — Logical sequence? Test-driven where appropriate?
5. Specificity — Exact file paths? Code examples match project style?
6. Verification — Each step has verification? Final checklist includes tests?

Do NOT run tests — you are reviewing the plan document only.

## Response Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Issues** (if any):
1. Issue description
   - Suggestion: How to fix

**Missing** (if any):
- What's not covered that should be
```

### Implementer

```
You are implementing a phase of a specification.

Follow the implementation plan step-by-step, following project conventions.

{projectContext}

## Implementation Workflow

1. Codebase Grounding: Read related files to understand patterns
2. Follow TDD (if project uses it): Write tests first
3. Make Changes: Implement following existing code style
4. Verify: Run tests after each step

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

### Code Reviewer

```
You are a senior code reviewer.

Review the implementation against spec requirements and project conventions.

{projectContext}

## CRITICAL: Do NOT Run Tests

You are a REVIEWER, not an implementer. Do NOT run tests, build commands, or execute code.

## Review Focus Areas

1. Correctness — Does implementation match spec? Logic correct? Edge cases handled?
2. Code Quality — Clean, readable, matches surrounding style?
3. Architecture — Fits project structure? Uses appropriate patterns?
4. Testing — Are test files present and covering the implementation? READ test files, do NOT execute.
5. Organization — Code in right location? Files named appropriately?
6. Security — Input validation? No obvious vulnerabilities?

## Review Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Issues** (if any):
1. [CRITICAL/MAJOR/MINOR] Description
   - File: path/to/file:line
   - Problem: What's wrong
   - Fix: How to address it
```

### Address Review

```
You are addressing code review feedback.

Fix issues raised in the code review, following project conventions.

{projectContext}

## Process

For each issue in the review:
1. Understand the problem
2. Check referenced files/conventions
3. Make the fix following project patterns
4. Verify the fix works

## Priority Order

1. CRITICAL: Blocking issues (tests failing, security, correctness)
2. MAJOR: Significant problems (architecture, patterns, organization)
3. MINOR: Polish (style, naming, comments)

After addressing issues, run the full test suite.

Report: What was fixed, test results, any issues not addressed (with reason).
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

### Brainstorm Agent

```
You are a creative thought partner helping to explore and brainstorm ideas before any formal planning begins.

{projectContext}

## Your Role

1. Explore the codebase to understand what exists and what constraints apply
2. Focus each exchange on one concept or problem — explore from multiple angles before moving on
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
```

### Scoping Agent

```
You are a scoping assessment expert. Given a description of what the user wants to build, help determine the right level of planning.

{projectContext}

## Levels

- Roadmap: High-level initiative spanning multiple epics (months, multiple teams, 5+ deliverables)
- Epic: Medium-level effort spanning multiple feature specs (weeks, 2-5 features)
- Feature: Single feature spec (days, one coherent change)

## Process

1. Read the description
2. Explore the codebase to understand scope of impact
3. Ask targeted scoping questions ONE AT A TIME:
   - How many distinct functional areas?
   - Single coherent change or multiple deliverables?
   - Estimated effort: days, weeks, months?
   - Cross-subsystem coordination needed?
4. Recommend a level with justification

## Output

**Recommended Level**: roadmap | epic | feature
**Justification**: Brief explanation
**Proposed Decomposition** (if roadmap/epic): Sketch of child items
```

### Roadmap Drafter

```
You are an expert software architect creating a roadmap document.

{projectContext}

## Document Structure

### PART I: Vision & Context
1. Initiative Overview — what, why, business value, current state
2. Success Criteria — measurable outcomes
3. Scope & Boundaries — included/excluded

### PART II: Epic Decomposition

| # | Item | Description | Priority | Dependencies |
|---|------|-------------|----------|--------------|
| 1 | Epic name | Brief description | High | - |
| 2 | Epic name | Brief description | High | 1 |

Guidelines:
- Each epic independently deliverable
- Roughly 1-4 weeks each
- Minimize dependencies
- Enough context for independent spec creation

### PART III: Timeline & Risks
1. Estimated Timeline
2. Key Risks
3. Assumptions

Focus on WHAT (capabilities), not HOW (implementation details).
```

### Roadmap Reviewer

```
You are a senior technical reviewer evaluating a roadmap document.

{projectContext}

## Review Focus

1. Decomposition Quality — Well-scoped, independent epics?
2. Dependencies — Correctly identified? Can they be reduced?
3. Priority & Ordering — Makes sense? Accounts for dependencies?
4. Completeness — Vision clear? Success criteria measurable? Scope defined?
5. Context Sufficiency — Each epic has enough detail for independent spec?
6. Child Items Table Format — MUST have: #, Item, Description, Priority, Dependencies

**Verdict**: APPROVED | NEEDS_CHANGES
```

### Epic Drafter

```
You are an expert software architect creating an epic document.

{projectContext}

## Document Structure

### PART I: Epic Overview
1. Goal Statement — what this delivers, how it fits broader initiative
2. Requirements — R1, R2, R3 (independently verifiable)
3. Success Criteria — measurable outcomes with checkboxes
4. Scope & Boundaries

### PART II: Feature Decomposition

| # | Item | Description | Priority | Dependencies |
|---|------|-------------|----------|--------------|
| 1 | Feature name | What it delivers | High | - |
| 2 | Feature name | What it delivers | High | 1 |

Guidelines:
- Each feature implementable as single spec + implement cycle
- 1-5 days of work each
- Clear, testable boundaries

### PART III: Technical Considerations
1. Architecture Notes
2. Integration Points
3. Testing Strategy

Features should be right granularity for a single /spec + /implement cycle.
```

### Epic Reviewer

```
You are a senior technical reviewer evaluating an epic document.

{projectContext}

## Review Focus

1. Feature Decomposition — Right size (1-5 days)? Independently deliverable?
2. Dependencies — Correctly identified?
3. Requirements & Success Criteria — Specific, testable, measurable?
4. Context Sufficiency — Each feature has enough for standalone spec?
5. Child Items Table Format — MUST have: #, Item, Description, Priority, Dependencies

**Verdict**: APPROVED | NEEDS_CHANGES
```
