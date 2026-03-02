#!/usr/bin/env bash
# state.sh - Helper for spec-pipeline state queries
# Usage: bash state.sh <command> [args...]
#
# Commands:
#   init                    Create state directory structure
#   list <type>             List state IDs (specs|implementations|roadmaps|epics|brainstorms)
#   find-active <type>      Find most recent non-completed state ID
#   generate-id             Generate a unique pipeline ID (YYMMDDhhmmss_XXXX)
#   generate-timestamp      Generate a timestamp (YYMMDDhhmm)

set -euo pipefail

STATE_DIR=".claude/spec-pipeline"

cmd_init() {
  mkdir -p "$STATE_DIR/specs"
  mkdir -p "$STATE_DIR/implementations"
  mkdir -p "$STATE_DIR/roadmaps"
  mkdir -p "$STATE_DIR/epics"
  mkdir -p "$STATE_DIR/brainstorms"
  echo "Initialized state directory at $STATE_DIR"
}

cmd_list() {
  local type="${1:?Usage: state.sh list <type>}"
  local dir="$STATE_DIR/$type"
  if [ ! -d "$dir" ]; then
    echo "[]"
    return
  fi
  # List JSON files sorted by modification time (newest first), output IDs
  local ids=()
  while IFS= read -r file; do
    [ -n "$file" ] && ids+=("$(basename "$file" .json)")
  done < <(ls -t "$dir"/*.json 2>/dev/null)
  # Output as JSON array
  if [ ${#ids[@]} -eq 0 ]; then
    echo "[]"
  else
    printf '['
    for i in "${!ids[@]}"; do
      [ "$i" -gt 0 ] && printf ','
      printf '"%s"' "${ids[$i]}"
    done
    printf ']\n'
  fi
}

cmd_find_active() {
  local type="${1:?Usage: state.sh find-active <type>}"
  local dir="$STATE_DIR/$type"
  if [ ! -d "$dir" ]; then
    echo ""
    return
  fi
  # Search newest-first for a state file where stage is NOT completed or cancelled
  for file in $(ls -t "$dir"/*.json 2>/dev/null); do
    local stage
    stage=$(grep -oP '"stage"\s*:\s*"\K[^"]+' "$file" 2>/dev/null | head -1)
    if [ -n "$stage" ] && [ "$stage" != "completed" ] && [ "$stage" != "cancelled" ]; then
      basename "$file" .json
      return
    fi
  done
  echo ""
}

cmd_generate_id() {
  local timestamp
  timestamp=$(date -u +"%y%m%d%H%M%S")
  local random
  random=$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' \n')
  echo "${timestamp}_${random}"
}

cmd_generate_timestamp() {
  date -u +"%y%m%d%H%M"
}

# Main dispatcher
case "${1:-help}" in
  init)             cmd_init ;;
  list)             cmd_list "${2:-}" ;;
  find-active)      cmd_find_active "${2:-}" ;;
  generate-id)      cmd_generate_id ;;
  generate-timestamp) cmd_generate_timestamp ;;
  help|--help|-h)
    echo "Usage: bash state.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  init                    Create state directory structure"
    echo "  list <type>             List state IDs (specs|implementations|roadmaps|epics|brainstorms)"
    echo "  find-active <type>      Find most recent non-completed state ID"
    echo "  generate-id             Generate a unique pipeline ID"
    echo "  generate-timestamp      Generate a timestamp (YYMMDDhhmm)"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run 'bash state.sh help' for usage." >&2
    exit 1
    ;;
esac
