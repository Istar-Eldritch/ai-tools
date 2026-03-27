use crate::config::ResolvedConfig;
use crate::config::MountMode;
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

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

    // Read-only binds from profile
    for ro_path in &config.profile.ro_paths {
        let expanded = expand_tilde(ro_path)?;
        if host_path_exists(&expanded) {
            let p = expanded.to_string_lossy().to_string();
            args.extend_from_slice(&["--ro-bind".to_string(), p.clone(), p]);
        }
    }

    // Read-write binds from profile
    for rw_path in &config.profile.rw_paths {
        let expanded = expand_tilde(rw_path)?;
        if host_path_exists(&expanded) {
            let p = expanded.to_string_lossy().to_string();
            args.extend_from_slice(&["--bind".to_string(), p.clone(), p]);
        }
    }

    // Project root: always rw bind
    {
        let p = config.project_root.to_string_lossy().to_string();
        args.extend_from_slice(&["--bind".to_string(), p.clone(), p]);
    }

    // Extra paths from project config
    for extra in &config.project.extra_paths {
        let expanded = expand_tilde(&extra.path)?;
        if host_path_exists(&expanded) {
            let p = expanded.to_string_lossy().to_string();
            let flag = match extra.mode {
                MountMode::Ro => "--ro-bind",
                MountMode::Rw => "--bind",
            };
            args.extend_from_slice(&[flag.to_string(), p.clone(), p]);
        }
    }

    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
