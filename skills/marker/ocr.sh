#!/usr/bin/env bash
set -euo pipefail

# Marker OCR-only mode
# Usage: ocr.sh <file> [options]

show_help() {
    cat <<EOF
Usage: $(basename "$0") <file> [options]

Run OCR on documents/images (OCR only, no document structure).

Options:
  --output-dir PATH       Output directory (default: same as input file)
  --keep-chars            Keep individual character bounding boxes
  --page-range RANGE      Page range (e.g., "0,5-10,20")
  -h, --help              Show this help

Examples:
  $(basename "$0") scanned.pdf
  $(basename "$0") image.png --keep-chars
  $(basename "$0") document.pdf --page-range "0-5" --output-dir ./ocr

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
KEEP_CHARS=""
PAGE_RANGE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --keep-chars)
            KEEP_CHARS="--keep_chars"
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

# Build command - use OCRConverter
CMD=("$MARKER_BIN" "$INPUT_FILE")
CMD+=("--converter_cls" "marker.converters.ocr.OCRConverter")

[[ -n "$OUTPUT_DIR" ]] && CMD+=("--output_dir" "$OUTPUT_DIR")
[[ -n "$KEEP_CHARS" ]] && CMD+=("$KEEP_CHARS")
[[ -n "$PAGE_RANGE" ]] && CMD+=("--page_range" "$PAGE_RANGE")

# Run OCR
"${CMD[@]}"
