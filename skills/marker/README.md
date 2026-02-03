# Marker - Document to Markdown Converter

Convert PDF, images, PPTX, DOCX, XLSX, HTML, and EPUB files to markdown, JSON, HTML, or chunks.

**Repository:** https://github.com/datalab-to/marker

## Features

- High-accuracy document conversion
- Supports 90+ languages via OCR
- Extracts tables, equations, code blocks, images
- Optional LLM enhancement for best quality
- Works on GPU, CPU, or MPS

## Scripts

### convert.sh - Single File Conversion

```bash
# Basic conversion to markdown
~/.pi/agent/skills/marker/convert.sh document.pdf

# Convert to JSON
~/.pi/agent/skills/marker/convert.sh document.pdf --json

# Use LLM for higher accuracy
~/.pi/agent/skills/marker/convert.sh document.pdf --use-llm

# Convert specific pages
~/.pi/agent/skills/marker/convert.sh document.pdf --page-range "0-5,10"

# Force OCR (good for scanned docs or inline math)
~/.pi/agent/skills/marker/convert.sh scanned.pdf --force-ocr

# Specify output directory
~/.pi/agent/skills/marker/convert.sh document.pdf --output-dir ./output
```

### batch-convert.sh - Batch Conversion

```bash
# Convert all documents in a folder
~/.pi/agent/skills/marker/batch-convert.sh ./pdfs ./output

# With parallel workers
~/.pi/agent/skills/marker/batch-convert.sh ./documents --workers 4

# Batch convert to JSON
~/.pi/agent/skills/marker/batch-convert.sh ./papers ./json --output-format json
```

### extract-tables.sh - Table Extraction

```bash
# Extract tables from PDF (outputs JSON with bounding boxes)
~/.pi/agent/skills/marker/extract-tables.sh document.pdf

# Extract with LLM for better accuracy
~/.pi/agent/skills/marker/extract-tables.sh spreadsheet.png --use-llm
```

### ocr.sh - OCR Only Mode

```bash
# Run OCR without document structure
~/.pi/agent/skills/marker/ocr.sh scanned.pdf

# Keep character-level bounding boxes
~/.pi/agent/skills/marker/ocr.sh image.png --keep-chars
```

## Options Reference

| Option | Description |
|--------|-------------|
| `--output-dir PATH` | Directory for output files |
| `--output-format FORMAT` | markdown, json, html, or chunks |
| `--page-range RANGE` | e.g., "0,5-10,20" |
| `--use-llm` | Use LLM for higher accuracy (requires API key) |
| `--force-ocr` | Force OCR on all content |
| `--no-images` | Disable image extraction |
| `--debug` | Enable debug logging |
| `--json` | Shorthand for --output-format json |

## Output Formats

### Markdown
- Image links (images saved alongside)
- Formatted tables
- LaTeX equations (fenced with `$$`)
- Code blocks with triple backticks
- Footnote superscripts

### JSON
- Full document structure
- Block hierarchy with types
- Bounding box information
- Metadata

### HTML
- `<img>` tags for images
- `<math>` tags for equations
- `<pre>` tags for code

### Chunks
- Document split into semantic chunks
- Good for RAG/embedding pipelines

## LLM Enhancement

For highest accuracy, use `--use-llm`. This helps with:
- Table merging across pages
- Inline math formatting
- Form value extraction
- Better table structure

Requires setting up an LLM service (Gemini, Ollama, etc.):

```bash
# For Gemini (default)
export GOOGLE_API_KEY="your-key"

# For Ollama
# Set llm_service to marker.services.ollama.OllamaService
```

## Python Usage

```python
from marker.converters.pdf import PdfConverter
from marker.models import create_model_dict
from marker.output import text_from_rendered

converter = PdfConverter(
    artifact_dict=create_model_dict(),
)
rendered = converter("document.pdf")
text, _, images = text_from_rendered(rendered)
```

## Installation

```bash
# Basic installation (PDF only)
pip install marker-pdf

# Full installation (all document types)
pip install marker-pdf[full]
```

## Hardware Requirements

- ~5GB VRAM per worker at peak
- ~3.5GB VRAM average
- CPU mode available but slower
