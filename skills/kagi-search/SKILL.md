---
name: kagi-search
description: Web search using Kagi Search API. Use when the user needs to search the web, find information, look up documentation, research topics, or get current facts. Provides high-quality search results without ads.
---

# Kagi Search

## Setup

Requires:
- `jq` for JSON parsing
- `pass` password manager with GPG key available
- Kagi API key stored in `pass shared/kagi_token`

Store your API key (one-time):
```bash
pass insert shared/kagi_token
```

Get an API key from: https://kagi.com/settings/api

## Usage

```bash
~/.pi/agent/skills/kagi-search/search.sh "your search query"
~/.pi/agent/skills/kagi-search/search.sh "query" --limit 5
~/.pi/agent/skills/kagi-search/search.sh "query" --json
```

## Options

| Option | Description |
|--------|-------------|
| `--limit N` | Limit to N results (default: 10) |
| `--json` | Output raw JSON response |
| `--related` | Include related searches |

## Examples

Search for documentation:
```bash
~/.pi/agent/skills/kagi-search/search.sh "rust async await tutorial"
```

Quick fact lookup:
```bash
~/.pi/agent/skills/kagi-search/search.sh "population of france 2024" --limit 3
```

## Output Format

Default output shows:
```
[1] Title of Result
    https://example.com/page
    Snippet describing the content...

[2] Another Result
    https://example.com/other
    More description...
```

## Workflow

1. Search: `search.sh "query"` to find relevant pages
2. Review results and identify useful URLs
3. If needed, fetch full content with browser skill or curl

## API Reference

See [references/api-reference.md](references/api-reference.md) for full API documentation.

## Troubleshooting

**"GPG decryption failed"**: Ensure your GPG key is available (`gpg --list-keys`)

**"Unauthorized"**: Check your API key is valid at https://kagi.com/settings/api

**"Insufficient credit"**: Add funds at https://kagi.com/settings/billing_api
