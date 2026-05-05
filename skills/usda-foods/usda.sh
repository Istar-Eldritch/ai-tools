#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${USDA_API_KEY:-}" ]]; then
  echo "USDA_API_KEY is required" >&2
  exit 1
fi

cmd="${1:-}"
shift || true
base="https://api.nal.usda.gov/fdc/v1"

case "$cmd" in
  search)
    query="${1:-}"
    if [[ -z "$query" ]]; then
      echo "usage: usda.sh search <query> [pageSize]" >&2
      exit 1
    fi
    page_size="${2:-10}"
    curl -sS "$base/foods/search?api_key=$USDA_API_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"query\":\"$query\",\"pageSize\":$page_size}" | jq '{totalHits, foods: [.foods[]? | {fdcId, description, dataType, brandOwner, gtinUpc}]}'
    ;;
  details)
    fdc_id="${1:-}"
    if [[ -z "$fdc_id" ]]; then
      echo "usage: usda.sh details <fdcId>" >&2
      exit 1
    fi
    curl -sS "$base/food/$fdc_id?api_key=$USDA_API_KEY" | jq .
    ;;
  raw)
    path="${1:-}"
    if [[ -z "$path" ]]; then
      echo "usage: usda.sh raw <path-after-/fdc/v1/>" >&2
      exit 1
    fi
    curl -sS "$base/$path${path#*\?}" >/dev/null
    ;;
  *)
    echo "usage: usda.sh {search|details} ..." >&2
    exit 1
    ;;
esac
