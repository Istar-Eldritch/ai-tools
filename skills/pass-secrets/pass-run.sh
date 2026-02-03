#!/bin/bash
#
# pass-run: Securely run commands with secrets from pass
#
# This script injects secrets from the pass password store into commands
# WITHOUT exposing the secret values to the calling process (e.g., an AI agent).
#
# Usage:
#   pass-run list [prefix]              - List available secret paths
#   pass-run exec <pass-path> <env-var> -- <command> [args...]
#   pass-run multi <pass-path1>:<env1> [pass-path2:env2 ...] -- <command> [args...]
#
# Examples:
#   pass-run list api/
#   pass-run exec api/openai OPENAI_API_KEY -- python script.py
#   pass-run multi api/openai:OPENAI_API_KEY api/anthropic:ANTHROPIC_API_KEY -- ./multi-llm.sh
#

set -euo pipefail

SCRIPT_NAME=$(basename "$0")

# ANSI colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
    cat <<EOF
Usage: $SCRIPT_NAME <command> [options]

Commands:
  list [prefix]       List available secret paths (optionally filtered by prefix)
  exec <path> <var> -- <cmd>    Run command with one secret
  multi <path:var> [...] -- <cmd>   Run command with multiple secrets

Examples:
  $SCRIPT_NAME list
  $SCRIPT_NAME list api/
  $SCRIPT_NAME exec api/github GITHUB_TOKEN -- gh pr list
  $SCRIPT_NAME multi db/user:DB_USER db/pass:DB_PASS -- ./connect.sh

Security:
  - Secrets are NEVER printed to stdout/stderr
  - Secrets are passed via environment variables to the child process only
  - Environment is cleaned up after command execution
EOF
    exit 1
}

error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

info() {
    echo -e "${BLUE}$1${NC}" >&2
}

warn() {
    echo -e "${YELLOW}Warning: $1${NC}" >&2
}

success() {
    echo -e "${GREEN}$1${NC}" >&2
}

# Check if pass is available
check_pass() {
    if ! command -v pass &> /dev/null; then
        error "pass (password-store) is not installed or not in PATH"
    fi
}

# List available secrets
cmd_list() {
    check_pass
    local prefix="${1:-}"
    
    info "Available secrets${prefix:+ under '$prefix'}:"
    echo ""
    
    if [[ -n "$prefix" ]]; then
        pass ls "$prefix" 2>/dev/null || error "Prefix '$prefix' not found or no secrets available"
    else
        pass ls 2>/dev/null || error "No secrets available or GPG key not accessible"
    fi
}

# Execute command with a single secret
cmd_exec() {
    check_pass
    
    if [[ $# -lt 4 ]]; then
        error "exec requires: <pass-path> <env-var> -- <command> [args...]"
    fi
    
    local pass_path="$1"
    local env_var="$2"
    shift 2
    
    if [[ "$1" != "--" ]]; then
        error "Missing '--' separator before command"
    fi
    shift
    
    if [[ $# -lt 1 ]]; then
        error "No command specified after '--'"
    fi
    
    # Validate environment variable name
    if [[ ! "$env_var" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        error "Invalid environment variable name: $env_var"
    fi
    
    # Check if secret exists (without revealing content)
    if ! pass show "$pass_path" &>/dev/null; then
        error "Secret '$pass_path' not found or GPG key not available"
    fi
    
    info "Running command with secret from '$pass_path' as \$$env_var"
    
    # Execute with secret in environment
    # The secret is passed directly to the subprocess environment
    # and is never stored in a shell variable that could be logged
    env "$env_var=$(pass show "$pass_path" 2>/dev/null | head -n1)" "$@"
    local exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        success "Command completed successfully"
    else
        warn "Command exited with code $exit_code"
    fi
    
    return $exit_code
}

# Execute command with multiple secrets
cmd_multi() {
    check_pass
    
    if [[ $# -lt 2 ]]; then
        error "multi requires: <pass-path:env-var> [...] -- <command> [args...]"
    fi
    
    local -a env_assignments=()
    local -a secret_info=()
    
    # Parse path:var pairs until we hit --
    while [[ $# -gt 0 && "$1" != "--" ]]; do
        local pair="$1"
        shift
        
        if [[ ! "$pair" =~ : ]]; then
            error "Invalid format '$pair'. Expected 'pass-path:ENV_VAR'"
        fi
        
        local pass_path="${pair%%:*}"
        local env_var="${pair#*:}"
        
        # Validate environment variable name
        if [[ ! "$env_var" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
            error "Invalid environment variable name: $env_var"
        fi
        
        # Check if secret exists
        if ! pass show "$pass_path" &>/dev/null; then
            error "Secret '$pass_path' not found or GPG key not available"
        fi
        
        # Build env assignment (secret fetched at execution time)
        env_assignments+=("$env_var=$(pass show "$pass_path" 2>/dev/null | head -n1)")
        secret_info+=("$pass_path → \$$env_var")
    done
    
    if [[ "$1" != "--" ]]; then
        error "Missing '--' separator before command"
    fi
    shift
    
    if [[ $# -lt 1 ]]; then
        error "No command specified after '--'"
    fi
    
    info "Running command with ${#env_assignments[@]} secret(s):"
    for s in "${secret_info[@]}"; do
        echo "  • $s" >&2
    done
    
    # Execute with all secrets in environment
    env "${env_assignments[@]}" "$@"
    local exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        success "Command completed successfully"
    else
        warn "Command exited with code $exit_code"
    fi
    
    return $exit_code
}

# Main entry point
main() {
    if [[ $# -lt 1 ]]; then
        usage
    fi
    
    local command="$1"
    shift
    
    case "$command" in
        list)
            cmd_list "$@"
            ;;
        exec)
            cmd_exec "$@"
            ;;
        multi)
            cmd_multi "$@"
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            error "Unknown command: $command. Use 'list', 'exec', or 'multi'."
            ;;
    esac
}

main "$@"
