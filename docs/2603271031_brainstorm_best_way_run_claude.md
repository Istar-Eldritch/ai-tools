# Brainstorm: Best way to run Claude Code with safety guarantees against bricking the computer while minimizing permission prompts - Docker, sandboxing, and other approaches

**Status**: Draft
**Created**: 2026-03-27T10:31:58Z
**Timestamp**: 2603271031

## Problem / Opportunity

Claude Code's bash tool and subagents can cause irreversible damage: deleting files outside the project directory, installing software system-wide, leaking credentials from ~/.ssh or ~/.aws to network calls, or quietly modifying shell configs. The threat model is accidental misuse by a capable but context-unaware agent — not an adversarial attacker. The opportunity is to run Claude Code inside a kernel-enforced boundary that prevents these failure modes structurally, without requiring the agent's cooperation, while keeping startup friction low enough that developers actually use it.

## Context & Background

Claude Code runs as the user's own process. Every child process it spawns — bash tool invocations, subagent calls, build toolchains — inherits the full filesystem and environment of the user's shell. There is no built-in containment. Current mitigations are purely cooperative: prompt instructions like "don't delete things outside this directory." This works until it doesn't.

The project already has a skills system (ai_tools repo) and a conventions-over-configuration ethos. The desired solution should integrate with that, live in the same repo, and feel like a natural extension of the existing workflow rather than a separate infrastructure project.

Constraints: Linux developer machines only (acceptable tradeoff). Single-developer use initially. Must not require a daemon, root, or image management.

## Proposed Directions

- **Option A: bwrap (bubblewrap) — SELECTED**
  - Description: Wrap the `claude` invocation in a bubblewrap namespace. The sandbox config (a TOML profile) declares which paths are mounted read-write, read-only, or excluded. Claude Code and all its child processes inherit the namespace. A small Rust CLI binary reads the config and executes `bwrap` with the assembled flags.
  - Pros: Kernel-level enforcement (Linux namespaces), ~50ms startup overhead, no daemon, no root required, inherits to all child processes automatically, structural rather than cooperative, single binary with zero runtime dependencies, composable profile system maps well to different dev personas (rust-dev, java-dev, debug)
  - Cons: Linux only — no macOS support, bwrap must be installed on the machine, requires understanding of mount namespace semantics to author profiles correctly

- **Option B: Docker**
  - Description: Run Claude Code inside a Docker container with volume mounts for the project directory.
  - Pros: Familiar abstraction, strong isolation, works on macOS
  - Cons: Image rebuild friction whenever environment changes, requires Docker daemon running, interactive terminal sessions have impedance mismatch with container stdio, credential forwarding is awkward, startup latency, cognitive overhead for a single interactive process

- **Option C: Docker Compose**
  - Description: Define the Claude Code environment as a service in a compose file.
  - Pros: Declarative, version-controllable
  - Cons: Multi-service orchestration tool applied to a single interactive process — wrong abstraction entirely, adds complexity without adding value over plain Docker

- **Option D: Nix Flakes**
  - Description: Define a reproducible shell environment using Nix, providing hermetic dependency closure.
  - Pros: Technically correct, reproducible across machines, strong isolation of toolchain
  - Cons: Steep learning curve for anyone not already in the Nix ecosystem, large infrastructure investment, solves reproducibility more than safety boundary enforcement, would be a project in itself

- **Option E: Claude Skill (cooperative)**
  - Description: Implement safety checks as a Claude skill that audits or pre-approves operations.
  - Pros: No system-level changes, composable with skill system
  - Cons: Chicken-and-egg — the skill runs inside the same process with the same permissions, cooperative safety can be reasoned around by a sufficiently confused agent, cannot sandbox retroactively

- **Option F: Python or Bash CLI wrapper**
  - Description: Script the bwrap invocation in Python or Bash instead of Rust.
  - Pros: Faster to prototype
  - Cons: Python suffers from version drift across machines even for stdlib-only scripts; Bash TOML parsing is ugly, error handling is fragile, unreadable at scale past ~100 lines. Rust compiles to a single binary, copy-anywhere, zero runtime dependency concerns.

## Architecture Decisions (for selected approach)

**Profile format**: TOML files in `ai_tools/sandboxes/`. Named profiles (rust-dev, java-dev, debug) define bwrap mount rules. Start monolithic; extract composability (mixins, inheritance) only after months of real usage reveal the right abstraction boundaries.

**Per-project config**: `.claude/sandbox.toml` in the project root declares semantic intent — which profile to use, which skills to activate, which extra paths to mount. Named by semantic role (`skills = ["jira", "linear"]`), resolved from ai_tools at launch time. Portable across machines.

**Machine-local config**: `~/.config/claude-sandbox/paths.toml` resolves machine-specific path values. Schema splits `[tools]` (where is ai_tools?) from `[paths]` (machine-local mount targets). Separates portable intent from machine-specific location.

**Deny-list**: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh` and similar credential paths are blocked from mounting regardless of profile declarations.

**Env var whitelist**: Only `ANTHROPIC_API_KEY`, `TERM`, `COLORTERM`, `LANG`, `LC_ALL`, `HOME` forwarded into sandbox. All other env vars require explicit opt-in to prevent ambient credential leaking.

**Build cache mounts**: `.cargo/registry`, `.m2/repository`, and equivalent caches mounted read-only. Cache hits without cache poisoning.

**CLI design**: Independent Rust binary, globally in PATH. Fail-closed — refuses to launch without a valid, resolvable config. Passthrough design: the wrapper reads config silently, then all remaining CLI args pass through to `claude` unmodified. Subcommands: `setup` (machine bootstrap), `init` (project scaffold), `check` (validate config without launching), `list-profiles` (enumerate available profiles). Optional shell function to shadow the bare `claude` command.

**Bootstrap flow**: setup (machine, one-time) → init (project, one-time) → use (daily).

**Escape hatch philosophy**: The sandbox is an audit trail as much as a hard barrier. When an agent needs a tool not in scope, the acquisition becomes visible (bwrap blocks it or the config must be explicitly widened). Appropriate for accidental misuse threat model — not trying to defeat a determined attacker.

## Out of Scope

- macOS support (sandbox namespaces are Linux-specific; a macOS path would require a separate mechanism)
- Multi-user or shared-machine scenarios
- Network isolation (not part of the current threat model; filesystem and credential scope is the focus)
- Adversarial threat model (containment against a deliberately malicious agent is a different and harder problem)
- Profile composability / inheritance (intentionally deferred; start monolithic, extract after real usage)
- Automated profile generation from project manifests
- Integration with CI/CD pipelines

## Open Questions

1. **bwrap availability**: Should `setup` install bwrap automatically (e.g., via apt/dnf), or require it as a precondition and emit a clear error?
2. **Profile versioning**: When a profile changes in ai_tools, projects pinned to it silently get new behavior. Should profiles be versioned or pinned by hash?
3. **Skill path resolution**: If ai_tools is not at the canonical machine path, who is responsible for the mapping — the user editing paths.toml, or an auto-detection heuristic in `setup`?
4. **Read-write project root boundary**: Should the RW mount be strictly the git root, the directory containing `.claude/sandbox.toml`, or configurable? Edge cases with monorepos.
5. **Secret opt-in**: Is `ANTHROPIC_API_KEY` safe to forward given network isolation is out of scope? If the agent can make outbound network calls, key forwarding is still an exposure surface.
6. **Shadow function adoption**: If the shell function shadows `claude`, unsandboxed invocations become impossible without editing shell config. Is that the right default or opt-in?
7. **Windows/macOS future**: Is the Linux-only constraint permanent, or should the CLI design anticipate a platform abstraction layer even if only one backend exists today?

## Rough Scope Assessment

**Epic-level effort** (~2–4 weeks for a working, integrated v1).

- Core Rust binary with TOML parsing, bwrap flag assembly, and passthrough launch: 300–400 lines, ~2–3 days
- Profile library (rust-dev, java-dev, debug, minimal): 1–2 days of iteration per profile with real usage testing
- `setup` / `init` / `check` subcommands with good error messages: 1–2 days
- Machine-local paths.toml schema and resolution logic: 1 day
- Deny-list and env var whitelist implementation and testing: 1 day
- Integration with existing ai_tools skills system (name-to-path resolution): 1–2 days
- Real-world validation: running actual Claude Code sessions against the profiles, finding and fixing edge cases in mount configuration: ongoing, 1–2 weeks

The implementation is deliberately scoped small. The long tail is profile authoring and edge-case discovery, not the binary itself.
