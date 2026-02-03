# AI Tools

A collection of extensions, skills, and utilities for [pi](https://github.com/mariozechner/pi-coding-agent), an AI coding agent.

## Structure

```
ai_tools/
├── extensions/       # Pi extensions (add commands and tools)
├── skills/           # Pi skills (instruction files for specific tasks)
├── plane/            # Plane.so CLI tool (Rust)
└── prompts/          # Reusable prompt templates
```

## Extensions

Extensions add new commands and tools to pi. They are TypeScript modules that integrate with pi's extension API.

### spec-pipeline

Automates the spec → implementation workflow with configurable AI agents:

1. **Discovery** (optional): Sonnet asks clarifying questions to gather requirements
2. **Spec Drafting**: Opus drafts a technical specification
3. **Spec Review**: Tiered review (Sonnet → Opus), user approves or requests changes
4. **Plan Generation**: For each implementation phase, Opus creates detailed plans with tiered review
5. **Implementation**: Opus implements, tiered code review (Sonnet → Opus), Opus addresses feedback
6. **Commits**: Haiku writes commit messages after each phase

The tiered review system runs cheaper models (Sonnet) first, then expensive models (Opus) as a final quality gate, optimizing costs while maintaining quality.

**Commands:**
- `/spec [--quick] <description>` - Start a new spec pipeline (--quick skips discovery)
- `/spec-resume` - Resume the last active pipeline
- `/spec-status` - Show current pipeline status
- `/spec-list` - List all pipelines
- `/spec-cancel` - Cancel the current pipeline

**Configuration:** Create `.pi/spec-pipeline.json` in your project:
```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
  "discovery": {
    "enabled": true,
    "maxRounds": 5,
    "questionsPerRound": 4
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `specsDir` | string | `"docs"` | Directory for spec files |
| `testCommand` | string | auto-detected | Command to run tests |
| `contextFiles` | string[] | `[]` | Extra context files to include |
| `discovery.enabled` | boolean | `true` | Whether discovery runs by default |
| `discovery.maxRounds` | number | `5` | Maximum Q&A rounds |
| `discovery.questionsPerRound` | number | `4` | Target questions per round |
| `models` | object | see below | Model configuration per role |
| `reviewCycles.cheap` | number | `2` | Review cycles for cheap tier |
| `reviewCycles.expensive` | number | `2` | Review cycles for expensive tier |

**Model Configuration:**

All models are configurable via the `models` object. Example:
```json
{
  "models": {
    "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
    "specReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    }
  },
  "reviewCycles": { "cheap": 2, "expensive": 2 }
}
```

| Role | Default Model | Default Thinking | Notes |
|------|---------------|------------------|-------|
| `discoveryAgent` | sonnet | medium | Question generation |
| `specDrafter` | opus | high | Complex synthesis |
| `specReviewer` | tiered | - | cheap: sonnet/medium, expensive: opus/high |
| `planDrafter` | opus | high | Complex planning |
| `planReviewer` | tiered | - | cheap: sonnet/medium, expensive: opus/high |
| `implementer` | opus | high | Code generation |
| `codeReviewer` | tiered | - | cheap: sonnet/medium, expensive: opus/high |
| `addressReview` | opus | high | Fix implementation |
| `commitMessageWriter` | haiku | off | Fixed, not configurable |

Reviewer roles use tiered configuration (`cheap`/`expensive` tiers). Other roles use flat `{ model, thinking }` configuration.

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

## Plane CLI

A Rust CLI tool for interacting with Plane.so project management. See [plane/README.md](plane/README.md) for details.

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
