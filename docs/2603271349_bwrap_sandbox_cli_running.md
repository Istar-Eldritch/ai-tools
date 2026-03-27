# bwrap sandbox CLI for running Claude Code with filesystem safety guarantees

**Status**: Draft
**Created**: 2026-03-27T13:49:04Z
**Timestamp**: 2603271349

---

## PART I: Requirements

### Problem Statement

Claude Code runs as the user's own process. Every child process it spawns — bash tool invocations, subagent calls, build toolchains, MCP servers, hook scripts — inherits the full filesystem and environment of the user's shell. There is no built-in containment. Current mitigations are purely cooperative (prompt instructions), which fail when an agent is capable but context-unaware.

The threat model is **accidental misuse** — not adversarial attack. Failure modes include: deleting files outside the project directory, installing software system-wide, leaking credentials from `~/.ssh` or `~/.aws` to network calls, and silently modifying shell configs.

The solution wraps the `claude` invocation in a bubblewrap (bwrap) namespace, enforcing filesystem boundaries at the kernel level. All child processes — including MCP servers and hook scripts — inherit the namespace automatically.

### Requirements

**R1: bwrap namespace sandboxing**
Wrap the `claude` process in a bwrap mount namespace. The project directory is mounted read-write; everything else follows the active profile's mount rules. The namespace is inherited by all child processes (MCP servers, hooks, build tools, subagents).

**R2: TOML profile system**
Sandbox profiles are TOML files in `ai_tools/sandboxes/`. Each profile declares:
- Read-write bind mounts (project root, `~/.claude/`, tmp)
- Read-only bind mounts (toolchains, build caches, system paths)
- Paths that are explicitly excluded/blocked
- Additional environment variables to forward

Initial profiles: `minimal`, `rust-dev`, `java-dev`, `debug`.

**R3: Per-project configuration**
`.claude/sandbox.toml` in the project root declares:
- `profile` — which sandbox profile to use (e.g., `"rust-dev"`)
- `extra_paths` — additional bind mounts beyond the profile defaults
- `extra_env` — additional environment variables to forward

Portable across machines; machine-specific paths resolved separately.

**R4: Machine-local path resolution**
`~/.config/claude-sandbox/paths.toml` resolves machine-specific values:
- `[tools]` section: path to `ai_tools` repo
- `[paths]` section: machine-local mount targets (e.g., custom toolchain locations)

Separates portable intent (project config) from machine-specific location.

**R5: Credential deny-list**
The following paths are **always blocked** from mounting, regardless of profile declarations:
- `~/.ssh`
- `~/.gnupg`
- `~/.aws`
- `~/.config/gh`
- `~/.config/gcloud`

The deny-list is hardcoded in the binary, not configurable.

**R6: ~/.claude/ as monolithic read-write mount**
`~/.claude/` is mounted read-write as a single bind mount. No fine-grained per-subdirectory controls. Claude Code needs full read-write access to its own operational data (sessions, settings, history, plugins, tasks). The threat model protects the host filesystem — not Claude from itself.

**R7: Environment variable whitelist**
Only these variables are forwarded by default: `ANTHROPIC_API_KEY`, `TERM`, `COLORTERM`, `LANG`, `LC_ALL`, `HOME`, `PATH`, `USER`, `SHELL`. All other env vars require explicit opt-in via profile or project config `extra_env`.

**R8: System path mounts**
Profiles must mount essential system paths for Claude Code to function:
- `/proc` (proc filesystem)
- `/dev` (device nodes — at minimum `/dev/null`, `/dev/zero`, `/dev/urandom`, `/dev/tty`)
- `/tmp` (tmpfs, private to the namespace)
- `/usr`, `/lib`, `/lib64`, `/bin`, `/sbin` (read-only, for system binaries)
- `/etc/resolv.conf`, `/etc/hosts`, `/etc/ssl` (read-only, for DNS and TLS)

**R9: CLI binary design**
Independent Rust binary (`claude-sandbox`), installed globally in PATH. Subcommands:
- `claude-sandbox run [-- claude-args...]` — launch Claude Code in sandbox (default if no subcommand)
- `claude-sandbox setup` — one-time machine bootstrap (verify bwrap, create `~/.config/claude-sandbox/`)
- `claude-sandbox init` — scaffold `.claude/sandbox.toml` in current project
- `claude-sandbox check` — validate config without launching (dry-run of mount assembly)
- `claude-sandbox list-profiles` — enumerate available profiles from ai_tools

**R10: Fail-closed behavior**
The binary refuses to launch if:
- bwrap is not installed
- No valid `.claude/sandbox.toml` exists (or is not resolvable)
- The referenced profile does not exist
- `~/.config/claude-sandbox/paths.toml` is missing or invalid
- A deny-listed path appears in the mount list

Clear error messages guide the user to fix each condition.

**R11: Passthrough design**
All CLI arguments after `--` (or after the `run` subcommand) pass through to `claude` unmodified. The sandbox wrapper is invisible to Claude Code — it just changes the filesystem namespace.

**R12: Shadow function (opt-in)**
An optional shell function can shadow the bare `claude` command to route through `claude-sandbox`. Generated by `claude-sandbox setup --shell-function` and printed to stdout for the user to add to their shell config. Not installed automatically.

**R13: Project root detection**
The read-write project mount uses `git rev-parse --show-toplevel` to find the git root. Falls back to the directory containing `.claude/sandbox.toml` if not in a git repo.

**R14: Build cache mounts**
Profiles mount build caches read-only to enable cache hits without cache poisoning:
- `~/.cargo/registry` (Rust)
- `~/.m2/repository` (Java/Maven)
- Other caches as declared per profile

### Success Criteria

- SC1: Claude Code launches and completes a full interactive session inside the sandbox with no functional regressions
- SC2: `rm -rf ~/` from a bash tool invocation inside the sandbox fails to affect the host filesystem outside the project root
- SC3: `cat ~/.ssh/id_rsa` from inside the sandbox returns "No such file or directory"
- SC4: MCP servers (e.g., rust-analyzer) function correctly within the sandbox using profile-provided mounts
- SC5: `claude-sandbox check` validates and reports all mount rules without launching
- SC6: A new project can go from zero to sandboxed in under 2 minutes (`setup` + `init`)
- SC7: Startup overhead is under 100ms compared to bare `claude` invocation
- SC8: Hook scripts (formatters, test runners) execute correctly within the namespace

### Out of Scope

- **macOS / Windows support** — bwrap uses Linux namespaces; other platforms need different mechanisms
- **Multi-user / shared-machine scenarios** — single-developer use only
- **Network isolation** — not part of the current threat model; filesystem and credential scope is the focus
- **Adversarial threat model** — containment against deliberately malicious agents is a different problem
- **Profile composability / inheritance** — start monolithic; extract after real usage reveals boundaries
- **Automated profile generation** from project manifests (Cargo.toml, pom.xml, etc.)
- **CI/CD integration**

### Open Questions

1. **bwrap version requirements** — What minimum bwrap version is needed? Some older distro packages lack `--die-with-parent`.
2. **Symlink handling** — If the project directory contains symlinks pointing outside the mount namespace, should the sandbox resolve them (mount targets) or let them dangle?
3. **Signal forwarding** — Does bwrap correctly forward SIGTERM/SIGINT to Claude Code for graceful shutdown, or does the wrapper need explicit signal handling?

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Rust project scaffold, CLI argument parsing (clap), TOML config loading | 1 day |
| Phase 2 | bwrap flag assembly from profile — mount rules, /proc, /dev, /tmp, system paths | 2 days |
| Phase 3 | Deny-list enforcement, env var whitelist filtering, fail-closed validation | 1 day |
| Phase 4 | `setup` subcommand — bwrap detection, paths.toml scaffold, shell function generation | 1 day |
| Phase 5 | `init` and `check` subcommands — project config scaffold, dry-run validation | 1 day |
| Phase 6 | Profile library — minimal, rust-dev, java-dev, debug profiles with real-world testing | 2 days |
| Phase 7 | Integration testing — full Claude Code sessions, MCP servers, hooks, edge cases | 2 days |

**Total estimated effort**: ~10 days
