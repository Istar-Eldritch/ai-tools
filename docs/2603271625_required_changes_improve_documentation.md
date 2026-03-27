# the required changes to improve documentation

**Status**: Draft
**Created**: 2026-03-27T16:25:45Z
**Timestamp**: 2603271625

---

## PART I: Requirements

### Problem Statement

claude-sandbox is a fully implemented, production-ready Rust CLI tool that wraps Claude Code execution in a bubblewrap (bwrap) Linux namespace sandbox. It has comprehensive test coverage (unit tests across all modules, integration tests in `tests/`) and a complete feature set: 5 CLI commands, a 3-layer configuration system, a deny-list security model, and environment variable whitelisting. Despite this, the tool has zero user-facing documentation -- no README in the `claude-sandbox/` crate, and no mention in the main `README.md`. A new user encountering this codebase cannot determine how to install, configure, or use the sandbox without reading the source code.

### Requirements

**R1: Create `claude-sandbox/README.md` with 8 sections**

The README must contain exactly these sections:

1. **Overview** -- What claude-sandbox is (a bwrap-based filesystem sandbox for Claude Code on Linux), what problem it solves (preventing Claude from accessing sensitive files, credentials, and unrelated parts of the filesystem), and the one-sentence value proposition.

2. **Prerequisites** -- Required software: Linux (kernel namespace support), bubblewrap (`apt install bubblewrap`), Claude Code (`claude` binary on PATH), Rust toolchain (for building from source). Note that macOS and Windows are not supported.

3. **Quick Start** -- A 3-step workflow with exact commands:
   - Step 1: `claude-sandbox setup` (creates `~/.config/claude-sandbox/paths.toml`, verifies bwrap)
   - Step 2: `claude-sandbox init` (creates `.claude/sandbox.toml` in the project root)
   - Step 3: `claude-sandbox run` (launches Claude inside the sandbox)
   - Include the shell alias: `eval "$(claude-sandbox setup --shell-function)"`

4. **CLI Reference** -- All 5 commands with their flags and behavior:
   - `run [--dry-run] [--profile <name>] [-- <claude-args>...]` -- Launch Claude in the sandbox. `--dry-run` prints the bwrap command without executing. `--profile` overrides the project config's profile. `-- <args>` passes arguments through to claude. This is the default command when no subcommand is given.
   - `setup [--shell-function]` -- One-time machine setup. Verifies bwrap is installed, creates `~/.config/claude-sandbox/paths.toml` with auto-detected `ai_tools` path. `--shell-function` prints a shell function (`claude() { claude-sandbox run -- "$@"; }`) for shadowing the `claude` command.
   - `init [--profile <name>]` -- Initialize project sandbox config. Creates `.claude/sandbox.toml` in the detected project root (git root or upward walk). `--profile` sets the default profile (defaults to `minimal`). Idempotent -- skips if file already exists.
   - `check [--profile <name>]` -- Validate sandbox configuration without running. Verifies bwrap availability, resolves and validates config, reports profile name, project root, mount count, and env var count.
   - `list-profiles` -- List all available sandbox profiles from the `sandboxes/` directory with their descriptions.

5. **Configuration** -- The 3-layer configuration system with TOML examples for each layer:
   - **Layer 1: Sandbox profiles** (`sandboxes/<name>.toml`) -- Define filesystem mount rules. Fields: `description` (string), `rw_paths` (list of read-write mount paths), `ro_paths` (list of read-only mount paths), `excluded_paths` (list of paths to block even if otherwise allowed), `env` (list of extra environment variables). Include the full `minimal.toml` as an example.
   - **Layer 2: Project config** (`.claude/sandbox.toml`) -- Per-project overrides. Fields: `profile` (string, defaults to `"minimal"`), `extra_paths` (list of `{path, mode}` entries where mode is `"ro"` or `"rw"`), `extra_env` (list of environment variable pass-throughs). Include an example showing `extra_paths` and `extra_env` usage.
   - **Layer 3: Machine config** (`~/.config/claude-sandbox/paths.toml`) -- Machine-specific paths. Sections: `[tools]` with `ai_tools` pointing to the ai_tools repo, `[paths]` for additional machine-specific path mappings. Include an example.
   - Document the resolution order: machine config is loaded first (required; fail-closed if missing), then project config is loaded, then profile is loaded using the name from project config (or `--profile` override). All layers merge into a `ResolvedConfig`.

6. **Security Model** -- Document all security mechanisms:
   - **Deny-list**: Hard-coded credential paths that are never mountable regardless of profile or project config: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.config/gcloud`. Applies to exact matches and all subdirectories. Cannot be overridden.
   - **Environment whitelist**: `--clearenv` strips all environment variables. Only these are passed through: `ANTHROPIC_API_KEY`, `TERM`, `COLORTERM`, `LANG`, `LC_ALL`, `HOME`, `PATH`, `USER`, `SHELL`. Profiles and project configs can add more via `env` and `extra_env`.
   - **Fail-closed design**: Missing machine config is an error (not a silent default). Missing project config is an error with a helpful message pointing to `claude-sandbox init`. Missing bwrap binary is caught before any sandbox assembly.
   - **Namespace isolation**: `--unshare-user`, `--unshare-pid`, `--unshare-uts`, `--die-with-parent`. Process and user namespace isolation. Sandbox processes die when the parent exits.
   - **Implicit mounts**: `~/.claude/` and `~/.claude.json` are always mounted read-write (Claude needs its config/session state). The project root is always mounted read-write. `/proc`, `/dev`, `/tmp` are provided as virtual filesystems.
   - **Excluded paths**: Profiles can define `excluded_paths` to block specific paths even if they appear in `ro_paths`, `rw_paths`, or `extra_paths`. Exception: `~/.claude/` is never blocked by `excluded_paths`.

7. **Creating Custom Profiles** -- How to create a new profile:
   - Create a TOML file in `sandboxes/<name>.toml`
   - Define the 5 fields (`description`, `rw_paths`, `ro_paths`, `excluded_paths`, `env`)
   - Use tilde (`~`) for home-relative paths
   - Reference it via `--profile <name>` or set it in `.claude/sandbox.toml`
   - Include a realistic example profile (e.g., a Node.js development profile)

8. **Troubleshooting** -- Common issues and solutions:
   - "bwrap not found" -- Install bubblewrap
   - "Machine config not found" -- Run `claude-sandbox setup`
   - "No sandbox.toml found" -- Run `claude-sandbox init`
   - "credential path and cannot be mounted" -- A deny-listed path was referenced; remove it from the profile or project config
   - "excluded by profile" -- The path is in the profile's `excluded_paths`; remove it or use a different profile
   - "Could not find the `claude` binary" -- Ensure Claude Code is installed and `claude` is on PATH
   - Debugging with `--dry-run` -- Print the full bwrap command to inspect mounts and env vars

**R2: Update main `README.md`**

- Add `claude-sandbox/` and `sandboxes/` to the directory structure diagram
- Add a "Claude Sandbox" section (after "Skills", before "Plane CLI") with a brief description and link to `claude-sandbox/README.md`
- Remove the "Plane CLI" section entirely (the `plane/` directory is not part of the current repo focus)

**R3: Document only what exists today**

- The only available profile is `minimal` -- do not document rust-dev, java-dev, debug, or any other planned profiles as if they exist
- Do not reference features that are not implemented (e.g., network namespace isolation, profile inheritance)
- Custom profile examples should be clearly labeled as examples, not as shipped profiles

### Success Criteria

- **SC1**: A new user can go from zero to running Claude in a sandbox by following the Quick Start section -- the 3-step workflow (`setup` -> `init` -> `run`) must be complete and correct
- **SC2**: All 5 CLI commands (`run`, `setup`, `init`, `check`, `list-profiles`) are documented with every flag, default behavior, and at least one usage example each
- **SC3**: The 3-layer config system (profile TOML, project TOML, machine TOML) is explained with a concrete TOML example for each layer and the resolution/merge order is documented
- **SC4**: The security model is documented: deny-list paths are listed, env whitelist variables are listed, fail-closed behavior is explained, namespace flags are listed
- **SC5**: The main README directory structure matches reality (includes `claude-sandbox/` and `sandboxes/`, no stale entries)

### Out of Scope

- Documenting planned but unimplemented profiles (rust-dev, java-dev, debug)
- Architecture diagrams or visual aids
- Performance benchmarks or comparison with other sandboxing tools
- macOS or Windows support documentation
- API documentation or rustdoc generation
- CI/CD pipeline documentation
- Contributing guidelines specific to claude-sandbox

---

## PART II: Implementation Plan

### Target Audience

Experienced developers who already use Claude Code on Linux. They are comfortable with CLI tools, TOML configuration, and Linux concepts like namespaces and bind mounts. They do not need hand-holding but do need precise, example-driven reference material.

### Tone and Style

- Concise and technical -- no marketing language
- Example-driven -- every concept gets a concrete code/config/command example
- Imperative voice for instructions ("Run `claude-sandbox setup`", not "You should run...")
- Fenced code blocks with language annotations for all examples
- No emojis

### Phase 1: Create `claude-sandbox/README.md`

**Effort**: 1 day

**Deliverable**: A single Markdown file at `claude-sandbox/README.md` containing all 8 sections defined in R1.

**Content sources** (all information must come from the existing codebase, not invented):

| Section | Primary source files |
|---------|---------------------|
| Overview | `claude-sandbox/Cargo.toml`, `cli.rs` (about string) |
| Prerequisites | `bwrap.rs` (verify_bwrap_available), `run.rs` (resolve_claude_path) |
| Quick Start | `setup.rs` (execute flow), `init.rs` (execute flow), `run.rs` (execute flow) |
| CLI Reference | `cli.rs` (all Args structs and doc comments) |
| Configuration | `config.rs` (all structs, load functions, resolve_config), `sandboxes/minimal.toml`, `init.rs` (default_sandbox_toml) |
| Security Model | `bwrap.rs` (CREDENTIAL_DENY_LIST, DEFAULT_ENV_WHITELIST, assemble_args namespace flags, check_deny_list, check_excluded_paths) |
| Creating Custom Profiles | `config.rs` (SandboxProfile struct), `sandboxes/minimal.toml` (as template) |
| Troubleshooting | `bwrap.rs`, `config.rs`, `run.rs` (all error messages) |

**Key details to get right**:

- The `minimal.toml` profile content must be reproduced exactly as it exists in `sandboxes/minimal.toml`
- The deny-list must list exactly these 5 paths: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.config/gcloud`
- The env whitelist must list exactly these 9 variables: `ANTHROPIC_API_KEY`, `TERM`, `COLORTERM`, `LANG`, `LC_ALL`, `HOME`, `PATH`, `USER`, `SHELL`
- The namespace flags must list exactly: `--unshare-user`, `--unshare-pid`, `--unshare-uts`, `--die-with-parent`
- The shell function must be exactly: `claude() { claude-sandbox run -- "$@"; }`
- Project root detection order: git rev-parse, upward walk for `.claude/sandbox.toml`, fallback to cwd
- The `run` command is the default when no subcommand is given (from `Option<Commands>` in cli.rs)

### Phase 2: Update main `README.md`

**Effort**: 0.5 days

**Deliverable**: Updated `README.md` at the repo root.

**Changes**:

1. **Update directory structure** -- Replace the current structure block with:
   ```
   ai_tools/
   ├── extensions/       # Pi extensions (add commands and tools)
   ├── skills/           # Pi skills (instruction files for specific tasks)
   ├── claude-sandbox/   # Claude Code bwrap sandbox CLI (Rust)
   ├── sandboxes/        # Sandbox profile definitions (TOML)
   └── prompts/          # Reusable prompt templates
   ```

2. **Add Claude Sandbox section** -- Insert after the Skills section, before Installation. Content:
   - One-paragraph description: what it is, what it does, Linux-only
   - Link to `claude-sandbox/README.md` for full documentation
   - The 3-command Quick Start snippet (`setup`, `init`, `run`)

3. **Remove Plane CLI section** -- Delete the "Plane CLI" heading and its content ("A Rust CLI tool for interacting with Plane.so project management. See [plane/README.md](plane/README.md) for details."). Also remove `plane/` from the directory structure if present.

### Verification Checklist

After implementation, verify:

- [ ] `claude-sandbox/README.md` exists and renders correctly in GitHub Markdown
- [ ] All 5 commands appear in CLI Reference with all flags from `cli.rs`
- [ ] `minimal.toml` content in the README matches `sandboxes/minimal.toml` exactly
- [ ] Deny-list paths match `CREDENTIAL_DENY_LIST` in `bwrap.rs` exactly
- [ ] Env whitelist matches `DEFAULT_ENV_WHITELIST` in `bwrap.rs` exactly
- [ ] Namespace flags match `assemble_args` in `bwrap.rs` exactly
- [ ] Shell function matches `SHELL_FUNCTION` in `setup.rs` exactly
- [ ] Main README directory structure includes `claude-sandbox/` and `sandboxes/`
- [ ] Main README has no Plane CLI section
- [ ] No references to unimplemented profiles or features
- [ ] All TOML examples parse correctly (validate with `toml` crate or online parser)
