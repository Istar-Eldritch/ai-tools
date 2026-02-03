#!/bin/bash

# Presentation Designer Quick Start
# A helper script to make using the designer even easier

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESIGNER="$SCRIPT_DIR/designer.js"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${MAGENTA}╔════════════════════════════════════════╗${NC}"
echo -e "${MAGENTA}║   Presentation Designer Quick Start   ║${NC}"
echo -e "${MAGENTA}╔════════════════════════════════════════╗${NC}"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 16+ to use this tool"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    cd "$SCRIPT_DIR" && npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to install dependencies${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
fi

# Show menu
echo -e "${CYAN}What would you like to do?${NC}"
echo ""
echo "  1) Smart designer (recommended) - with AI suggestions"
echo "  2) Simple designer - straightforward Q&A"
echo "  3) Quick conference talk (20 min)"
echo "  4) Quick workshop (2 hours)"
echo "  5) Quick pitch (10 min)"
echo "  6) Edit existing design"
echo "  7) View examples"
echo "  8) Show help"
echo "  9) Exit"
echo ""
read -p "Enter your choice (1-9): " choice

case $choice in
    1)
        echo -e "${GREEN}Starting smart designer with AI suggestions...${NC}"
        node "$SCRIPT_DIR/designer-v2.js"
        ;;
    2)
        echo -e "${GREEN}Starting simple designer...${NC}"
        node "$DESIGNER"
        ;;
    3)
        echo -e "${GREEN}Creating conference talk design...${NC}"
        read -p "Title: " title
        read -p "Output filename [conference-talk.yaml]: " output
        output=${output:-conference-talk.yaml}
        node "$SCRIPT_DIR/designer-v2.js" --type conference --duration 20 --title "$title" --output "$output"
        ;;
    4)
        echo -e "${GREEN}Creating workshop design...${NC}"
        read -p "Title: " title
        read -p "Output filename [workshop.yaml]: " output
        output=${output:-workshop.yaml}
        node "$SCRIPT_DIR/designer-v2.js" --type workshop --duration 120 --title "$title" --output "$output"
        ;;
    5)
        echo -e "${GREEN}Creating pitch design...${NC}"
        read -p "Title: " title
        read -p "Output filename [pitch.yaml]: " output
        output=${output:-pitch.yaml}
        node "$SCRIPT_DIR/designer-v2.js" --type pitch --duration 10 --title "$title" --output "$output"
        ;;
    6)
        echo -e "${CYAN}Edit existing design${NC}"
        read -p "Input file: " input
        if [ -f "$input" ]; then
            node "$SCRIPT_DIR/designer-v2.js" --input "$input"
        else
            echo -e "${RED}File not found: $input${NC}"
            exit 1
        fi
        ;;
    7)
        echo -e "${CYAN}Available examples:${NC}"
        echo ""
        for file in "$SCRIPT_DIR/examples"/*.yaml; do
            if [ -f "$file" ]; then
                filename=$(basename "$file")
                title=$(grep "title:" "$file" | head -1 | sed 's/.*title: "\(.*\)"/\1/')
                duration=$(grep "duration:" "$file" | head -1 | sed 's/.*duration: \(.*\)/\1/')
                echo -e "  ${GREEN}$filename${NC}"
                echo -e "    Title: $title"
                echo -e "    Duration: ${duration} minutes"
                echo ""
            fi
        done
        echo -e "${YELLOW}View these files in: $SCRIPT_DIR/examples/${NC}"
        ;;
    8)
        node "$SCRIPT_DIR/designer-v2.js" --help
        ;;
    9)
        echo -e "${BLUE}Goodbye!${NC}"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

# If a design was created, show next steps
if [ $? -eq 0 ] && [ $choice -ne 7 ] && [ $choice -ne 8 ]; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          Design Complete! 🎉           ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo ""
    echo "  1. Review and refine your design file"
    echo "  2. Use with an AI agent to generate slides:"
    echo ""
    echo -e "     ${YELLOW}pi \"Create a Typst presentation using the design in $output\"${NC}"
    echo ""
fi
