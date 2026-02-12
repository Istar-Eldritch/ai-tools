#!/bin/bash
# Screenshot capture tool with support for Wayland (grim) and X11 (scrot/maim)

set -euo pipefail

# Default values
OUTPUT_FILE=""
DELAY=0
REGION=false
WINDOW=false

# Help message
show_help() {
    cat << EOF
Usage: screenshot.sh [OPTIONS] [output.png]

Capture screenshots using native screenshot utilities.

OPTIONS:
    --region        Select a region interactively (requires slurp on Wayland)
    --window        Capture a specific window (interactive selection)
    --delay N       Wait N seconds before capturing
    --help          Show this help message

EXAMPLES:
    screenshot.sh                           # Full screen with auto-generated filename
    screenshot.sh output.png                # Full screen to specific file
    screenshot.sh --region selection.png    # Select region to capture
    screenshot.sh --delay 5 menu.png        # Capture after 5 second delay
    screenshot.sh --window window.png       # Capture specific window

REQUIREMENTS:
    Wayland: grim (and slurp for region selection)
    X11:     scrot or maim

EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            ;;
        --region)
            REGION=true
            shift
            ;;
        --window)
            WINDOW=true
            shift
            ;;
        --delay)
            DELAY="$2"
            shift 2
            ;;
        *)
            OUTPUT_FILE="$1"
            shift
            ;;
    esac
done

# Generate default filename if not provided
if [[ -z "$OUTPUT_FILE" ]]; then
    OUTPUT_FILE="screenshot_$(date +%Y%m%d_%H%M%S).png"
fi

# Make output path absolute
if [[ ! "$OUTPUT_FILE" =~ ^/ ]]; then
    OUTPUT_FILE="$(pwd)/$OUTPUT_FILE"
fi

# Create output directory if needed
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Detect display server and available tools
detect_screenshot_tool() {
    # Flameshot works well on both Wayland and X11
    if command -v flameshot &>/dev/null; then
        echo "flameshot"
        return
    fi
    
    # Check for GNOME-specific tools
    if [[ "${XDG_CURRENT_DESKTOP:-}" == *"GNOME"* ]]; then
        if command -v gnome-screenshot &>/dev/null; then
            echo "gnome-screenshot"
            return
        fi
    fi
    
    if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]] || [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
        if command -v grim &>/dev/null; then
            echo "grim"
            return
        fi
    fi
    
    if command -v scrot &>/dev/null; then
        echo "scrot"
        return
    fi
    
    if command -v maim &>/dev/null; then
        echo "maim"
        return
    fi
    
    if command -v import &>/dev/null; then
        echo "import"
        return
    fi
    
    echo "none"
}

TOOL=$(detect_screenshot_tool)

if [[ "$TOOL" == "none" ]]; then
    echo "Error: No screenshot tool found" >&2
    echo "Please install one of the following:" >&2
    echo "  - Wayland: grim (and slurp for region selection)" >&2
    echo "  - X11:     scrot, maim, or imagemagick" >&2
    exit 1
fi

# Apply delay if specified
if [[ $DELAY -gt 0 ]]; then
    echo "Waiting ${DELAY} seconds before capture..." >&2
    sleep "$DELAY"
fi

# Capture screenshot based on tool and mode
case "$TOOL" in
    flameshot)
        OPTS=(full -p "$OUTPUT_FILE")
        if $REGION; then
            OPTS=(gui -p "$OUTPUT_FILE")
            echo "Select region with mouse..." >&2
        elif $WINDOW; then
            echo "Warning: flameshot doesn't support window-only capture, using region selection" >&2
            OPTS=(gui -p "$OUTPUT_FILE")
        fi
        # Run flameshot and suppress Qt warnings
        flameshot "${OPTS[@]}" 2>&1 | grep -v "QThreadStorage" | grep -v "^$" >&2 || true
        ;;
        
    grim)
        if $REGION; then
            if ! command -v slurp &>/dev/null; then
                echo "Error: slurp is required for region selection on Wayland" >&2
                echo "Install it with: sudo apt install slurp" >&2
                exit 1
            fi
            echo "Select region with mouse..." >&2
            grim -g "$(slurp)" "$OUTPUT_FILE"
        elif $WINDOW; then
            if ! command -v slurp &>/dev/null; then
                echo "Error: slurp is required for window selection on Wayland" >&2
                echo "Install it with: sudo apt install slurp" >&2
                exit 1
            fi
            echo "Click on window to capture..." >&2
            # Get window geometry from slurp and use it
            grim -g "$(slurp)" "$OUTPUT_FILE"
        else
            grim "$OUTPUT_FILE"
        fi
        ;;
        
    scrot)
        OPTS=()
        if $REGION; then
            OPTS+=(-s)
            echo "Click and drag to select region..." >&2
        elif $WINDOW; then
            OPTS+=(-u)
            echo "Click on window to capture..." >&2
        fi
        scrot "${OPTS[@]}" "$OUTPUT_FILE"
        ;;
        
    maim)
        OPTS=()
        if $REGION; then
            OPTS+=(-s)
            echo "Click and drag to select region..." >&2
        elif $WINDOW; then
            OPTS+=(-i "$(xdotool selectwindow)")
            echo "Click on window to capture..." >&2
        fi
        maim "${OPTS[@]}" "$OUTPUT_FILE"
        ;;
        
    import)
        OPTS=()
        if $REGION || $WINDOW; then
            echo "Click and drag to select area..." >&2
        else
            OPTS+=(-window root)
        fi
        import "${OPTS[@]}" "$OUTPUT_FILE"
        ;;
esac

# Verify the screenshot was created
if [[ -f "$OUTPUT_FILE" ]]; then
    # Get file size for confirmation
    SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo "Screenshot saved: $OUTPUT_FILE ($SIZE)" >&2
    echo "$OUTPUT_FILE"
else
    echo "Error: Screenshot failed to save" >&2
    exit 1
fi
