#!/usr/bin/env bash
# parse.sh - Content parsing for spec-pipeline
# Usage: bash parse.sh <command> [args...]
#
# Commands:
#   extract-phases <spec-file>          Extract implementation phases from a spec
#   parse-verdict <text-or-file>        Parse review verdict (APPROVED or NEEDS_CHANGES)
#   extract-child-items <doc-path>      Extract child items from roadmap/epic document

set -euo pipefail

# Check for jq
if ! command -v jq &>/dev/null; then
  echo '{"error": "jq is required but not installed. Install with: sudo apt install jq (Debian/Ubuntu), brew install jq (macOS)"}' >&2
  exit 2
fi

# Sanitize a focus string for use in filenames
sanitize_focus() {
  local focus="$1"
  echo "$focus" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]/ /g' | tr -s ' ' | {
    local stop_words="a an the and or for of in on to with is are be its this that from by at"
    local words=()
    local count=0
    read -r line
    for word in $line; do
      local is_stop=false
      for sw in $stop_words; do
        if [ "$word" = "$sw" ]; then
          is_stop=true
          break
        fi
      done
      if [ "$is_stop" = false ] && [ -n "$word" ]; then
        words+=("$word")
        count=$((count + 1))
        if [ "$count" -ge 4 ]; then
          break
        fi
      fi
    done
    local IFS="_"
    echo "${words[*]}"
  }
}

cmd_extract_phases() {
  local spec_file="${1:?Usage: parse.sh extract-phases <spec-file>}"

  if [ ! -f "$spec_file" ]; then
    echo "[]"
    return
  fi

  local content
  content=$(cat "$spec_file")

  local phases="[]"
  local found=false

  # Pattern 1: Table with links - | Phase N | ... | [name](path) |
  if [ "$found" = false ]; then
    local matches
    matches=$(echo "$content" | grep -oP '\|\s*Phase\s+(\d+)\s*\|([^|]*)\|[^|]*\[([^\]]*)\]\(([^)]*)\)' 2>/dev/null || true)
    if [ -n "$matches" ]; then
      found=true
      while IFS= read -r line; do
        local num focus
        num=$(echo "$line" | grep -oP 'Phase\s+\K\d+')
        focus=$(echo "$line" | sed 's/|[^|]*|//' | sed 's/|.*//' | sed 's/^\s*Phase\s*[0-9]*\s*|\s*//' | sed 's/\s*$//')
        # Extract focus from second column
        focus=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); print $3}')
        local sanitized
        sanitized=$(sanitize_focus "$focus")
        phases=$(echo "$phases" | jq --argjson n "$num" --arg f "$focus" --arg s "$sanitized" \
          '. + [{"number": $n, "focus": $f, "sanitizedFocus": $s}]')
      done <<< "$matches"
    fi
  fi

  # Pattern 2: Table without links - | Phase N | Focus description | Effort |
  if [ "$found" = false ]; then
    local matches
    matches=$(echo "$content" | grep -P '^\s*\|\s*Phase\s+\d+' 2>/dev/null || true)
    if [ -n "$matches" ]; then
      found=true
      while IFS= read -r line; do
        local num focus
        num=$(echo "$line" | grep -oP 'Phase\s+\K\d+')
        focus=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); print $3}')
        if [ -n "$num" ] && [ -n "$focus" ]; then
          local sanitized
          sanitized=$(sanitize_focus "$focus")
          phases=$(echo "$phases" | jq --argjson n "$num" --arg f "$focus" --arg s "$sanitized" \
            '. + [{"number": $n, "focus": $f, "sanitizedFocus": $s}]')
        fi
      done <<< "$matches"
    fi
  fi

  # Pattern 3: Typst table - [Phase N], [Focus description], [Effort],
  if [ "$found" = false ]; then
    local matches
    matches=$(echo "$content" | grep -oP '\[Phase\s+\d+\]\s*,\s*\[[^\]]+\]\s*,\s*\[[^\]]+\]' 2>/dev/null || true)
    if [ -n "$matches" ]; then
      found=true
      while IFS= read -r line; do
        local num focus
        num=$(echo "$line" | grep -oP 'Phase\s+\K\d+')
        focus=$(echo "$line" | sed 's/\[Phase[^]]*\]\s*,\s*\[//' | sed 's/\]\s*,.*//')
        if [ -n "$num" ] && [ -n "$focus" ]; then
          local sanitized
          sanitized=$(sanitize_focus "$focus")
          phases=$(echo "$phases" | jq --argjson n "$num" --arg f "$focus" --arg s "$sanitized" \
            '. + [{"number": $n, "focus": $f, "sanitizedFocus": $s}]')
        fi
      done <<< "$matches"
    fi
  fi

  # Pattern 4: Inline headers - ### Phase N: Name
  if [ "$found" = false ]; then
    local matches
    matches=$(echo "$content" | grep -oP '###?\s*Phase\s+\d+\s*:\s*.+' 2>/dev/null || true)
    if [ -n "$matches" ]; then
      found=true
      while IFS= read -r line; do
        local num focus
        num=$(echo "$line" | grep -oP 'Phase\s+\K\d+')
        focus=$(echo "$line" | sed 's/.*Phase\s*[0-9]*\s*:\s*//')
        if [ -n "$num" ] && [ -n "$focus" ]; then
          local sanitized
          sanitized=$(sanitize_focus "$focus")
          phases=$(echo "$phases" | jq --argjson n "$num" --arg f "$focus" --arg s "$sanitized" \
            '. + [{"number": $n, "focus": $f, "sanitizedFocus": $s}]')
        fi
      done <<< "$matches"
    fi
  fi

  echo "$phases"
}

cmd_parse_verdict() {
  local input="${1:?Usage: parse.sh parse-verdict <text-or-file>}"

  # Read from file if it exists, otherwise treat as text
  local text
  if [ -f "$input" ]; then
    text=$(cat "$input")
  else
    text="$input"
  fi

  # Search for verdict markers (case-insensitive)
  local last_verdict="NEEDS_CHANGES"
  local last_pos=-1

  # Convert to lowercase for searching
  local lower
  lower=$(echo "$text" | tr '[:upper:]' '[:lower:]')

  # Find all occurrences of verdict markers and track positions
  local pos=0
  local remaining="$lower"

  while [ -n "$remaining" ]; do
    # Check for each verdict marker at current position
    local found_marker=""
    local found_at=-1

    # Find next occurrence of each marker
    for marker in "approved" "needs_changes" "changes_requested" "needs_work" "ready"; do
      local idx
      # Use grep to find byte offset
      idx=$(echo "$remaining" | grep -ob "\b${marker}\b" 2>/dev/null | head -1 | cut -d: -f1 || true)
      if [ -n "$idx" ] && { [ "$found_at" -eq -1 ] || [ "$idx" -lt "$found_at" ]; }; then
        found_at=$idx
        found_marker=$marker
      fi
    done

    if [ "$found_at" -eq -1 ]; then
      break
    fi

    local absolute_pos=$((pos + found_at))

    # Map marker to verdict
    local verdict
    case "$found_marker" in
      approved|ready) verdict="APPROVED" ;;
      needs_changes|changes_requested|needs_work) verdict="NEEDS_CHANGES" ;;
    esac

    # Last-wins rule
    if [ "$absolute_pos" -gt "$last_pos" ]; then
      last_pos=$absolute_pos
      last_verdict=$verdict
    fi

    # Move past this match
    local skip=$((found_at + ${#found_marker}))
    remaining="${remaining:$skip}"
    pos=$((pos + skip))
  done

  echo "$last_verdict"
}

cmd_extract_child_items() {
  local doc_path="${1:?Usage: parse.sh extract-child-items <doc-path>}"

  if [ ! -f "$doc_path" ]; then
    echo "[]"
    return
  fi

  local content
  content=$(cat "$doc_path")

  local items="[]"

  # Find table rows matching: | # | Item | Description | Priority | Dependencies |
  # Skip header and separator rows
  local in_table=false
  while IFS= read -r line; do
    # Detect table header (contains # and Item columns)
    if echo "$line" | grep -qP '^\s*\|.*#.*\|.*Item.*\|' 2>/dev/null; then
      in_table=true
      continue
    fi

    # Skip separator row
    if [ "$in_table" = true ] && echo "$line" | grep -qP '^\s*\|[\s-:|]+\|' 2>/dev/null; then
      continue
    fi

    # Parse data rows
    if [ "$in_table" = true ] && echo "$line" | grep -qP '^\s*\|\s*\d+' 2>/dev/null; then
      local num item desc priority deps
      num=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2}')
      item=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); print $3}')
      desc=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); print $4}')
      priority=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $5); print $5}')
      deps=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $6); print $6}')

      # Parse dependencies as array
      local deps_array="[]"
      if [ -n "$deps" ] && [ "$deps" != "-" ] && [ "$deps" != "None" ] && [ "$deps" != "none" ]; then
        deps_array=$(echo "$deps" | tr ',' '\n' | sed 's/[^0-9]//g' | jq -R 'select(length > 0) | tonumber' | jq -s '.')
      fi

      items=$(echo "$items" | jq \
        --argjson n "${num:-0}" \
        --arg i "$item" \
        --arg d "$desc" \
        --arg p "$priority" \
        --argjson deps "$deps_array" \
        '. + [{"number": $n, "item": $i, "description": $d, "priority": $p, "dependencies": $deps}]')
    elif [ "$in_table" = true ] && ! echo "$line" | grep -qP '^\s*\|' 2>/dev/null; then
      # End of table
      in_table=false
    fi
  done <<< "$content"

  echo "$items"
}

# Main dispatcher
case "${1:-help}" in
  extract-phases)     cmd_extract_phases "${2:-}" ;;
  parse-verdict)      cmd_parse_verdict "${2:-}" ;;
  extract-child-items) cmd_extract_child_items "${2:-}" ;;
  help|--help|-h)
    echo "Usage: bash parse.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  extract-phases <spec-file>          Extract phases from spec"
    echo "  parse-verdict <text-or-file>        Parse review verdict"
    echo "  extract-child-items <doc-path>      Extract child items from doc"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run 'bash parse.sh help' for usage." >&2
    exit 1
    ;;
esac
