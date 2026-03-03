#!/usr/bin/env bash
# git-helpers.sh - Git operations for spec-pipeline
# Usage: bash git-helpers.sh <command> [args...]
#
# Commands:
#   scoped-commit --files "f1 f2" --message "msg"   Commit specific files
#   scoped-commit --auto --message "msg"             Auto-detect changed files and commit
#   staged-diff [--max-chars 8000]                   Get truncated diff for commit msg generation
#
# Exit codes: 0 = success, 1 = no changes, 2 = error

set -euo pipefail

cmd_scoped_commit() {
  local files="" message="" auto=false

  while [ $# -gt 0 ]; do
    case "$1" in
      --files)   files="$2"; shift 2 ;;
      --message) message="$2"; shift 2 ;;
      --auto)    auto=true; shift ;;
      *) shift ;;
    esac
  done

  if [ -z "$message" ]; then
    echo "Error: --message is required" >&2
    exit 2
  fi

  if [ "$auto" = true ]; then
    # Auto-detect changed files
    local changed
    changed=$(git status --porcelain 2>/dev/null | awk '{print $2}')
    if [ -z "$changed" ]; then
      echo "no-changes"
      exit 1
    fi
    # Stage all changed files
    echo "$changed" | while IFS= read -r f; do
      git add "$f"
    done
  else
    if [ -z "$files" ]; then
      echo "Error: --files or --auto is required" >&2
      exit 2
    fi
    # Stage specified files
    local has_changes=false
    for f in $files; do
      if [ -f "$f" ] || git ls-files --deleted -- "$f" | grep -q .; then
        git add "$f"
        has_changes=true
      fi
    done
    if [ "$has_changes" = false ]; then
      echo "no-changes"
      exit 1
    fi
  fi

  # Check if there's actually anything staged
  if git diff --cached --quiet 2>/dev/null; then
    echo "no-changes"
    exit 1
  fi

  # Commit
  git commit -m "$message" 2>/dev/null
  local hash
  hash=$(git rev-parse --short HEAD)
  echo "$hash"
}

cmd_staged_diff() {
  local max_chars=8000

  while [ $# -gt 0 ]; do
    case "$1" in
      --max-chars) max_chars="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  local diff
  diff=$(git diff --cached 2>/dev/null)

  # If no staged diff, try unstaged
  if [ -z "$diff" ]; then
    diff=$(git diff 2>/dev/null)
  fi

  # If still no diff, try showing last commit
  if [ -z "$diff" ]; then
    diff=$(git show --stat HEAD 2>/dev/null || echo "")
  fi

  # Truncate to max_chars
  if [ ${#diff} -gt "$max_chars" ]; then
    echo "${diff:0:$max_chars}"
    echo ""
    echo "... [diff truncated at $max_chars characters]"
  else
    echo "$diff"
  fi
}

# Main dispatcher
case "${1:-help}" in
  scoped-commit) shift; cmd_scoped_commit "$@" ;;
  staged-diff)   shift; cmd_staged_diff "$@" ;;
  help|--help|-h)
    echo "Usage: bash git-helpers.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  scoped-commit --files \"f1 f2\" --message \"msg\"   Commit specific files"
    echo "  scoped-commit --auto --message \"msg\"             Auto-detect and commit"
    echo "  staged-diff [--max-chars 8000]                   Get truncated diff"
    echo ""
    echo "Exit codes: 0 = success, 1 = no changes, 2 = error"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run 'bash git-helpers.sh help' for usage." >&2
    exit 1
    ;;
esac
