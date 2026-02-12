# Screenshot Skill

Capture screenshots of the screen, windows, or regions using native screenshot utilities.

## Quick Start

1. Install the required tool for your display server:
   ```bash
   # Flameshot - works on both Wayland and X11 (recommended)
   sudo apt install flameshot
   
   # Alternative: For Wayland only
   sudo apt install grim slurp
   
   # Alternative: For X11 only
   sudo apt install scrot
   ```

2. Take a screenshot:
   ```bash
   ~/.pi/agent/skills/screenshot/screenshot.sh
   ```

## Features

- ✅ Full screen capture
- ✅ Region selection (interactive)
- ✅ Window capture
- ✅ Delayed capture (for menus, tooltips)
- ✅ Auto-detection of display server (Wayland/X11)
- ✅ Multiple tool support with automatic fallback
- ✅ PNG output format

## Usage Examples

```bash
# Full screen
./screenshot.sh screenshot.png

# Select a region interactively
./screenshot.sh --region selection.png

# Capture after 3 second delay
./screenshot.sh --delay 3 delayed.png

# Capture specific window
./screenshot.sh --window active_window.png

# Auto-generated filename
./screenshot.sh
```

## Tools Support

| Tool | Display Server | Features |
|------|----------------|----------|
| flameshot | Both | Full screen, region, GUI editor |
| grim | Wayland | Full screen, region (with slurp) |
| scrot | X11 | Full screen, region, window |
| maim | X11 | Full screen, region, window |
| import | X11 | Full screen, region |

## Integration with Pi Agent

When the user asks to:
- "Take a screenshot"
- "Capture the screen"
- "Save what's on my screen"
- "Screenshot this window"
- "Show me a screenshot of..."

The agent will automatically use this skill to capture the requested screenshot.

## File Structure

```
screenshot/
├── SKILL.md          # Skill metadata and documentation (Pi format)
├── README.md         # This file
└── screenshot.sh     # Main screenshot capture script
```

## Troubleshooting

### "No screenshot tool found"
Install grim (Wayland) or scrot (X11):
```bash
sudo apt install grim slurp  # Wayland
sudo apt install scrot       # X11
```

### Region selection not working
Install slurp for Wayland:
```bash
sudo apt install slurp
```

### Permission issues
Some Wayland compositors may require specific permissions. Check your compositor's documentation.

## License

Part of the Pi agent skills collection.
