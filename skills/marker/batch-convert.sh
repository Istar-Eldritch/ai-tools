#!/usr/bin/env bash
set -euo pipefail

# Marker Batch Document Converter
# Usage: batch-convert.sh <input-dir> [output-dir] [options]

show_help() {
    cat <<EOF
Usage: $(basename "$0") <input-dir> [output-dir] [options]

Batch convert documents to markdown/JSON/HTML.

Options:
  --output-format FORMAT  Output format: markdown, json, html, chunks (default: markdown)
  --workers N             Number of parallel workers (default: auto)
  --use-llm               Use LLM for higher accuracy
  --force-ocr             Force OCR on all content
  --no-images             Disable image extraction
  -h, --help              Show this help

Examples:
  $(basename "$0") ./pdfs ./output
  $(basename "$0") ./documents --output-format json --workers 4
  $(basename "$0") ./papers ./markdown --use-llm

EOF
    exit 0
}

# Find the marker executable
MARKER_BIN=""
if command -v marker &>/dev/null; then
    MARKER_BIN="marker"
elif [[ -x "$HOME/.local/bin/marker" ]]; then
    MARKER_BIN="$HOME/.local/bin/marker"
else
    echo "Error: marker not found. Install with: pip install marker-pdf" >&2
    exit 1
fi

# Defaults
INPUT_DIR=""
OUTPUT_DIR=""
OUTPUT_FORMAT="markdown"
WORKERS=""
USE_LLM=""
FORCE_OCR=""
NO_IMAGES=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output-format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        --workers)
            WORKERS="$2"
            shift 2
            ;;
        --use-llm)
            USE_LLM="--use_llm"
            shift
            ;;
        --force-ocr)
            FORCE_OCR="--force_ocr"
            shift
            ;;
        --no-images)
            NO_IMAGES="--disable_image_extraction"
            shift
            ;;
        -h|--help)
            show_help
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            if [[ -z "$INPUT_DIR" ]]; then
                INPUT_DIR="$1"
            elif [[ -z "$OUTPUT_DIR" ]]; then
                OUTPUT_DIR="$1"
            else
                echo "Error: Too many positional arguments" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate input
if [[ -z "$INPUT_DIR" ]]; then
    echo "Error: No input directory specified" >&2
    echo "Usage: $(basename "$0") <input-dir> [output-dir] [options]" >&2
    exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
    echo "Error: Directory not found: $INPUT_DIR" >&2
    exit 1
fi

# Build command
CMD=("$MARKER_BIN" "$INPUT_DIR")
[[ -n "$OUTPUT_DIR" ]] && CMD+=("--output_dir" "$OUTPUT_DIR")
CMD+=("--output_format" "$OUTPUT_FORMAT")
[[ -n "$WORKERS" ]] && CMD+=("--workers" "$WORKERS")
[[ -n "$USE_LLM" ]] && CMD+=("$USE_LLM")
[[ -n "$FORCE_OCR" ]] && CMD+=("$FORCE_OCR")
[[ -n "$NO_IMAGES" ]] && CMD+=("$NO_IMAGES")

# Run conversion
"${CMD[@]}"
