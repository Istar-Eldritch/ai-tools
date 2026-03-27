use crate::bwrap;
use crate::cli::SetupArgs;
use crate::config;
use crate::error::AppResult;
use std::path::PathBuf;

/// The shell function that shadows `claude` with `claude-sandbox run --`.
const SHELL_FUNCTION: &str = r#"claude() { claude-sandbox run -- "$@"; }"#;

pub fn execute(args: SetupArgs) -> AppResult<()> {
    // --shell-function: print the function and return immediately.
    if args.shell_function {
        println!("{}", SHELL_FUNCTION);
        return Ok(());
    }

    // Verify bwrap is installed.
    bwrap::verify_bwrap_available()?;
    println!("setup: bwrap found");

    // Create the config directory.
    let config_dir = config::machine_config_dir()?;
    std::fs::create_dir_all(&config_dir)?;

    // Generate paths.toml if it doesn't already exist (idempotent).
    let config_path = config::machine_config_path()?;
    if config_path.exists() {
        println!(
            "setup: {} already exists, skipping",
            config_path.display()
        );
    } else {
        let ai_tools = detect_ai_tools_path();
        let content = format!(
            "[tools]\nai_tools = \"{}\"\n\n[paths]\n",
            ai_tools.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"")
        );
        std::fs::write(&config_path, content)?;
        println!("setup: created {}", config_path.display());
    }

    println!();
    println!("setup: configuration complete");
    println!();
    println!("Next steps:");
    println!("  1. Review {}",  config_path.display());
    println!("  2. Run `claude-sandbox init` in a project directory");
    println!(
        "  3. Add to your shell profile: eval \"$(claude-sandbox setup --shell-function)\""
    );

    Ok(())
}

/// Auto-detect the ai_tools directory path.
///
/// Strategy:
/// 1. `AI_TOOLS_DIR` environment variable
/// 2. Walk up from the current executable path looking for an `ai_tools` ancestor
/// 3. Check if the current working directory looks like it's inside ai_tools
/// 4. Fallback placeholder
fn detect_ai_tools_path() -> PathBuf {
    // 1. Environment variable
    if let Ok(val) = std::env::var("AI_TOOLS_DIR") {
        let p = PathBuf::from(&val);
        if p.is_dir() {
            return p;
        }
    }

    // 2. Walk up from the executable path
    if let Ok(exe) = std::env::current_exe() {
        if let Some(found) = walk_up_for_ai_tools(&exe) {
            return found;
        }
    }

    // 3. Walk up from cwd
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(found) = walk_up_for_ai_tools(&cwd) {
            return found;
        }
    }

    // 4. Fallback placeholder
    PathBuf::from("/path/to/ai_tools")
}

/// Walk up from `start` looking for a directory named `ai_tools`.
fn walk_up_for_ai_tools(start: &std::path::Path) -> Option<PathBuf> {
    let mut dir = start.to_path_buf();
    loop {
        if dir.file_name().map(|n| n == "ai_tools").unwrap_or(false) && dir.is_dir() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}
