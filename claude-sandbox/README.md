# claude-sandbox

A bubblewrap (`bwrap`) filesystem sandbox for running Claude Code with restricted host access. Mounts only the paths a project needs, blocks credential directories, and clears the environment to a known-safe whitelist.

## Prerequisites

- Linux with user namespaces enabled (macOS and Windows are not supported)
- [bubblewrap](https://github.com/containers/bubblewrap) installed (`apt install bubblewrap`)
- Claude Code CLI (`claude`) installed and on `$PATH`
- Rust toolchain (to build from source)

Build:

```sh
cd claude-sandbox
cargo build --release
```

## Quick Start

**1. Run first-time setup:**

```sh
claude-sandbox setup
```

This verifies `bwrap` is installed and creates the machine config at `~/.config/claude-sandbox/paths.toml`.

**2. Initialize a project:**

```sh
cd /path/to/your/project
claude-sandbox init
```

This creates `.claude/sandbox.toml` with the `minimal` profile.

**3. Run Claude inside the sandbox:**

```sh
claude-sandbox run
```

Or pass arguments through to Claude:

```sh
claude-sandbox run -- --model opus -p "explain this repo"
```

**Shell alias (recommended):**

Add to your shell profile (`.bashrc`, `.zshrc`, etc.):

```sh
eval "$(claude-sandbox setup --shell-function)"
```

This defines a shell function that shadows `claude`:

```sh
claude() { claude-sandbox run -- "$@"; }
```

## CLI Reference

`run` is the default command when no subcommand is given.

### `run`

Run Claude inside a sandbox (default when no subcommand given).

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the bwrap command that would be executed, then exit |
| `--profile <NAME>` | Override the sandbox profile to use |
| `-- <ARGS>...` | Arguments to pass through to Claude |

```sh
claude-sandbox run --dry-run
claude-sandbox run --profile development -- -p "hello"
claude-sandbox -- -p "hello"          # run is implicit
```

### `setup`

Interactive first-time setup.

| Flag | Description |
|------|-------------|
| `--shell-function` | Print a shell function that shadows `claude` with `claude-sandbox run --` |

### `init`

Initialize a project-level sandbox config.

| Flag | Description |
|------|-------------|
| `--profile <NAME>` | Set the default sandbox profile (defaults to "minimal") |

### `check`

Check that the sandbox environment is correctly configured.

| Flag | Description |
|------|-------------|
| `--profile <NAME>` | Override the sandbox profile to check |

### `list-profiles`

List available sandbox profiles. No flags.

## Configuration

Configuration is a 3-layer system. Each layer is a TOML file loaded at a different scope.

### Layer 1: Sandbox profile (repository-level, shared)

Located in the `sandboxes/` directory of the ai\_tools repository (e.g., `sandboxes/minimal.toml`). Defines what the sandbox mounts.

```toml
description = "Minimal sandbox for basic Claude Code usage"
rw_paths = ["~/.claude/"]
ro_paths = ["/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc/resolv.conf", "/etc/hosts", "/etc/ssl", "~/code/ai_tools"]
excluded_paths = []
env = []
```

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable description |
| `rw_paths` | string array | Paths mounted read-write |
| `ro_paths` | string array | Paths mounted read-only |
| `excluded_paths` | string array | Paths that must never be mounted (overrides rw/ro) |
| `env` | string array | Extra environment variables (`"VAR=value"` or `"VAR"`) |

### Layer 2: Project config (per-project)

Located at `.claude/sandbox.toml` in the project root.

```toml
profile = "minimal"

# [[extra_paths]]
# path = "/opt/tools"
# mode = "ro"

extra_env = []
```

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `profile` | string | Name of the sandbox profile to use (default: `"minimal"`) |
| `extra_paths` | array of `{path, mode}` | Additional paths to mount (`mode` is `"ro"` or `"rw"`) |
| `extra_env` | string array | Additional environment variables to pass through |

### Layer 3: Machine config (per-machine)

Located at `~/.config/claude-sandbox/paths.toml`. Created by `claude-sandbox setup`.

```toml
[tools]
ai_tools = "/home/user/code/ai_tools"

[paths]
```

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `tools.ai_tools` | string | Path to the ai\_tools repository (required) |
| `paths` | key-value map | Additional machine-specific named paths |

## Security Model

### Excluded paths

Profiles can define `excluded_paths` to block specific paths from being mounted. Any attempt to mount an excluded path (via profile `ro_paths`, `rw_paths`, or project `extra_paths`) results in an error. The implicit `~/.claude/` mount is never blocked by excluded paths.

### Environment variable whitelist

The sandbox clears all environment variables (`--clearenv`) and re-exports only these defaults:

- `ANTHROPIC_API_KEY`
- `TERM`
- `COLORTERM`
- `LANG`
- `LC_ALL`
- `HOME`
- `PATH`
- `USER`
- `SHELL`

Profile `env` and project `extra_env` entries are appended to this list.

### Fail-closed design

- Machine config (`paths.toml`) **must exist** before the sandbox will run. If missing, `claude-sandbox` exits with an error directing you to run `setup`.
- Project config (`.claude/sandbox.toml`) **must exist** in the detected project root. If missing, `claude-sandbox` exits with an error directing you to run `init`.

### Namespace isolation

The sandbox uses these bwrap namespace flags:

- `--unshare-user` -- separate user namespace
- `--unshare-pid` -- separate PID namespace
- `--unshare-uts` -- separate UTS (hostname) namespace
- `--die-with-parent` -- kill sandbox if parent exits

System mounts provided automatically: `--proc /proc`, `--dev /dev`, `--tmpfs /tmp`.

### Implicit mounts

These paths are **always mounted read-write** regardless of profile, so Claude can read its config and write session state:

- `~/.claude/`
- `~/.claude.json`
- The detected project root directory

The `~/.claude/` implicit mount is exempt from `excluded_paths` enforcement.

### Excluded paths

A profile's `excluded_paths` list prevents those paths from being mounted even if they appear in `ro_paths`, `rw_paths`, or project `extra_paths`. This is enforced at argument assembly time.

### Claude binary auto-mount

The directories containing the `claude` binary (and its symlink targets) are automatically mounted read-only so the sandbox can execute it.

## Creating Custom Profiles

1. Create a new TOML file in the `sandboxes/` directory:

```toml
# sandboxes/development.toml
description = "Development sandbox with extra tooling"
rw_paths = ["~/.claude/", "~/.cargo/registry"]
ro_paths = ["/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc/resolv.conf", "/etc/hosts", "/etc/ssl"]
excluded_paths = []
env = ["RUST_LOG=debug"]
```

2. Use it in a project by setting the profile in `.claude/sandbox.toml`:

```toml
profile = "development"
```

Or override at runtime:

```sh
claude-sandbox run --profile development
```

3. Verify with:

```sh
claude-sandbox check --profile development
claude-sandbox run --dry-run --profile development
```

List all available profiles:

```sh
claude-sandbox list-profiles
```

## Troubleshooting

**`bwrap not found`**

Install bubblewrap: `apt install bubblewrap` (Debian/Ubuntu) or the equivalent for your distribution.

**`Machine config not found`**

Run `claude-sandbox setup` to create `~/.config/claude-sandbox/paths.toml`.

**`No sandbox.toml found`**

Run `claude-sandbox init` in your project directory to create `.claude/sandbox.toml`.

**`machine.tools.ai_tools is not configured`**

Edit `~/.config/claude-sandbox/paths.toml` and set `tools.ai_tools` to the absolute path of the ai\_tools repository.

**`Profile 'X' not found`**

Verify the profile TOML exists at `<ai_tools>/sandboxes/X.toml`. Run `claude-sandbox list-profiles` to see available profiles.

**`excluded by profile`**

A path listed in the profile's `excluded_paths` was referenced in `ro_paths`, `rw_paths`, or `extra_paths`. Remove the conflict.

**`warning: skipping non-existent path`**

A configured path does not exist on the host. The sandbox continues without it. Verify the path or remove it from the config.

**Debugging the bwrap invocation:**

```sh
claude-sandbox run --dry-run
```

This prints the full bwrap command line without executing it.
