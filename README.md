# AI Tools

A collection of extensions, skills, and utilities for [pi](https://github.com/mariozechner/pi-coding-agent), an AI coding agent.

## Structure

```
ai_tools/
├── extensions/       # Pi extensions (add commands and tools)
├── skills/           # Pi skills (instruction files for specific tasks)
├── claude-sandbox/   # Claude Code bwrap sandbox CLI (Rust)
├── sandboxes/        # Sandbox profile definitions (TOML)
└── prompts/          # Reusable prompt templates
```

## Extensions

Extensions add new commands and tools to pi. They are TypeScript modules that integrate with pi's extension API.

### spec-pipeline

A comprehensive workflow automation extension that takes projects from idea to implementation with AI-assisted specification, planning, and coding.

**Key Features:**
- **Fully Conversational** - Discovery and drafting are natural conversations with AI
- **Code Review Loop** - Implementation uses a single configurable reviewer model (default GPT-5.4) for code review
- **Conversational Scoping** - `/plan` command assesses scope and recommends roadmap/epic/feature level
- **Hierarchical Planning** - Break down large initiatives: roadmaps → epics → features
- **Git Integration** - Automatic branching, commits, checkpoints, and error recovery
- **Dirty Tree Support** - Write specs while implementation runs (documentation pipelines only)
- **Fully Configurable** - Customize models, thinking levels, review cycles, and context files

**Quick Start:**
```bash
# Create a spec (conversational discovery → drafting)
/spec "Add user authentication system"
# AI explores codebase, proposes assumptions
# You guide naturally until /spec-draft-done

# Implement the spec
/implement specs/2602101200_auth_system_spec.md

# For large initiatives, use hierarchical planning
/plan "Redesign the billing system"
# AI assesses scope, recommends roadmap/epic/feature
```

**Main Commands:**
- `/spec [--quick] <description>` - Create a spec (conversational discovery → drafting)
- `/spec-resume` - Resume spec pipeline
- `/implement [--no-plan] <spec-path>` - Implement a spec
- `/plan <description>` - Conversational scoping (recommends roadmap/epic/feature)
- `/roadmap <description>` - Create a roadmap (→ epics)
- `/epic <description>` - Create an epic (→ features)
- `/plan-overview [id]` - Show full hierarchy tree

**Configuration:** Create `.pi/spec-pipeline.json`:
```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
  "models": {
    "implementer": { "model": "gpt-5.5", "thinking": "high" },
    "codeReviewer": { "model": "gpt-5.4", "thinking": "medium" }
  },
  "reviewCycles": 3
}
```

**📖 [Full Documentation](extensions/spec-pipeline/README.md)** - Detailed guide, configuration options, examples, and troubleshooting.

### pi-wakatime

WakaTime integration for tracking coding time in pi sessions.

## Skills

Skills are instruction files that teach pi how to perform specific tasks. They are loaded on-demand based on the task description.

| Skill | Description |
|-------|-------------|
| **agent-browser** | Browser automation for web testing, screenshots, and data extraction |
| **catacloud** | Manage Catacloud platform via API (machines, jobs, pools) |
| **gh-cli** | GitHub CLI for repos, issues, PRs, releases, and workflows |
| **kagi-search** | Web search using Kagi Search API |
| **pass-secrets** | Securely inject secrets from pass password store into commands |
| **plane** | Project management via Plane.so CLI |

## Claude Sandbox

A bubblewrap (`bwrap`) filesystem sandbox for running Claude Code on Linux. Restricts host filesystem access to only the paths a project needs, blocks credential directories, and clears the environment to a known-safe whitelist. See [claude-sandbox/README.md](claude-sandbox/README.md) for full documentation.

```bash
claude-sandbox setup        # one-time machine setup
claude-sandbox init         # initialize project config
claude-sandbox run          # launch Claude inside the sandbox
```

## Installation

Skills and extensions are typically symlinked or referenced from pi's configuration:

```bash
# Skills are referenced in pi's system prompt or loaded via skill detection
# Extensions are loaded via pi's extension configuration
```

## Development

### Adding a new skill

1. Create a directory under `skills/`
2. Add a `SKILL.md` file with frontmatter:
   ```yaml
   ---
   name: my-skill
   description: When to use this skill
   allowed-tools: Bash(my-skill:*)  # Optional: restrict tool access
   ---
   ```
3. Add instructions and any supporting scripts

### Adding a new extension

1. Create a directory under `extensions/`
2. Add an `index.ts` that exports a default function receiving `ExtensionAPI`
3. Register commands and/or tools using the API

## License

MIT
