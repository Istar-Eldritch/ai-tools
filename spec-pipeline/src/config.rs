use std::path::PathBuf;

use clap::Args;

#[derive(Debug, Clone, Args)]
pub struct Config {
    /// Directory for persistent session state
    #[arg(long, env = "SPEC_PIPELINE_STATE_DIR")]
    pub state_dir: Option<PathBuf>,

    /// Directory for log files
    #[arg(long, env = "SPEC_PIPELINE_LOG_DIR")]
    pub log_dir: Option<PathBuf>,

    /// Path to the MCP server configuration file for child agents
    #[arg(long, env = "SPEC_PIPELINE_MCP_CONFIG")]
    pub mcp_config: Option<PathBuf>,
}

impl Config {
    /// Resolved state directory, defaulting to ~/.local/state/spec-pipeline/sessions/
    pub fn resolved_state_dir(&self) -> PathBuf {
        self.state_dir.clone().unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            PathBuf::from(home).join(".local/state/spec-pipeline/sessions")
        })
    }

    /// Resolved log directory, defaulting to ~/.local/state/spec-pipeline/logs/
    pub fn resolved_log_dir(&self) -> PathBuf {
        self.log_dir.clone().unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            PathBuf::from(home).join(".local/state/spec-pipeline/logs")
        })
    }
}
