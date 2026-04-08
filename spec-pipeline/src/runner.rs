use std::path::{Path, PathBuf};
use std::process::Stdio;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tracing::{debug, info, warn};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum RunnerError {
    #[error("claude subprocess failed (exit code {exit_code:?}): {stderr}")]
    SubprocessFailed {
        exit_code: Option<i32>,
        stderr: String,
    },

    #[error("claude subprocess timed out after {timeout_secs}s")]
    Timeout { timeout_secs: u64 },

    #[error("failed to parse claude envelope: {source}")]
    InvalidEnvelope {
        raw_stdout: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("failed to parse phase output from result field: {source}")]
    InvalidPhaseOutput {
        raw_result: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("failed to spawn claude subprocess: {0}")]
    SpawnFailed(#[source] std::io::Error),

    #[error("failed to serialize context to JSON: {0}")]
    SerializeFailed(#[source] serde_json::Error),
}

// ---------------------------------------------------------------------------
// Claude envelope (the JSON wrapper `claude -p --output-format json` emits)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ClaudeEnvelope {
    /// The JSON-schema-validated output as a string.
    pub result: String,
    #[serde(default)]
    pub total_cost_usd: f64,
    #[serde(default)]
    pub stop_reason: String,
    #[serde(default)]
    pub num_turns: u32,
}

// ---------------------------------------------------------------------------
// Raw phase output — the structured value Claude is asked to produce.
// This mirrors the shape we ask Claude to emit via JSON schema.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type")]
pub enum RawPhaseOutput {
    #[serde(rename = "continue")]
    Continue,

    #[serde(rename = "gate")]
    Gate {
        question: String,
        artifact_path: Option<String>,
    },

    #[serde(rename = "done")]
    Done {
        artifact_path: String,
        summary: String,
    },
}

// ---------------------------------------------------------------------------
// Phase context — serialized and piped to claude's stdin
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct PhaseContext {
    pub topic: String,
    pub workflow_type: String,
    pub phase: String,
    pub sub_phase: Option<String>,
    pub prior_artifacts: Vec<String>,
    pub context_refs: Vec<String>,
    pub gate_history: Vec<GateHistoryEntry>,
    pub revision_feedback: Option<String>,
    pub revision: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct GateHistoryEntry {
    pub phase: String,
    pub question: Option<String>,
    pub response: String,
}

// ---------------------------------------------------------------------------
// Phase run result
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct PhaseRunResult {
    pub output: RawPhaseOutput,
    pub cost_usd: f64,
    pub stop_reason: String,
    pub num_turns: u32,
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/// Default timeout for a single phase run (seconds).
const DEFAULT_TIMEOUT_SECS: u64 = 300;

pub struct ClaudeRunner {
    /// Optional path to the RAG MCP server config JSON file.
    rag_mcp_config: Option<PathBuf>,
    /// Temp directory that keeps the schema file alive.
    _schema_dir: tempfile::TempDir,
    /// Path to the generated JSON schema for RawPhaseOutput.
    phase_output_schema: PathBuf,
}

impl ClaudeRunner {
    /// Create a new runner. Generates the JSON schema file for phase output.
    pub fn new(rag_mcp_config: Option<PathBuf>) -> Result<Self, RunnerError> {
        let schema_dir =
            tempfile::TempDir::new().map_err(|e| RunnerError::SpawnFailed(e))?;

        let schema = schemars::schema_for!(RawPhaseOutput);
        let schema_json =
            serde_json::to_string_pretty(&schema).map_err(RunnerError::SerializeFailed)?;

        let schema_path = schema_dir.path().join("phase_output_schema.json");
        std::fs::write(&schema_path, &schema_json)
            .map_err(|e| RunnerError::SpawnFailed(e))?;

        debug!(path = %schema_path.display(), "wrote phase output JSON schema");

        Ok(Self {
            rag_mcp_config,
            _schema_dir: schema_dir,
            phase_output_schema: schema_path,
        })
    }

    /// Run a single phase by invoking `claude -p` as a subprocess.
    pub async fn run_phase(
        &self,
        context: &PhaseContext,
        model: &str,
        system_prompt: &Path,
    ) -> Result<PhaseRunResult, RunnerError> {
        let context_json =
            serde_json::to_string_pretty(context).map_err(RunnerError::SerializeFailed)?;

        let mut cmd = tokio::process::Command::new("claude");
        cmd.arg("-p")
            .arg("--bare")
            .arg("--no-session-persistence")
            .arg("--output-format")
            .arg("json")
            .arg("--json-schema")
            .arg(&self.phase_output_schema)
            .arg("--model")
            .arg(model)
            .arg("--system-prompt-file")
            .arg(system_prompt)
            .arg("--max-turns")
            .arg("50");

        // If a RAG MCP config is available, pass it with strict mode.
        if let Some(ref mcp_config) = self.rag_mcp_config {
            cmd.arg("--mcp-config")
                .arg(mcp_config)
                .arg("--strict-mcp-config");
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        info!(
            phase = %context.phase,
            model = model,
            "spawning claude subprocess"
        );

        let mut child = cmd.spawn().map_err(RunnerError::SpawnFailed)?;

        // Write context JSON to stdin.
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(context_json.as_bytes())
                .await
                .map_err(|e| RunnerError::SpawnFailed(e))?;
            // Drop to close stdin so claude reads EOF.
        }

        // Wait with timeout.
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS),
            child.wait_with_output(),
        )
        .await
        .map_err(|_| RunnerError::Timeout {
            timeout_secs: DEFAULT_TIMEOUT_SECS,
        })?
        .map_err(|e| RunnerError::SpawnFailed(e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            warn!(
                exit_code = output.status.code(),
                stderr = %stderr,
                "claude subprocess exited with non-zero status"
            );
            return Err(RunnerError::SubprocessFailed {
                exit_code: output.status.code(),
                stderr,
            });
        }

        // Parse the envelope.
        let envelope: ClaudeEnvelope =
            serde_json::from_str(&stdout).map_err(|e| RunnerError::InvalidEnvelope {
                raw_stdout: stdout.clone(),
                source: e,
            })?;

        info!(
            cost_usd = envelope.total_cost_usd,
            stop_reason = %envelope.stop_reason,
            num_turns = envelope.num_turns,
            "claude subprocess completed"
        );

        // Parse the actual phase output from the result string.
        let raw_output: RawPhaseOutput = serde_json::from_str(&envelope.result).map_err(|e| {
            RunnerError::InvalidPhaseOutput {
                raw_result: envelope.result.clone(),
                source: e,
            }
        })?;

        debug!(?raw_output, "parsed phase output");

        Ok(PhaseRunResult {
            output: raw_output,
            cost_usd: envelope.total_cost_usd,
            stop_reason: envelope.stop_reason,
            num_turns: envelope.num_turns,
        })
    }
}
