//! Phase 7: Integration tests — end-to-end workflows, edge cases, error messages.
//!
//! These tests exercise the full pipeline (config loading -> validation -> bwrap
//! assembly) using temporary directories with realistic config layouts, without
//! requiring a running bwrap or Claude Code instance.

use claude_sandbox::bwrap::{assemble_args, expand_tilde, validate};
use claude_sandbox::config::*;
use serial_test::serial;
use std::collections::HashMap;
use std::path::PathBuf;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Build a ResolvedConfig from parts, using the given ai_tools dir.
fn make_resolved_with_machine(
    profile_name: &str,
    profile: SandboxProfile,
    project: ProjectConfig,
    machine: MachineConfig,
    project_root: PathBuf,
) -> ResolvedConfig {
    ResolvedConfig {
        profile_name: profile_name.to_string(),
        profile,
        project,
        machine,
        project_root,
    }
}

/// Build a ResolvedConfig with a default (empty) MachineConfig.
fn make_resolved(
    profile_name: &str,
    profile: SandboxProfile,
    project: ProjectConfig,
    project_root: PathBuf,
) -> ResolvedConfig {
    make_resolved_with_machine(
        profile_name,
        profile,
        project,
        MachineConfig::default(),
        project_root,
    )
}

/// Create a temporary "ai_tools" tree with sandboxes/ containing the given profiles.
struct TempAiTools {
    dir: tempfile::TempDir,
}

impl TempAiTools {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        // Copy shipped profiles from the real sandboxes directory.
        let shipped = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sandboxes");
        let dest = dir.path().join("claude-sandbox").join("sandboxes");
        std::fs::create_dir_all(&dest).unwrap();
        for entry in std::fs::read_dir(&shipped).unwrap() {
            let entry = entry.unwrap();
            let src_path = entry.path();
            if src_path.extension().map(|e| e == "toml").unwrap_or(false) {
                std::fs::copy(&src_path, dest.join(entry.file_name())).unwrap();
            }
        }
        Self { dir }
    }

    fn ai_tools_path(&self) -> String {
        self.dir.path().to_string_lossy().to_string()
    }

    fn claude_sandbox_path(&self) -> PathBuf {
        self.dir.path().join("claude-sandbox")
    }

    fn machine_config(&self) -> MachineConfig {
        MachineConfig {
            tools: ToolPaths {
                ai_tools: Some(self.ai_tools_path()),
            },
            paths: HashMap::new(),
        }
    }
}

/// Create a temp project directory with a .claude/sandbox.toml.
struct TempProject {
    dir: tempfile::TempDir,
}

impl TempProject {
    fn new(profile: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        let content = format!("profile = \"{}\"\nextra_env = []\n", profile);
        std::fs::write(claude_dir.join("sandbox.toml"), content).unwrap();
        Self { dir }
    }

    fn root(&self) -> PathBuf {
        self.dir.path().to_path_buf()
    }
}

// ── 1. Full workflow: setup -> init -> check -> run --dry-run ──────────────

#[test]
fn test_full_workflow_setup_to_dry_run() {
    // Simulate the full pipeline without invoking the CLI binary:
    // 1. Create machine config (setup output)
    // 2. Create project config (init output)
    // 3. Load and validate (check)
    // 4. Assemble bwrap args (run --dry-run)

    let ai_tools = TempAiTools::new();
    let project = TempProject::new("minimal");

    // Load profile from the temp ai_tools tree
    let profile = load_profile(&ai_tools.claude_sandbox_path(), "minimal").unwrap();

    // Load project config
    let project_config = load_project_config(project.root().as_path())
        .unwrap()
        .expect("project config should exist");
    assert_eq!(project_config.profile, "minimal");

    // Build resolved config
    let resolved = make_resolved_with_machine(
        "minimal",
        profile,
        project_config,
        ai_tools.machine_config(),
        project.root(),
    );

    // Validate
    validate(&resolved).unwrap();

    // Assemble bwrap args (the dry-run output)
    let args = assemble_args(&resolved, None).unwrap();

    // Verify essential structure
    assert!(args.contains(&"--unshare-user".to_string()));
    assert!(args.contains(&"--clearenv".to_string()));
    assert!(args.contains(&"--proc".to_string()));
    assert!(args.contains(&"--dev".to_string()));

    // Project root must be rw-mounted
    let root_str = project.root().to_string_lossy().to_string();
    let has_project_root = args.windows(3).any(|w| {
        w[0] == "--bind" && w[1] == root_str && w[2] == root_str
    });
    assert!(has_project_root, "project root must appear as --bind");
}

// ── 2. Dry-run with each profile ──────────────────────────────────────────

#[test]
fn test_dry_run_with_each_profile() {
    let ai_tools = TempAiTools::new();
    let profiles = ["minimal", "rust-dev", "java-dev", "debug"];

    for profile_name in &profiles {
        let project = TempProject::new(profile_name);
        let profile = load_profile(&ai_tools.claude_sandbox_path(), profile_name)
            .unwrap_or_else(|e| panic!("Failed to load profile '{}': {}", profile_name, e));

        let project_config = load_project_config(project.root().as_path())
            .unwrap()
            .unwrap();

        let resolved = make_resolved_with_machine(
            profile_name,
            profile,
            project_config,
            ai_tools.machine_config(),
            project.root(),
        );

        validate(&resolved).unwrap_or_else(|e| {
            panic!("Validation failed for profile '{}': {}", profile_name, e)
        });

        let args = assemble_args(&resolved, None).unwrap_or_else(|e| {
            panic!(
                "assemble_args failed for profile '{}': {}",
                profile_name, e
            )
        });

        // All profiles must produce namespace isolation flags
        assert!(
            args.contains(&"--unshare-user".to_string()),
            "profile '{}' missing --unshare-user",
            profile_name
        );
        assert!(
            args.contains(&"--unshare-pid".to_string()),
            "profile '{}' missing --unshare-pid",
            profile_name
        );
        assert!(
            args.contains(&"--die-with-parent".to_string()),
            "profile '{}' missing --die-with-parent",
            profile_name
        );
        assert!(
            args.contains(&"--clearenv".to_string()),
            "profile '{}' missing --clearenv",
            profile_name
        );

        // System mounts must always be present
        assert!(
            args.contains(&"--proc".to_string()),
            "profile '{}' missing --proc",
            profile_name
        );
        assert!(
            args.contains(&"--dev".to_string()),
            "profile '{}' missing --dev",
            profile_name
        );
        assert!(
            args.contains(&"--tmpfs".to_string()),
            "profile '{}' missing --tmpfs",
            profile_name
        );

        // Project root must be rw-mounted for every profile
        let root_str = project.root().to_string_lossy().to_string();
        let has_root = args.windows(3).any(|w| {
            w[0] == "--bind" && w[1] == root_str && w[2] == root_str
        });
        assert!(
            has_root,
            "profile '{}' missing --bind for project root",
            profile_name
        );

        // /usr must be ro-bound (all profiles include it)
        let has_usr = args.windows(3).any(|w| {
            w[0] == "--ro-bind" && w[1] == "/usr" && w[2] == "/usr"
        });
        assert!(
            has_usr,
            "profile '{}' missing --ro-bind /usr /usr",
            profile_name
        );

        // R14: profile-specific cache paths must be present (expanded)
        if *profile_name == "rust-dev" {
            let cargo_registry = expand_tilde("~/.cargo/registry").unwrap();
            let cargo_registry_str = cargo_registry.to_string_lossy().to_string();
            let has_cargo_registry = args.iter().any(|a| a == &cargo_registry_str);
            assert!(
                has_cargo_registry,
                "rust-dev profile missing cache path '{}' in args",
                cargo_registry_str
            );
        }
        if *profile_name == "java-dev" {
            let m2_repo = expand_tilde("~/.m2/repository").unwrap();
            let m2_repo_str = m2_repo.to_string_lossy().to_string();
            let has_m2_repo = args.iter().any(|a| a == &m2_repo_str);
            assert!(
                has_m2_repo,
                "java-dev profile missing cache path '{}' in args",
                m2_repo_str
            );
        }
    }
}

// ── 2b. R11: claude args are appended after bwrap args ───────────────────

#[test]
fn test_r11_claude_args_passthrough() {
    let project_root = tempfile::tempdir().unwrap();

    let profile = SandboxProfile {
        description: "passthrough test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "minimal",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    // Simulate what run.rs does: assemble bwrap args, then append "claude --flag value"
    let mut full_args = assemble_args(&resolved, None).unwrap();
    full_args.push("claude".to_string());
    full_args.push("--flag".to_string());
    full_args.push("value".to_string());

    // The last three args must be the claude invocation and its flags
    let n = full_args.len();
    assert!(
        n >= 3,
        "full_args must have at least 3 entries, got {}",
        n
    );
    assert_eq!(
        &full_args[n - 3..],
        &["claude", "--flag", "value"],
        "last args must be [\"claude\", \"--flag\", \"value\"]"
    );
}

// ── 3. Run fails without setup (no machine config) ───────────────────────

#[test]
fn test_run_fails_without_setup() {
    // Simulate a clean environment: no machine config on disk.
    // load_machine_config should fail with an actionable error message.
    // We cannot call load_machine_config with a custom path, but we can
    // verify the error variant and message from the library.

    // Instead, test the resolve_config path indirectly: a ResolvedConfig
    // with no ai_tools should fail validation.
    let project_root = tempfile::tempdir().unwrap();
    let resolved = ResolvedConfig {
        profile_name: "minimal".to_string(),
        profile: SandboxProfile {
            description: "test".to_string(),
            rw_paths: vec![],
            ro_paths: vec![],
            excluded_paths: vec![],
            env: vec![],
        },
        project: ProjectConfig::default(),
        machine: MachineConfig::default(), // ai_tools is None
        project_root: project_root.path().to_path_buf(),
    };

    let result = validate(&resolved);
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("ai_tools"),
        "error should mention ai_tools, got: {}",
        msg
    );
    assert!(
        msg.contains("setup"),
        "error should mention `setup` command, got: {}",
        msg
    );
}

// ── 4. Run fails with missing profile ────────────────────────────────────

#[test]
fn test_run_fails_with_missing_profile() {
    let ai_tools = TempAiTools::new();
    let result = load_profile(&ai_tools.claude_sandbox_path(), "nonexistent_profile_xyz");

    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("nonexistent_profile_xyz"),
        "error should name the missing profile, got: {}",
        msg
    );
    assert!(
        msg.contains("not found"),
        "error should say 'not found', got: {}",
        msg
    );
}

// ── 5. Deny-list blocks ~/.ssh in profile ────────────────────────────────

#[test]
fn test_deny_list_blocks_ssh_in_profile() {
    let home = dirs::home_dir().unwrap();
    let project_root = tempfile::tempdir().unwrap();

    // Profile that tries to mount ~/.ssh as read-only
    let profile = SandboxProfile {
        description: "bad profile with ssh".to_string(),
        rw_paths: vec![],
        ro_paths: vec![home.join(".ssh").to_string_lossy().to_string()],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "bad-ssh",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let result = assemble_args(&resolved, None);
    assert!(result.is_err(), "mounting ~/.ssh must be rejected");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("credential path"),
        "error should mention 'credential path', got: {}",
        msg
    );
    assert!(
        msg.contains("~/.ssh"),
        "error should mention the deny-list entry '~/.ssh', got: {}",
        msg
    );
}

#[test]
fn test_deny_list_blocks_ssh_in_rw_paths() {
    let home = dirs::home_dir().unwrap();
    let project_root = tempfile::tempdir().unwrap();

    let profile = SandboxProfile {
        description: "bad profile rw ssh".to_string(),
        rw_paths: vec![home.join(".ssh").to_string_lossy().to_string()],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "bad-ssh-rw",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let result = assemble_args(&resolved, None);
    assert!(result.is_err(), "rw mounting ~/.ssh must be rejected");
    assert!(result.unwrap_err().to_string().contains("~/.ssh"));
}

#[test]
fn test_deny_list_blocks_ssh_in_extra_paths() {
    let home = dirs::home_dir().unwrap();
    let project_root = tempfile::tempdir().unwrap();

    let project = ProjectConfig {
        profile: "test".to_string(),
        extra_paths: vec![ExtraPath {
            path: home.join(".ssh").to_string_lossy().to_string(),
            mode: MountMode::Ro,
        }],
        extra_env: vec![],
    };

    let profile = SandboxProfile {
        description: "minimal".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved("test", profile, project, project_root.path().to_path_buf());

    let result = assemble_args(&resolved, None);
    assert!(result.is_err(), "extra path ~/.ssh must be rejected");
    assert!(result.unwrap_err().to_string().contains("~/.ssh"));
}

// ── 6. Env whitelist prevents leakage ────────────────────────────────────

#[test]
#[serial]
fn test_env_whitelist_prevents_leakage() {
    // Set a secret variable that is NOT in the whitelist
    let secret_var_name = "SUPER_SECRET_TEST_VAR_12345";
    let secret_value = "this_must_not_leak";
    std::env::set_var(secret_var_name, secret_value);

    let project_root = tempfile::tempdir().unwrap();
    let profile = SandboxProfile {
        description: "minimal".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "minimal",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&resolved, None).unwrap();

    // The args should contain --clearenv
    assert!(
        args.contains(&"--clearenv".to_string()),
        "--clearenv must be present"
    );

    // The secret variable must NOT appear anywhere in the args
    assert!(
        !args.contains(&secret_var_name.to_string()),
        "secret variable name must not appear in bwrap args"
    );
    assert!(
        !args.contains(&secret_value.to_string()),
        "secret variable value must not appear in bwrap args"
    );

    // Clean up
    std::env::remove_var(secret_var_name);
}

#[test]
#[serial]
fn test_whitelisted_env_var_passes_through() {
    // Verify that a whitelisted var IS present when set
    let var_name = "TERM";
    let original = std::env::var(var_name).ok();
    std::env::set_var(var_name, "xterm-256color");

    let project_root = tempfile::tempdir().unwrap();
    let profile = SandboxProfile {
        description: "minimal".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "minimal",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&resolved, None).unwrap();

    let has_term = args.windows(3).any(|w| {
        w[0] == "--setenv" && w[1] == "TERM" && w[2] == "xterm-256color"
    });
    assert!(has_term, "whitelisted TERM var should be in bwrap args");

    // Restore
    match original {
        Some(v) => std::env::set_var(var_name, v),
        None => std::env::remove_var(var_name),
    }
}

#[test]
#[serial]
fn test_profile_env_vars_are_whitelisted() {
    // A profile that declares CARGO_HOME env should pass it through if set
    let original = std::env::var("CARGO_HOME").ok();
    std::env::set_var("CARGO_HOME", "/test/cargo/home");

    let project_root = tempfile::tempdir().unwrap();
    let profile = SandboxProfile {
        description: "rust-like".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec!["CARGO_HOME".to_string()],
    };

    let resolved = make_resolved(
        "rust-dev",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&resolved, None).unwrap();

    let has_cargo = args.windows(3).any(|w| {
        w[0] == "--setenv" && w[1] == "CARGO_HOME" && w[2] == "/test/cargo/home"
    });
    assert!(
        has_cargo,
        "profile-declared CARGO_HOME should be in bwrap args"
    );

    // Restore
    match original {
        Some(v) => std::env::set_var("CARGO_HOME", v),
        None => std::env::remove_var("CARGO_HOME"),
    }
}

// ── 7. Check reports mount count ─────────────────────────────────────────

#[test]
fn test_check_reports_all_mounts() {
    let ai_tools = TempAiTools::new();
    let project = TempProject::new("minimal");

    let profile = load_profile(&ai_tools.claude_sandbox_path(), "minimal").unwrap();
    let project_config = load_project_config(project.root().as_path())
        .unwrap()
        .unwrap();

    let resolved = make_resolved_with_machine(
        "minimal",
        profile,
        project_config,
        ai_tools.machine_config(),
        project.root(),
    );

    let args = assemble_args(&resolved, None).unwrap();

    // Count mounts the same way the check command does
    let mount_count = args
        .iter()
        .filter(|a| a.as_str() == "--bind" || a.as_str() == "--ro-bind")
        .count();

    // Minimal profile has /usr, /lib, /lib64, /bin, /sbin, /etc/resolv.conf,
    // /etc/hosts, /etc/ssl as ro, plus project root as rw, plus ~/.claude/ as rw.
    // Some may be skipped if they don't exist, but we should have at least
    // the project root (always) + /usr (always exists).
    assert!(
        mount_count >= 2,
        "should have at least 2 mounts (project root + /usr), got {}",
        mount_count
    );

    // Count env vars — HOME is always set so we expect at least one --setenv entry
    let env_count = args.iter().filter(|a| a.as_str() == "--setenv").count();
    assert!(
        env_count >= 1,
        "should have at least 1 --setenv entry from default whitelist, got {}",
        env_count
    );
}

// ── Edge case: empty profile ─────────────────────────────────────────────

#[test]
fn test_empty_profile_still_mounts_project_root() {
    let project_root = tempfile::tempdir().unwrap();

    let profile = SandboxProfile {
        description: "".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "empty",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&resolved, None).unwrap();

    // Even an empty profile must include the project root
    let root_str = project_root.path().to_string_lossy().to_string();
    let has_root = args.windows(3).any(|w| {
        w[0] == "--bind" && w[1] == root_str && w[2] == root_str
    });
    assert!(has_root, "empty profile must still mount project root");

    // Must still have namespace flags
    assert!(args.contains(&"--unshare-user".to_string()));
    assert!(args.contains(&"--clearenv".to_string()));
}

// ── Edge case: symlinks ──────────────────────────────────────────────────

#[test]
fn test_symlinked_project_root() {
    let real_dir = tempfile::tempdir().unwrap();
    let link_dir = tempfile::tempdir().unwrap();
    let link_path = link_dir.path().join("symlinked_project");
    std::os::unix::fs::symlink(real_dir.path(), &link_path).unwrap();

    let profile = SandboxProfile {
        description: "symlink test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "test",
        profile,
        ProjectConfig::default(),
        link_path.clone(),
    );

    // assemble_args should succeed with the symlink path
    let args = assemble_args(&resolved, None).unwrap();
    let link_str = link_path.to_string_lossy().to_string();
    let has_root = args.windows(3).any(|w| {
        w[0] == "--bind" && w[1] == link_str && w[2] == link_str
    });
    assert!(
        has_root,
        "symlinked project root should be mounted as --bind"
    );
}

#[test]
fn test_symlinked_extra_path() {
    let real_dir = tempfile::tempdir().unwrap();
    let link_dir = tempfile::tempdir().unwrap();
    let link_path = link_dir.path().join("linked_tools");
    std::os::unix::fs::symlink(real_dir.path(), &link_path).unwrap();

    let project_root = tempfile::tempdir().unwrap();
    let link_str = link_path.to_string_lossy().to_string();

    let project = ProjectConfig {
        profile: "test".to_string(),
        extra_paths: vec![ExtraPath {
            path: link_str.clone(),
            mode: MountMode::Ro,
        }],
        extra_env: vec![],
    };

    let profile = SandboxProfile {
        description: "test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "test",
        profile,
        project,
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&resolved, None).unwrap();
    let has_link = args.windows(3).any(|w| {
        w[0] == "--ro-bind" && w[1] == link_str && w[2] == link_str
    });
    assert!(has_link, "symlinked extra path should be mounted");
}

// ── Edge case: invalid config TOML ───────────────────────────────────────

#[test]
fn test_invalid_toml_in_project_config() {
    let dir = tempfile::tempdir().unwrap();
    let claude_dir = dir.path().join(".claude");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(
        claude_dir.join("sandbox.toml"),
        "this is not valid [[[toml content!!!",
    )
    .unwrap();

    let result = load_project_config(dir.path());
    assert!(result.is_err(), "invalid TOML should produce an error");
}

#[test]
fn test_invalid_toml_in_profile() {
    let dir = tempfile::tempdir().unwrap();
    let sandboxes_dir = dir.path().join("claude-sandbox").join("sandboxes");
    std::fs::create_dir_all(&sandboxes_dir).unwrap();
    std::fs::write(
        sandboxes_dir.join("broken.toml"),
        "description = [not valid",
    )
    .unwrap();

    let result = load_profile(dir.path(), "broken");
    assert!(result.is_err(), "invalid profile TOML should produce an error");
}

// ── Edge case: missing .claude directory ─────────────────────────────────

#[test]
fn test_load_project_config_no_claude_dir() {
    let dir = tempfile::tempdir().unwrap();
    // No .claude/ directory at all
    let result = load_project_config(dir.path()).unwrap();
    assert!(result.is_none(), "missing .claude/ should return None");
}

// ── Edge case: profile with only excluded paths (no ro/rw) ──────────────

#[test]
fn test_profile_with_only_excluded_paths() {
    let project_root = tempfile::tempdir().unwrap();

    let profile = SandboxProfile {
        description: "exclusions only".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec!["/opt/secret".to_string()],
        env: vec![],
    };

    let resolved = make_resolved(
        "test",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    // Should succeed — excluded_paths only matter when a path is actually mounted
    let result = assemble_args(&resolved, None);
    assert!(
        result.is_ok(),
        "profile with only excluded_paths and no actual mounts should succeed"
    );
}

// ── Error message quality tests ──────────────────────────────────────────

#[test]
fn test_error_profile_not_found_is_actionable() {
    let dir = tempfile::tempdir().unwrap();
    let sandboxes = dir.path().join("claude-sandbox").join("sandboxes");
    std::fs::create_dir_all(&sandboxes).unwrap();

    let result = load_profile(dir.path(), "does_not_exist");
    let msg = result.unwrap_err().to_string();

    // Error should contain the profile name
    assert!(
        msg.contains("does_not_exist"),
        "error should contain the profile name: {}",
        msg
    );
    // Error should contain the path where it looked
    assert!(
        msg.contains("sandboxes"),
        "error should mention the sandboxes directory: {}",
        msg
    );
}

#[test]
fn test_error_denied_path_is_actionable() {
    let home = dirs::home_dir().unwrap();
    let project_root = tempfile::tempdir().unwrap();

    let profile = SandboxProfile {
        description: "test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![home.join(".gnupg").to_string_lossy().to_string()],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "test",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let result = assemble_args(&resolved, None);
    let msg = result.unwrap_err().to_string();

    // Should explain what was denied and why
    assert!(
        msg.contains("credential path"),
        "error should explain this is a credential path: {}",
        msg
    );
    assert!(
        msg.contains("~/.gnupg"),
        "error should reference the deny-list entry: {}",
        msg
    );
}

#[test]
fn test_error_excluded_path_is_actionable() {
    let project_root = tempfile::tempdir().unwrap();
    let blocked_dir = tempfile::tempdir().unwrap();
    let blocked_path = blocked_dir.path().to_string_lossy().to_string();

    let profile = SandboxProfile {
        description: "test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![blocked_path.clone()],
        excluded_paths: vec![blocked_path.clone()],
        env: vec![],
    };

    let resolved = make_resolved(
        "test",
        profile,
        ProjectConfig::default(),
        project_root.path().to_path_buf(),
    );

    let result = assemble_args(&resolved, None);
    let msg = result.unwrap_err().to_string();

    assert!(
        msg.contains("excluded by profile"),
        "error should mention exclusion by profile: {}",
        msg
    );
    assert!(
        msg.contains(&blocked_path),
        "error should contain the blocked path: {}",
        msg
    );
}

#[test]
fn test_error_validation_missing_project_root_is_actionable() {
    let ai_tools = tempfile::tempdir().unwrap();

    let resolved = ResolvedConfig {
        profile_name: "test".to_string(),
        profile: SandboxProfile {
            description: "test".to_string(),
            rw_paths: vec![],
            ro_paths: vec![],
            excluded_paths: vec![],
            env: vec![],
        },
        project: ProjectConfig::default(),
        machine: MachineConfig {
            tools: ToolPaths {
                ai_tools: Some(ai_tools.path().to_string_lossy().to_string()),
            },
            paths: HashMap::new(),
        },
        project_root: PathBuf::from("/this/path/definitely/does/not/exist/12345"),
    };

    let result = validate(&resolved);
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("does not exist"),
        "error should say 'does not exist': {}",
        msg
    );
    assert!(
        msg.contains("/this/path/definitely/does/not/exist/12345"),
        "error should contain the bad path: {}",
        msg
    );
}

// ── All deny-list entries are blocked ────────────────────────────────────

#[test]
fn test_all_deny_list_entries_blocked() {
    let home = dirs::home_dir().unwrap();
    let project_root = tempfile::tempdir().unwrap();

    let deny_entries = vec![
        home.join(".ssh"),
        home.join(".gnupg"),
        home.join(".aws"),
        home.join(".config").join("gh"),
        home.join(".config").join("gcloud"),
    ];

    for denied_path in &deny_entries {
        let profile = SandboxProfile {
            description: "deny test".to_string(),
            rw_paths: vec![],
            ro_paths: vec![denied_path.to_string_lossy().to_string()],
            excluded_paths: vec![],
            env: vec![],
        };

        let resolved = make_resolved(
            "test",
            profile,
            ProjectConfig::default(),
            project_root.path().to_path_buf(),
        );

        let result = assemble_args(&resolved, None);
        assert!(
            result.is_err(),
            "deny-list should block: {}",
            denied_path.display()
        );
    }
}

// ── Subdirectory of denied path is also blocked ──────────────────────────

#[test]
fn test_deny_list_blocks_subdirectories() {
    let home = dirs::home_dir().unwrap();
    let project_root = tempfile::tempdir().unwrap();

    let sub_paths = vec![
        home.join(".ssh").join("id_rsa"),
        home.join(".aws").join("credentials"),
        home.join(".gnupg").join("private-keys-v1.d"),
        home.join(".config").join("gh").join("hosts.yml"),
    ];

    for sub_path in &sub_paths {
        let profile = SandboxProfile {
            description: "subdir deny test".to_string(),
            rw_paths: vec![],
            ro_paths: vec![sub_path.to_string_lossy().to_string()],
            excluded_paths: vec![],
            env: vec![],
        };

        let resolved = make_resolved(
            "test",
            profile,
            ProjectConfig::default(),
            project_root.path().to_path_buf(),
        );

        let result = assemble_args(&resolved, None);
        assert!(
            result.is_err(),
            "subdirectory of denied path should also be blocked: {}",
            sub_path.display()
        );
    }
}

// ── Tilde expansion edge cases ───────────────────────────────────────────

#[test]
fn test_tilde_expansion_bare_tilde() {
    let result = expand_tilde("~").unwrap();
    let home = dirs::home_dir().unwrap();
    assert_eq!(result, home);
}

#[test]
fn test_tilde_expansion_with_trailing_slash() {
    let result = expand_tilde("~/").unwrap();
    let home = dirs::home_dir().unwrap();
    // ~/  expands to home + "" which is just home
    assert_eq!(result, home.join(""));
}

#[test]
fn test_tilde_expansion_no_tilde() {
    let result = expand_tilde("/absolute/path").unwrap();
    assert_eq!(result, PathBuf::from("/absolute/path"));
}

// ── CLI binary integration tests (assert_cmd) ───────────────────────────

use assert_cmd::Command;
use predicates::prelude::*;

fn cmd() -> Command {
    Command::cargo_bin("claude-sandbox").unwrap()
}

#[test]
fn test_cli_run_dry_run_contains_namespace_flags() {
    // The dry-run output should include critical sandbox flags
    cmd()
        .args(["run", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--unshare-user"))
        .stdout(predicate::str::contains("--unshare-pid"))
        .stdout(predicate::str::contains("--die-with-parent"))
        .stdout(predicate::str::contains("--clearenv"))
        .stdout(predicate::str::contains("--proc"))
        .stdout(predicate::str::contains("--dev"))
        .stdout(predicate::str::contains("--tmpfs"));
}

#[test]
fn test_cli_run_dry_run_contains_bind_mounts() {
    cmd()
        .args(["run", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--ro-bind"))
        .stdout(predicate::str::contains("--bind"));
}

#[test]
fn test_cli_check_then_dry_run_same_profile() {
    // check with minimal should succeed
    cmd()
        .args(["check", "--profile", "minimal"])
        .assert()
        .success()
        .stdout(predicate::str::contains("minimal"));

    // dry-run with minimal should succeed
    cmd()
        .args(["run", "--dry-run", "--profile", "minimal"])
        .assert()
        .success()
        .stdout(predicate::str::contains("bwrap"));
}

#[test]
fn test_cli_check_nonexistent_profile_error_message() {
    cmd()
        .args(["check", "--profile", "totally_bogus_profile_name"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("totally_bogus_profile_name"));
}

#[test]
fn test_cli_run_dry_run_nonexistent_profile_error_message() {
    cmd()
        .args(["run", "--dry-run", "--profile", "no_such_profile_xyz"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("no_such_profile_xyz"));
}

#[test]
fn test_cli_list_profiles_shows_at_least_minimal() {
    // The list-profiles command reads from the ai_tools/sandboxes/ directory
    // (resolved via machine config or fallback). In dev/test environments the
    // fallback points to ai_tools/sandboxes/ which contains at least "minimal".
    cmd()
        .arg("list-profiles")
        .assert()
        .success()
        .stdout(predicate::str::contains("minimal"));
}

#[test]
fn test_cli_setup_shell_function_is_valid() {
    cmd()
        .args(["setup", "--shell-function"])
        .assert()
        .success();

    // The shell function should be syntactically a function definition
    let output = cmd()
        .args(["setup", "--shell-function"])
        .output()
        .unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("claude()"), "should define claude() function");
    assert!(
        stdout.contains("claude-sandbox run"),
        "should delegate to claude-sandbox run"
    );
}

// ── Multiple extra paths ─────────────────────────────────────────────────

#[test]
fn test_multiple_extra_paths_all_mounted() {
    let project_root = tempfile::tempdir().unwrap();
    let extra1 = tempfile::tempdir().unwrap();
    let extra2 = tempfile::tempdir().unwrap();
    let path1 = extra1.path().to_string_lossy().to_string();
    let path2 = extra2.path().to_string_lossy().to_string();

    let project = ProjectConfig {
        profile: "test".to_string(),
        extra_paths: vec![
            ExtraPath {
                path: path1.clone(),
                mode: MountMode::Ro,
            },
            ExtraPath {
                path: path2.clone(),
                mode: MountMode::Rw,
            },
        ],
        extra_env: vec![],
    };

    let profile = SandboxProfile {
        description: "test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "test",
        profile,
        project,
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&resolved, None).unwrap();

    let has_ro = args.windows(3).any(|w| {
        w[0] == "--ro-bind" && w[1] == path1 && w[2] == path1
    });
    let has_rw = args.windows(3).any(|w| {
        w[0] == "--bind" && w[1] == path2 && w[2] == path2
    });
    assert!(has_ro, "first extra path should be ro-bound");
    assert!(has_rw, "second extra path should be rw-bound");
}

// ── Project extra_env passes through ─────────────────────────────────────

#[test]
fn test_project_extra_env_whitelisted() {
    let var_name = "MY_CUSTOM_BUILD_VAR_12345";
    std::env::set_var(var_name, "custom_value");

    let project_root = tempfile::tempdir().unwrap();
    let project = ProjectConfig {
        profile: "test".to_string(),
        extra_paths: vec![],
        extra_env: vec![format!("{}=custom_value", var_name)],
    };

    let profile = SandboxProfile {
        description: "test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let resolved = make_resolved(
        "test",
        profile,
        project,
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&resolved, None).unwrap();

    let has_var = args.windows(3).any(|w| {
        w[0] == "--setenv" && w[1] == var_name && w[2] == "custom_value"
    });
    assert!(
        has_var,
        "project extra_env should whitelist the variable through"
    );

    std::env::remove_var(var_name);
}

// ── Validation: project root is a file, not a directory ──────────────────

#[test]
fn test_validate_project_root_is_file_not_dir() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let ai_tools = tempfile::tempdir().unwrap();

    let resolved = ResolvedConfig {
        profile_name: "test".to_string(),
        profile: SandboxProfile {
            description: "test".to_string(),
            rw_paths: vec![],
            ro_paths: vec![],
            excluded_paths: vec![],
            env: vec![],
        },
        project: ProjectConfig::default(),
        machine: MachineConfig {
            tools: ToolPaths {
                ai_tools: Some(ai_tools.path().to_string_lossy().to_string()),
            },
            paths: HashMap::new(),
        },
        project_root: tmp.path().to_path_buf(),
    };

    let result = validate(&resolved);
    assert!(result.is_err());
    assert!(
        result.unwrap_err().to_string().contains("not a directory"),
        "should say project root is not a directory"
    );
}
