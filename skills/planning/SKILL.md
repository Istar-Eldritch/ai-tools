---
name: planning
description: "Hierarchical planning for software projects: scoping assessment (/plan), roadmap creation (/roadmap), and epic creation (/epic). Decomposes large initiatives into manageable work items. Invoke on /plan, /plan-overview, /roadmap, /epic commands."
---

# Planning

Hierarchical planning that decomposes large initiatives into roadmaps, epics, and feature specs through structured discovery and drafting workflows.

## Prerequisites

**Before executing any command**, read the core protocols:
> Read `skills/spec-pipeline-core/CORE.md`

Configuration, state management, discovery mode, git operations, and shared prompts are defined there.
This file only contains planning-specific workflow and prompts.

## 1. Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `/plan <description>` | Scoping assessment — recommends roadmap/epic/feature | `--roadmap`, `--epic`, `--feature` |
| `/plan-overview` | Show hierarchy: roadmaps → epics → specs | |
| `/roadmap <description>` | Create a roadmap (decomposes into epics) | |
| `/epic <description>` | Create an epic (decomposes into feature specs) | |

## 2. Hierarchy State Schema (Roadmap/Epic)

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

## 3. Scoping Assessment (`/plan`)

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

## 4. Plan Overview (`/plan-overview`)

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

## 5. Roadmap Creation (`/roadmap`)

### Workflow

1. **Initialize**: Load config via `bash skills/spec-pipeline-core/config.sh load-config`. Generate ID, timestamp, short name. Construct paths with `--type roadmap`. Create state with `level: "roadmap"`.
2. **Discovery**: Follow CORE.md §3 Discovery Mode, focused on initiative scope.
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
5. **Child Extraction**: Parse child items from the approved document:
   ```bash
   bash skills/spec-pipeline-core/parse.sh extract-child-items "{docPath}"
   ```
   Save result to `state.childItems[]`.
6. **Commit**: Use `bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --files "{docPath}" --message "{commitMsg}"`. Generate commit message via haiku agent — see CORE.md §4-5.
7. **Next Steps**: Inform user they can now create epics for each child item:
   ```
   To create an epic for item 1: /epic "Epic name - Brief description"
   ```

## 6. Epic Creation (`/epic`)

Same workflow as roadmap but:
- Uses `epicDrafter` and `epicReviewer` prompts instead
- Construct paths with `--type epic`
- Document structure:
  - PART I: Epic Overview (goal, requirements, success criteria, scope)
  - PART II: Feature Decomposition (child items table)
  - PART III: Technical Considerations
- Child items decompose into feature specs (not epics)
- After approval, extract child items: `bash skills/spec-pipeline-core/parse.sh extract-child-items "{docPath}"`
- Inform user they can create specs:
  ```
  To create a spec for item 1: /spec "Feature name - Brief description"
  ```
- If this epic is a child of a roadmap, record `parentId` in state

## 7. System Prompts

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
