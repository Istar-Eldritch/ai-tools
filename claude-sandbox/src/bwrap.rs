use crate::config::ResolvedConfig;
use crate::config::MountMode;
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Credential paths that must never be exposed inside the sandbox.
/// Any host path that resolves to one of these (or a subdirectory of one) will
/// be rejected with `AppError::DeniedPath`.
const CREDENTIAL_DENY_LIST: &[&str] = &[
    "~/.ssh",
    "~/.gnupg",
    "~/.aws",
    "~/.config/gh",
    "~/.config/gcloud",
];

/// Environment variables that are allowed to pass through into the sandbox.
/// All other variables are cleared via `--clearenv`.
const DEFAULT_ENV_WHITELIST: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "TERM",
    "COLORTERM",
    "LANG",
    "LC_ALL",
    "HOME",
    "PATH",
    "USER",
    "SHELL",
];

/// Expand a leading `~` in a path string to the user's home directory.
pub fn expand_tilde(path: &str) -> AppResult<PathBuf> {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Config("Could not determine home directory".to_string()))?;
        Ok(home.join(rest))
    } else if path == "~" {
        dirs::home_dir()
            .ok_or_else(|| AppError::Config("Could not determine home directory".to_string()))
    } else {
        Ok(PathBuf::from(path))
    }
}

/// Check whether `path` falls under any entry in `CREDENTIAL_DENY_LIST`.
/// Returns `Err(AppError::DeniedPath(...))` if blocked, `Ok(())` otherwise.
fn check_deny_list(path: &Path) -> AppResult<()> {
    for &denied_raw in CREDENTIAL_DENY_LIST {
        let denied = expand_tilde(denied_raw)?;
        // Block exact matches and any subdirectory of a denied path.
        if path == denied || path.starts_with(&denied) {
            return Err(AppError::DeniedPath(format!(
                "'{}' is a credential path and cannot be mounted in the sandbox (matches deny-list entry '{}')",
                path.display(),
                denied_raw,
            )));
        }
    }
    Ok(())
}

/// Check whether a host path exists, printing a warning if not.
/// Returns `true` if the path exists.
fn host_path_exists(path: &Path) -> bool {
    if path.exists() {
        true
    } else {
        eprintln!(
            "warning: skipping non-existent path: {}",
            path.display()
        );
        false
    }
}

/// Assemble the bwrap argument list from a resolved configuration.
pub fn assemble_args(config: &ResolvedConfig) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = Vec::new();

    // Namespace flags
    args.extend_from_slice(&[
        "--unshare-user".to_string(),
        "--unshare-pid".to_string(),
        "--unshare-uts".to_string(),
        "--die-with-parent".to_string(),
    ]);

    // System mounts
    args.extend_from_slice(&[
        "--proc".to_string(),
        "/proc".to_string(),
        "--dev".to_string(),
        "/dev".to_string(),
        "--tmpfs".to_string(),
        "/tmp".to_string(),
    ]);

    // Clear the environment so that only explicitly whitelisted variables are
    // available inside the sandbox.
    args.push("--clearenv".to_string());

    // Whitelist: default set + profile env vars + project extra_env.
    // Build the combined list of variable names to allow through.
    let mut env_vars: Vec<&str> = DEFAULT_ENV_WHITELIST.to_vec();

    // Profile env entries are "VAR=value" or just "VAR"; extract the name.
    let profile_env_names: Vec<String> = config
        .profile
        .env
        .iter()
        .map(|e| {
            e.split('=').next().unwrap_or(e.as_str()).to_string()
        })
        .collect();
    for name in &profile_env_names {
        env_vars.push(name.as_str());
    }

    // Project extra_env entries are also "VAR=value" or "VAR".
    let extra_env_names: Vec<String> = config
        .project
        .extra_env
        .iter()
        .map(|e| {
            e.split('=').next().unwrap_or(e.as_str()).to_string()
        })
        .collect();
    for name in &extra_env_names {
        env_vars.push(name.as_str());
    }

    // Deduplicate while preserving order.
    let mut seen = std::collections::HashSet::new();
    for var in env_vars {
        if seen.insert(var.to_string()) {
            if let Ok(val) = std::env::var(var) {
                args.extend_from_slice(&[
                    "--setenv".to_string(),
                    var.to_string(),
                    val,
                ]);
            }
        }
    }

    // Read-only binds from profile
    for ro_path in &config.profile.ro_paths {
        let expanded = expand_tilde(ro_path)?;
        check_deny_list(&expanded)?;
        if host_path_exists(&expanded) {
            let src = expanded.to_string_lossy().to_string();
            // dest == src (same path inside the sandbox)
            args.extend_from_slice(&["--ro-bind".to_string(), src.clone(), src]);
        }
    }

    // Read-write binds from profile
    for rw_path in &config.profile.rw_paths {
        let expanded = expand_tilde(rw_path)?;
        check_deny_list(&expanded)?;
        if host_path_exists(&expanded) {
            let src = expanded.to_string_lossy().to_string();
            args.extend_from_slice(&["--bind".to_string(), src.clone(), src]);
        }
    }

    // Project root: always rw bind
    {
        let src = config.project_root.to_string_lossy().to_string();
        args.extend_from_slice(&["--bind".to_string(), src.clone(), src]);
    }

    // ~/.claude/ is always bound rw so that Claude can read its config and
    // write session state, regardless of what the profile specifies.
    {
        let claude_dir = dirs::home_dir()
            .ok_or_else(|| AppError::Config("Could not determine home directory".to_string()))?
            .join(".claude");
        if host_path_exists(&claude_dir) {
            let src = claude_dir.to_string_lossy().to_string();
            args.extend_from_slice(&["--bind".to_string(), src.clone(), src]);
        }
    }

    // Extra paths from project config
    for extra in &config.project.extra_paths {
        let expanded = expand_tilde(&extra.path)?;
        check_deny_list(&expanded)?;
        if host_path_exists(&expanded) {
            let src = expanded.to_string_lossy().to_string();
            let flag = match extra.mode {
                MountMode::Ro => "--ro-bind",
                MountMode::Rw => "--bind",
            };
            args.extend_from_slice(&[flag.to_string(), src.clone(), src]);
        }
    }

    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{MachineConfig, MountMode, ProjectConfig, ResolvedConfig, SandboxProfile, ExtraPath};
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
    fn test_expand_tilde_with_subpath() {
        let result = expand_tilde("~/foo/bar").unwrap();
        let home = dirs::home_dir().unwrap();
        assert_eq!(result, home.join("foo/bar"));
    }

    #[test]
    fn test_expand_tilde_bare() {
        let result = expand_tilde("~").unwrap();
        let home = dirs::home_dir().unwrap();
        assert_eq!(result, home);
    }

    #[test]
    fn test_expand_tilde_absolute() {
        let result = expand_tilde("/usr/bin").unwrap();
        assert_eq!(result, PathBuf::from("/usr/bin"));
    }

    // ── Deny-list tests ──────────────────────────────────────────────────────

    #[test]
    fn test_deny_list_blocks_ssh_dir() {
        let home = dirs::home_dir().unwrap();
        let ssh = home.join(".ssh");
        let result = check_deny_list(&ssh);
        assert!(result.is_err(), "~/.ssh must be blocked by the deny list");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("~/.ssh"), "error message should mention the deny-list entry");
    }

    #[test]
    fn test_deny_list_blocks_aws_subdir() {
        let home = dirs::home_dir().unwrap();
        let aws_creds = home.join(".aws").join("credentials");
        let result = check_deny_list(&aws_creds);
        assert!(result.is_err(), "subdirectory of ~/.aws must be blocked");
    }

    #[test]
    fn test_deny_list_blocks_gnupg() {
        let home = dirs::home_dir().unwrap();
        let gnupg = home.join(".gnupg");
        let result = check_deny_list(&gnupg);
        assert!(result.is_err(), "~/.gnupg must be blocked by the deny list");
    }

    #[test]
    fn test_deny_list_allows_safe_path() {
        let result = check_deny_list(Path::new("/usr/share/doc"));
        assert!(result.is_ok(), "/usr/share/doc should not be blocked");
    }

    #[test]
    fn test_assemble_args_rejects_denied_ro_path() {
        let project_root = tempfile::tempdir().unwrap();
        let home = dirs::home_dir().unwrap();

        let profile = SandboxProfile {
            description: "bad".to_string(),
            rw_paths: vec![],
            ro_paths: vec![home.join(".ssh").to_string_lossy().to_string()],
            excluded_paths: vec![],
            env: vec![],
        };

        let config = make_resolved(profile, ProjectConfig::default(), project_root.path().to_path_buf());
        let result = assemble_args(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("~/.ssh"));
    }

    #[test]
    fn test_assemble_args_rejects_denied_extra_path() {
        let project_root = tempfile::tempdir().unwrap();
        let home = dirs::home_dir().unwrap();

        let project = ProjectConfig {
            profile: "test".to_string(),
            extra_paths: vec![ExtraPath {
                path: home.join(".aws").to_string_lossy().to_string(),
                mode: MountMode::Ro,
            }],
            extra_env: vec![],
        };

        let config = make_resolved(minimal_profile(), project, project_root.path().to_path_buf());
        let result = assemble_args(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("~/.aws"));
    }

    // ── Env whitelist / clearenv tests ───────────────────────────────────────

    #[test]
    fn test_clearenv_flag_present() {
        let project_root = tempfile::tempdir().unwrap();
        let config = make_resolved(minimal_profile(), ProjectConfig::default(), project_root.path().to_path_buf());
        let args = assemble_args(&config).unwrap();
        assert!(args.contains(&"--clearenv".to_string()), "--clearenv must be present");
    }

    #[test]
    fn test_setenv_for_whitelisted_var() {
        // Set a known whitelisted variable and verify --setenv appears.
        std::env::set_var("ANTHROPIC_API_KEY", "test-key-12345");
        let project_root = tempfile::tempdir().unwrap();
        let config = make_resolved(minimal_profile(), ProjectConfig::default(), project_root.path().to_path_buf());
        let args = assemble_args(&config).unwrap();

        // Find --setenv ANTHROPIC_API_KEY test-key-12345 triple
        let pos = args.iter().position(|a| a == "--setenv");
        assert!(pos.is_some(), "--setenv should appear for ANTHROPIC_API_KEY");
        let found = args.windows(3).any(|w| {
            w[0] == "--setenv" && w[1] == "ANTHROPIC_API_KEY" && w[2] == "test-key-12345"
        });
        assert!(found, "--setenv ANTHROPIC_API_KEY <value> triple should be present");
    }

    // ── ~/.claude bind test ───────────────────────────────────────────────────

    #[test]
    fn test_claude_dir_always_bound() {
        let home = dirs::home_dir().unwrap();
        let claude_dir = home.join(".claude");
        // Only run this assertion if ~/.claude actually exists on the host
        if !claude_dir.exists() {
            return;
        }
        let project_root = tempfile::tempdir().unwrap();
        let profile = SandboxProfile {
            description: "empty".to_string(),
            rw_paths: vec![],
            ro_paths: vec![],
            excluded_paths: vec![],
            env: vec![],
        };
        let config = make_resolved(profile, ProjectConfig::default(), project_root.path().to_path_buf());
        let args = assemble_args(&config).unwrap();

        let claude_str = claude_dir.to_string_lossy().to_string();
        // Both source and destination should appear
        let occurrences: Vec<_> = args.iter().enumerate().filter(|(_, a)| a.as_str() == claude_str).collect();
        assert!(occurrences.len() >= 2, "~/.claude path should appear as both src and dst");
        // The flag before the first occurrence should be --bind
        let first_idx = occurrences[0].0;
        assert!(first_idx >= 1);
        assert_eq!(args[first_idx - 1], "--bind", "~/.claude must be --bind (rw)");
    }
}
