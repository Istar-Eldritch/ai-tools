#!/bin/bash
set -e

# Catacloud Platform Management CLI
#
# Requires: jq, curl
# Uses JWT_SECRET from .env file in catacloud project directory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATACLOUD_DIR="${CATACLOUD_DIR:-$HOME/code/catacloud}"

# Host presets
declare -A HOSTS=(
    [prod]="https://app.catallactical.com/api/v1"
    [local]="http://localhost:3030/api/v1"
    [staging]="https://staging.catallactical.com/api/v1"
)

# Default to prod, can be overridden by --host or CATACLOUD_API_URL
API_URL="${CATACLOUD_API_URL:-${HOSTS[prod]}}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load .env and generate token
generate_token() {
    if [ -f "$CATACLOUD_DIR/.env" ]; then
        set -a
        source "$CATACLOUD_DIR/.env"
        set +a
    fi

    if [ -z "$JWT_SECRET" ]; then
        echo "Error: JWT_SECRET not found. Set it in $CATACLOUD_DIR/.env" >&2
        exit 1
    fi

    local CONTEXT="catacloud-cli"
    local HOURS=24
    local USER_ID=$(python3 -c "import uuid; print(uuid.uuid5(uuid.NAMESPACE_OID, '$CONTEXT'))")
    local EXP=$(python3 -c "import time; print(int(time.time() + $HOURS * 3600))")

    local HEADER='{"alg":"HS256","typ":"JWT"}'
    local PAYLOAD='{"sub":"'"$USER_ID"'","exp":'"$EXP"',"aud":"authenticated","app_metadata":{"role":"platform_admin","organization_id":null,"machine_id":null}}'

    b64url_encode() {
        python3 -c "import base64, sys; print(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode().rstrip('='))"
    }

    local HEADER_B64=$(echo -n "$HEADER" | b64url_encode)
    local PAYLOAD_B64=$(echo -n "$PAYLOAD" | b64url_encode)
    local SIGNATURE=$(echo -n "${HEADER_B64}.${PAYLOAD_B64}" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url_encode)

    echo "${HEADER_B64}.${PAYLOAD_B64}.${SIGNATURE}"
}

# Make API call
api_call() {
    local method="$1"
    local params="$2"
    local token=$(generate_token)

    curl -s -X POST "$API_URL" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"method\": \"$method\",
            \"params\": $params
        }"
}

# Commands
cmd_list_pools() {
    local org_filter=""
    while [[ $# -gt 0 ]]; do
        case $1 in
            --org) org_filter="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local filters='{"and":[]}'
    if [ -n "$org_filter" ]; then
        filters='{"and":[{"params":{"organization_id":{"equals":{"value":"'"$org_filter"'","case_sensitive":true}}}}]}'
    fi

    local result=$(api_call "list_machine_pools" "{\"pagination\":{\"offset\":0,\"limit\":100},\"filters\":$filters}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    echo "$result" | jq -r '.result.results'
}

cmd_list_machines() {
    local pool_filter=""
    while [[ $# -gt 0 ]]; do
        case $1 in
            --pool) pool_filter="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local filters='{"and":[]}'
    if [ -n "$pool_filter" ]; then
        filters='{"and":[{"params":{"pool_id":{"equals":{"value":"'"$pool_filter"'","case_sensitive":true}}}}]}'
    fi

    local result=$(api_call "list_machines" "{\"pagination\":{\"offset\":0,\"limit\":100},\"filters\":$filters}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    echo "$result" | jq -r '.result.results'
}

cmd_list_jobs() {
    local state_filter=""
    while [[ $# -gt 0 ]]; do
        case $1 in
            --state) state_filter="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local filters='{"and":[]}'
    if [ -n "$state_filter" ]; then
        filters='{"and":[{"params":{"state":{"equals":{"value":"'"$state_filter"'","case_sensitive":true}}}}]}'
    fi

    local result=$(api_call "list_jobs" "{\"pagination\":{\"offset\":0,\"limit\":100},\"filters\":$filters}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    echo "$result" | jq -r '.result.results'
}

cmd_list_orgs() {
    local result=$(api_call "list_organizations" "{\"pagination\":{\"offset\":0,\"limit\":100}}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    echo "$result" | jq -r '.result.results'
}

cmd_remove_machine() {
    local pool_id="$1"
    local machine_id="$2"

    if [ -z "$pool_id" ] || [ -z "$machine_id" ]; then
        echo "Usage: catacloud.sh remove-machine <pool_id> <machine_id>" >&2
        exit 1
    fi

    local result=$(api_call "remove_machine_from_pool" "{\"pool_id\":\"$pool_id\",\"machine_id\":\"$machine_id\"}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        echo "$result" | jq -r '.error.data' >&2
        exit 1
    fi

    echo -e "${GREEN}✓${NC} Removed machine $machine_id from pool $pool_id"
}

cmd_find_stuck_machines() {
    local machines=$(cmd_list_machines)
    
    # Find machines stuck in PROVISIONING status
    # These are machines that failed to provision properly
    echo "$machines" | jq -r '[.[] | select(.status == "PROVISIONING")]'
}

cmd_diagnose_pools() {
    echo -e "${BLUE}Diagnosing machine pools...${NC}\n"

    local pools=$(cmd_list_pools)
    local machines=$(cmd_list_machines)
    local issues_found=0

    echo "$pools" | jq -c '.[]' | while read -r pool; do
        local pool_id=$(echo "$pool" | jq -r '.id')
        local pool_name=$(echo "$pool" | jq -r '.name')
        local current=$(echo "$pool" | jq -r '.current_machines')
        local max=$(echo "$pool" | jq -r '.max_machines')
        local registered=$(echo "$pool" | jq -r '.registered_machines')

        echo -e "${YELLOW}Pool:${NC} $pool_name ($pool_id)"
        echo "  Capacity: $current / $max machines"
        
        # Check each registered machine
        local reg_count=$(echo "$registered" | jq -r 'length')
        if [ "$reg_count" -gt 0 ]; then
            echo "  Registered machines:"
            echo "$registered" | jq -r '.[]' | while read -r machine_id; do
                local machine=$(echo "$machines" | jq -r ".[] | select(.id == \"$machine_id\")")
                if [ -n "$machine" ]; then
                    local status=$(echo "$machine" | jq -r '.status')
                    local created=$(echo "$machine" | jq -r '.created_at')
                    
                    if [ "$status" == "PROVISIONING" ]; then
                        echo -e "    ${RED}⚠ $machine_id${NC} - STUCK (PROVISIONING since $created)"
                        issues_found=$((issues_found + 1))
                    else
                        echo -e "    ${GREEN}✓${NC} $machine_id - $status"
                    fi
                else
                    echo -e "    ${RED}⚠ $machine_id${NC} - ORPHAN (not found in machines table)"
                    issues_found=$((issues_found + 1))
                fi
            done
        else
            echo -e "  ${GREEN}✓${NC} No registered machines"
        fi
        echo ""
    done

    if [ "$issues_found" -eq 0 ]; then
        echo -e "${GREEN}All pools healthy!${NC}"
    else
        echo -e "${RED}Found $issues_found issue(s). Run 'fix-orphans' to resolve.${NC}"
    fi
}

cmd_fix_orphans() {
    echo -e "${BLUE}Finding orphan/stuck machines...${NC}\n"

    local pools=$(cmd_list_pools)
    local machines=$(cmd_list_machines)
    local fixed=0

    echo "$pools" | jq -c '.[]' | while read -r pool; do
        local pool_id=$(echo "$pool" | jq -r '.id')
        local pool_name=$(echo "$pool" | jq -r '.name')
        local registered=$(echo "$pool" | jq -r '.registered_machines')

        echo "$registered" | jq -r '.[]' 2>/dev/null | while read -r machine_id; do
            [ -z "$machine_id" ] && continue
            
            local machine=$(echo "$machines" | jq -r ".[] | select(.id == \"$machine_id\")")
            local should_remove=false
            local reason=""

            if [ -z "$machine" ]; then
                should_remove=true
                reason="orphan (not in machines table)"
            else
                local status=$(echo "$machine" | jq -r '.status')
                
                if [ "$status" == "PROVISIONING" ]; then
                    should_remove=true
                    reason="stuck in PROVISIONING"
                fi
            fi

            if [ "$should_remove" = true ]; then
                echo -e "${YELLOW}Removing${NC} $machine_id from $pool_name ($reason)"
                cmd_remove_machine "$pool_id" "$machine_id"
                fixed=$((fixed + 1))
            fi
        done
    done

    echo -e "\n${GREEN}Fixed $fixed orphan machine(s)${NC}"
}

cmd_get_logs() {
    # First argument is the JSON filter, rest are optional pagination
    local filter="$1"
    local limit="${2:-100}"
    local offset="${3:-0}"

    if [ -z "$filter" ]; then
        echo -e "${RED}Error:${NC} Must provide a JSON filter as first argument" >&2
        echo "Example: get-logs '{\"and\":[{\"job_id\":{\"eq\":{\"value\":\"...\"}}}]}'" >&2
        exit 1
    fi
    
    # Build params using SortedAndPaginatedRequest format
    local params="{\"pagination\":{\"offset\":$offset,\"limit\":$limit},\"filters\":$filter}"

    local result=$(api_call "get_logs" "$params")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    local entry_count=$(echo "$result" | jq -r '.result.results | length')
    
    echo -e "${BLUE}Showing:${NC} $entry_count log entries\n"
    echo "$result" | jq -r '.result.results[] | "[\(.timestamp)] \(.level) [\(.source)]: \(.message)"'
}

cmd_get_log_filters() {
    local result=$(api_call "get_log_filters" "{}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    local default_level=$(echo "$result" | jq -r '.result.default_level')
    local filters=$(echo "$result" | jq -r '.result.filters')
    local filter_count=$(echo "$filters" | jq -r 'length')

    echo -e "${BLUE}Default log level:${NC} $default_level"
    
    if [ "$filter_count" -gt 0 ]; then
        echo -e "\n${BLUE}Module filters:${NC}"
        echo "$filters" | jq -r '.[] | "  \(.module) = \(.level)"'
    else
        echo -e "\n${YELLOW}No module-specific filters set${NC}"
    fi
}

cmd_set_log_filter() {
    local module="$1"
    local level="$2"

    # If only one arg, treat as setting default level
    if [ -z "$level" ]; then
        level="$module"
        module="*"
    fi

    if [ -z "$level" ]; then
        echo "Usage: catacloud.sh set-log-filter [module] <level>" >&2
        echo "  catacloud.sh set-log-filter INFO              # Set default level" >&2
        echo "  catacloud.sh set-log-filter catacloud_core DEBUG  # Set module level" >&2
        echo "Valid levels: ERROR, WARN, INFO, DEBUG, TRACE" >&2
        exit 1
    fi

    # Convert level to uppercase
    level=$(echo "$level" | tr '[:lower:]' '[:upper:]')

    local result=$(api_call "set_log_filter" "{\"module\":\"$module\",\"level\":\"$level\"}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    local result_module=$(echo "$result" | jq -r '.result.module')
    local result_level=$(echo "$result" | jq -r '.result.level')
    local previous=$(echo "$result" | jq -r '.result.previous_level // empty')

    if [ "$result_module" == "*" ]; then
        echo -e "${GREEN}✓${NC} Default log level changed: $previous → $result_level"
    else
        echo -e "${GREEN}✓${NC} Log filter set: $result_module = $result_level"
    fi
}

cmd_clear_log_filter() {
    local module="${1:-*}"

    local result=$(api_call "clear_log_filter" "{\"module\":\"$module\"}")
    
    if echo "$result" | jq -e '.error' > /dev/null 2>&1 && [ "$(echo "$result" | jq -r '.error')" != "null" ]; then
        echo -e "${RED}Error:${NC} $(echo "$result" | jq -r '.error.message')" >&2
        exit 1
    fi

    local cleared=$(echo "$result" | jq -r '.result.cleared')
    local previous=$(echo "$result" | jq -r '.result.previous_level // empty')

    if [ "$cleared" == "all" ]; then
        echo -e "${GREEN}✓${NC} All module filters cleared"
    else
        if [ -n "$previous" ]; then
            echo -e "${GREEN}✓${NC} Filter cleared: $cleared (was: $previous)"
        else
            echo -e "${YELLOW}No filter existed for:${NC} $cleared"
        fi
    fi
}

cmd_help() {
    cat << 'EOF'
Catacloud Platform Management CLI

Usage: catacloud.sh [--host <target>] <command> [options]

Global Options:
  --host <target>     Target host: prod, local, staging, or a full URL
                      (default: prod)

Commands:
  list-pools [--org <org_id>]       List machine pools
  list-machines [--pool <pool_id>]  List machines
  list-jobs [--state <state>]       List jobs
  list-orgs                         List organizations
  remove-machine <pool_id> <machine_id>  Remove machine from pool
  find-stuck-machines               Find machines stuck in PROVISIONING
  diagnose-pools                    Health check for all pools
  fix-orphans                       Remove all orphan/stuck machines

  get-logs '<filter_json>' [limit] [offset]
                                    Get logs from S3 storage
                                    Filter JSON uses standard filter format with and/or logic
                                    Examples:
                                      '{"and":[{"job_id":{"eq":{"value":"..."}}}]}'
                                      '{"and":[{"instance_id":{"eq":{"value":"..."}}},{"timestamp":{"gte":"2026-01-29T10:00:00Z"}}]}'
  get-log-filters                   Show current log level and module filters
  set-log-filter [module] <level>   Set log level (default or per-module)
  clear-log-filter [module]         Clear module filter(s) (* or omit for all)

  help                              Show this help

Host Presets:
  prod      https://app.catallactical.com/api/v1 (default)
  local     http://localhost:3030/api/v1
  staging   https://staging.catallactical.com/api/v1

Environment:
  CATACLOUD_DIR      Path to catacloud project (default: ~/code/catacloud)
  CATACLOUD_API_URL  Override API endpoint (takes precedence over --host)

Examples:
  catacloud.sh list-pools                      # List pools on prod
  catacloud.sh --host local get-logs           # Get logs from local dev server
  catacloud.sh --host staging list-jobs        # List jobs on staging
  catacloud.sh --host http://custom:3030/api/v1 list-orgs  # Custom URL
EOF
}

# Parse global flags (before command)
while [[ $# -gt 0 ]]; do
    case $1 in
        --host)
            if [[ -n "${HOSTS[$2]}" ]]; then
                API_URL="${HOSTS[$2]}"
            else
                # Treat as raw URL if not a preset
                API_URL="$2"
            fi
            shift 2
            ;;
        *)
            break
            ;;
    esac
done

# Main
case "${1:-help}" in
    list-pools)       shift; cmd_list_pools "$@" ;;
    list-machines)    shift; cmd_list_machines "$@" ;;
    list-jobs)        shift; cmd_list_jobs "$@" ;;
    list-orgs)        shift; cmd_list_orgs "$@" ;;
    remove-machine)   shift; cmd_remove_machine "$@" ;;
    find-stuck-machines) cmd_find_stuck_machines ;;
    diagnose-pools)   cmd_diagnose_pools ;;
    fix-orphans)      cmd_fix_orphans ;;
    get-logs)         shift; cmd_get_logs "$@" ;;
    get-log-filters)  cmd_get_log_filters ;;
    set-log-filter)   shift; cmd_set_log_filter "$@" ;;
    clear-log-filter) shift; cmd_clear_log_filter "$@" ;;
    help|--help|-h)   cmd_help ;;
    *)
        echo "Unknown command: $1" >&2
        cmd_help >&2
        exit 1
        ;;
esac
