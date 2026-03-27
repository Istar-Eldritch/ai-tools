use claude_sandbox::bwrap::{assemble_args, expand_tilde};
use claude_sandbox::config::*;
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

    let args = assemble_args(&config).unwrap();

    // Namespace flags must be present
    assert!(args.contains(&"--unshare-user".to_string()));
    assert!(args.contains(&"--unshare-pid".to_string()));
    assert!(args.contains(&"--unshare-uts".to_string()));
    assert!(args.contains(&"--die-with-parent".to_string()));

    // System mounts
    assert!(args.contains(&"--proc".to_string()));
    assert!(args.contains(&"--dev".to_string()));
    assert!(args.contains(&"--tmpfs".to_string()));

    // /usr should be ro-bound (it exists on the host)
    let usr_idx = args.iter().position(|a| a == "/usr");
    assert!(usr_idx.is_some(), "/usr should appear in args");
    // The flag before /usr should be --ro-bind
    let idx = usr_idx.unwrap();
    assert!(idx >= 1);
    assert_eq!(args[idx - 1], "--ro-bind");

    // Project root should appear as --bind (rw)
    let root_str = root_path.to_string_lossy().to_string();
    let root_idx = args.iter().position(|a| a == &root_str);
    assert!(root_idx.is_some(), "project root should appear in args");
    let idx = root_idx.unwrap();
    assert!(idx >= 1);
    assert_eq!(args[idx - 1], "--bind");
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

    let args = assemble_args(&config).unwrap();

    let extra_idx = args.iter().position(|a| a == &extra_path);
    assert!(extra_idx.is_some(), "extra path should appear in args");
    let idx = extra_idx.unwrap();
    assert!(idx >= 1);
    assert_eq!(args[idx - 1], "--bind");
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

    let args = assemble_args(&config).unwrap();

    let extra_idx = args.iter().position(|a| a == &extra_path);
    assert!(extra_idx.is_some(), "extra ro path should appear in args");
    let idx = extra_idx.unwrap();
    assert!(idx >= 1);
    assert_eq!(args[idx - 1], "--ro-bind");
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
    let args = assemble_args(&config).unwrap();

    // /usr should be present, nonexistent should not
    assert!(args.contains(&"/usr".to_string()));
    assert!(!args.contains(&"/nonexistent_path_that_does_not_exist_12345".to_string()));
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
    let args = assemble_args(&config).unwrap();

    let root_str = root_path.to_string_lossy().to_string();
    let root_idx = args.iter().position(|a| a == &root_str);
    assert!(root_idx.is_some(), "project root must always appear");
    let idx = root_idx.unwrap();
    assert!(idx >= 1);
    assert_eq!(args[idx - 1], "--bind", "project root must be rw (--bind)");
}
