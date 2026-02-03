#!/usr/bin/env bash
set -euo pipefail

# Marker PDF/Document to Markdown Converter
# Usage: convert.sh <file> [options]

show_help() {
    cat <<EOF
Usage: $(basename "$0") <file> [options]

Convert PDF, images, PPTX, DOCX, XLSX, HTML, EPUB to markdown/JSON/HTML.

Options:
  --output-dir PATH       Output directory (default: same as input file)
  --output-format FORMAT  Output format: markdown, json, html, chunks (default: markdown)
  --page-range RANGE      Page range (e.g., "0,5-10,20")
  --use-llm               Use LLM for higher accuracy (requires API key)
  --force-ocr             Force OCR on all content
  --no-images             Disable image extraction
  --debug                 Enable debug mode
  --json                  Shorthand for --output-format json
  -h, --help              Show this help

Examples:
  $(basename "$0") document.pdf
  $(basename "$0") document.pdf --output-format json
  $(basename "$0") document.pdf --page-range "0-5" --use-llm
  $(basename "$0") presentation.pptx --output-dir ./output
  $(basename "$0") image.png --force-ocr

Supported formats:
  PDF, PNG, JPG, JPEG, GIF, WEBP, PPTX, DOCX, XLSX, HTML, EPUB

Note: For non-PDF formats, install with: pip install marker-pdf[full]
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
OUTPUT_FORMAT="markdown"
PAGE_RANGE=""
USE_LLM=""
FORCE_OCR=""
NO_IMAGES=""
DEBUG=""

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
        --page-range)
            PAGE_RANGE="$2"
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
        --debug)
            DEBUG="--debug"
            shift
            ;;
        --json)
            OUTPUT_FORMAT="json"
            shift
            ;;
        -h|--help)
            show_help
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Use --help for usage information" >&2
            exit 1
            ;;
        *)
            if [[ -z "$INPUT_FILE" ]]; then
                INPUT_FILE="$1"
            else
                echo "Error: Multiple input files not supported. Use 'marker' for batch conversion." >&2
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

# Build command
CMD=("$MARKER_BIN" "$INPUT_FILE")
CMD+=("--output_format" "$OUTPUT_FORMAT")

[[ -n "$OUTPUT_DIR" ]] && CMD+=("--output_dir" "$OUTPUT_DIR")
[[ -n "$PAGE_RANGE" ]] && CMD+=("--page_range" "$PAGE_RANGE")
[[ -n "$USE_LLM" ]] && CMD+=("$USE_LLM")
[[ -n "$FORCE_OCR" ]] && CMD+=("$FORCE_OCR")
[[ -n "$NO_IMAGES" ]] && CMD+=("$NO_IMAGES")
[[ -n "$DEBUG" ]] && CMD+=("$DEBUG")

# Run conversion
"${CMD[@]}"
