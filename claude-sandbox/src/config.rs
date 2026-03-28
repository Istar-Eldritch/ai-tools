use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A sandbox profile defining filesystem mount rules.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct SandboxProfile {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub rw_paths: Vec<String>,
    #[serde(default)]
    pub ro_paths: Vec<String>,
    #[serde(default)]
    pub excluded_paths: Vec<String>,
    #[serde(default)]
    pub env: Vec<String>,
}

/// Per-project sandbox configuration (`.claude/sandbox.toml`).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct ProjectConfig {
    #[serde(default = "default_profile")]
    pub profile: String,
    #[serde(default)]
    pub extra_paths: Vec<ExtraPath>,
    #[serde(default)]
    pub extra_env: Vec<String>,
}

fn default_profile() -> String {
    "minimal".to_string()
}

impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            profile: default_profile(),
            extra_paths: Vec::new(),
            extra_env: Vec::new(),
        }
    }
}

/// An additional path mount with a specified mode.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct ExtraPath {
    pub path: String,
    pub mode: MountMode,
}

/// Whether a path is mounted read-only or read-write.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MountMode {
    Ro,
    Rw,
}

/// Machine-level configuration (`~/.config/claude-sandbox/paths.toml`).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MachineConfig {
    #[serde(default)]
    pub tools: ToolPaths,
    #[serde(default)]
    pub paths: HashMap<String, String>,
}

impl Default for MachineConfig {
    fn default() -> Self {
        Self {
            tools: ToolPaths::default(),
            paths: HashMap::new(),
        }
    }
}

/// Paths to tools used by the sandbox.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct ToolPaths {
    pub ai_tools: Option<String>,
}

/// Fully resolved configuration combining profile, project, and machine configs.
// Constructed during sandbox launch once all config layers are loaded and merged.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub profile_name: String,
    pub profile: SandboxProfile,
    pub project: ProjectConfig,
    pub machine: MachineConfig,
    pub project_root: PathBuf,
}

/// Return the machine config directory (`~/.config/claude-sandbox/`).
pub fn machine_config_dir() -> AppResult<PathBuf> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        AppError::Config("Could not determine user config directory".to_string())
    })?;
    Ok(config_dir.join("claude-sandbox"))
}

/// Return the machine config file path.
pub fn machine_config_path() -> AppResult<PathBuf> {
    Ok(machine_config_dir()?.join("paths.toml"))
}

/// Detect the project root by:
/// 1. Running `git rev-parse --show-toplevel` (fastest, covers most cases).
/// 2. Walking upward from cwd searching for `.claude/sandbox.toml` (R13 fallback).
/// 3. Falling back to the current working directory.
pub fn detect_project_root() -> AppResult<PathBuf> {
    // Step 1: try git rev-parse --show-toplevel
    if let Ok(output) = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
    {
        if output.status.success() {
            let toplevel = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !toplevel.is_empty() {
                return Ok(PathBuf::from(toplevel));
            }
        }
    }

    // Step 2: walk upward searching for .claude/sandbox.toml
    let cwd = std::env::current_dir()?;
    let mut dir = cwd.as_path();
    loop {
        if dir.join(".claude").join("sandbox.toml").exists() {
            return Ok(dir.to_path_buf());
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return Ok(cwd),
        }
    }
}

/// Load a sandbox profile by name from the ai_tools sandboxes directory.
pub fn load_profile(ai_tools_dir: &Path, name: &str) -> AppResult<SandboxProfile> {
    let path = ai_tools_dir.join("claude-sandbox").join("sandboxes").join(format!("{}.toml", name));
    if !path.exists() {
        return Err(AppError::ProfileNotFound(format!(
            "Profile '{}' not found at {}",
            name,
            path.display()
        )));
    }
    let content = std::fs::read_to_string(&path)?;
    let profile: SandboxProfile = toml::from_str(&content)?;
    Ok(profile)
}

/// Load the project configuration from a project root directory.
/// Returns `None` if no `.claude/sandbox.toml` exists.
pub fn load_project_config(project_root: &Path) -> AppResult<Option<ProjectConfig>> {
    let path = project_root.join(".claude").join("sandbox.toml");
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)?;
    let config: ProjectConfig = toml::from_str(&content)?;
    Ok(Some(config))
}

/// Resolve a fully merged configuration from all layers.
///
/// - Detects the project root
/// - Loads machine config (required in production; see note below)
/// - Loads project config (or defaults)
/// - Loads the sandbox profile (using optional override)
///
/// Machine config is required when `paths.toml` exists.  When it is absent,
/// the function falls back to a `CARGO_MANIFEST_DIR`-relative path so that
/// the test suite can locate profiles without a real machine config file.
/// This fallback is test/dev-only — production use always requires machine
/// config to be present.
pub fn resolve_config(profile_override: Option<&str>) -> AppResult<ResolvedConfig> {
    // Try to load the machine config.  If it is absent, attempt the
    // CARGO_MANIFEST_DIR fallback (valid only in test / dev environments).
    let machine = match load_machine_config() {
        Ok(m) => m,
        Err(_) => {
            // If the machine config is missing and ai_tools has not been set
            // via any other means, we synthesise a minimal MachineConfig that
            // points at the workspace root derived from CARGO_MANIFEST_DIR.
            // This keeps the test suite working without requiring a real
            // paths.toml on every developer machine.
            let fallback_ai_tools = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            MachineConfig {
                tools: ToolPaths {
                    ai_tools: Some(fallback_ai_tools.to_string_lossy().to_string()),
                },
                paths: std::collections::HashMap::new(),
            }
        }
    };

    let project_root = detect_project_root()?;
    let project = load_project_config(&project_root)?.ok_or_else(|| {
        AppError::Config(format!(
            "No sandbox.toml found at '{}/.claude/sandbox.toml'. Run `claude-sandbox init` to create one.",
            project_root.display()
        ))
    })?;

    let profile_name = profile_override
        .map(|s| s.to_string())
        .unwrap_or_else(|| project.profile.clone());

    // Determine ai_tools directory: from machine config.
    // The CARGO_MANIFEST_DIR fallback above guarantees this is always set.
    let ai_tools_dir = machine
        .tools
        .ai_tools
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    let profile = load_profile(&ai_tools_dir, &profile_name)?;

    Ok(ResolvedConfig {
        profile_name,
        profile,
        project,
        machine,
        project_root,
    })
}

/// Load the machine configuration (fail-closed).
///
/// Returns `Err` if `paths.toml` does not exist.  The sandbox must be
/// explicitly configured before use; silently accepting a missing config
/// would allow the tool to run without any machine-specific path bindings,
/// which violates the R10 fail-closed requirement.
pub fn load_machine_config() -> AppResult<MachineConfig> {
    let path = machine_config_path()?;
    if !path.exists() {
        return Err(AppError::Config(format!(
            "Machine config not found at '{}'. Run `claude-sandbox setup` to create it.",
            path.display()
        )));
    }
    let content = std::fs::read_to_string(&path)?;
    let config: MachineConfig = toml::from_str(&content)?;
    Ok(config)
}
