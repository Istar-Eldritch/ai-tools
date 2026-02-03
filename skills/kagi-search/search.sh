#!/usr/bin/env bash
set -euo pipefail

# Kagi Search API client
# Usage: search.sh "query" [--limit N] [--json] [--related]

show_help() {
    cat <<EOF
Usage: $(basename "$0") "query" [options]

Options:
  --limit N     Limit to N results (default: 10)
  --json        Output raw JSON response
  --related     Include related searches in output
  -h, --help    Show this help

Examples:
  $(basename "$0") "rust async tutorial"
  $(basename "$0") "python requests library" --limit 5
  $(basename "$0") "kagi search api" --json
EOF
    exit 0
}

# Defaults
LIMIT=10
JSON_OUTPUT=false
SHOW_RELATED=false
QUERY=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --limit)
            LIMIT="$2"
            shift 2
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --related)
            SHOW_RELATED=true
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
            if [[ -z "$QUERY" ]]; then
                QUERY="$1"
            else
                echo "Error: Multiple queries provided" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$QUERY" ]]; then
    echo "Error: No search query provided" >&2
    echo "Usage: $(basename "$0") \"query\" [--limit N] [--json] [--related]" >&2
    exit 1
fi

# Check dependencies
if ! command -v jq &>/dev/null; then
    echo "Error: jq is required but not installed" >&2
    exit 1
fi

if ! command -v pass &>/dev/null; then
    echo "Error: pass is required but not installed" >&2
    exit 1
fi

# Get API key from pass
API_KEY=$(pass shared/kagi_token 2>/dev/null) || {
    echo "Error: Failed to retrieve API key from 'pass shared/kagi_token'" >&2
    echo "Make sure your GPG key is available and the password exists" >&2
    exit 1
}

# URL encode the query
ENCODED_QUERY=$(printf '%s' "$QUERY" | jq -sRr @uri)

# Make API request
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bot $API_KEY" \
    "https://kagi.com/api/v0/search?q=${ENCODED_QUERY}&limit=${LIMIT}")

# Split response and status code
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check for HTTP errors
if [[ "$HTTP_CODE" != "200" ]]; then
    echo "Error: HTTP $HTTP_CODE" >&2
    ERROR_MSG=$(echo "$BODY" | jq -r '.error[0].msg // "Unknown error"' 2>/dev/null || echo "Unknown error")
    echo "$ERROR_MSG" >&2
    exit 1
fi

# Check for API errors
if echo "$BODY" | jq -e '.error[0]' &>/dev/null; then
    ERROR_CODE=$(echo "$BODY" | jq -r '.error[0].code')
    ERROR_MSG=$(echo "$BODY" | jq -r '.error[0].msg')
    echo "Error [$ERROR_CODE]: $ERROR_MSG" >&2
    exit 1
fi

# Output raw JSON if requested
if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "$BODY" | jq .
    exit 0
fi

# Parse and display results
export SHOW_RELATED
echo "$BODY" | jq -r '
    .data[] |
    if .t == 0 then
        "[\(.url | split("/") | .[2] // "")]",
        "  \(.title)",
        "  \(.url)",
        (if .snippet then "  \(.snippet | gsub("&#39;"; "'"'"'") | gsub("&quot;"; "\"") | gsub("&amp;"; "&") | gsub("<[^>]*>"; ""))" else empty end),
        (if .published then "  Published: \(.published | split("T")[0])" else empty end),
        ""
    elif .t == 1 then
        if env.SHOW_RELATED == "true" then
            "",
            "Related searches:",
            (.list | map("  • \(.)") | join("\n"))
        else
            empty
        end
    else
        empty
    end
'

# Show API balance
BALANCE=$(echo "$BODY" | jq -r '.meta.api_balance // empty')
if [[ -n "$BALANCE" ]]; then
    echo "---"
    echo "API Balance: \$${BALANCE}"
fi
