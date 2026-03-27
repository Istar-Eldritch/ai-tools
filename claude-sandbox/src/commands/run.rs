use crate::bwrap;
use crate::cli::RunArgs;
use crate::config;
use crate::error::{AppError, AppResult};
use std::os::unix::process::CommandExt;
use std::process::Command;

pub fn execute(args: RunArgs) -> AppResult<()> {
    // R10 fail-closed: verify bwrap is installed before doing anything else.
    // If it is absent the error message is unambiguous and the tool does not
    // proceed with a partially-constructed command.
    verify_bwrap_available()?;

    let resolved = config::resolve_config(args.profile.as_deref())?;
    let bwrap_args = bwrap::assemble_args(&resolved)?;

    let mut full_args = bwrap_args;
    full_args.push("claude".to_string());
    full_args.extend(args.claude_args);

    if args.dry_run {
        println!("bwrap {}", shell_join(&full_args));
        return Ok(());
    }

    let err = Command::new("bwrap").args(&full_args).exec();
    // exec() only returns on error
    Err(AppError::Io(err))
}

/// Check that the `bwrap` binary exists and is executable.
/// Returns `Err` with a clear message if it cannot be found.
fn verify_bwrap_available() -> AppResult<()> {
    match Command::new("bwrap").arg("--version").output() {
        Ok(_) => Ok(()), // binary exists; exit code is irrelevant
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::General(
                "bwrap not found. Install bubblewrap (e.g. `apt install bubblewrap`) and try again.".to_string(),
            ))
        }
        Err(e) => Err(AppError::Io(e)),
    }
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
