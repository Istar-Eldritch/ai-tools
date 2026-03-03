#!/usr/bin/env bash
# config.sh - Configuration loading, short-name derivation, and path construction
# Usage: bash config.sh <command> [args...]
#
# Commands:
#   load-config [--needs-test-command] [--needs-template]   Load and merge configuration
#   derive-short-name "<description>"                       Derive a short name from description
#   construct-paths --specs-dir X --timestamp Y --short-name Z --format F --type T   Build file paths
#   build-agent-context --role <role>                       Build context string for an agent role

set -euo pipefail

# Check for jq
if ! command -v jq &>/dev/null; then
  echo '{"error": "jq is required but not installed. Install with: sudo apt install jq (Debian/Ubuntu), brew install jq (macOS), or see https://jqlang.github.io/jq/download/"}' >&2
  exit 2
fi

CONFIG_FILE=".claude/spec-pipeline.json"
STOP_WORDS="a an the and or for of in on to with is are be its this that from by at"

# Default configuration — used when no config file exists or fields are missing
DEFAULT_CONFIG='{
  "models": {
    "planDrafter": "opus",
    "planReviewer": "sonnet",
    "implementer": "opus",
    "codeReviewer": "sonnet",
    "addressReview": "sonnet",
    "commitMessageWriter": "haiku"
  },
  "reviewCycles": {
    "planReviewer": 0,
    "codeReviewer": 5
  }
}'

cmd_load_config() {
  local needs_test_command=false
  local needs_template=false

  for arg in "$@"; do
    case "$arg" in
      --needs-test-command) needs_test_command=true ;;
      --needs-template)     needs_template=true ;;
    esac
  done

  # Start with defaults, then deep-merge user config on top
  local config="$DEFAULT_CONFIG"
  if [ -f "$CONFIG_FILE" ]; then
    local user_config
    user_config=$(cat "$CONFIG_FILE")
    config=$(echo "$DEFAULT_CONFIG" "$user_config" | jq -s '.[0] * .[1]')
  else
    # Generate default config file on first run
    mkdir -p "$(dirname "$CONFIG_FILE")"
    echo "$DEFAULT_CONFIG" | jq '.' > "$CONFIG_FILE"
  fi

  # Auto-detect specsDir if not configured
  local specs_dir
  specs_dir=$(echo "$config" | jq -r '.specsDir // empty')
  if [ -z "$specs_dir" ]; then
    if [ -d "docs/specs" ]; then
      specs_dir="docs/specs"
    elif [ -d "docs" ]; then
      specs_dir="docs"
    elif [ -d "specs" ]; then
      specs_dir="specs"
    else
      specs_dir="."
    fi
    config=$(echo "$config" | jq --arg d "$specs_dir" '.specsDir = $d')
  fi

  # Auto-detect specFormat if not configured
  local spec_format
  spec_format=$(echo "$config" | jq -r '.specFormat // empty')
  if [ -z "$spec_format" ]; then
    spec_format="md"
    config=$(echo "$config" | jq --arg f "$spec_format" '.specFormat = $f')
  fi

  # Auto-detect test command if needed and not configured
  if [ "$needs_test_command" = true ]; then
    local test_cmd
    test_cmd=$(echo "$config" | jq -r '.testCommand // empty')
    if [ -z "$test_cmd" ]; then
      if [ -f "package.json" ]; then
        test_cmd="npm test"
      elif [ -f "Cargo.toml" ]; then
        test_cmd="cargo test"
      elif [ -f "setup.py" ] || [ -f "pyproject.toml" ]; then
        test_cmd="pytest"
      elif [ -f "go.mod" ]; then
        test_cmd="go test ./..."
      elif [ -f "Makefile" ] && grep -q "^test:" Makefile 2>/dev/null; then
        test_cmd="make test"
      fi
      if [ -n "$test_cmd" ]; then
        config=$(echo "$config" | jq --arg t "$test_cmd" '.testCommand = $t')
      fi
    fi
  fi

  # Discover template and conventions if needed
  if [ "$needs_template" = true ]; then
    local template_path
    template_path=$(echo "$config" | jq -r '.specTemplatePath // empty')
    if [ -z "$template_path" ]; then
      # Search specsDir for template files
      local found
      found=$(find "$specs_dir" -maxdepth 2 -iname "*template*" \( -name "*.md" -o -name "*.typ" -o -name "*.txt" -o -name "*.rst" -o -name "*.adoc" \) 2>/dev/null | head -1)
      if [ -n "$found" ]; then
        config=$(echo "$config" | jq --arg p "$found" '.specTemplatePath = $p')
        # Infer format from template extension
        local ext="${found##*.}"
        if [ "$ext" = "typ" ]; then
          config=$(echo "$config" | jq '.specFormat = "typ"')
        fi
      fi
    fi

    local conventions_path
    conventions_path=$(echo "$config" | jq -r '.specConventionsPath // empty')
    if [ -z "$conventions_path" ]; then
      local found_conv
      found_conv=$(find . -maxdepth 3 \( -iname "*guide*spec*" -o -iname "*spec*guide*" -o -iname "*spec*convention*" \) \( -name "*.md" -o -name "*.txt" \) 2>/dev/null | head -1)
      if [ -n "$found_conv" ]; then
        config=$(echo "$config" | jq --arg p "$found_conv" '.specConventionsPath = $p')
      fi
    fi
  fi

  # Enumerate existing context files
  local context_files="[]"
  for cf in README.md CONTRIBUTING.md ARCHITECTURE.md CLAUDE.md AGENTS.md; do
    if [ -f "$cf" ]; then
      context_files=$(echo "$context_files" | jq --arg f "$cf" '. + [$f]')
    fi
  done
  config=$(echo "$config" | jq --argjson cf "$context_files" '.contextFiles = ((.contextFiles // []) + $cf | unique)')

  echo "$config"
}

cmd_derive_short_name() {
  local description="${1:?Usage: config.sh derive-short-name \"<description>\"}"

  # Lowercase, strip non-alphanumeric (keep spaces), remove stop words, take first 4 words
  local words
  words=$(echo "$description" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]/ /g' | tr -s ' ')

  local result=()
  local count=0
  for word in $words; do
    # Check if word is a stop word
    local is_stop=false
    for sw in $STOP_WORDS; do
      if [ "$word" = "$sw" ]; then
        is_stop=true
        break
      fi
    done
    if [ "$is_stop" = false ] && [ -n "$word" ]; then
      result+=("$word")
      count=$((count + 1))
      if [ "$count" -ge 4 ]; then
        break
      fi
    fi
  done

  # Join with underscores
  local IFS="_"
  echo "${result[*]}"
}

cmd_construct_paths() {
  local specs_dir="" timestamp="" short_name="" format="md" type="spec"

  while [ $# -gt 0 ]; do
    case "$1" in
      --specs-dir)   specs_dir="$2"; shift 2 ;;
      --timestamp)   timestamp="$2"; shift 2 ;;
      --short-name)  short_name="$2"; shift 2 ;;
      --format)      format="$2"; shift 2 ;;
      --type)        type="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  if [ -z "$specs_dir" ] || [ -z "$timestamp" ] || [ -z "$short_name" ] || [ -z "$format" ]; then
    echo '{"error": "Missing required arguments. Need: --specs-dir, --timestamp, --short-name, --format"}' >&2
    exit 2
  fi

  local filename
  case "$type" in
    brainstorm) filename="${timestamp}_brainstorm_${short_name}.${format}" ;;
    roadmap)    filename="${timestamp}_roadmap_${short_name}.${format}" ;;
    epic)       filename="${timestamp}_epic_${short_name}.${format}" ;;
    *)          filename="${timestamp}_${short_name}.${format}" ;;
  esac

  local path="${specs_dir}/${filename}"

  jq -n --arg f "$filename" --arg p "$path" '{"filename": $f, "path": $p}'
}

cmd_build_agent_context() {
  local role=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --role) role="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  if [ -z "$role" ]; then
    echo "Error: --role is required" >&2
    echo "Usage: config.sh build-agent-context --role <role>" >&2
    exit 2
  fi

  # Load config (reuse load-config logic)
  local config
  config=$(cmd_load_config)

  local output=""

  # 1. Shared context files
  local shared_files
  shared_files=$(echo "$config" | jq -r '.contextFiles // [] | .[]')
  if [ -n "$shared_files" ]; then
    output+="## Project Context"$'\n\n'
    while IFS= read -r file; do
      if [ -f "$file" ]; then
        output+="### ${file}"$'\n\n'
        output+="$(cat "$file")"$'\n\n'
      fi
    done <<< "$shared_files"
  fi

  # 2. Per-role context files
  local role_files
  role_files=$(echo "$config" | jq -r --arg r "$role" '.agentContext[$r] // [] | .[]')
  if [ -n "$role_files" ]; then
    output+="## Additional Reference (${role})"$'\n\n'
    while IFS= read -r file; do
      if [ -f "$file" ]; then
        output+="### ${file}"$'\n\n'
        output+="$(cat "$file")"$'\n\n'
      else
        output+="### ${file}"$'\n\n'"(file not found)"$'\n\n'
      fi
    done <<< "$role_files"
  fi

  echo "$output"
}

# Main dispatcher
case "${1:-help}" in
  load-config)          shift; cmd_load_config "$@" ;;
  derive-short-name)    cmd_derive_short_name "${2:-}" ;;
  construct-paths)      shift; cmd_construct_paths "$@" ;;
  build-agent-context)  shift; cmd_build_agent_context "$@" ;;
  help|--help|-h)
    echo "Usage: bash config.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  load-config [--needs-test-command] [--needs-template]   Load and merge configuration"
    echo "  derive-short-name \"<description>\"                       Derive a short name"
    echo "  construct-paths --specs-dir X --timestamp Y --short-name Z --format F --type T"
    echo "  build-agent-context --role <role>                       Build context string for an agent role"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run 'bash config.sh help' for usage." >&2
    exit 1
    ;;
esac
