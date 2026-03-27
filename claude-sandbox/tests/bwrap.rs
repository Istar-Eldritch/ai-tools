use claude_sandbox::bwrap::{assemble_args, expand_tilde, validate};
use claude_sandbox::config::*;
use std::collections::HashMap;
use std::path::PathBuf;

fn minimal_profile() -> SandboxProfile {
    SandboxProfile {
        description: "Minimal test profile".to_string(),
        rw_paths: vec![],
        ro_paths: vec!["/usr".to_string(), "/lib".to_string()],
        excluded_paths: vec![],
        env: vec![],
    }
}

fn make_resolved(
    profile: SandboxProfile,
    project: ProjectConfig,
    project_root: PathBuf,
) -> ResolvedConfig {
    ResolvedConfig {
        profile_name: "test".to_string(),
        profile,
        project,
        machine: MachineConfig::default(),
        project_root,
    }
}

#[test]
fn test_minimal_profile_produces_correct_flags() {
    let project_root = tempfile::tempdir().unwrap();
    let root_path = project_root.path().to_path_buf();
    let config = make_resolved(minimal_profile(), ProjectConfig::default(), root_path.clone());

    let args = assemble_args(&config, None).unwrap();

    // Namespace flags must be present
    assert!(args.contains(&"--unshare-user".to_string()));
    assert!(args.contains(&"--unshare-pid".to_string()));
    assert!(args.contains(&"--unshare-uts".to_string()));
    assert!(args.contains(&"--die-with-parent".to_string()));

    // System mounts
    assert!(args.contains(&"--proc".to_string()));
    assert!(args.contains(&"--dev".to_string()));
    assert!(args.contains(&"--tmpfs".to_string()));

    // /usr should be ro-bound (it exists on the host).
    // Check the full --ro-bind <src> <dst> triple (src == dst for same-path mounts).
    let found_usr_ro_bind = args.windows(3).any(|w| {
        w[0] == "--ro-bind" && w[1] == "/usr" && w[2] == "/usr"
    });
    assert!(found_usr_ro_bind, "--ro-bind /usr /usr triple must be present in args");

    // Project root should appear as --bind <src> <dst> triple (rw)
    let root_str = root_path.to_string_lossy().to_string();
    let found_root_bind = args.windows(3).any(|w| {
        w[0] == "--bind" && w[1] == root_str && w[2] == root_str
    });
    assert!(found_root_bind, "--bind <root> <root> triple must be present in args");
}

#[test]
fn test_project_extra_paths_included() {
    let project_root = tempfile::tempdir().unwrap();
    let extra_dir = tempfile::tempdir().unwrap();
    let extra_path = extra_dir.path().to_string_lossy().to_string();

    let project = ProjectConfig {
        profile: "test".to_string(),
        extra_paths: vec![
            ExtraPath {
                path: extra_path.clone(),
                mode: MountMode::Rw,
            },
        ],
        extra_env: vec![],
    };

    let config = make_resolved(
        minimal_profile(),
        project,
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&config, None).unwrap();

    // Check the full --bind <src> <dst> triple
    let found = args.windows(3).any(|w| {
        w[0] == "--bind" && w[1] == extra_path && w[2] == extra_path
    });
    assert!(found, "--bind <extra_path> <extra_path> triple must be present in args");
}

#[test]
fn test_extra_path_ro_mode() {
    let project_root = tempfile::tempdir().unwrap();
    let extra_dir = tempfile::tempdir().unwrap();
    let extra_path = extra_dir.path().to_string_lossy().to_string();

    let project = ProjectConfig {
        profile: "test".to_string(),
        extra_paths: vec![
            ExtraPath {
                path: extra_path.clone(),
                mode: MountMode::Ro,
            },
        ],
        extra_env: vec![],
    };

    let config = make_resolved(
        minimal_profile(),
        project,
        project_root.path().to_path_buf(),
    );

    let args = assemble_args(&config, None).unwrap();

    // Check the full --ro-bind <src> <dst> triple
    let found = args.windows(3).any(|w| {
        w[0] == "--ro-bind" && w[1] == extra_path && w[2] == extra_path
    });
    assert!(found, "--ro-bind <extra_path> <extra_path> triple must be present in args");
}

#[test]
fn test_tilde_expansion() {
    let result = expand_tilde("~/documents").unwrap();
    let home = dirs::home_dir().unwrap();
    assert_eq!(result, home.join("documents"));

    // Absolute paths are unchanged
    let result = expand_tilde("/etc/hosts").unwrap();
    assert_eq!(result, PathBuf::from("/etc/hosts"));
}

#[test]
fn test_nonexistent_paths_skipped() {
    let project_root = tempfile::tempdir().unwrap();

    let profile = SandboxProfile {
        description: "test".to_string(),
        rw_paths: vec![],
        ro_paths: vec![
            "/usr".to_string(),
            "/nonexistent_path_that_does_not_exist_12345".to_string(),
        ],
        excluded_paths: vec![],
        env: vec![],
    };

    let config = make_resolved(profile, ProjectConfig::default(), project_root.path().to_path_buf());
    let args = assemble_args(&config, None).unwrap();

    // /usr should be present, nonexistent should not
    assert!(args.contains(&"/usr".to_string()));
    assert!(!args.contains(&"/nonexistent_path_that_does_not_exist_12345".to_string()));
}

#[test]
fn test_excluded_paths_blocks_ro_path() {
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

    let config = make_resolved(profile, ProjectConfig::default(), project_root.path().to_path_buf());
    let result = assemble_args(&config, None);
    assert!(result.is_err(), "excluded path in ro_paths must be rejected");
    assert!(result.unwrap_err().to_string().contains("excluded by profile"));
}

#[test]
fn test_excluded_paths_allows_non_excluded() {
    let project_root = tempfile::tempdir().unwrap();

    let profile = SandboxProfile {
        description: "test".to_string(),
        rw_paths: vec![],
        ro_paths: vec!["/usr".to_string()],
        excluded_paths: vec!["/opt/secret".to_string()],
        env: vec![],
    };

    let config = make_resolved(profile, ProjectConfig::default(), project_root.path().to_path_buf());
    let result = assemble_args(&config, None);
    assert!(result.is_ok(), "non-excluded path should be allowed");
}

#[test]
fn test_validate_passes_with_valid_config() {
    let project_root = tempfile::tempdir().unwrap();
    let ai_tools = tempfile::tempdir().unwrap();

    let config = ResolvedConfig {
        profile_name: "test".to_string(),
        profile: minimal_profile(),
        project: ProjectConfig::default(),
        machine: MachineConfig {
            tools: ToolPaths {
                ai_tools: Some(ai_tools.path().to_string_lossy().to_string()),
            },
            paths: HashMap::new(),
        },
        project_root: project_root.path().to_path_buf(),
    };

    assert!(validate(&config).is_ok());
}

#[test]
fn test_validate_fails_missing_project_root() {
    let ai_tools = tempfile::tempdir().unwrap();

    let config = ResolvedConfig {
        profile_name: "test".to_string(),
        profile: minimal_profile(),
        project: ProjectConfig::default(),
        machine: MachineConfig {
            tools: ToolPaths {
                ai_tools: Some(ai_tools.path().to_string_lossy().to_string()),
            },
            paths: HashMap::new(),
        },
        project_root: PathBuf::from("/nonexistent_root_12345"),
    };

    let result = validate(&config);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("does not exist"));
}

#[test]
fn test_validate_fails_missing_ai_tools() {
    let project_root = tempfile::tempdir().unwrap();

    let config = ResolvedConfig {
        profile_name: "test".to_string(),
        profile: minimal_profile(),
        project: ProjectConfig::default(),
        machine: MachineConfig::default(),
        project_root: project_root.path().to_path_buf(),
    };

    let result = validate(&config);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("ai_tools"));
}

#[test]
fn test_project_root_always_rw_bind() {
    let project_root = tempfile::tempdir().unwrap();
    let root_path = project_root.path().to_path_buf();

    // Even with empty profile and no extra paths, project root must appear
    let profile = SandboxProfile {
        description: "empty".to_string(),
        rw_paths: vec![],
        ro_paths: vec![],
        excluded_paths: vec![],
        env: vec![],
    };

    let config = make_resolved(profile, ProjectConfig::default(), root_path.clone());
    let args = assemble_args(&config, None).unwrap();

    let root_str = root_path.to_string_lossy().to_string();
    let found_root_bind = args.windows(3).any(|w| {
        w[0] == "--bind" && w[1] == root_str && w[2] == root_str
    });
    assert!(found_root_bind, "--bind <root> <root> triple must always be present (project root is rw)");
}
