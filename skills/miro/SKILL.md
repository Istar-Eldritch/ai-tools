---
name: miro
description: Visual collaboration via Miro REST API CLI. Use for creating and managing boards, adding board items (sticky notes, shapes, text, cards, frames), connecting items with connectors, organizing with tags, and building visual artifacts like user story maps, diagrams, and flowcharts. Invoke when user mentions Miro, boards, sticky notes, shapes, connectors, visual collaboration, diagrams, story maps, whiteboarding, or Miro board management.
---

# Miro Visual Collaboration CLI

A command-line interface wrapping the Miro REST API (v2). All commands output JSON for easy parsing.

## Core Concepts

- **Boards**: The canvas where all visual content lives
- **Items**: Visual elements on a board — sticky notes, shapes, text, cards, frames, images
- **Connectors**: Lines/arrows connecting two items on a board
- **Tags**: Labels that can be attached to items for categorization
- **Frames**: Container items that group other items visually

## Prerequisites

The CLI must be configured with a Miro access token. Run setup if not already done:

```bash
miro-cli setup
```

To get an access token:
1. Go to Miro Settings > Your apps
2. Create a new app, select your team
3. Set permissions (boards:read, boards:write)
4. Install the app to get a non-expiring access token

Configuration is stored in `~/.config/miro-cli/config.toml`.

Environment variables are also supported:
- `MIRO_ACCESS_TOKEN` - Access token
- `MIRO_TEAM_ID` - Default team ID
- `MIRO_API_BASE_URL` - API base URL (default: https://api.miro.com/)

## Global Options

- `--board <ID>` - Set the board ID for all subcommands that need one

If a board ID is needed and not provided globally, use `--board-id` on the subcommand.

---

## Boards

### List Boards

```bash
miro-cli board list
```

### Get Board

```bash
miro-cli board get <BOARD_ID>
```

### Create Board

```bash
miro-cli board create --name "Sprint Planning" \
  --description "Sprint 5 planning board"
```

**Options:**
- `--name` (required): Board name
- `--description`: Board description

### Update Board

```bash
miro-cli board update <BOARD_ID> \
  --name "Updated Name" \
  --description "Updated description"
```

### Delete Board

```bash
miro-cli board delete <BOARD_ID>
```

### Copy Board

```bash
miro-cli board copy <BOARD_ID>
```

---

## Items

Items are the visual elements on a board. The CLI supports creating sticky notes, shapes, text items, cards, and frames.

### List Items

```bash
miro-cli --board <BOARD_ID> item list
# or
miro-cli item list --board-id <BOARD_ID>
```

### Get Item

```bash
miro-cli --board <BOARD_ID> item get <ITEM_ID>
```

### Create Sticky Note

```bash
miro-cli --board <BOARD_ID> item create-sticky-note \
  --content "User can login with SSO" \
  --x 100 --y 200
```

**Options:**
- `--content` (required): Text content of the sticky note
- `--x`: X position on the board
- `--y`: Y position on the board

### Create Shape

```bash
miro-cli --board <BOARD_ID> item create-shape \
  --content "Authentication Service" \
  --shape rectangle \
  --x 300 --y 100 \
  --width 200 --height 100
```

**Options:**
- `--content`: Text inside the shape
- `--shape`: Shape type — `rectangle` (default), `circle`, `triangle`, `wedge_round_rectangle_callout`, `round_rectangle`, `rhombus`, `parallelogram`, `trapezoid`, `pentagon`, `hexagon`, `octagon`, `star`, `flow_chart_*`, etc.
- `--x`, `--y`: Position
- `--width`, `--height`: Dimensions

### Create Text

```bash
miro-cli --board <BOARD_ID> item create-text \
  --content "Sprint Goals" \
  --x 0 --y -200
```

**Options:**
- `--content` (required): Text content
- `--x`, `--y`: Position

### Create Card

```bash
miro-cli --board <BOARD_ID> item create-card \
  --title "PROJ-42: Fix auth bug" \
  --description "Users unable to login after password reset" \
  --x 500 --y 300
```

**Options:**
- `--title` (required): Card title
- `--description`: Card description
- `--x`, `--y`: Position

### Create Frame

```bash
miro-cli --board <BOARD_ID> item create-frame \
  --title "Sprint Backlog" \
  --x 0 --y 0 \
  --width 1000 --height 600
```

**Options:**
- `--title` (required): Frame title
- `--x`, `--y`: Position
- `--width`, `--height`: Dimensions

### Delete Item

```bash
miro-cli --board <BOARD_ID> item delete <ITEM_ID>
```

---

## Connectors

Connectors are lines/arrows that visually link two items on a board.

### List Connectors

```bash
miro-cli --board <BOARD_ID> connector list
```

### Get Connector

```bash
miro-cli --board <BOARD_ID> connector get <CONNECTOR_ID>
```

### Create Connector

```bash
miro-cli --board <BOARD_ID> connector create \
  --start-item <ITEM_ID_1> \
  --end-item <ITEM_ID_2> \
  --shape elbowed
```

**Options:**
- `--start-item` (required): ID of the starting item
- `--end-item` (required): ID of the ending item
- `--shape`: Connector shape — `straight`, `elbowed`, `curved`

### Delete Connector

```bash
miro-cli --board <BOARD_ID> connector delete <CONNECTOR_ID>
```

---

## Tags

Tags are labels that can be attached to board items for categorization and filtering.

### List Tags

```bash
miro-cli --board <BOARD_ID> tag list
```

### Get Tag

```bash
miro-cli --board <BOARD_ID> tag get <TAG_ID>
```

### Create Tag

```bash
miro-cli --board <BOARD_ID> tag create \
  --title "Priority: High" \
  --color red
```

**Options:**
- `--title` (required): Tag title
- `--color`: Fill color — `red`, `light_green`, `cyan`, `yellow`, `magenta`, `green`, `blue`, `gray`, `violet`, `dark_green`, `dark_blue`, `black`

### Update Tag

```bash
miro-cli --board <BOARD_ID> tag update <TAG_ID> \
  --title "Priority: Critical" \
  --color magenta
```

### Delete Tag

```bash
miro-cli --board <BOARD_ID> tag delete <TAG_ID>
```

### Attach Tag to Item

```bash
miro-cli --board <BOARD_ID> tag attach \
  --tag-id <TAG_ID> \
  --item-id <ITEM_ID>
```

### Detach Tag from Item

```bash
miro-cli --board <BOARD_ID> tag detach \
  --tag-id <TAG_ID> \
  --item-id <ITEM_ID>
```

---

## Common Workflows

### Build a User Story Map

A user story map organizes stories along two axes: user activities (horizontal) and priority (vertical).

```bash
BOARD="uXjVJoUqSIg="

# 1. Create activity frames across the top
miro-cli --board $BOARD item create-frame \
  --title "Authentication" --x 0 --y 0 --width 800 --height 1200

miro-cli --board $BOARD item create-frame \
  --title "Dashboard" --x 900 --y 0 --width 800 --height 1200

miro-cli --board $BOARD item create-frame \
  --title "Settings" --x 1800 --y 0 --width 800 --height 1200

# 2. Add user activities as shapes at the top of each frame
miro-cli --board $BOARD item create-shape \
  --content "Login / Register" --shape round_rectangle \
  --x 400 --y 50 --width 300 --height 60

# 3. Add user stories as sticky notes below, ordered by priority
miro-cli --board $BOARD item create-sticky-note \
  --content "User can login with email/password" \
  --x 200 --y 200

miro-cli --board $BOARD item create-sticky-note \
  --content "User can login with SSO" \
  --x 200 --y 350

miro-cli --board $BOARD item create-sticky-note \
  --content "User can reset password" \
  --x 200 --y 500

# 4. Add release boundary lines or tags for prioritization
miro-cli --board $BOARD tag create --title "MVP" --color green
miro-cli --board $BOARD tag create --title "V2" --color blue
```

### Create a Simple Flowchart

```bash
BOARD="<BOARD_ID>"

# 1. Create flow shapes
START=$(miro-cli --board $BOARD item create-shape \
  --content "Start" --shape circle \
  --x 400 --y 0 --width 100 --height 100 | jq -r '.id')

DECISION=$(miro-cli --board $BOARD item create-shape \
  --content "Authenticated?" --shape rhombus \
  --x 400 --y 200 --width 200 --height 150 | jq -r '.id')

LOGIN=$(miro-cli --board $BOARD item create-shape \
  --content "Show Login" --shape rectangle \
  --x 100 --y 450 --width 200 --height 80 | jq -r '.id')

DASHBOARD=$(miro-cli --board $BOARD item create-shape \
  --content "Show Dashboard" --shape rectangle \
  --x 700 --y 450 --width 200 --height 80 | jq -r '.id')

# 2. Connect them
miro-cli --board $BOARD connector create \
  --start-item $START --end-item $DECISION

miro-cli --board $BOARD connector create \
  --start-item $DECISION --end-item $LOGIN --shape elbowed

miro-cli --board $BOARD connector create \
  --start-item $DECISION --end-item $DASHBOARD --shape elbowed
```

### Organize Items with Tags

```bash
BOARD="<BOARD_ID>"

# 1. Create tags for categorization
miro-cli --board $BOARD tag create --title "Must Have" --color red
miro-cli --board $BOARD tag create --title "Nice to Have" --color yellow
miro-cli --board $BOARD tag create --title "Done" --color green

# 2. Attach tags to items
miro-cli --board $BOARD tag attach --tag-id <TAG_ID> --item-id <ITEM_ID>

# 3. View all tags on the board
miro-cli --board $BOARD tag list
```

---

## Output Format

All commands return JSON. Example sticky note response:

```json
{
  "id": "3458764620123456789",
  "type": "sticky_note",
  "data": {
    "content": "User can login with SSO",
    "shape": "square"
  },
  "position": {
    "x": 100.0,
    "y": 200.0,
    "origin": "center"
  },
  "geometry": {
    "width": 199.0,
    "height": 228.0
  },
  "createdAt": "2026-01-18T12:00:00Z",
  "modifiedAt": "2026-01-18T12:00:00Z"
}
```

Use `jq` for parsing JSON output:

```bash
# Get all item IDs on a board
miro-cli --board $BOARD item list | jq '.[].id'

# Get only sticky notes
miro-cli --board $BOARD item list | jq '.[] | select(.type == "sticky_note")'

# Get item content
miro-cli --board $BOARD item list | jq '.[] | {id: .id, type: .type, data: .data}'

# Get board names and IDs
miro-cli board list | jq '.[] | {name: .name, id: .id}'

# Get all tag titles
miro-cli --board $BOARD tag list | jq '.[].title'
```

---

## Tips

1. **Set the board globally** with `--board <ID>` to avoid repeating it on every subcommand
2. **Positions use center origin** — (0,0) is the center of the board
3. **Capture IDs from create responses** using `jq -r '.id'` for chaining commands
4. **Frames group items visually** — place items within a frame's bounds to organize them
5. **Connectors need item IDs** — create items first, then connect them
6. **Tags are board-scoped** — create tags once per board, then attach to multiple items
7. **Shapes support many types** — use `rectangle`, `circle`, `rhombus` for flowcharts; `round_rectangle` for general purpose
8. **Cards have rich data** — use cards when you need both a title and description (like task cards)
9. **Use frames for sections** — group related items in frames for visual organization (e.g., story map columns)
10. **JSON output** — pipe to `jq` for filtering, extracting IDs, or reformatting
