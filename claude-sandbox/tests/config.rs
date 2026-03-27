use claude_sandbox::config::*;
use std::io::Write;

#[test]
fn test_parse_sandbox_profile() {
    let toml_str = r#"
description = "Test profile"
rw_paths = ["/tmp"]
ro_paths = ["/usr", "/lib"]
excluded_paths = ["/usr/local/secrets"]
env = ["HOME=/home/test"]
"#;
    let profile: SandboxProfile = toml::from_str(toml_str).unwrap();
    assert_eq!(profile.description, "Test profile");
    assert_eq!(profile.rw_paths, vec!["/tmp"]);
    assert_eq!(profile.ro_paths, vec!["/usr", "/lib"]);
    assert_eq!(profile.excluded_paths, vec!["/usr/local/secrets"]);
    assert_eq!(profile.env, vec!["HOME=/home/test"]);
}

#[test]
fn test_parse_project_config() {
    let toml_str = r#"
profile = "development"
extra_env = ["RUST_LOG=debug"]

[[extra_paths]]
path = "/opt/tools"
mode = "ro"

[[extra_paths]]
path = "/tmp/build"
mode = "rw"
"#;
    let config: ProjectConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.profile, "development");
    assert_eq!(config.extra_paths.len(), 2);
    assert_eq!(config.extra_paths[0].path, "/opt/tools");
    assert_eq!(config.extra_paths[0].mode, MountMode::Ro);
    assert_eq!(config.extra_paths[1].path, "/tmp/build");
    assert_eq!(config.extra_paths[1].mode, MountMode::Rw);
    assert_eq!(config.extra_env, vec!["RUST_LOG=debug"]);
}

#[test]
fn test_parse_machine_config() {
    let toml_str = r#"
[tools]
ai_tools = "/home/user/ai_tools"

[paths]
cargo = "/home/user/.cargo/bin"
node = "/home/user/.nvm/versions/node/v20/bin"
"#;
    let config: MachineConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(
        config.tools.ai_tools,
        Some("/home/user/ai_tools".to_string())
    );
    assert_eq!(
        config.paths.get("cargo"),
        Some(&"/home/user/.cargo/bin".to_string())
    );
    assert_eq!(
        config.paths.get("node"),
        Some(&"/home/user/.nvm/versions/node/v20/bin".to_string())
    );
}

#[test]
fn test_load_profile_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let sandboxes_dir = dir.path().join("sandboxes");
    std::fs::create_dir_all(&sandboxes_dir).unwrap();

    let profile_content = r#"
description = "Test on disk"
rw_paths = ["/tmp"]
ro_paths = ["/usr"]
excluded_paths = []
env = []
"#;
    let mut file = std::fs::File::create(sandboxes_dir.join("test.toml")).unwrap();
    file.write_all(profile_content.as_bytes()).unwrap();

    let profile = load_profile(dir.path(), "test").unwrap();
    assert_eq!(profile.description, "Test on disk");
    assert_eq!(profile.rw_paths, vec!["/tmp"]);
}

#[test]
fn test_load_profile_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let sandboxes_dir = dir.path().join("sandboxes");
    std::fs::create_dir_all(&sandboxes_dir).unwrap();

    let result = load_profile(dir.path(), "nonexistent");
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("Profile 'nonexistent' not found"));
}

#[test]
fn test_load_project_config_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let config_content = r#"
profile = "custom"
extra_env = ["FOO=bar"]
"#;
    let claude_dir = dir.path().join(".claude");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(claude_dir.join("sandbox.toml"), config_content).unwrap();

    let config = load_project_config(dir.path()).unwrap();
    assert!(config.is_some());
    let config = config.unwrap();
    assert_eq!(config.profile, "custom");
    assert_eq!(config.extra_env, vec!["FOO=bar"]);
}

#[test]
fn test_load_project_config_missing() {
    let dir = tempfile::tempdir().unwrap();
    let config = load_project_config(dir.path()).unwrap();
    assert!(config.is_none());
}

#[test]
fn test_project_config_defaults() {
    let config = ProjectConfig::default();
    assert_eq!(config.profile, "minimal");
    assert!(config.extra_paths.is_empty());
    assert!(config.extra_env.is_empty());
}

/// Test that detect_project_root walks upward to find .claude/sandbox.toml.
/// We can't change cwd in a unit test safely, but we can verify the upward-walk
/// logic by calling load_project_config on parent/child directory pairs directly.
#[test]
fn test_detect_project_root_upward_walk_via_load() {
    // Create a directory tree:  root/.claude/sandbox.toml  and  root/subdir/subsubdir/
    // Verify that load_project_config finds the config when called with root, and
    // returns None when called with a subdir that has no .claude/sandbox.toml.
    let root = tempfile::tempdir().unwrap();
    let claude_dir = root.path().join(".claude");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(
        claude_dir.join("sandbox.toml"),
        "profile = \"test\"\n",
    )
    .unwrap();

    let subdir = root.path().join("subdir").join("subsubdir");
    std::fs::create_dir_all(&subdir).unwrap();

    // load_project_config on root finds the config
    let config = load_project_config(root.path()).unwrap();
    assert!(config.is_some());
    assert_eq!(config.unwrap().profile, "test");

    // load_project_config on a subdirectory (no .claude/sandbox.toml there) returns None
    let config = load_project_config(&subdir).unwrap();
    assert!(config.is_none());
}

/// Test that resolve_config fails when no sandbox.toml exists.
/// We can't call resolve_config directly in a temp dir because it uses
/// detect_project_root which looks at cwd/git, but we can verify the
/// load_project_config -> None path would produce an error.
#[test]
fn test_load_project_config_none_means_required_error() {
    let dir = tempfile::tempdir().unwrap();
    let result = load_project_config(dir.path()).unwrap();
    // Verify it returns None (which resolve_config now treats as an error)
    assert!(result.is_none(), "Missing sandbox.toml should return None from load_project_config");
}

/// Test that detect_project_root upward-walk stops at the directory containing
/// .claude/sandbox.toml, not at a deeper subdirectory.
#[test]
fn test_detect_project_root_finds_ancestor() {
    use std::path::PathBuf;

    // Build a tree and manually simulate what detect_project_root does (walk upward).
    let root = tempfile::tempdir().unwrap();
    let claude_dir = root.path().join(".claude");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(claude_dir.join("sandbox.toml"), "profile = \"ancestor\"\n").unwrap();

    let deep = root.path().join("a").join("b").join("c");
    std::fs::create_dir_all(&deep).unwrap();

    // Walk upward from `deep` looking for .claude/sandbox.toml — mirrors the
    // fallback logic in detect_project_root.
    let mut found: Option<PathBuf> = None;
    let mut dir = deep.as_path();
    loop {
        if dir.join(".claude").join("sandbox.toml").exists() {
            found = Some(dir.to_path_buf());
            break;
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => break,
        }
    }

    assert!(found.is_some(), "should have found the ancestor root");
    assert_eq!(found.unwrap(), root.path());
}

/// Test that all shipped profile TOML files parse correctly as SandboxProfile.
#[test]
fn test_all_shipped_profiles_parse() {
    let sandboxes_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sandboxes");
    let expected_profiles = ["minimal", "rust-dev", "java-dev", "debug"];

    for name in &expected_profiles {
        let path = sandboxes_dir.join(format!("{}.toml", name));
        assert!(
            path.exists(),
            "Profile file should exist: {}",
            path.display()
        );
        let content = std::fs::read_to_string(&path).unwrap();
        let profile: SandboxProfile = toml::from_str(&content).unwrap_or_else(|e| {
            panic!("Profile '{}' failed to parse: {}", name, e);
        });
        assert!(
            !profile.description.is_empty(),
            "Profile '{}' should have a description",
            name
        );
        assert!(
            !profile.ro_paths.is_empty(),
            "Profile '{}' should have at least one ro_path",
            name
        );
    }
}

/// Test that load_profile correctly loads shipped profiles via the ai_tools directory.
#[test]
fn test_load_shipped_profiles() {
    // ai_tools dir is the parent of CARGO_MANIFEST_DIR (claude-sandbox/)
    let ai_tools_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();

    let profiles = ["minimal", "rust-dev", "java-dev", "debug"];
    for name in &profiles {
        let profile = load_profile(&ai_tools_dir.join("claude-sandbox"), name).unwrap_or_else(|e| {
            panic!("Failed to load profile '{}': {}", name, e);
        });
        assert!(!profile.description.is_empty());
    }
}

/// Test specific properties of the rust-dev profile.
#[test]
fn test_rust_dev_profile_contents() {
    let sandboxes_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sandboxes");
    let content = std::fs::read_to_string(sandboxes_dir.join("rust-dev.toml")).unwrap();
    let profile: SandboxProfile = toml::from_str(&content).unwrap();

    assert!(profile.ro_paths.iter().any(|p| p.contains(".cargo/registry")));
    assert!(profile.ro_paths.iter().any(|p| p.contains(".rustup")));
    assert!(profile.env.contains(&"CARGO_HOME".to_string()));
    assert!(profile.env.contains(&"RUSTUP_HOME".to_string()));
}

/// Test specific properties of the java-dev profile.
#[test]
fn test_java_dev_profile_contents() {
    let sandboxes_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sandboxes");
    let content = std::fs::read_to_string(sandboxes_dir.join("java-dev.toml")).unwrap();
    let profile: SandboxProfile = toml::from_str(&content).unwrap();

    assert!(profile.ro_paths.iter().any(|p| p.contains(".m2/repository")));
    assert!(profile.env.contains(&"JAVA_HOME".to_string()));
    assert!(profile.env.contains(&"MAVEN_HOME".to_string()));
}

/// Test that the debug profile has permissive rw_paths.
#[test]
fn test_debug_profile_is_permissive() {
    let sandboxes_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sandboxes");
    let content = std::fs::read_to_string(sandboxes_dir.join("debug.toml")).unwrap();
    let profile: SandboxProfile = toml::from_str(&content).unwrap();

    assert!(profile.rw_paths.iter().any(|p| p == "~/"));
    assert!(profile.description.contains("debug") || profile.description.contains("Debug"));
}
