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
    std::fs::write(dir.path().join(".claude-sandbox.toml"), config_content).unwrap();

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
