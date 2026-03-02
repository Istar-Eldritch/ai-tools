---
name: planning
description: "Hierarchical planning for software projects: scoping assessment (/plan), roadmap creation (/roadmap), and epic creation (/epic). Decomposes large initiatives into manageable work items. Invoke on /plan, /plan-overview, /roadmap, /epic, /draft-done commands."
---

# Planning

Hierarchical planning that decomposes large initiatives into roadmaps, epics, and feature specs through structured discovery and drafting workflows.

## 1. Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `/plan <description>` | Scoping assessment — recommends roadmap/epic/feature | `--roadmap`, `--epic`, `--feature` |
| `/plan-overview` | Show hierarchy: roadmaps → epics → specs | |
| `/roadmap <description>` | Create a roadmap (decomposes into epics) | |
| `/epic <description>` | Create an epic (decomposes into feature specs) | |
| `/draft-done` | End hierarchy (roadmap/epic) drafting, request approval | |

## 2. Configuration

Configuration is stored in `.claude/spec-pipeline.json`. All fields are optional — sensible defaults are used when absent.

### Schema

```json
{
  "specsDir": "docs/specs",
  "contextFiles": ["README.md", "ARCHITECTURE.md"],
  "specFormat": "md",
  "models": {
    "commitMessageWriter": { "model": "haiku", "thinking": "off" }
  }
}
```

### Default Behavior

When no config file exists:
- **specsDir**: Auto-detect by checking `docs/specs` → `docs` → `specs` → `.` (first that exists)
- **specFormat**: `"md"` (or inferred from template file extension)
- **models**: Use the defaults shown above

### Loading Config

At the start of any command:
1. Check if `.claude/spec-pipeline.json` exists — if so, read it
2. Auto-detect `specsDir` if not configured
3. Gather project context from: `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`
4. Merge any user-specified models with defaults (user config overrides)

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
├── specs/              # Referenced for plan-overview
│   └── <id>.json
├── roadmaps/           # Roadmap states
│   └── <id>.json
└── epics/              # Epic states
    └── <id>.json
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

- **Read state**: Use the `Read` tool to read `.claude/spec-pipeline/<type>/<id>.json`
- **Write state**: Use the `Write` tool to write the full JSON state
- **List states**: `bash skills/spec-pipeline-core/state.sh list <type>`
- **Find active**: `bash skills/spec-pipeline-core/state.sh find-active <type>`

### Save Protocol

Save state at EVERY stage transition and after EVERY significant operation:
1. Update `stage` field
2. Update `updatedAt` to ISO timestamp
3. Write the full state JSON via `Write` tool

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

## 4. Discovery Mode

Discovery is a conversational protocol for gathering requirements before writing a roadmap or epic. It uses the **Assume & Confirm** approach: one assumption at a time.

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
3. Transition to the next stage (drafting)

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

## 5. Scoping Assessment (`/plan`)

The `/plan` command helps determine the right level for the user's work.

### Direct Level Flags

- `/plan --roadmap <desc>` → Skip scoping, create roadmap directly
- `/plan --epic <desc>` → Skip scoping, create epic directly
- `/plan --feature <desc>` → Skip scoping, create spec directly (delegates to `/spec`)

### Scoping Flow

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

## 6. Plan Overview (`/plan-overview`)

Show the full hierarchy of existing plans:

1. List all roadmaps: `bash skills/spec-pipeline-core/state.sh list roadmaps`
2. List all epics: `bash skills/spec-pipeline-core/state.sh list epics`
3. List all specs: `bash skills/spec-pipeline-core/state.sh list specs`
4. Read each state file and display a tree:

```
Roadmap: Platform Modernization (260302_abc)
  |- Epic: API Redesign (260302_def) [completed]
  |  |- Spec: REST endpoints (260302_ghi) [completed]
  |  +- Spec: Auth middleware (260302_jkl) [in progress]
  +- Epic: Frontend Migration (260302_mno) [pending]
```

## 7. Roadmap Creation (`/roadmap`)

### Workflow

1. **Initialize**: Generate ID, timestamp, short name. Create state with `level: "roadmap"`.
2. **Discovery**: Same as discovery (Section 4) but focused on initiative scope.
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

## 8. Epic Creation (`/epic`)

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
| specDrafter | `docs` | `docs(specs): add user authentication specification` |

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
