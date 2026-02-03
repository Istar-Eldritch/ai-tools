---
name: catacloud
description: Manage Catacloud platform via API - list/manage machine pools, machines, jobs, organizations, fix orphan machines, and control server logging. Use when user needs to inspect or modify production Catacloud resources.
---

# Catacloud Platform Management

Manage the Catacloud platform through its JSON-RPC API.

## Usage

```bash
# Run command against production (default)
~/.pi/agent/skills/catacloud/catacloud.sh <command> [args...]

# Run against a specific host
~/.pi/agent/skills/catacloud/catacloud.sh --host local <command> [args...]
~/.pi/agent/skills/catacloud/catacloud.sh --host staging <command> [args...]
~/.pi/agent/skills/catacloud/catacloud.sh --host prod <command> [args...]

# Or use a custom URL
~/.pi/agent/skills/catacloud/catacloud.sh --host http://localhost:3030/api/v1 <command>
```

### Host Presets

| Preset | URL |
|--------|-----|
| `prod` | https://app.catallactical.com/api/v1 (default) |
| `local` | http://localhost:3030/api/v1 |
| `staging` | https://staging.catallactical.com/api/v1 |

## Commands

### Machine Pools

```bash
# List all machine pools
~/.pi/agent/skills/catacloud/catacloud.sh list-pools

# List pools for a specific organization
~/.pi/agent/skills/catacloud/catacloud.sh list-pools --org <org_id>

# Remove an orphan machine from a pool (admin only)
~/.pi/agent/skills/catacloud/catacloud.sh remove-machine <pool_id> <machine_id>
```

### Machines

```bash
# List all machines
~/.pi/agent/skills/catacloud/catacloud.sh list-machines

# List machines in a specific pool
~/.pi/agent/skills/catacloud/catacloud.sh list-machines --pool <pool_id>

# Find stuck/orphan machines (PROVISIONING with no hetzner_machine_id)
~/.pi/agent/skills/catacloud/catacloud.sh find-stuck-machines
```

### Jobs

```bash
# List jobs
~/.pi/agent/skills/catacloud/catacloud.sh list-jobs

# List jobs by state (Draft, Submitted, Running, Completed, Failed, Cancelled)
~/.pi/agent/skills/catacloud/catacloud.sh list-jobs --state <state>
```

### Organizations

```bash
# List organizations
~/.pi/agent/skills/catacloud/catacloud.sh list-orgs
```

### Diagnostics

```bash
# Health check for all pools - finds pools with orphan machines
~/.pi/agent/skills/catacloud/catacloud.sh diagnose-pools

# Fix all orphan machines across all pools (interactive)
~/.pi/agent/skills/catacloud/catacloud.sh fix-orphans
```

### Logs

```bash
# Get logs for a specific job
~/.pi/agent/skills/catacloud/catacloud.sh get-logs '{"and":[{"job_id":{"eq":{"value":"<job_id>"}}}]}'

# Get logs with time range
~/.pi/agent/skills/catacloud/catacloud.sh get-logs '{"and":[{"job_id":{"eq":{"value":"<job_id>"}}},{"timestamp":{"gte":"2026-01-29T10:00:00Z"}},{"timestamp":{"lte":"2026-01-29T11:00:00Z"}}]}'

# Get supervisor logs for a machine
~/.pi/agent/skills/catacloud/catacloud.sh get-logs '{"and":[{"machine_id":{"eq":{"value":"<machine_id>"}}}]}'

# Get platform logs for an instance (admin only)
~/.pi/agent/skills/catacloud/catacloud.sh get-logs '{"and":[{"instance_id":{"eq":{"value":"<instance_id>"}}}]}'

# Filter by level (WARN and above) 
~/.pi/agent/skills/catacloud/catacloud.sh get-logs '{"and":[{"job_id":{"eq":{"value":"<job_id>"}}},{"level":{"gte":"WARN"}}]}'

# OR query: logs from today OR yesterday
~/.pi/agent/skills/catacloud/catacloud.sh get-logs '{"or":[{"and":[{"job_id":{"eq":{"value":"<job_id>"}}},{"timestamp":{"gte":"2026-01-29T10:00:00Z"}}]},{"and":[{"job_id":{"eq":{"value":"<job_id>"}}},{"timestamp":{"gte":"2026-01-28T10:00:00Z"}},{"timestamp":{"lte":"2026-01-28T11:00:00Z"}}]}]}'

# With pagination (limit 50, offset 100)
~/.pi/agent/skills/catacloud/catacloud.sh get-logs '{"and":[{"job_id":{"eq":{"value":"<job_id>"}}}]}' 50 100

# Show current log filters (default level + per-module filters)
~/.pi/agent/skills/catacloud/catacloud.sh get-log-filters

# Set default log level
~/.pi/agent/skills/catacloud/catacloud.sh set-log-filter INFO

# Set per-module log level (enables debug for just one module)
~/.pi/agent/skills/catacloud/catacloud.sh set-log-filter catacloud_core::sagas DEBUG
~/.pi/agent/skills/catacloud/catacloud.sh set-log-filter catacloud_web TRACE

# Clear a specific module filter (reverts to default level)
~/.pi/agent/skills/catacloud/catacloud.sh clear-log-filter catacloud_core::sagas

# Clear ALL module filters
~/.pi/agent/skills/catacloud/catacloud.sh clear-log-filter
```

## Configuration

The skill uses:
- `--host` flag or `CATACLOUD_API_URL` env var for target selection
- JWT token generated from `JWT_SECRET` in the project's `.env` file

## Examples

### Diagnose and fix orphan machines

```bash
# First, diagnose to see the issues
~/.pi/agent/skills/catacloud/catacloud.sh diagnose-pools

# Then fix all orphans
~/.pi/agent/skills/catacloud/catacloud.sh fix-orphans
```

### Check pool capacity

```bash
# See which pools have room for new machines
~/.pi/agent/skills/catacloud/catacloud.sh list-pools | jq '.[] | select(.current_machines < .max_machines)'
```

### Investigate a job failure

```bash
JOB_ID="550e8400-e29b-41d4-a716-446655440000"

# Get all logs for a job
~/.pi/agent/skills/catacloud/catacloud.sh get-logs "{\"and\":[{\"job_id\":{\"eq\":{\"value\":\"$JOB_ID\"}}}]}"

# Get only errors and warnings
~/.pi/agent/skills/catacloud/catacloud.sh get-logs "{\"and\":[{\"job_id\":{\"eq\":{\"value\":\"$JOB_ID\"}}},{\"level\":{\"gte\":\"WARN\"}}]}"

# Get only child process output
~/.pi/agent/skills/catacloud/catacloud.sh get-logs "{\"and\":[{\"job_id\":{\"eq\":{\"value\":\"$JOB_ID\"}}},{\"source\":{\"eq\":{\"value\":\"child\"}}}]}"

# Search for specific error message
~/.pi/agent/skills/catacloud/catacloud.sh get-logs "{\"and\":[{\"job_id\":{\"eq\":{\"value\":\"$JOB_ID\"}}},{\"message\":{\"contains\":{\"value\":\"failed\",\"case_sensitive\":false}}}]}"

# Get logs for a specific time range
~/.pi/agent/skills/catacloud/catacloud.sh get-logs "{\"and\":[{\"job_id\":{\"eq\":{\"value\":\"$JOB_ID\"}}},{\"timestamp\":{\"gte\":\"2026-01-29T10:00:00Z\"}},{\"timestamp\":{\"lte\":\"2026-01-29T11:00:00Z\"}}]}"
```

### Adjust runtime log levels

```bash
# Check current filter configuration
~/.pi/agent/skills/catacloud/catacloud.sh get-log-filters

# Enable debug for a specific module
~/.pi/agent/skills/catacloud/catacloud.sh set-log-filter catacloud_core::sagas DEBUG

# Set default log level
~/.pi/agent/skills/catacloud/catacloud.sh set-log-filter INFO

# Clear module filter
~/.pi/agent/skills/catacloud/catacloud.sh clear-log-filter catacloud_core::sagas
```
