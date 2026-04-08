use anyhow::{Context, Result, bail};
use tokio::process::Command;

/// Run `claude --version` and return the version string.
pub async fn validate_claude_cli() -> Result<String> {
    let output = Command::new("claude")
        .arg("--version")
        .output()
        .await
        .context(
            "Failed to execute `claude --version`. \
             Is the Claude CLI installed and on your PATH?"
        )?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "`claude --version` exited with status {}.\nstderr: {}",
            output.status,
            stderr.trim()
        );
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        bail!("`claude --version` returned empty output");
    }

    Ok(version)
}

/// Run a minimal `claude -p` probe to verify credentials are valid.
pub async fn validate_claude_credentials() -> Result<()> {
    // Write a temporary empty MCP config so that `claude -p` does not load
    // the user's default MCP servers.  Without this, Claude would try to
    // start *this* MCP server, creating an infinite recursion of processes.
    let tmp = tempfile::NamedTempFile::new()
        .context("failed to create temp file for empty MCP config")?;
    std::fs::write(tmp.path(), r#"{"mcpServers":{}}"#)
        .context("failed to write empty MCP config")?;

    let output = Command::new("claude")
        .args([
            "-p", "say ok",
            "--output-format", "json",
            "--max-turns", "1",
            "--mcp-config",
        ])
        .arg(tmp.path())
        .arg("--strict-mcp-config")
        .output()
        .await
        .context(
            "Failed to execute credential probe (`claude -p`). \
             Is the Claude CLI installed and on your PATH?"
        )?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        bail!(
            "Claude credential probe failed (exit status {}).\n\
             This usually means your Claude credentials are missing or expired.\n\
             Run `claude` interactively to authenticate.\n\
             stderr: {}\nstdout: {}",
            output.status,
            stderr.trim(),
            stdout.trim()
        );
    }

    Ok(())
}
