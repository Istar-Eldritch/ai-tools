use crate::bwrap;
use crate::cli::CheckArgs;
use crate::config;
use crate::error::AppResult;

pub fn execute(args: CheckArgs) -> AppResult<()> {
    crate::commands::run::verify_bwrap_available()?;
    let resolved = config::resolve_config(args.profile.as_deref())?;
    bwrap::validate(&resolved)?;
    let bwrap_args = bwrap::assemble_args(&resolved)?;

    // Count mounts: --bind and --ro-bind each consume 3 positions (flag, src, dst)
    let mount_count = bwrap_args
        .iter()
        .filter(|a| a.as_str() == "--bind" || a.as_str() == "--ro-bind")
        .count();

    // Count env vars: --setenv consumes 3 positions (flag, name, value)
    let env_count = bwrap_args
        .iter()
        .filter(|a| a.as_str() == "--setenv")
        .count();

    println!("check: sandbox environment OK");
    println!("  profile:      {}", resolved.profile_name);
    println!("  project root: {}", resolved.project_root.display());
    println!("  mounts:       {}", mount_count);
    println!("  env vars:     {}", env_count);

    Ok(())
}
