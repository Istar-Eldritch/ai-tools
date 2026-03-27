use crate::bwrap;
use crate::cli::RunArgs;
use crate::config;
use crate::error::{AppError, AppResult};
use std::os::unix::process::CommandExt;
use std::process::Command;

pub fn execute(args: RunArgs) -> AppResult<()> {
    // R10 fail-closed: verify bwrap is installed before doing anything else.
    bwrap::verify_bwrap_available()?;

    // Resolve the absolute path to the claude binary before entering the
    // sandbox.  Inside the namespace only explicitly mounted paths are visible,
    // so a bare "claude" would fail with ENOENT.
    let claude_path = resolve_claude_path()?;

    let resolved = config::resolve_config(args.profile.as_deref())?;
    bwrap::validate(&resolved)?;
    let bwrap_args = bwrap::assemble_args(&resolved, Some(&claude_path))?;

    let mut full_args = bwrap_args;
    full_args.push(claude_path.to_string_lossy().to_string());
    full_args.extend(args.claude_args);

    if args.dry_run {
        println!("bwrap {}", shell_join(&full_args));
        return Ok(());
    }

    let err = Command::new("bwrap").args(&full_args).exec();
    // exec() only returns on error
    Err(AppError::Io(err))
}

/// Locate the `claude` binary on the host, returning its absolute path.
///
/// Tries `which claude` first, then common installation locations.
fn resolve_claude_path() -> AppResult<std::path::PathBuf> {
    use std::path::PathBuf;

    // Try PATH lookup via `which`
    if let Ok(output) = Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    // Common locations
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            home.join(".local/bin/claude"),
            home.join(".nvm/versions/node/current/bin/claude"),
        ];
        for candidate in &candidates {
            if candidate.exists() {
                return Ok(candidate.clone());
            }
        }
    }

    // System-wide
    let system = std::path::Path::new("/usr/local/bin/claude");
    if system.exists() {
        return Ok(system.to_path_buf());
    }

    Err(AppError::General(
        "Could not find the `claude` binary. Ensure Claude Code is installed and on your PATH."
            .to_string(),
    ))
}

/// Join args with shell-safe quoting for display.
///
/// Note: this output is for human-readable display only.  It is not guaranteed
/// to be copy-paste safe for all inputs (e.g. paths containing newlines or
/// other non-printable characters are not escaped).
fn shell_join(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            if a.contains(' ') || a.contains('\'') || a.contains('"') || a.is_empty() {
                format!("'{}'", a.replace('\'', "'\\''"))
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
