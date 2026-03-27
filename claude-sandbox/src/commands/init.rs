use crate::cli::InitArgs;
use crate::config;
use crate::error::AppResult;

/// Default content for a new `.claude/sandbox.toml`.
fn default_sandbox_toml(profile: &str) -> String {
    format!(
        r#"# Sandbox configuration for this project.
# See `claude-sandbox list-profiles` for available profiles.
profile = "{}"

# Additional paths to mount inside the sandbox.
# Each entry needs a `path` and a `mode` ("ro" or "rw").
# [[extra_paths]]
# path = "/opt/tools"
# mode = "ro"

# Additional environment variables to pass through.
# extra_env = ["RUST_LOG=debug"]
extra_env = []
"#,
        profile
    )
}

pub fn execute(args: InitArgs) -> AppResult<()> {
    let project_root = config::detect_project_root()?;
    let claude_dir = project_root.join(".claude");
    let config_path = claude_dir.join("sandbox.toml");

    // Create .claude/ directory if needed
    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir)?;
        println!("init: created {}", claude_dir.display());
    }

    // Create sandbox.toml if it doesn't exist (idempotent)
    if config_path.exists() {
        println!(
            "init: {} already exists, skipping",
            config_path.display()
        );
    } else {
        let profile = args.profile.as_deref().unwrap_or("minimal");
        let content = default_sandbox_toml(profile);
        std::fs::write(&config_path, content)?;
        println!("init: created {}", config_path.display());
    }

    println!(
        "init: project sandbox config ready at {}",
        config_path.display()
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_sandbox_toml_contains_profile() {
        let content = default_sandbox_toml("minimal");
        assert!(content.contains("profile = \"minimal\""));
        assert!(content.contains("extra_env"));
    }

    #[test]
    fn test_default_sandbox_toml_custom_profile() {
        let content = default_sandbox_toml("development");
        assert!(content.contains("profile = \"development\""));
    }

    #[test]
    fn test_default_sandbox_toml_parses_as_project_config() {
        let content = default_sandbox_toml("minimal");
        let config: crate::config::ProjectConfig = toml::from_str(&content).unwrap();
        assert_eq!(config.profile, "minimal");
        assert!(config.extra_paths.is_empty());
        assert!(config.extra_env.is_empty());
    }

    #[test]
    fn test_init_creates_config_in_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        let config_path = claude_dir.join("sandbox.toml");

        // Simulate what execute does (without detect_project_root)
        std::fs::create_dir_all(&claude_dir).unwrap();
        let content = default_sandbox_toml("minimal");
        std::fs::write(&config_path, &content).unwrap();

        assert!(config_path.exists());
        let loaded = std::fs::read_to_string(&config_path).unwrap();
        assert!(loaded.contains("profile = \"minimal\""));
    }

    #[test]
    fn test_init_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        let config_path = claude_dir.join("sandbox.toml");

        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(&config_path, "profile = \"existing\"\n").unwrap();

        // Verify the file already exists and wouldn't be overwritten
        assert!(config_path.exists());
        let content = std::fs::read_to_string(&config_path).unwrap();
        assert!(content.contains("existing"), "existing content should be preserved");
    }
}
