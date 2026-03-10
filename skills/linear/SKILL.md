---
name: linear
description: Project management via Linear using the linear CLI (schpet/linear-cli). Use for creating, updating, and tracking issues, managing projects, teams, initiatives, milestones, documents, labels, comments, relations, and status updates. Invoke when user mentions Linear, issues, tickets, bugs, tasks, projects, initiatives, milestones, teams, labels, documents, or Linear project management.
---

# Linear Project Management CLI

A command-line interface for Linear.app (schpet/linear-cli v1.10.0). All issue views support `--json` for machine-readable output.

## Core Concepts

- **Issues**: Individual tasks, bugs, or work items (identified like `ENG-123`)
- **Teams**: Groups of people with their own issue prefixes and workflows
- **Projects**: Cross-team efforts that group related issues
- **Initiatives**: High-level strategic goals that group projects
- **Milestones**: Checkpoints within a project
- **Labels**: Tags for categorizing issues (workspace-level or team-level)
- **Documents**: Rich text documents attached to projects or issues
- **Relations**: Dependencies and links between issues (blocks, blocked-by, related, duplicate)

## Prerequisites

Authenticate with Linear:

```bash
linear auth login
```

Check current authentication:

```bash
linear auth list
linear auth whoami
```

## Global Options

All commands support:

- `-w, --workspace <slug>` — Target a specific workspace (if you have multiple)

## Per-Project Configuration

Create a `.linear.toml` in your repo root to set defaults:

```bash
linear config
```

This sets the default team so you don't need `--team` on every command.

---

## Authentication

```bash
# Add a workspace credential
linear auth login

# List configured workspaces (* = default)
linear auth list

# Set default workspace
linear auth default [workspace]

# Remove a workspace credential
linear auth logout [workspace]

# Print the configured API token
linear auth token

# Print info about the authenticated user
linear auth whoami
```

---

## Issues

Issues are the primary work items in Linear. They belong to a team and are identified by a prefix like `ENG-123`.

### List Issues

```bash
# List your unstarted issues (default)
linear issue list

# Filter by state
linear issue list --state started
linear issue list --state backlog
linear issue list --state triage
linear issue list --state completed
linear issue list --state canceled
linear issue list --all-states

# Filter by assignee
linear issue list --assignee username
linear issue list --all-assignees
linear issue list --unassigned

# IMPORTANT: Specify team when not in a configured project directory
linear issue list --team SIG --sort manual

# Filter by team or project
linear issue list --team ENG
linear issue list --project "Project Name"

# Sort and limit
linear issue list --sort priority
linear issue list --sort manual
linear issue list --limit 100
linear issue list --limit 0    # unlimited

# Open in browser/app
linear issue list --web
linear issue list --app

# Disable pager
linear issue list --no-pager
```

**State values:** `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`

### View Issue

```bash
# View issue details (rendered)
linear issue view ENG-123

# JSON output (for parsing)
linear issue view ENG-123 --json

# Open in browser or app
linear issue view ENG-123 --web
linear issue view ENG-123 --app

# Without comments
linear issue view ENG-123 --no-comments

# Keep remote URLs instead of downloading files
linear issue view ENG-123 --no-download

# Disable pager
linear issue view ENG-123 --no-pager
```

### Create Issue

> **IMPORTANT:** Always use `--description-file` for multi-line descriptions. Passing multi-line content via `--description` causes shell escaping issues that result in literal `\n` strings being stored instead of real newlines, breaking rendering in the Linear UI.

```bash
# Minimal creation (interactive mode fills in the rest)
linear issue create --title "Fix login bug"

# Full creation — write description to a temp file first, then pass with --description-file
cat > /tmp/issue-description.md << 'EOF'
Add OAuth 2.0 support for Google and GitHub.

## Acceptance Criteria
- Google login works
- GitHub login works
EOF
linear issue create \
  --title "Implement OAuth login" \
  --description-file /tmp/issue-description.md \
  --assignee self \
  --priority 1 \
  --state "In Progress" \
  --label "Bug" \
  --label "Backend" \
  --team ENG \
  --project "Auth System" \
  --due-date 2026-03-15 \
  --estimate 3 \
  --parent ENG-100

# Single-line descriptions only — safe to use --description inline
linear issue create --title "Fix login bug" --description "Simple one-liner description"

# Create and start working (creates branch)
linear issue create --title "Quick fix" --start

# Non-interactive mode (skip prompts)
linear issue create --title "API task" --no-interactive
```

**Options:**
- `--title, -t` — Issue title (required)
- `--description, -d` — Description text
- `--description-file` — Read description from file (preferred for markdown)
- `--assignee, -a` — Assign to `self` or username/name
- `--priority` — Priority 1-4 (1=urgent, 2=high, 3=medium, 4=low)
- `--state, -s` — Workflow state (by name or type)
- `--label, -l` — Label name (can repeat for multiple labels)
- `--team` — Team key (e.g., `ENG`)
- `--project` — Project name
- `--parent, -p` — Parent issue ID (e.g., `ENG-100`) for sub-issues
- `--due-date` — Due date
- `--estimate` — Story points estimate
- `--start` — Start the issue after creation (creates git branch)
- `--no-use-default-template` — Skip default issue template
- `--no-interactive` — Disable interactive prompts

### Update Issue

```bash
# Update by identifier
linear issue update ENG-123 --title "Updated title"
linear issue update ENG-123 --state "Done"
linear issue update ENG-123 --assignee self
linear issue update ENG-123 --priority 2
linear issue update ENG-123 --label "Bug"
linear issue update ENG-123 --project "New Project"
linear issue update ENG-123 --due-date 2026-04-01
linear issue update ENG-123 --estimate 5
linear issue update ENG-123 --description "New description"
linear issue update ENG-123 --description-file updated.md

# Combine multiple updates
linear issue update ENG-123 \
  --state "In Progress" \
  --assignee self \
  --priority 1
```

All create options are available (except `--start`, `--no-interactive`, `--no-use-default-template`).

### Delete Issue

```bash
# Delete single issue (with confirmation)
linear issue delete ENG-123

# Skip confirmation
linear issue delete ENG-123 --confirm

# Bulk delete
linear issue delete --bulk ENG-123 ENG-124 ENG-125

# Bulk delete from file (one ID per line)
linear issue delete --bulk-file issues-to-delete.txt

# Bulk delete from stdin
echo "ENG-123\nENG-124" | linear issue delete --bulk-stdin
```

### Start Working on Issue

Creates a git branch and assigns the issue to you:

```bash
# Start from issue list (interactive picker)
linear issue start

# Start a specific issue
linear issue start ENG-123

# Create branch from a specific ref
linear issue start ENG-123 --from-ref main

# Custom branch name
linear issue start ENG-123 --branch my-custom-branch

# Show all assignees' issues or unassigned
linear issue start --all-assignees
linear issue start --unassigned
```

### Git Integration Helpers

```bash
# Print issue ID from current git branch
linear issue id

# Print issue title
linear issue title ENG-123

# Print issue URL
linear issue url ENG-123

# Print title + Linear-issue trailer (for commit messages)
linear issue describe ENG-123
linear issue describe ENG-123 --references  # Use "References" instead of "Fixes"

# Show commits for an issue (jj only)
linear issue commits ENG-123
```

### Create Pull Request

Creates a GitHub PR with issue details pre-filled:

```bash
# Create PR for current branch's issue
linear issue pr

# Create PR for specific issue
linear issue pr ENG-123

# Options
linear issue pr --base main
linear issue pr --head feature-branch
linear issue pr --draft
linear issue pr --title "Custom PR title"
linear issue pr --web   # Open in browser after creating
```

### Attach File

```bash
linear issue attach ENG-123 ./screenshot.png
linear issue attach ENG-123 ./report.pdf --title "Monthly Report"
linear issue attach ENG-123 ./log.txt --comment "Attached crash log for investigation"
```

---

## Comments

### List Comments

```bash
linear issue comment list ENG-123
```

### Add Comment

```bash
# Inline comment
linear issue comment add ENG-123 --body "Looking into this now"

# Comment from file
linear issue comment add ENG-123 --body-file analysis.md

# Reply to a comment
linear issue comment add ENG-123 --body "Good point" --parent <commentId>

# Comment with attachment
linear issue comment add ENG-123 --body "See attached" --attach ./file.png
```

### Update Comment

```bash
linear issue comment update <commentId> --body "Updated text"
linear issue comment update <commentId> --body-file updated.md
```

---

## Relations (Dependencies)

### List Relations

```bash
linear issue relation list ENG-123
```

### Add Relation

```bash
# Mark ENG-123 as blocked by ENG-100
linear issue relation add ENG-123 blocked-by ENG-100

# Mark ENG-123 as blocking ENG-456
linear issue relation add ENG-123 blocks ENG-456

# Mark issues as related
linear issue relation add ENG-123 related ENG-456

# Mark as duplicate
linear issue relation add ENG-123 duplicate ENG-100
```

**Relation types:** `blocked-by`, `blocks`, `related`, `duplicate`

### Delete Relation

```bash
linear issue relation delete ENG-123 blocks ENG-456
```

---

## Teams

### List Teams

```bash
linear team list
linear team list --web
linear team list --app
```

### Create Team

```bash
linear team create --name "Engineering" --key ENG
linear team create --name "Design" --key DES --description "Design team" --private
linear team create --name "Backend" --no-interactive
```

### Delete Team

```bash
linear team delete ENG
```

### List Team Members

```bash
linear team members
linear team members ENG
linear team members ENG --all   # Include inactive members
```

### Get Team ID

```bash
linear team id
```

### Configure GitHub Autolinks

```bash
linear team autolinks
```

---

## Projects

Projects are cross-team efforts that group related issues together.

### List Projects

```bash
linear project list
linear project list --team ENG
linear project list --all-teams
linear project list --status started
linear project list --web
linear project list --app
```

### View Project

```bash
linear project view <projectId>
linear project view <projectId> --web
linear project view <projectId> --app
```

### Create Project

```bash
linear project create \
  --name "Auth System" \
  --description "Implement authentication" \
  --team ENG \
  --lead @me \
  --status planned \
  --start-date 2026-03-01 \
  --target-date 2026-06-01 \
  --initiative "Q1 Goals"

# Interactive mode
linear project create --interactive
```

**Options:**
- `--name, -n` (required) — Project name
- `--description, -d` — Project description
- `--team, -t` (required, repeatable) — Team key(s)
- `--lead, -l` — Project lead (username, email, or `@me`)
- `--status, -s` — `backlog`, `planned`, `started`, `paused`, `completed`, `canceled`
- `--start-date` — Start date (YYYY-MM-DD)
- `--target-date` — Target date (YYYY-MM-DD)
- `--initiative` — Add to initiative (ID, slug, or name)

---

## Project Updates (Status Updates)

### List Updates

```bash
linear project-update list <projectId>
linear project-update list <projectId> --json
linear project-update list <projectId> --limit 5
```

### Create Update

```bash
linear project-update create <projectId> \
  --body "Sprint completed. All auth endpoints deployed." \
  --health onTrack

# From file
linear project-update create <projectId> --body-file update.md --health atRisk

# Interactive
linear project-update create <projectId> --interactive
```

**Health values:** `onTrack`, `atRisk`, `offTrack`

---

## Initiatives

Initiatives are high-level strategic goals that group projects together.

### List Initiatives

```bash
linear initiative list                    # Active only (default)
linear initiative list --all-statuses
linear initiative list --status planned
linear initiative list --status completed
linear initiative list --owner @me
linear initiative list --json
linear initiative list --archived
linear initiative list --web
linear initiative list --app
```

### View Initiative

```bash
linear initiative view <initiativeId>
```

### Create Initiative

```bash
linear initiative create \
  --name "Q1 Platform Reliability" \
  --description "Improve uptime to 99.9%" \
  --status active \
  --owner @me \
  --target-date 2026-03-31 \
  --color "#5E6AD2"

# Interactive
linear initiative create --interactive
```

**Status values:** `planned`, `active`, `completed`

### Update Initiative

```bash
linear initiative update <initiativeId> \
  --name "New Name" \
  --status completed \
  --owner username \
  --target-date 2026-06-30
```

### Archive / Unarchive / Delete

```bash
linear initiative archive <initiativeId>
linear initiative unarchive <initiativeId>
linear initiative delete <initiativeId>
```

### Link Projects to Initiatives

```bash
linear initiative add-project <initiativeId> <projectId>
linear initiative remove-project <initiativeId> <projectId>
```

---

## Initiative Updates (Timeline Posts)

### List Updates

```bash
linear initiative-update list <initiativeId>
linear initiative-update list <initiativeId> --json
linear initiative-update list <initiativeId> --limit 5
```

### Create Update

```bash
linear initiative-update create <initiativeId> \
  --body "All projects on track for Q1 delivery." \
  --health onTrack

linear initiative-update create <initiativeId> --body-file update.md
linear initiative-update create <initiativeId> --interactive
```

---

## Cycles

Cycles are time-boxed iterations (sprints) for teams. The CLI doesn't have direct cycle commands, but you can query cycles via the GraphQL API.

### Get Active Cycle for a Team

```bash
# Get the team ID first
linear team list

# Query the active cycle
linear api '{ team(id: "<team-id>") { activeCycle { id name number startsAt endsAt } } }'
```

### List Issues in Current Cycle

```bash
# First, get the active cycle ID (see above)
# Then query issues for that cycle
linear api '{ cycle(id: "<cycle-id>") { issues { nodes { identifier title state { name } assignee { name } } } } }'
```

**Example:**
```bash
# Get active cycle
linear api '{ team(id: "5e5028d8-dbb3-4f9f-a296-fe73281a985e") { activeCycle { id number startsAt endsAt } } }'

# Get issues in the cycle
linear api '{ cycle(id: "4e68bf14-f694-4433-ae14-cff0e20fa806") { issues { nodes { identifier title state { name } assignee { name } } } } }'
```

---

## Milestones

Milestones are checkpoints within a project.

### List Milestones

```bash
linear milestone list --project <projectId>
```

### View Milestone

```bash
linear milestone view <milestoneId>
```

### Create Milestone

```bash
linear milestone create \
  --project <projectId> \
  --name "Alpha Release" \
  --description "Core features complete" \
  --target-date 2026-04-15
```

### Update Milestone

```bash
linear milestone update <milestoneId> \
  --name "Beta Release" \
  --target-date 2026-05-01 \
  --description "Updated scope" \
  --sort-order 1 \
  --project <newProjectId>   # Move to different project
```

### Delete Milestone

```bash
linear milestone delete <milestoneId>
```

---

## Labels

Labels categorize issues. They can be workspace-level or team-specific.

### List Labels

```bash
linear label list                   # Default (depends on context)
linear label list --team ENG        # Team-specific labels only
linear label list --workspace       # Workspace-level labels only
linear label list --all             # All labels
linear label list --json            # JSON output
```

### Create Label

```bash
# Workspace-level label
linear label create --name "Bug" --color "#EB5757" --description "Software defects"

# Team-specific label
linear label create --name "Backend" --color "#FF8800" --team ENG

# Interactive
linear label create --interactive
```

### Delete Label

```bash
linear label delete "Bug"
linear label delete <labelId>
```

---

## Documents

### List Documents

```bash
linear document list
linear document list --project "Auth System"
linear document list --issue ENG-123
linear document list --json
linear document list --limit 20
```

### View Document

```bash
linear document view <documentId>
linear document view <documentId> --raw       # Raw markdown
linear document view <documentId> --json      # Full JSON
linear document view <documentId> --web       # Open in browser
```

### Create Document

```bash
linear document create \
  --title "API Design Doc" \
  --content "# API Design\n\nThis document..." \
  --project "Auth System" \
  --icon "📄"

# From file
linear document create --title "Spec" --content-file spec.md --issue ENG-123

# Interactive
linear document create --interactive
```

### Update Document

```bash
linear document update <documentId> --title "Updated Title"
linear document update <documentId> --content "New content"
linear document update <documentId> --content-file updated.md
linear document update <documentId> --icon "🚀"

# Edit in $EDITOR
linear document update <documentId> --edit
```

### Delete Document

```bash
linear document delete <documentId>
```

---

## Raw GraphQL API

For anything not covered by the CLI commands:

```bash
# Simple query
linear api '{ viewer { id name email } }'

# With variables
linear api '{ issue(id: $id) { title state { name } } }' \
  --variable id=<issueId>

# Variables from JSON
linear api '{ issues(filter: $filter) { nodes { title } } }' \
  --variables-json '{"filter": {"state": {"name": {"eq": "In Progress"}}}}'

# Auto-paginate
linear api '{ issues { nodes { title identifier } } }' --paginate

# Silent mode (check exit code only)
linear api '{ viewer { id } }' --silent

# Read query from file
linear api @query.graphql --variable id=abc123
```

---

## Common Workflows

### Create and Start Working on an Issue

```bash
# Create and immediately start (creates git branch)
linear issue create --title "Fix auth bug" --priority 1 --start

# Or start an existing issue
linear issue start ENG-123
```

### Triage and Assign Issues

```bash
# View triage issues
linear issue list --state triage --all-assignees

# Assign and move to backlog
linear issue update ENG-123 --assignee self --state "Backlog"
```

### View Issues in Current Cycle

```bash
# 1. Get team ID
TEAM_ID=$(linear team list | grep SIG | awk '{print $NF}')

# 2. Get active cycle ID
CYCLE_ID=$(linear api "{ team(id: \"$TEAM_ID\") { activeCycle { id } } }" | jq -r '.data.team.activeCycle.id')

# 3. Get issues in the cycle
linear api "{ cycle(id: \"$CYCLE_ID\") { issues { nodes { identifier title state { name } assignee { name } } } } }"
```

### Track a Bug from Report to Fix

```bash
# 1. Create the bug
linear issue create \
  --title "Login fails with special characters" \
  --description "Users cannot log in if password contains < or >" \
  --priority 1 \
  --label "Bug"

# 2. Start working on it (creates branch, assigns to you)
linear issue start ENG-123

# 3. Add investigation comment
linear issue comment add ENG-123 --body "Root cause: input not escaped in auth handler"

# 4. Create PR with issue details
linear issue pr ENG-123

# 5. Mark as done
linear issue update ENG-123 --state "Done"
```

### Set Up a New Project

```bash
# 1. Create the project
linear project create \
  --name "User Authentication" \
  --team ENG \
  --lead @me \
  --status planned \
  --start-date 2026-03-01 \
  --target-date 2026-05-01

# 2. Add milestones
linear milestone create --project <projectId> --name "Alpha" --target-date 2026-03-15
linear milestone create --project <projectId> --name "Beta" --target-date 2026-04-15

# 3. Create issues under the project
linear issue create --title "Design login UI" --project "User Authentication" --team ENG
linear issue create --title "Implement JWT auth" --project "User Authentication" --team ENG

# 4. Post a status update
linear project-update create <projectId> --body "Project kicked off" --health onTrack
```

### Strategic Planning with Initiatives

```bash
# 1. Create an initiative
linear initiative create \
  --name "Q2 Platform Growth" \
  --status planned \
  --owner @me \
  --target-date 2026-06-30

# 2. Link projects to the initiative
linear initiative add-project <initiativeId> <projectId1>
linear initiative add-project <initiativeId> <projectId2>

# 3. Post status updates
linear initiative-update create <initiativeId> \
  --body "All projects on track" \
  --health onTrack
```

### Set Up Issue Dependencies

```bash
# ENG-200 blocks ENG-201
linear issue relation add ENG-200 blocks ENG-201

# ENG-202 is blocked by ENG-200
linear issue relation add ENG-202 blocked-by ENG-200

# ENG-203 and ENG-204 are related
linear issue relation add ENG-203 related ENG-204

# View relations
linear issue relation list ENG-200
```

### Manage Labels

```bash
# Create a label set
linear label create --name "Bug" --color "#EB5757"
linear label create --name "Feature" --color "#26B5CE"
linear label create --name "Tech Debt" --color "#F2C94C"

# Use labels on issues
linear issue create --title "Fix crash" --label "Bug" --priority 1
linear issue update ENG-123 --label "Tech Debt"
```

### Create Documentation

```bash
# Create a design doc for a project
linear document create \
  --title "API Design" \
  --content-file api-design.md \
  --project "User Authentication" \
  --icon "📋"

# Attach a doc to an issue
linear document create \
  --title "Investigation Notes" \
  --content "## Findings\n\nThe root cause is..." \
  --issue ENG-123
```

---

## Output & Parsing

### JSON Output

Use `--json` where supported for machine-readable output:

```bash
linear issue view ENG-123 --json
linear label list --json
linear initiative list --json
linear document list --json
linear document view <id> --json
linear project-update list <projectId> --json
```

Parse with `jq`:

```bash
# Get issue title
linear issue view ENG-123 --json | jq -r '.title'

# Get all label names
linear label list --json | jq -r '.[].name'

# Get issue identifier and title
linear issue view ENG-123 --json | jq -r '"\(.identifier): \(.title)"'
```

---

## Environment Variables

- `LINEAR_DEBUG=1` — Show full error details including stack traces
- `LINEAR_ISSUE_SORT` — Default sort order for issue list (`manual` or `priority`)

---

## Tips

1. **Use `.linear.toml`** in your repo to set default team — run `linear config` to generate it
2. **`self` for assignee** — Use `--assignee self` to assign to yourself
3. **Priority is 1-4** — 1=urgent, 2=high, 3=medium, 4=low (descending)
4. **`--start` creates a branch** — `linear issue create --start` or `linear issue start` creates a git branch and assigns you
5. **Labels are by name** — Use `--label "Bug"` not label IDs
6. **States are by name** — Use `--state "In Progress"` or type like `started`
7. **Always use `--description-file`** — Never use `--description` for multi-line content; shell escaping will store literal `\n` strings instead of newlines, breaking rendering. Write to `/tmp/` and use `--description-file`. Only use `--description` for single-line strings.
8. **Commit integration** — Use `linear issue describe` to generate commit message trailers
9. **PR creation** — `linear issue pr` creates GitHub PRs pre-filled with issue details
10. **Multiple workspaces** — Use `-w <slug>` to target a different workspace
11. **Raw API** — Use `linear api` for anything not covered by CLI commands
12. **Bulk delete** — Use `--bulk`, `--bulk-file`, or `--bulk-stdin` for deleting multiple issues
