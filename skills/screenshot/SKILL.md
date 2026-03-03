---
name: screenshot
description: Capture screenshots of the screen, windows, or regions. Use when the user needs to take a screenshot, capture the display, save screen content, or document visual information. Supports full screen, window selection, and region selection.
---

# Screenshot Tool

Capture screenshots of your display using native screenshot utilities.

## Setup

### Recommended (works on both Wayland and X11)
```bash
# Install flameshot - works great on both display servers
sudo apt install flameshot         # Debian/Ubuntu
sudo dnf install flameshot         # Fedora
sudo pacman -S flameshot           # Arch
```

### Alternative tools

**Wayland-specific:**
```bash
# Install grim (and optionally slurp for region selection)
sudo apt install grim slurp        # Debian/Ubuntu
```

**X11-specific:**
```bash
# Install scrot or maim
sudo apt install scrot             # Debian/Ubuntu (scrot)
sudo apt install maim              # Debian/Ubuntu (maim)
```

## Usage

```bash
# Capture full screen
skills/screenshot/screenshot.sh

# Capture to specific file
skills/screenshot/screenshot.sh output.png

# Capture specific region (interactive selection)
skills/screenshot/screenshot.sh --region output.png

# Capture with delay (useful for capturing menus)
skills/screenshot/screenshot.sh --delay 3 output.png
```

## Options

| Option | Description |
|--------|-------------|
| `--region` | Select a region interactively (requires `slurp` on Wayland) |
| `--delay N` | Wait N seconds before capturing |
| `--window` | Capture a specific window (interactive selection) |
| `--help` | Show help message |

## Examples

### Full screen capture
```bash
skills/screenshot/screenshot.sh screenshot.png
```

### Capture after delay (for menus, tooltips)
```bash
skills/screenshot/screenshot.sh --delay 5 menu.png
```

### Select region to capture
```bash
skills/screenshot/screenshot.sh --region selection.png
```

### Capture specific window
```bash
skills/screenshot/screenshot.sh --window window.png
```

## Output

Screenshots are saved as PNG files. The script will:
- Print the path to the saved screenshot
- Indicate if the capture was successful
- Show any errors if the capture fails

Default filename format: `screenshot_YYYYMMDD_HHMMSS.png`

## Supported Display Servers

- **Both (recommended)**: Uses `flameshot` (works on Wayland and X11, feature-rich)
- **Wayland**: Uses `grim` (fast, modern)
- **X11**: Uses `scrot` or `maim` (reliable fallbacks)

## Troubleshooting

**"No screenshot tool found"**: Install `grim` (Wayland) or `scrot`/`maim` (X11)

**"Cannot select region"**: Install `slurp` for Wayland region selection

**Permission denied**: Some Wayland compositors may require specific permissions

**Black screen**: On X11, some applications block screenshots for security. Try `--delay` option.
