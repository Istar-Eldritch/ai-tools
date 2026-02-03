#!/usr/bin/env bash
set -euo pipefail

# Marker Table Extractor
# Usage: extract-tables.sh <file> [options]

show_help() {
    cat <<EOF
Usage: $(basename "$0") <file> [options]

Extract tables from documents (PDF, images, etc.)

Options:
  --output-dir PATH       Output directory (default: same as input file)
  --output-format FORMAT  Output format: markdown, json (default: json for bboxes)
  --use-llm               Use LLM for higher accuracy
  --page-range RANGE      Page range (e.g., "0,5-10,20")
  -h, --help              Show this help

Examples:
  $(basename "$0") document.pdf
  $(basename "$0") spreadsheet.png --use-llm
  $(basename "$0") report.pdf --output-format json --output-dir ./tables

EOF
    exit 0
}

# Find the marker_single executable
MARKER_BIN=""
if command -v marker_single &>/dev/null; then
    MARKER_BIN="marker_single"
elif [[ -x "$HOME/.local/bin/marker_single" ]]; then
    MARKER_BIN="$HOME/.local/bin/marker_single"
else
    echo "Error: marker_single not found. Install with: pip install marker-pdf" >&2
    exit 1
fi

# Defaults
INPUT_FILE=""
OUTPUT_DIR=""
OUTPUT_FORMAT="json"
USE_LLM=""
PAGE_RANGE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --output-format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        --use-llm)
            USE_LLM="--use_llm"
            shift
            ;;
        --page-range)
            PAGE_RANGE="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            if [[ -z "$INPUT_FILE" ]]; then
                INPUT_FILE="$1"
            else
                echo "Error: Multiple input files not supported" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate input
if [[ -z "$INPUT_FILE" ]]; then
    echo "Error: No input file specified" >&2
    echo "Usage: $(basename "$0") <file> [options]" >&2
    exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
    echo "Error: File not found: $INPUT_FILE" >&2
    exit 1
fi

# Build command - use TableConverter
CMD=("$MARKER_BIN" "$INPUT_FILE")
CMD+=("--converter_cls" "marker.converters.table.TableConverter")
CMD+=("--output_format" "$OUTPUT_FORMAT")

[[ -n "$OUTPUT_DIR" ]] && CMD+=("--output_dir" "$OUTPUT_DIR")
[[ -n "$USE_LLM" ]] && CMD+=("$USE_LLM")
[[ -n "$PAGE_RANGE" ]] && CMD+=("--page_range" "$PAGE_RANGE")

# Run extraction
"${CMD[@]}"
