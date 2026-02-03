# pi-wakatime

[WakaTime](https://wakatime.com) extension for [pi coding agent](https://github.com/badlogic/pi-mono).

Track your AI-assisted coding time alongside your regular coding activity in WakaTime.

> **Note**: This project was generated using AI with manual human curation.

![WakaTime Dashboard](https://wakatime.com/static/img/ScreenShots/Screen-Shot-2016-03-21.png)

## Features

- 📁 **File tracking** — Tracks every file read/written/edited by the AI agent
- ⏱️ **Session tracking** — Heartbeats on session start, each turn, and shutdown
- 🔤 **Language detection** — Auto-detects 100+ programming languages
- 📂 **Project detection** — Auto-detects project from current working directory
- 🌿 **Branch detection** — Auto-detects git branch
- 🤖 **AI line changes** — Tracks lines added/removed by AI
- 🧠 **Model tracking** — Includes LLM model name in the plugin identifier
- 🏷️ **Category** — Uses `"ai coding"` category

## Quick Start

1. Install the extension (see [Installation](#installation))
2. Start pi — wakatime-cli will auto-install if needed
3. Configure your API key when prompted:
   ```
   /wakatime-setup <your-api-key>
   ```
   Get your API key from: https://wakatime.com/settings/api-key
4. Done! Your AI coding time is now being tracked.

## Installation

### Option 1: Git clone (recommended)

Clone directly into your pi extensions directory:

```bash
git clone https://github.com/Istar-Eldritch/pi-wakatime ~/.pi/agent/extensions/wakatime
```

**Update anytime with:**
```bash
cd ~/.pi/agent/extensions/wakatime && git pull
```

### Option 2: Single file download

```bash
mkdir -p ~/.pi/agent/extensions/wakatime
curl -o ~/.pi/agent/extensions/wakatime/index.ts \
  https://raw.githubusercontent.com/Istar-Eldritch/pi-wakatime/main/index.ts
```

### Option 3: Manual loading

Load explicitly when starting pi:

```bash
pi -e /path/to/pi-wakatime/index.ts
```

## Commands

| Command | Description |
|---------|-------------|
| `/wakatime` | Show status (CLI, API key, config, session info) |
| `/wakatime-setup <key>` | Configure your WakaTime API key |
| `/wakatime-install` | Manually install or update wakatime-cli |
| `/wakatime-toggle` | Toggle tracking on/off for current session |

## Configuration

Optional configuration via `~/.pi/agent/settings.json`:

```json
{
  "wakatime": {
    "enabled": true,
    "trackFiles": true,
    "trackSessions": true,
    "category": "ai coding",
    "cliPath": "~/.wakatime/wakatime-cli"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable tracking |
| `trackFiles` | `true` | Track individual file operations |
| `trackSessions` | `true` | Track session activity (turns) |
| `category` | `"ai coding"` | WakaTime category for heartbeats |
| `cliPath` | `~/.wakatime/wakatime-cli` | Path to wakatime-cli |

## Troubleshooting

### "WakaTime CLI not found"

The CLI should auto-install on first run. If it fails, try:
```
/wakatime-install
```

### "WakaTime API key not configured"

Configure your API key:
```
/wakatime-setup <your-api-key>
```
Get your API key from: https://wakatime.com/settings/api-key

### Heartbeats not appearing

Run `/wakatime` to check status and verify CLI and API key are configured correctly.

## License

MIT
