---
name: plane
description: Project management via Plane.so CLI. Use for creating, updating, and tracking work items (issues/tasks), managing sprints (cycles), organizing features (modules), categorizing with labels, attaching external resource links, managing user information, querying project status, and organizing work. Invoke when user mentions tasks, issues, tickets, sprints, modules, features, releases, labels, tags, categories, links, attachments, references, URLs, documentation links, user profile, project management, or Plane.
---

# Plane.so Project Management CLI

A command-line interface for Plane.so project management. All commands output JSON for easy parsing.

## Core Concepts

- **Work Items**: Individual tasks, issues, or tickets
- **Cycles**: Time-boxed iterations (sprints) for executing work
- **Modules**: Logical groupings of work items (features, releases, epics)
- **Labels**: Tags for categorizing and organizing work items (e.g., bug, enhancement, documentation)
- **Links**: External resource URLs attached to work items (documentation, designs, references)
- **States**: Workflow stages that work items move through
- **Projects**: Top-level containers for organizing all work
- **Users**: Team members and their profile information

## Prerequisites

The CLI must be configured with API credentials. Run setup if not already done:

```bash
plane-cli setup
```

Configuration is stored in `~/.config/plane-cli/config.toml`.

## Global Options

All commands support these global options:

- `--workspace <SLUG>` - Override default workspace
- `--project <SLUG>` - Override default project

If workspace/project are configured as defaults, these flags are optional.

---

## Users

User commands allow you to retrieve information about the currently authenticated user. This is useful for:
- Verifying your authentication and credentials
- Getting your user ID for assigning work items
- Checking your profile information

### Get Current User

Retrieve information about the currently authenticated user:

```bash
plane-cli user me
```

**Example Output:**
```json
{
  "id": "16c61a3a-512a-48ac-b0be-b6b46fe6f430",
  "first_name": "John",
  "last_name": "Doe",
  "email": "john.doe@example.com",
  "avatar": "avatar-123",
  "avatar_url": "https://example.com/avatars/avatar-123.png",
  "display_name": "John Doe"
}
```

**Use Cases:**
```bash
# Get your user ID for assigning work items to yourself
USER_ID=$(plane-cli user me | jq -r '.id')
plane-cli work-item create --name "My task" \
  --state <STATE_ID> \
  --assignees $USER_ID

# Verify authentication is working
plane-cli user me | jq '.email'

# Get your display name
plane-cli user me | jq -r '.display_name'
```

**Note:** The user commands do not require workspace or project slugs as they operate on the authenticated user.

---

## Modules

Modules are collections of work items that can represent features, releases, or any logical grouping of work. They help organize and track related tasks together.

### List Modules

```bash
plane-cli module list
plane-cli module list --project-id <PROJECT_ID>
```

### Get Module

```bash
plane-cli module get --module-id <MODULE_ID>
plane-cli module get --project-id <PROJECT_ID> --module-id <MODULE_ID>
```

### Create Module

```bash
plane-cli module create --name "Feature Release 1.0" \
  --description "Initial release features" \
  --start-date 2026-01-20 \
  --target-date 2026-02-28 \
  --status planned \
  --lead <USER_ID>
```

**Options:**
- `--name` (required): Module name
- `--description`: Module description
- `--start-date`: Start date (YYYY-MM-DD)
- `--target-date`: Target completion date (YYYY-MM-DD)
- `--status`: Module status - `backlog`, `planned`, `in-progress`, `paused`, `completed`, `cancelled`
- `--lead`: User ID of the module lead
- `--members`: User ID(s) to add as members

### Update Module

```bash
plane-cli module update --module-id <MODULE_ID> \
  --status in-progress \
  --target-date 2026-03-15
```

All create options are available for update (all optional).

### Delete Module

```bash
plane-cli module delete --module-id <MODULE_ID>
```

### Archive Module

Archive a module to hide it from active lists without deleting:

```bash
plane-cli module archive --module-id <MODULE_ID>
```

### Unarchive Module

Restore an archived module:

```bash
plane-cli module unarchive --module-id <MODULE_ID>
```

### List Archived Modules

```bash
plane-cli module list-archived
plane-cli module list-archived --project-id <PROJECT_ID>
```

### Manage Module Work Items

```bash
# List work items in a module
plane-cli module items --module-id <MODULE_ID> list

# Add work items to a module
plane-cli module items --module-id <MODULE_ID> add <ITEM_ID_1> <ITEM_ID_2>

# Remove work item from a module
plane-cli module items --module-id <MODULE_ID> remove --item-id <ITEM_ID>
```

---

## Work Items (Issues/Tasks)

### List Work Items

```bash
plane-cli work-item list
plane-cli work-item list --project-id <PROJECT_ID>
```

### Create Work Item

```bash
plane-cli work-item create --name "Task title" \
  --description-html "<p>Description in HTML</p>" \
  --priority high \
  --state <STATE_ID> \
  --assignees <USER_ID> \
  --start-date 2026-01-20 \
  --target-date 2026-01-25
```

**Options:**
- `--name` (required): Work item title
- `--description-html`: HTML-formatted description
- `--state`: State ID (get from `state list`)
- `--priority`: `none`, `low`, `medium`, `high`, `urgent`
- `--assignees`: User ID(s) to assign
- `--labels`: Label ID(s) to apply
- `--parent`: Parent work item ID (for sub-tasks)
- `--estimate-point`: Story points (0-7)
- `--issue-type`: Work item type ID
- `--module`: Module ID
- `--start-date`: Start date (YYYY-MM-DD)
- `--target-date`: Due date (YYYY-MM-DD)

### Get Work Item

```bash
# By UUID
plane-cli work-item get --work-item-id <UUID>

# By human-readable identifier (e.g., PROJ-123)
plane-cli work-item get-by-identifier --identifier PROJ-123
```

### Update Work Item

```bash
plane-cli work-item update --work-item-id <UUID> \
  --state <NEW_STATE_ID> \
  --priority medium \
  --name "Updated title"
```

All create options are available for update (except `--name` becomes optional).

### Search Work Items

```bash
plane-cli work-item search --search "search query"
plane-cli work-item search --search "bug" --project <PROJECT_ID>
```

### Delete Work Item

```bash
plane-cli work-item delete --work-item-id <UUID>
```

---

## Cycles (Sprints)

### List Cycles

```bash
plane-cli cycle list
plane-cli cycle list --project-id <PROJECT_ID>
```

### Create Cycle

```bash
plane-cli cycle create --name "Sprint 1" \
  --description "First sprint" \
  --start-date 2026-01-20 \
  --end-date 2026-02-03
```

### Get Cycle

```bash
plane-cli cycle get --cycle-id <CYCLE_ID>
```

### Update Cycle

```bash
plane-cli cycle update --cycle-id <CYCLE_ID> \
  --name "Sprint 1 (Extended)" \
  --end-date 2026-02-10
```

### Delete Cycle

```bash
plane-cli cycle delete --cycle-id <CYCLE_ID>
```

### Manage Cycle Work Items

```bash
# List work items in a cycle
plane-cli cycle items --cycle-id <CYCLE_ID> list

# Add work items to a cycle
plane-cli cycle items --cycle-id <CYCLE_ID> add <ITEM_ID_1> <ITEM_ID_2>

# Remove work item from a cycle
plane-cli cycle items --cycle-id <CYCLE_ID> remove --item-id <ITEM_ID>
```

---

## Labels

Labels are tags that help categorize and organize work items in your project. They can represent types (bug, feature), priorities, teams, or any custom categorization you need.

### List Labels

```bash
plane-cli label list
plane-cli label list --project-id <PROJECT_ID>
```

### Get Label

```bash
plane-cli label get <LABEL_ID>
plane-cli label get <LABEL_ID> --project-id <PROJECT_ID>
```

### Create Label

```bash
# Basic label
plane-cli label create "Bug"

# With color and description
plane-cli label create "High Priority" \
  --description "Items that need immediate attention" \
  --color "#FF0000"

# With project specified
plane-cli label create "Documentation" \
  --project-id <PROJECT_ID> \
  --color "#00FF00" \
  --description "Documentation tasks"

# Nested label (child of another label)
plane-cli label create "Critical Bug" \
  --parent <BUG_LABEL_ID> \
  --color "#CC0000"
```

**Options:**
- `<NAME>` (required): Label name
- `--description`: Label description
- `--color`: Hex color code (e.g., #FF0000 for red)
- `--parent`: Parent label ID for creating hierarchical labels
- `--project-id`: Project ID (or use global `--project`)

### Update Label

```bash
plane-cli label update <LABEL_ID> \
  --name "Urgent Bug" \
  --description "Updated description" \
  --color "#990000"
```

All options from create are available (all optional).

### Delete Label

```bash
plane-cli label delete <LABEL_ID>
plane-cli label delete <LABEL_ID> --project-id <PROJECT_ID>
```

**Note:** Deleting a label removes it from all work items it's applied to.

### Using Labels with Work Items

When creating or updating work items, use the `--labels` option:

```bash
# Create work item with labels
plane-cli work-item create --name "Fix login bug" \
  --labels <BUG_LABEL_ID> <HIGH_PRIORITY_LABEL_ID> \
  --state <STATE_ID>

# Update work item to add/change labels
plane-cli work-item update --work-item-id <ITEM_ID> \
  --labels <NEW_LABEL_ID_1> <NEW_LABEL_ID_2>
```

---

## Links

Links allow you to attach external resource URLs to work items, such as documentation, design files, related tickets, or any other relevant resources. Each link can have a URL and an optional descriptive title.

### List Links

List all links attached to a work item:

```bash
plane-cli link list --work-item-id <WORK_ITEM_ID>
plane-cli link list --work-item-id <WORK_ITEM_ID> --project-id <PROJECT_ID>
```

**Example Output:**
```json
[
  {
    "id": "662dd6b2-2b01-4315-955f-480eb51baa14",
    "url": "https://plane.so",
    "title": "Plane Website",
    "created_at": "2023-11-20T06:23:10.270664Z",
    "updated_at": "2023-11-20T06:23:10.270689Z"
  }
]
```

### Get Link

Retrieve details of a specific link:

```bash
plane-cli link get <LINK_ID> --work-item-id <WORK_ITEM_ID>
plane-cli link get <LINK_ID> --work-item-id <WORK_ITEM_ID> --project-id <PROJECT_ID>
```

### Create Link

Attach a new link to a work item:

```bash
# Basic link (URL only)
plane-cli link create --url "https://docs.example.com/feature-spec" \
  --work-item-id <WORK_ITEM_ID>

# Link with descriptive title
plane-cli link create --url "https://www.figma.com/design/abc123" \
  --title "Design Mockup" \
  --work-item-id <WORK_ITEM_ID>

# With explicit project
plane-cli link create --url "https://github.com/org/repo/issues/42" \
  --title "Related GitHub Issue" \
  --work-item-id <WORK_ITEM_ID> \
  --project-id <PROJECT_ID>
```

**Options:**
- `--url` (required): URL of the external resource
- `--work-item-id` (required): The work item to attach the link to
- `--title`: Optional descriptive title for the link
- `--project-id`: Project ID (or use global `--project`)

### Update Link

Update an existing link's URL or title:

```bash
# Update title only
plane-cli link update <LINK_ID> \
  --work-item-id <WORK_ITEM_ID> \
  --title "Updated Design Mockup"

# Update URL only
plane-cli link update <LINK_ID> \
  --work-item-id <WORK_ITEM_ID> \
  --url "https://docs.example.com/updated-spec"

# Update both
plane-cli link update <LINK_ID> \
  --work-item-id <WORK_ITEM_ID> \
  --url "https://new-url.com" \
  --title "New Title"
```

All options from create are available (all optional).

### Delete Link

Remove a link from a work item:

```bash
plane-cli link delete <LINK_ID> --work-item-id <WORK_ITEM_ID>
plane-cli link delete <LINK_ID> --work-item-id <WORK_ITEM_ID> --project-id <PROJECT_ID>
```

### Common Link Use Cases

```bash
# Attach design files to a UI task
plane-cli link create \
  --url "https://www.figma.com/file/XYZ/Dashboard" \
  --title "Dashboard Design" \
  --work-item-id <TASK_ID>

# Link to documentation
plane-cli link create \
  --url "https://docs.internal.com/api/auth" \
  --title "API Authentication Spec" \
  --work-item-id <TASK_ID>

# Reference related external tickets
plane-cli link create \
  --url "https://github.com/org/repo/issues/123" \
  --title "Related GitHub Issue #123" \
  --work-item-id <TASK_ID>

# Add multiple links to a work item
WORK_ITEM_ID="abc123"
plane-cli link create --url "https://docs.example.com" --title "Docs" --work-item-id $WORK_ITEM_ID
plane-cli link create --url "https://design.example.com" --title "Design" --work-item-id $WORK_ITEM_ID

# List all links for a work item to see what's attached
plane-cli link list --work-item-id <WORK_ITEM_ID>

# Update a broken link
plane-cli link update <LINK_ID> \
  --work-item-id <WORK_ITEM_ID> \
  --url "https://new-location.com/document"
```

**Note:** Links are attached to specific work items. You must always provide the `--work-item-id` when managing links.

---

## States (Workflow States)

States define the workflow stages for work items (e.g., Backlog, In Progress, Done).

### List States

```bash
plane-cli state list
plane-cli state list --project-id <PROJECT_ID>
```

### Create State

```bash
plane-cli state create "In Review" "#FFA500"
plane-cli state create --project-id <PROJECT_ID> "QA" "#00FF00"
```

Arguments:
1. State name
2. Color (hex format)

### Delete State

```bash
plane-cli state delete <STATE_ID>
```

---

## Projects

### List Projects

```bash
plane-cli project list
```

### Get Project

```bash
plane-cli project get <PROJECT_ID>
```

### Create Project

```bash
plane-cli project create --name "My Project" --identifier "MYPROJ" \
  --description "Project description"
```

- `--identifier`: Short code used in issue IDs (e.g., MYPROJ-123)

### Update Project

```bash
plane-cli project update <PROJECT_ID> --name "New Name" --description "Updated desc"
```

### Delete Project

```bash
plane-cli project delete <PROJECT_ID>
```

---

## Common Workflows

### Create a Task Assigned to Yourself

```bash
# 1. Get your user ID
USER_ID=$(plane-cli user me | jq -r '.id')

# 2. List states to find the appropriate state ID
plane-cli state list

# 3. Create the work item assigned to yourself
plane-cli work-item create --name "Implement feature X" \
  --priority high \
  --state <STATE_ID> \
  --assignees $USER_ID
```

### Create a New Task and Add to Current Sprint

```bash
# 1. List states to find the appropriate state ID
plane-cli state list

# 2. List cycles to find current sprint ID
plane-cli cycle list

# 3. Create the work item
plane-cli work-item create --name "Implement feature X" \
  --priority high \
  --state <BACKLOG_STATE_ID>

# 4. Add to sprint (use the ID from create response)
plane-cli cycle items --cycle-id <SPRINT_ID> add <WORK_ITEM_ID>
```

### Create and Organize with Labels

```bash
# 1. Create common labels for your project
plane-cli label create "Bug" --color "#FF0000" --description "Software defects"
plane-cli label create "Feature" --color "#00FF00" --description "New functionality"
plane-cli label create "Documentation" --color "#0000FF"

# 2. List labels to get their IDs
plane-cli label list

# 3. Create work item with labels
plane-cli work-item create --name "Fix authentication issue" \
  --state <STATE_ID> \
  --priority high \
  --labels <BUG_LABEL_ID>

# 4. Create hierarchical labels for better organization
plane-cli label create "Backend" --color "#FF8800"
plane-cli label create "API Bug" \
  --parent <BACKEND_LABEL_ID> \
  --color "#FF6600"

# 5. Update existing work item with labels
plane-cli work-item update --work-item-id <ITEM_ID> \
  --labels <BUG_LABEL_ID> <BACKEND_LABEL_ID>
```

### Create a Module and Add Tasks

```bash
# 1. Create a module for a feature
plane-cli module create --name "User Authentication" \
  --description "All auth-related features" \
  --status planned \
  --start-date 2026-01-20 \
  --target-date 2026-02-15

# 2. Create work items for the feature
plane-cli work-item create --name "Design login UI" --state <STATE_ID>
plane-cli work-item create --name "Implement JWT auth" --state <STATE_ID>

# 3. Add work items to the module
plane-cli module items --module-id <MODULE_ID> add <ITEM_ID_1> <ITEM_ID_2>

# 4. Track module progress
plane-cli module get --module-id <MODULE_ID>
plane-cli module items --module-id <MODULE_ID> list
```

### Organize Work with Modules, Cycles, and Labels

```bash
# Modules = What (features/releases)
# Cycles = When (sprints/timeboxes)
# Labels = How/Type (categorization)

# 1. Set up labels for your project
plane-cli label create "Bug" --color "#FF0000"
plane-cli label create "Feature" --color "#00FF00"
plane-cli label create "Frontend" --color "#0088FF"
plane-cli label create "Backend" --color "#FF8800"

# 2. Create a module for a feature
plane-cli module create --name "Dashboard v2" --status planned

# 3. Create work items with labels
plane-cli work-item create --name "Design dashboard layout" \
  --state <STATE_ID> \
  --labels <FEATURE_LABEL_ID> <FRONTEND_LABEL_ID>

plane-cli work-item create --name "Build dashboard API" \
  --state <STATE_ID> \
  --labels <FEATURE_LABEL_ID> <BACKEND_LABEL_ID>

plane-cli work-item create --name "Fix chart rendering bug" \
  --state <STATE_ID> \
  --labels <BUG_LABEL_ID> <FRONTEND_LABEL_ID>

# 4. Add work items to the module
plane-cli module items --module-id <MODULE_ID> add <ITEM_IDS...>

# 5. Create a sprint
plane-cli cycle create --name "Sprint 5" \
  --start-date 2026-01-20 \
  --end-date 2026-02-03

# 6. Add some of those items to the current sprint
plane-cli cycle items --cycle-id <CYCLE_ID> add <ITEM_IDS...>

# A work item can have multiple labels AND be in both a module and a cycle
# Labels help you filter/report across modules and cycles (e.g., all bugs, all frontend work)
```

### Create a Task with Documentation Links

```bash
# 1. Create the work item
plane-cli work-item create --name "Implement OAuth login" \
  --state <STATE_ID> \
  --priority high

# 2. Attach relevant documentation and design links
WORK_ITEM_ID="<from-previous-response>"
plane-cli link create \
  --url "https://docs.oauth.com/v2/authorization" \
  --title "OAuth 2.0 Specification" \
  --work-item-id $WORK_ITEM_ID

plane-cli link create \
  --url "https://www.figma.com/file/XYZ/login-flow" \
  --title "Login Flow Design" \
  --work-item-id $WORK_ITEM_ID

# 3. List all links to verify
plane-cli link list --work-item-id $WORK_ITEM_ID
```

### Move Task to Done

```bash
# 1. Get states to find "Done" state ID
plane-cli state list

# 2. Update the work item
plane-cli work-item update --work-item-id <UUID> --state <DONE_STATE_ID>
```

### Find and Update a Task by Identifier

```bash
# 1. Get the task
plane-cli work-item get-by-identifier --identifier PROJ-42

# 2. Update using the UUID from the response
plane-cli work-item update --work-item-id <UUID> --priority urgent
```

---

## Output Format

All commands return JSON. Example work item response:

```json
{
  "id": "uuid-here",
  "name": "Task title",
  "description": "Description text",
  "state": "state-uuid",
  "project": "project-uuid",
  "parent": null,
  "created_at": "2026-01-18T12:00:00Z",
  "updated_at": "2026-01-18T12:00:00Z"
}
```

Use `jq` for parsing JSON output:

```bash
# Get just the IDs of all work items
plane-cli work-item list | jq '.[].id'

# Get work items with high priority (if returned in response)
plane-cli work-item list | jq '.[] | select(.priority == "high")'

# Get all labels and their IDs
plane-cli label list | jq '.[] | {name: .name, id: .id, color: .color}'

# Filter labels by name pattern
plane-cli label list | jq '.[] | select(.name | contains("Bug"))'

# Get label names and IDs for quick reference
plane-cli label list | jq -r '.[] | "\(.name): \(.id)"'

# Get all link URLs from a work item
plane-cli link list --work-item-id <ID> | jq '.[].url'

# Get links with titles in readable format
plane-cli link list --work-item-id <ID> | jq -r '.[] | "\(.title // "Untitled"): \(.url)"'

# Find links to specific domains
plane-cli link list --work-item-id <ID> | jq '.[] | select(.url | contains("github.com"))'
```

---

## Tips

1. **Get your user ID first** - Run `plane-cli user me` to get your ID for assigning tasks to yourself
2. **Always list states first** when creating/updating work items - you need state IDs
3. **List labels early** - create a standard set of labels for your project and reuse their IDs
4. **Use identifiers** (PROJ-123) for human-friendly references, UUIDs for API calls
5. **Descriptions use HTML** - wrap text in `<p>` tags or use simple HTML formatting
6. **Dates use YYYY-MM-DD format** for start_date and target_date
7. **Modules vs Cycles**: Use modules for *what* you're building (features/releases) and cycles for *when* you're building it (sprints). A work item can belong to both.
8. **Label hierarchy**: Use parent labels to create nested categories (e.g., "Bug" → "Critical Bug", "Backend" → "API Bug")
9. **Color coding**: Use colors to visually distinguish label types (red for bugs, green for features, blue for documentation)
10. **Archive instead of delete**: Use `archive` for modules you want to hide but may need later
11. **Multiple labels**: Work items can have multiple labels - use them to tag by type, priority, team, etc.
12. **Links for context**: Attach documentation, design files, and related resources as links to provide context for work items
13. **Descriptive link titles**: Use the `--title` option to make links easily identifiable without clicking
14. **Work item required for links**: Links are always attached to work items - you can't create standalone links
15. **Verify authentication**: If commands fail, run `plane-cli user me` to verify your API key is working
