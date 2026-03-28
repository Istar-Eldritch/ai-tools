use crate::config::{self, SandboxProfile};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;

/// Resolve the ai_tools directory from machine config, with a fallback to
/// CARGO_MANIFEST_DIR for dev/test environments.
fn resolve_ai_tools_dir() -> AppResult<PathBuf> {
    match config::load_machine_config() {
        Ok(machine) => {
            if let Some(ai_tools) = &machine.tools.ai_tools {
                Ok(PathBuf::from(ai_tools))
            } else {
                Err(AppError::Config(
                    "machine.tools.ai_tools is not set in paths.toml".to_string(),
                ))
            }
        }
        Err(_) => {
            // Fallback for dev/test: use CARGO_MANIFEST_DIR parent
            let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            Ok(fallback)
        }
    }
}

pub fn execute() -> AppResult<()> {
    let ai_tools_dir = resolve_ai_tools_dir()?;
    let sandboxes_dir = ai_tools_dir.join("claude-sandbox").join("sandboxes");

    if !sandboxes_dir.exists() || !sandboxes_dir.is_dir() {
        return Err(AppError::Config(format!(
            "Sandboxes directory not found at '{}'",
            sandboxes_dir.display()
        )));
    }

    let mut profiles: Vec<(String, String)> = Vec::new();

    for entry in std::fs::read_dir(&sandboxes_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("toml") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let description = match std::fs::read_to_string(&path) {
                Ok(content) => match toml::from_str::<SandboxProfile>(&content) {
                    Ok(profile) => {
                        if profile.description.is_empty() {
                            "(no description)".to_string()
                        } else {
                            profile.description
                        }
                    }
                    Err(_) => "(parse error)".to_string(),
                },
                Err(_) => "(read error)".to_string(),
            };

            profiles.push((name, description));
        }
    }

    profiles.sort_by(|a, b| a.0.cmp(&b.0));

    println!("list-profiles: available sandbox profiles");
    println!();
    for (name, description) in &profiles {
        println!("  {:<20} {}", name, description);
    }

    if profiles.is_empty() {
        println!("  (no profiles found in {})", sandboxes_dir.display());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_ai_tools_dir_fallback() {
        // In test environment, the fallback should point to the ai_tools workspace root
        let dir = resolve_ai_tools_dir().unwrap();
        assert!(dir.join("claude-sandbox").join("sandboxes").exists(), "ai_tools fallback should have a claude-sandbox/sandboxes/ dir");
    }

    #[test]
    fn test_list_profiles_finds_minimal() {
        let ai_tools_dir = resolve_ai_tools_dir().unwrap();
        let sandboxes_dir = ai_tools_dir.join("claude-sandbox").join("sandboxes");
        assert!(sandboxes_dir.join("minimal.toml").exists(), "minimal.toml should exist");
    }
}
