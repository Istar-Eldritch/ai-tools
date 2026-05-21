---
name: jira
description: Project management via Atlassian Jira using acli CLI. Use ONLY when the user explicitly mentions Jira, Atlassian, JQL, or a Jira-specific project key from the ENA/TTENA workspaces. Do NOT use for Linear issues, GitHub issues, or any other tracker — only for Atlassian Jira.
---

# Jira Project Management via ACLI

A command-line interface for Atlassian Jira Cloud using `acli` (Atlassian CLI). Commands support JSON output for easy parsing.

## Core Concepts

- **Work Items**: Issues, bugs, stories, tasks, epics - individual trackable units of work
- **Projects**: Top-level containers identified by a key (e.g., TEAM, PROJ)
- **Sprints**: Time-boxed iterations for agile development
- **Boards**: Visual representations of work (Scrum/Kanban boards)
- **Statuses**: Workflow states (To Do, In Progress, Done, etc.)
- **Labels**: Tags for categorizing work items
- **Filters**: Saved JQL queries for finding work items
- **Links**: Relationships between work items (blocks, is blocked by, relates to, etc.)

## Prerequisites

Authenticate with your Atlassian account:

```bash
acli auth
# or
acli jira auth
```

Follow the prompts to authenticate via browser.

---

## Projects

### List Projects

```bash
# Requires one of: --recent, --limit, or --paginate
acli jira project list --paginate
acli jira project list --paginate --json
acli jira project list --limit 20
acli jira project list --recent
```

### View Project

```bash
acli jira project view PROJ
acli jira project view PROJ --json
```

### Create Project

```bash
acli jira project create --key "NEWPROJ" --name "New Project" --type "software"
```

### Update Project

```bash
acli jira project update --key "PROJ" --name "Updated Name"
```

### Archive/Restore Project

```bash
acli jira project archive PROJ
acli jira project restore PROJ
```

### Delete Project

```bash
acli jira project delete PROJ
```

---

## Work Items (Issues)

### View Work Item

```bash
# View single work item
acli jira workitem view PROJ-123

# JSON output
acli jira workitem view PROJ-123 --json

# Specific fields
acli jira workitem view PROJ-123 --fields "key,summary,status,assignee,description"

# All fields
acli jira workitem view PROJ-123 --fields "*all"

# Open in browser
acli jira workitem view PROJ-123 --web
```

### Search Work Items

Use JQL (Jira Query Language) to search:

```bash
# Basic project search
acli jira workitem search --jql "project = PROJ"

# Filter by status
acli jira workitem search --jql "project = PROJ AND status = 'In Progress'"

# Filter by assignee
acli jira workitem search --jql "project = PROJ AND assignee = currentUser()"
acli jira workitem search --jql "assignee = 'user@example.com'"

# Filter by type
acli jira workitem search --jql "project = PROJ AND issuetype = Bug"
acli jira workitem search --jql "project = PROJ AND issuetype in (Bug, Story)"

# Filter by label
acli jira workitem search --jql "project = PROJ AND labels = 'backend'"

# Filter by sprint
acli jira workitem search --jql "project = PROJ AND sprint in openSprints()"
acli jira workitem search --jql "sprint = 'Sprint 5'"

# Filter by priority
acli jira workitem search --jql "project = PROJ AND priority = High"

# Filter by date
acli jira workitem search --jql "project = PROJ AND created >= -7d"
acli jira workitem search --jql "project = PROJ AND updated >= startOfWeek()"

# Text search
acli jira workitem search --jql "project = PROJ AND text ~ 'login bug'"

# Complex queries
acli jira workitem search --jql "project = PROJ AND status != Done AND assignee = currentUser() ORDER BY priority DESC"

# Output options
acli jira workitem search --jql "project = PROJ" --json
acli jira workitem search --jql "project = PROJ" --csv
acli jira workitem search --jql "project = PROJ" --fields "key,summary,assignee,status"
acli jira workitem search --jql "project = PROJ" --limit 50
acli jira workitem search --jql "project = PROJ" --paginate  # Fetch all results
acli jira workitem search --jql "project = PROJ" --count     # Count only

# Using saved filter
acli jira workitem search --filter 10001
```

### Create Work Item

```bash
# Basic creation
acli jira workitem create --project "PROJ" --type "Task" --summary "Task title"

# With description
acli jira workitem create --project "PROJ" --type "Bug" \
  --summary "Login fails on mobile" \
  --description "Users cannot log in using the mobile app"

# Full creation with all options
acli jira workitem create --project "PROJ" --type "Story" \
  --summary "Implement OAuth login" \
  --description "Add OAuth 2.0 support for Google and GitHub" \
  --assignee "user@example.com" \
  --label "backend,security"

# Self-assign
acli jira workitem create --project "PROJ" --type "Task" \
  --summary "My task" \
  --assignee "@me"

# Use default assignee
acli jira workitem create --project "PROJ" --type "Task" \
  --summary "Team task" \
  --assignee "default"

# Create sub-task (with parent)
acli jira workitem create --project "PROJ" --type "Sub-task" \
  --summary "Write unit tests" \
  --parent "PROJ-123"

# Description from file
acli jira workitem create --project "PROJ" --type "Epic" \
  --summary "Q1 Release" \
  --description-file "epic-description.txt"

# Open editor for description
acli jira workitem create --project "PROJ" --type "Story" \
  --summary "New feature" \
  --editor

# JSON output
acli jira workitem create --project "PROJ" --type "Task" \
  --summary "API task" \
  --json

# From JSON file (for complex fields)
acli jira workitem create --from-json "workitem.json"

# Generate JSON template
acli jira workitem create --generate-json
```

**Work Item Types:**
- `Epic` - Large feature or initiative
- `Story` - User story
- `Task` - General task
- `Bug` - Defect or issue
- `Sub-task` - Child of another work item

### Edit Work Item

```bash
# Edit single work item
acli jira workitem edit --key "PROJ-123" --summary "Updated summary"

# Edit multiple work items
acli jira workitem edit --key "PROJ-123,PROJ-124" --assignee "user@example.com"

# Edit by JQL
acli jira workitem edit --jql "project = PROJ AND status = 'To Do'" \
  --assignee "@me" --yes

# Edit by filter
acli jira workitem edit --filter 10001 --labels "priority-high" --yes

# Change type
acli jira workitem edit --key "PROJ-123" --type "Bug"

# Update description
acli jira workitem edit --key "PROJ-123" \
  --description "Updated description text"

# Update from file
acli jira workitem edit --key "PROJ-123" \
  --description-file "updated-description.txt"

# Modify labels
acli jira workitem edit --key "PROJ-123" --labels "backend,api"
acli jira workitem edit --key "PROJ-123" --remove-labels "deprecated"

# Remove assignee
acli jira workitem edit --key "PROJ-123" --remove-assignee

# Skip confirmation
acli jira workitem edit --key "PROJ-123" --summary "New title" --yes

# Ignore errors on batch edit
acli jira workitem edit --jql "project = PROJ" --assignee "@me" --yes --ignore-errors

# JSON output
acli jira workitem edit --key "PROJ-123" --summary "New title" --json
```

### Transition Work Item (Change Status)

```bash
# Transition single work item
acli jira workitem transition --key "PROJ-123" --status "In Progress"

# Transition multiple
acli jira workitem transition --key "PROJ-123,PROJ-124" --status "Done"

# Transition by JQL
acli jira workitem transition --jql "project = PROJ AND assignee = currentUser() AND status = 'To Do'" \
  --status "In Progress" --yes

# Transition by filter
acli jira workitem transition --filter 10001 --status "Done" --yes

# Skip confirmation
acli jira workitem transition --key "PROJ-123" --status "Done" --yes

# Ignore errors
acli jira workitem transition --jql "project = PROJ" --status "Done" --yes --ignore-errors

# JSON output
acli jira workitem transition --key "PROJ-123" --status "Done" --json
```

**Common Statuses:**
- `To Do` / `Backlog`
- `In Progress`
- `In Review`
- `Done` / `Closed`

### Assign Work Item

```bash
# Assign to user
acli jira workitem assign --key "PROJ-123" --assignee "user@example.com"

# Self-assign
acli jira workitem assign --key "PROJ-123" --assignee "@me"

# Assign multiple
acli jira workitem assign --key "PROJ-123,PROJ-124" --assignee "user@example.com"
```

### Clone Work Item

```bash
acli jira workitem clone --key "PROJ-123"
```

### Archive/Unarchive Work Item

```bash
acli jira workitem archive --key "PROJ-123"
acli jira workitem unarchive --key "PROJ-123"
```

### Delete Work Item

```bash
acli jira workitem delete --key "PROJ-123"
acli jira workitem delete --key "PROJ-123,PROJ-124"
```

---

## Comments

### List Comments

```bash
acli jira workitem comment list --key "PROJ-123"
```

### Add Comment

```bash
# Inline comment
acli jira workitem comment create --key "PROJ-123" --body "This is my comment"

# Comment on multiple work items
acli jira workitem comment create --key "PROJ-123,PROJ-124" --body "Updated in batch"

# Comment by JQL
acli jira workitem comment create --jql "project = PROJ AND status = Done" \
  --body "Closing sprint" --yes

# Comment from file
acli jira workitem comment create --key "PROJ-123" --body-file "comment.txt"

# Open editor
acli jira workitem comment create --key "PROJ-123" --editor

# Edit last comment from same author
acli jira workitem comment create --key "PROJ-123" --body "Updated comment" --edit-last
```

### Update Comment

```bash
acli jira workitem comment update --key "PROJ-123" --comment-id 12345 --body "Updated text"
```

### Delete Comment

```bash
acli jira workitem comment delete --key "PROJ-123" --comment-id 12345
```

### Comment Visibility

```bash
acli jira workitem comment visibility --key "PROJ-123"
```

---

## Work Item Links

### List Links

```bash
acli jira workitem link list --key "PROJ-123"
```

### Get Link Types

```bash
acli jira workitem link type
```

**Common Link Types:**
- `Blocks` / `is blocked by`
- `Clones` / `is cloned by`
- `Duplicates` / `is duplicated by`
- `Relates to`

### Create Link

```bash
# Link two work items
acli jira workitem link create --out "PROJ-123" --in "PROJ-456" --type "Blocks"

# From JSON file
acli jira workitem link create --from-json "links.json"

# From CSV
acli jira workitem link create --from-csv "links.csv"

# Generate JSON template
acli jira workitem link create --generate-json
```

### Delete Link

```bash
acli jira workitem link delete --out "PROJ-123" --in "PROJ-456" --type "Blocks"
```

---

## Attachments

### List Attachments

```bash
acli jira workitem attachment list --key "PROJ-123"
```

### Delete Attachment

```bash
acli jira workitem attachment delete --key "PROJ-123" --attachment-id 12345
```

---

## Watchers

### Add/Remove Watchers

```bash
acli jira workitem watcher add --key "PROJ-123" --user "user@example.com"
acli jira workitem watcher remove --key "PROJ-123" --user "user@example.com"
```

---

## Sprints

### View Sprint

```bash
acli jira sprint view --id 123
acli jira sprint view --id 123 --json
```

### List Sprints (via Board)

```bash
acli jira board list-sprints --id 5
acli jira board list-sprints --id 5 --json
```

### Create Sprint

```bash
# Basic sprint
acli jira sprint create --name "Sprint 1" --board 5

# With dates
acli jira sprint create --name "Sprint 2" --board 5 \
  --start "2026-01-27" \
  --end "2026-02-10"

# With goal
acli jira sprint create --name "Sprint 3" --board 5 \
  --goal "Complete authentication feature"

# Full creation
acli jira sprint create --name "Sprint 4" --board 5 \
  --start "2026-02-10" \
  --end "2026-02-24" \
  --goal "Q1 Release preparation" \
  --json
```

### Update Sprint

```bash
acli jira sprint update --id 123 --name "Sprint 1 (Extended)"
acli jira sprint update --id 123 --end "2026-02-15"
acli jira sprint update --id 123 --goal "Updated sprint goal"
```

### List Work Items in Sprint

```bash
# Requires both --sprint and --board flags
acli jira sprint list-workitems --sprint 123 --board 5
acli jira sprint list-workitems --sprint 123 --board 5 --json
```

### Delete Sprint

```bash
acli jira sprint delete --id 123
acli jira sprint delete --id 123,124,125
```

---

## Boards

### Search Boards

```bash
acli jira board search
acli jira board search --json
acli jira board search --name "Team Board"
```

### Get Board Details

```bash
acli jira board get --id 5
acli jira board get --id 5 --json
```

### List Board Projects

```bash
acli jira board list-projects --id 5
```

### List Board Sprints

```bash
acli jira board list-sprints --id 5
acli jira board list-sprints --id 5 --json
```

### Create Board

```bash
acli jira board create --name "New Board" --type "scrum" --project "PROJ"
```

### Delete Board

```bash
acli jira board delete --id 5
```

---

## Filters

### List Filters

```bash
acli jira filter list
acli jira filter list --my        # My filters
acli jira filter list --favourite # Favourite filters
```

### Search Filters

```bash
acli jira filter search --name "Sprint"
acli jira filter search --owner "user@example.com"
```

### Get Filter

```bash
acli jira filter get --filter-id 10001
```

### Update Filter

```bash
acli jira filter update --filter-id 10001 --name "Updated Filter Name"
acli jira filter update --filter-id 10001 --jql "project = PROJ AND status = Done"
```

### Add to Favourites

```bash
acli jira filter add-favourite --filter-id 10001
```

### Filter Columns

```bash
acli jira filter get-columns --filter-id 10001
acli jira filter reset-columns --filter-id 10001
```

### Change Filter Owner

```bash
acli jira filter change-owner --filter-id 10001 --owner "newowner@example.com"
```

---

## Fields

### Create Custom Field

```bash
acli jira field create --name "Custom Field" --type "text"
```

### Delete Custom Field

```bash
acli jira field delete --field-id customfield_10001
```

### Restore Deleted Field

```bash
acli jira field cancel-delete --field-id customfield_10001
```

---

## Dashboards

```bash
acli jira dashboard --help
```

---

## JQL Quick Reference

JQL (Jira Query Language) is used for searching and filtering work items.

### Basic Operators
- `=` equals
- `!=` not equals
- `>`, `<`, `>=`, `<=` comparisons
- `~` contains (text search)
- `!~` does not contain
- `IN`, `NOT IN` list membership
- `IS EMPTY`, `IS NOT EMPTY` null checks

### Common Fields
- `project` - Project key
- `issuetype` - Type (Bug, Story, Task, Epic)
- `status` - Current status
- `assignee` - Assigned user
- `reporter` - Creator
- `priority` - Priority level
- `labels` - Labels
- `sprint` - Sprint
- `created` - Creation date
- `updated` - Last update date
- `resolution` - Resolution status

### Functions
- `currentUser()` - Logged in user
- `openSprints()` - Active sprints
- `closedSprints()` - Completed sprints
- `futureSprints()` - Upcoming sprints
- `startOfDay()`, `endOfDay()`
- `startOfWeek()`, `endOfWeek()`
- `startOfMonth()`, `endOfMonth()`
- `-1d`, `-7d`, `-30d` - Relative dates

### Example Queries

```bash
# My open issues
"assignee = currentUser() AND status != Done"

# Bugs created this week
"issuetype = Bug AND created >= startOfWeek()"

# High priority unassigned
"priority = High AND assignee IS EMPTY"

# In current sprint
"sprint in openSprints()"

# Recently updated
"updated >= -1d ORDER BY updated DESC"

# Text search in summary/description
"text ~ 'authentication error'"

# Multiple projects
"project IN (PROJ1, PROJ2) AND status = 'In Progress'"

# Epics with incomplete children
"issuetype = Epic AND 'Epic Link' IS NOT EMPTY"
```

---

## Common Workflows

### Create and Track a Bug

```bash
# 1. Create the bug
acli jira workitem create --project "PROJ" --type "Bug" \
  --summary "Login fails with special characters" \
  --description "Users cannot log in if password contains < or >" \
  --label "authentication,high-priority" \
  --json

# 2. Assign to yourself
acli jira workitem assign --key "PROJ-123" --assignee "@me"

# 3. Start working on it
acli jira workitem transition --key "PROJ-123" --status "In Progress"

# 4. Add a comment with findings
acli jira workitem comment create --key "PROJ-123" \
  --body "Root cause: Input not being escaped properly in auth handler"

# 5. Mark as done
acli jira workitem transition --key "PROJ-123" --status "Done"
```

### Sprint Planning

```bash
# 1. Find your board
acli jira board search --json

# 2. Create a new sprint
acli jira sprint create --name "Sprint 5" --board 10 \
  --start "2026-01-27" \
  --end "2026-02-10" \
  --goal "Complete user authentication module"

# 3. Find backlog items to add
acli jira workitem search --jql "project = PROJ AND status = 'To Do' AND sprint IS EMPTY" \
  --fields "key,summary,priority"

# 4. Move items to sprint (use JQL to add to sprint - done via board UI or edit)
# Note: Adding to sprint typically requires the Jira web UI or board operations
```

### Daily Standup Query

```bash
# What I'm working on
acli jira workitem search \
  --jql "assignee = currentUser() AND status = 'In Progress'" \
  --fields "key,summary,status"

# What I completed yesterday
acli jira workitem search \
  --jql "assignee = currentUser() AND status = Done AND updated >= -1d" \
  --fields "key,summary"

# My blocked items
acli jira workitem search \
  --jql "assignee = currentUser() AND status = Blocked" \
  --fields "key,summary,status"
```

### Bulk Update Issues

```bash
# Close all done items in sprint
acli jira workitem transition \
  --jql "project = PROJ AND sprint = 'Sprint 4' AND status = 'In Review'" \
  --status "Done" --yes

# Reassign all issues from one user to another
acli jira workitem edit \
  --jql "assignee = 'old@example.com' AND status != Done" \
  --assignee "new@example.com" --yes

# Add label to all bugs in project
acli jira workitem edit \
  --jql "project = PROJ AND issuetype = Bug" \
  --labels "needs-review" --yes
```

### Link Related Issues

```bash
# Bug blocks a story
acli jira workitem link create --out "PROJ-100" --in "PROJ-101" --type "Blocks"

# Issue duplicates another
acli jira workitem link create --out "PROJ-102" --in "PROJ-50" --type "Duplicates"

# Related issues
acli jira workitem link create --out "PROJ-103" --in "PROJ-104" --type "Relates"
```

### Create Epic with Stories

```bash
# 1. Create the epic
acli jira workitem create --project "PROJ" --type "Epic" \
  --summary "User Authentication System" \
  --description "Complete auth system with OAuth support"

# 2. Create stories under the epic
acli jira workitem create --project "PROJ" --type "Story" \
  --summary "Implement login form" \
  --parent "PROJ-200"

acli jira workitem create --project "PROJ" --type "Story" \
  --summary "Add OAuth providers" \
  --parent "PROJ-200"

acli jira workitem create --project "PROJ" --type "Story" \
  --summary "Password reset flow" \
  --parent "PROJ-200"
```

---

## Output Formats

### JSON Output

Most commands support `--json` for machine-readable output:

```bash
acli jira workitem view PROJ-123 --json
acli jira workitem search --jql "project = PROJ" --json
acli jira sprint view --sprint-id 123 --json
```

### CSV Output

Search supports CSV for spreadsheet export:

```bash
acli jira workitem search --jql "project = PROJ" --csv > issues.csv
```

### Custom Fields

Control which fields are returned:

```bash
acli jira workitem search --jql "project = PROJ" \
  --fields "key,summary,status,assignee,priority"

acli jira workitem view PROJ-123 --fields "*all"
acli jira workitem view PROJ-123 --fields "*navigable,-comment"
```

---

## Tips

1. **Use `--json` for scripting** - Parse with `jq` for automation
2. **Use `@me` for self-assignment** - Shorthand for current user
3. **Learn JQL basics** - Most powerful way to find issues
4. **Use `--yes` for batch operations** - Skip confirmation prompts
5. **Use `--ignore-errors` for bulk edits** - Continue past failures
6. **Check available statuses** - Transitions depend on workflow configuration
7. **Use filters** - Save complex JQL queries as filters for reuse
8. **Project keys are case-sensitive** - PROJ ≠ proj
9. **Dates use ISO format** - YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ
10. **Use `--web` to open in browser** - Quick way to see full details

## Parsing JSON with jq

```bash
# Get all issue keys
acli jira workitem search --jql "project = PROJ" --json | jq -r '.[].key'

# Get summary and status
acli jira workitem search --jql "project = PROJ" --json | \
  jq -r '.[] | "\(.key): \(.fields.summary) [\(.fields.status.name)]"'

# Filter high priority
acli jira workitem search --jql "project = PROJ" --json | \
  jq '.[] | select(.fields.priority.name == "High")'

# Count by status
acli jira workitem search --jql "project = PROJ" --json | \
  jq 'group_by(.fields.status.name) | map({status: .[0].fields.status.name, count: length})'
```

---

## Common Gotchas

**Flag naming inconsistencies** - Be aware of these patterns:

| Command | Correct Flag | Wrong Flag |
|---------|--------------|------------|
| `board get` | `--id` | `--board-id` |
| `board list-sprints` | `--id` | `--board-id` |
| `sprint view` | `--id` | `--sprint-id` |
| `sprint list-workitems` | `--sprint` and `--board` | `--sprint-id` |

**Required flags that aren't obvious:**

- `acli jira project list` requires one of: `--recent`, `--limit`, or `--paginate`
- `acli jira sprint list-workitems` requires BOTH `--sprint` and `--board` flags
- `acli jira workitem search --fields` does NOT support `project` as a field name

**JSON output parsing:**

- Some commands return JSON with `values` array (e.g., `board search`)
- Others return direct arrays or objects
- Always check the structure before writing jq queries

**When in doubt, use `--help`:**

```bash
acli jira <command> --help
acli jira <command> <subcommand> --help
```

---

## Authentication

```bash
# Initial authentication
acli auth

# Jira-specific auth
acli jira auth

# Check auth status
acli auth status
```

---

## Getting Help

```bash
# General help
acli --help

# Jira help
acli jira --help

# Command-specific help
acli jira workitem --help
acli jira workitem create --help
acli jira sprint --help
```
