# Spec Pipeline Core Protocols

Shared protocols for all spec-pipeline skills. Each skill's SKILL.md references this document for configuration, state management, discovery, git operations, and shared system prompts.

## 1. Configuration

Configuration is stored in `.claude/spec-pipeline.json`. All fields are optional — sensible defaults are used when absent.

### Full Schema

```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["README.md", "ARCHITECTURE.md"],
  "specTemplatePath": "docs/specs/TEMPLATE.md",
  "specConventionsPath": "docs/SPEC_CONVENTIONS.md",
  "specFormat": "md",
  "models": {
    "planDrafter": "opus",
    "planReviewer": "sonnet",
    "implementer": "opus",
    "codeReviewer": "sonnet",
    "addressReview": "sonnet",
    "commitMessageWriter": "haiku"
  },
  "reviewCycles": {
    "planReviewer": 0,
    "codeReviewer": 5
  },
  "agentContext": {
    "planDrafter": ["docs/architecture.md"],
    "implementer": ["docs/code_standards.md", "CONTRIBUTING.md"],
    "codeReviewer": ["docs/review_checklist.md"],
    "planReviewer": [],
    "addressReview": []
  }
}
```

**Field usage by skill:**
- `specsDir`, `specFormat`, `models.commitMessageWriter` — all skills
- `testCommand` — spec, implement
- `contextFiles` — all skills (shared project context for all agents)
- `agentContext` — per-role extra context files, read and appended to agent prompts
- `specTemplatePath`, `specConventionsPath` — spec, implement
- `models.planDrafter/planReviewer/implementer/codeReviewer/addressReview` — implement only
- `reviewCycles` — implement only

### Loading Config

Load configuration using the config script:

```bash
# Basic (brainstorm, planning)
bash skills/spec-pipeline-core/config.sh load-config

# With test command auto-detection (spec, implement)
bash skills/spec-pipeline-core/config.sh load-config --needs-test-command

# With template discovery (spec, implement)
bash skills/spec-pipeline-core/config.sh load-config --needs-template

# Both (spec, implement)
bash skills/spec-pipeline-core/config.sh load-config --needs-test-command --needs-template
```

The script outputs merged JSON with all resolved values. It:
1. Reads `.claude/spec-pipeline.json` if it exists
2. Auto-detects `specsDir` if not configured: checks `docs/specs` → `docs` → `specs` → `.`
3. If `--needs-test-command`: auto-detects from `npm test`, `cargo test`, `pytest`, `go test`, `make test`
4. If `--needs-template`: searches specsDir for template/convention files
5. Enumerates existing context files (`README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`)
6. Merges user config with defaults (user config overrides)

### Model Mapping for Agent Tool

Model values in config (`"opus"`, `"sonnet"`, `"haiku"`) map directly to the `Agent` tool's `model` parameter — no translation needed.

### Agent Context

Build the `{projectContext}` string for any agent role using the config script:

```bash
bash skills/spec-pipeline-core/config.sh build-agent-context --role implementer
```

This reads all shared `contextFiles` and any per-role `agentContext.<role>` files, concatenates their contents, and outputs the assembled context string. Substitute the output into `{projectContext}` in the agent's system prompt.

If `agentContext` is not configured for a role, only the shared `contextFiles` are included.

### Short Name Derivation

Derive a short name from a description for use in filenames:

```bash
bash skills/spec-pipeline-core/config.sh derive-short-name "Add user authentication"
# Output: user_authentication
```

Strips stop words, takes first 4 content words, lowercase, joined with underscores.

### Path Construction

Construct spec/doc file paths:

```bash
bash skills/spec-pipeline-core/config.sh construct-paths \
  --specs-dir docs/specs --timestamp 2603021430 \
  --short-name user_authentication --format md --type spec
# Output: {"filename": "2603021430_user_authentication.md", "path": "docs/specs/2603021430_user_authentication.md"}
```

For brainstorm type, the filename includes a `brainstorm_` prefix.

## 2. State Management

All state is persisted as JSON files in `.claude/spec-pipeline/`.

### Directory Structure

```
.claude/spec-pipeline/
├── specs/              # Spec pipeline states
├── implementations/    # Implementation pipeline states
├── roadmaps/           # Roadmap states
├── epics/              # Epic states
└── brainstorms/        # Brainstorm states
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

For any state type (`specs`, `implementations`, `roadmaps`, `epics`, `brainstorms`):

- **Read state**: Use the `Read` tool to read `.claude/spec-pipeline/<type>/<id>.json`
- **Write state**: Use the `Write` tool to write the full JSON state
- **List states**: `bash skills/spec-pipeline-core/state.sh list <type>`
- **Find active**: `bash skills/spec-pipeline-core/state.sh find-active <type>`

### Save Protocol

Save state at EVERY stage transition and after EVERY significant operation:
1. Update `stage` field
2. Update `updatedAt` to ISO timestamp
3. Write the full state JSON via `Write` tool

### Resume Protocol

When resuming a pipeline (e.g., `/spec-resume`, `/implement-resume`):
1. Run `bash skills/spec-pipeline-core/state.sh find-active <type>`
2. If an ID is returned, read its state file
3. Resume from the current `stage` — follow the skill's corresponding section from that point

## 3. Discovery Mode

Discovery is a conversational protocol for gathering requirements before writing the current artifact. It uses the **Assume & Confirm** approach: one assumption at a time.

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

When the user signals discovery is done (e.g., `/discovery-done`) or all important aspects are covered:
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

## 4. Git Operations

### Branching

The pipeline operates on the current branch. No automatic branch creation — the user manages branches.

### Scoped Commits

Use the git-helpers script for scoped commits:

```bash
# Commit specific files
bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --files "file1.md file2.md" --message "commit msg"

# Auto-detect changed files and commit
bash skills/spec-pipeline-core/git-helpers.sh scoped-commit --auto --message "commit msg"
```

Exit codes: 0 = success, 1 = no changes, 2 = error.

### Commit Message Generation

For automated commits, delegate to a haiku agent:

```
Agent(model: haiku, prompt: <commitMessageWriter prompt + diff content>)
```

Get a truncated diff for the prompt:

```bash
bash skills/spec-pipeline-core/git-helpers.sh staged-diff --max-chars 8000
```

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
| brainstormAgent | `docs` | `docs(brainstorm): capture brainstorm session` |
| specDrafter | `docs` | `docs(specs): add user authentication specification` |
| planDrafter | `docs` | `docs(user-auth): create implementation plan` |
| implementer | `feat` | `feat(user-auth): implement phase 1 changes` |
| addressReview | `fix` | `fix(user-auth): address review feedback` |
| codeReviewer | `refactor` | `refactor(user-auth): apply code review changes` |
| roadmapDrafter | `docs` | `docs(roadmap): create platform modernization roadmap` |
| epicDrafter | `docs` | `docs(epic): create API redesign epic` |

### Fallback Messages

If haiku agent fails to generate a commit message, use these:
- planDrafter → `docs({scope}): create implementation plan`
- implementer → `feat({scope}): implement phase changes`
- addressReview → `fix({scope}): address review feedback`
- codeReviewer → `refactor({scope}): apply code review changes`

## 5. Shared System Prompts

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
