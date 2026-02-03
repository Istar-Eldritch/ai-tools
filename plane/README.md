# Plane CLI

A command-line interface for [Plane.so](https://plane.so) project management system.

## ⚠️ Disclaimer

**This project was generated with AI assistance.** It's rough around the edges but in a working state. Some improvements will be added in the future, but it's useful as-is, especially for AI agents to interact with Plane.so programmatically.

## What is this?

`plane-cli` is a Rust-based CLI that lets you interact with Plane.so's API from the command line. All commands output JSON, making it ideal for:

- **AI agents** managing project tasks autonomously
- **Scripting and automation** workflows
- **Quick project management** without opening a browser

## Features

- **Work Items**: Create, update, list, search, and delete tasks/issues
- **Cycles**: Manage sprints and time-boxed iterations
- **Modules**: Organize work into features, releases, or logical groupings
- **Labels**: Categorize work items with tags
- **Links**: Attach external resources (docs, designs, etc.) to work items
- **States**: Manage workflow stages
- **Projects**: Create and manage projects
- **Users**: Get user information for assignments

## Installation

### Build from source

```bash
cd plane-cli
cargo build --release

# Binary will be at ./target/release/plane-cli
# Optionally copy to your PATH:
sudo cp ./target/release/plane-cli /usr/local/bin/
```

## Setup

Run the setup command to configure your API credentials:

```bash
plane-cli setup
```

This will prompt you for:
- Your Plane.so API key
- Default workspace slug
- Default project slug

Configuration is stored in `~/.config/plane-cli/config.toml`.

## Quick Start

```bash
# Verify your authentication
plane-cli user me

# List all states (you'll need state IDs for creating work items)
plane-cli state list

# List all work items
plane-cli work-item list

# Create a work item
plane-cli work-item create --name "My first task" \
  --state <STATE_ID> \
  --priority high

# Get a specific work item by human-readable ID
plane-cli work-item get-by-identifier --identifier PROJ-123

# Update a work item
plane-cli work-item update --work-item-id <UUID> --priority urgent

# Search work items
plane-cli work-item search --search "bug"
```

## Usage for AI Agents

This CLI was specifically designed to be used by AI coding agents. The JSON output makes it easy to parse and integrate into automated workflows.

### Skills File

A "skill" file is included at `skills/SKILL.md` that provides AI agents with comprehensive documentation on how to use this CLI. This file can be loaded by AI agents that support skill-based instructions.

**To use with [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent):**

1. Copy `skills/SKILL.md` to your Pi skills directory:
   ```bash
   mkdir -p ~/.pi/agent/skills/plane
   cp skills/SKILL.md ~/.pi/agent/skills/plane/SKILL.md
   ```

2. The skill will automatically be available when you mention tasks, issues, sprints, modules, labels, or project management in your prompts.

**What's in the skill file?**

The skill file contains:
- Complete command reference with examples
- All available options for each command
- Common workflows (create task, add to sprint, organize with labels, etc.)
- Tips for effective usage
- JSON parsing examples with `jq`

### Example Agent Workflow

An AI agent can use this CLI to:

```bash
# 1. Get the user's ID for self-assignment
USER_ID=$(plane-cli user me | jq -r '.id')

# 2. Find the "In Progress" state
STATE_ID=$(plane-cli state list | jq -r '.[] | select(.name == "In Progress") | .id')

# 3. Create a task assigned to the user
plane-cli work-item create --name "Implement feature X" \
  --state $STATE_ID \
  --assignees $USER_ID \
  --priority high

# 4. Attach relevant documentation
plane-cli link create --url "https://docs.example.com/spec" \
  --title "Feature Spec" \
  --work-item-id <ITEM_ID>
```

## Command Reference

| Command | Description |
|---------|-------------|
| `plane-cli setup` | Configure API credentials |
| `plane-cli user me` | Get current user info |
| `plane-cli project list` | List all projects |
| `plane-cli project get <ID>` | Get project details |
| `plane-cli project create` | Create a new project |
| `plane-cli state list` | List workflow states |
| `plane-cli state create` | Create a new state |
| `plane-cli work-item list` | List all work items |
| `plane-cli work-item get` | Get a work item by UUID |
| `plane-cli work-item get-by-identifier` | Get by human ID (PROJ-123) |
| `plane-cli work-item create` | Create a new work item |
| `plane-cli work-item update` | Update a work item |
| `plane-cli work-item search` | Search work items |
| `plane-cli work-item delete` | Delete a work item |
| `plane-cli cycle list` | List sprints |
| `plane-cli cycle create` | Create a sprint |
| `plane-cli cycle items` | Manage sprint work items |
| `plane-cli module list` | List modules |
| `plane-cli module create` | Create a module |
| `plane-cli module items` | Manage module work items |
| `plane-cli label list` | List labels |
| `plane-cli label create` | Create a label |
| `plane-cli link list` | List links on a work item |
| `plane-cli link create` | Attach a link |

For detailed usage of each command, see `skills/SKILL.md` or run:

```bash
plane-cli --help
plane-cli <command> --help
```

## Global Options

All commands support:

- `--workspace <SLUG>` - Override default workspace
- `--project <SLUG>` - Override default project

## Output Format

All commands return JSON. Use `jq` for parsing:

```bash
# Get all work item IDs
plane-cli work-item list | jq '.[].id'

# Get work items with high priority
plane-cli work-item list | jq '.[] | select(.priority == "high")'

# Get label names and IDs
plane-cli label list | jq -r '.[] | "\(.name): \(.id)"'
```

## Development

```bash
# Run tests
cargo test

# Format code
cargo fmt

# Check for issues
cargo clippy -- -D warnings
```

## Known Limitations

- Error messages could be more user-friendly
- Some edge cases may not be handled gracefully

## Future Improvements

- [ ] Better error handling and messages
- [ ] Shell completion scripts
- [ ] Interactive mode
- [ ] Caching for faster repeated queries
- [ ] More filtering options for list commands

## License

MIT

## Contributing

Contributions are welcome! Please see `AGENTS.md` for guidelines on how AI agents should contribute to this project.
