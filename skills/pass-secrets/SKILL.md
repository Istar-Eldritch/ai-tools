---
name: pass-secrets
description: Securely run commands that require secrets from the pass password store. Use this when a command needs API keys, tokens, passwords, or other credentials. Secrets are injected as environment variables and are NEVER visible in command output or logs.
---

# Pass Secrets Runner

Securely execute commands with secrets from [pass](https://www.passwordstore.org/) (the standard Unix password manager) without exposing secret values.

## ⚠️ CRITICAL SECURITY RULES

1. **NEVER run `pass show <path>`** - this would expose secrets in the output
2. **NEVER try to read or echo environment variables** containing secrets
3. **ALWAYS use this skill** when a command needs credentials
4. Use `list` to discover available secrets, then `exec` or `multi` to use them

## Usage

```bash
# List available secrets (safe - only shows paths, not values)
skills/pass-secrets/pass-run.sh list
skills/pass-secrets/pass-run.sh list api/

# Run command with ONE secret
skills/pass-secrets/pass-run.sh exec <pass-path> <ENV_VAR> -- <command> [args...]

# Run command with MULTIPLE secrets
skills/pass-secrets/pass-run.sh multi <path1:VAR1> [path2:VAR2 ...] -- <command> [args...]
```

## Examples

### List available secrets
```bash
# List all secrets
skills/pass-secrets/pass-run.sh list

# List secrets under a prefix
skills/pass-secrets/pass-run.sh list api/
skills/pass-secrets/pass-run.sh list work/databases/
```

### Single secret
```bash
# GitHub CLI with token
skills/pass-secrets/pass-run.sh exec github/token GITHUB_TOKEN -- gh pr list

# API call with key
skills/pass-secrets/pass-run.sh exec api/openai OPENAI_API_KEY -- python query_gpt.py

# Docker registry login
skills/pass-secrets/pass-run.sh exec docker/registry DOCKER_PASSWORD -- docker login -u user --password-stdin
```

### Multiple secrets
```bash
# Database connection with user and password
skills/pass-secrets/pass-run.sh multi db/user:DB_USER db/pass:DB_PASS -- ./connect-db.sh

# Multi-provider AI script
skills/pass-secrets/pass-run.sh multi api/openai:OPENAI_API_KEY api/anthropic:ANTHROPIC_API_KEY -- python multi_llm.py

# AWS credentials
skills/pass-secrets/pass-run.sh multi aws/access-key:AWS_ACCESS_KEY_ID aws/secret-key:AWS_SECRET_ACCESS_KEY -- aws s3 ls
```

## How It Works

```
┌─────────────────────────────────────────────────┐
│  AI Agent                                       │
│  - Sees: command names, pass paths, output      │
│  - NEVER sees: actual secret values             │
└─────────────────────┬───────────────────────────┘
                      │ calls pass-run.sh
                      ▼
┌─────────────────────────────────────────────────┐
│  pass-run.sh                                    │
│  - Fetches secrets from pass                    │
│  - Injects into subprocess environment          │
│  - Returns command output (secrets excluded)    │
└─────────────────────┬───────────────────────────┘
                      │ env VAR=<secret>
                      ▼
┌─────────────────────────────────────────────────┐
│  Your Command                                   │
│  - Reads secret from $ENV_VAR                   │
│  - Uses it for authentication                   │
│  - Output returned to agent (no secrets)        │
└─────────────────────────────────────────────────┘
```

## Common Environment Variable Names

| Service | Common Variable Name |
|---------|---------------------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| GitHub | `GITHUB_TOKEN` |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| Docker | `DOCKER_PASSWORD` |
| Database | `DB_PASSWORD`, `DATABASE_URL` |
| Generic | `API_KEY`, `AUTH_TOKEN`, `SECRET_KEY` |

## Requirements

- `pass` password manager installed and configured
- GPG key available (may require YubiKey touch)
- Secrets stored in pass at known paths

## Troubleshooting

**"GPG key not available"**: Your YubiKey may need to be touched or inserted.

**"Secret not found"**: Use `list` to check available paths.

**Command fails silently**: The underlying command may expect secrets in a different format. Check the command's documentation.
