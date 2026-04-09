use std::path::{Path, PathBuf};
use std::process::Stdio;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
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

    #[error("claude subprocess timed out after {timeout_secs}s; stderr: {stderr}")]
    Timeout { timeout_secs: u64, stderr: String },

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

    #[error("no result event found in stream-json output")]
    MissingResult,

    #[error("failed to spawn claude subprocess: {0}")]
    SpawnFailed(#[source] std::io::Error),

    #[error("failed to serialize context to JSON: {0}")]
    SerializeFailed(#[source] serde_json::Error),
}

// ---------------------------------------------------------------------------
// Claude envelope (parsed from the stream-json "result" event)
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
    #[serde(default)]
    pub session_id: String,
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
        #[serde(default)]
        artifact_path: String,
        #[serde(default)]
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
    pub claude_session_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Child event — forwarded to the caller for progress reporting
// ---------------------------------------------------------------------------

/// An event from the child claude subprocess that callers can observe.
#[derive(Debug, Clone)]
pub struct ChildEvent {
    pub message: String,
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/// Default timeout for a single phase run (seconds).
const DEFAULT_TIMEOUT_SECS: u64 = 600;

pub struct ClaudeRunner {
    /// Path to the MCP config JSON file passed to `claude -p`.
    /// Always set — contains the RAG server config when available, otherwise
    /// an empty `{"mcpServers":{}}` to prevent Claude from loading the
    /// user's default MCP servers (which would recursively spawn this server).
    mcp_config: PathBuf,
    /// Temp directory that keeps the MCP config file alive (when using empty config).
    _schema_dir: tempfile::TempDir,
    /// JSON schema string for RawPhaseOutput, passed inline to `--json-schema`.
    phase_output_schema: String,
}

impl ClaudeRunner {
    /// Create a new runner. Generates the JSON schema file for phase output.
    pub fn new(mcp_config: Option<PathBuf>) -> Result<Self, RunnerError> {
        let schema_dir =
            tempfile::TempDir::new().map_err(|e| RunnerError::SpawnFailed(e))?;

        // Hand-written flat schema for RawPhaseOutput.  schemars produces a
        // `oneOf` which the Claude API rejects at the top level, so we flatten
        // the tagged enum into a single object with optional variant fields.
        // Field descriptions tell Claude which fields are required per variant.
        let schema_json = serde_json::json!({
            "type": "object",
            "required": ["type"],
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["continue", "gate", "done"],
                    "description": "The output type. 'continue' needs no other fields. 'gate' requires 'question'. 'done' requires 'artifact_path' and 'summary'."
                },
                "question": {
                    "type": "string",
                    "description": "Required when type is 'gate'. The question to present to the user."
                },
                "artifact_path": {
                    "type": "string",
                    "description": "Required when type is 'done'. Path to the produced artifact (empty string if none). Optional when type is 'gate'."
                },
                "summary": {
                    "type": "string",
                    "description": "Required when type is 'done'. Brief summary of what was accomplished."
                }
            }
        })
        .to_string();

        debug!("generated phase output JSON schema");

        // Resolve the MCP config path. If one was provided, use it.
        // Otherwise write an empty config so `claude -p` won't load the user's
        // default MCP servers (which include *this* server → infinite recursion).
        let mcp_config = match mcp_config {
            Some(path) => path,
            None => {
                let empty_path = schema_dir.path().join("empty_mcp_config.json");
                std::fs::write(&empty_path, r#"{"mcpServers":{}}"#)
                    .map_err(RunnerError::SpawnFailed)?;
                empty_path
            }
        };

        Ok(Self {
            mcp_config,
            _schema_dir: schema_dir,
            phase_output_schema: schema_json,
        })
    }

    /// Run a single phase by invoking `claude -p` as a subprocess.
    ///
    /// If `event_tx` is provided, child agent events (tool calls, etc.) are
    /// streamed through the channel as they happen.
    pub async fn run_phase(
        &self,
        context: &PhaseContext,
        model: &str,
        system_prompt: &Path,
        event_tx: Option<mpsc::UnboundedSender<ChildEvent>>,
        claude_session_id: Option<&str>,
    ) -> Result<PhaseRunResult, RunnerError> {
        let context_json =
            serde_json::to_string_pretty(context).map_err(RunnerError::SerializeFailed)?;

        let mut cmd = tokio::process::Command::new("claude");
        cmd.arg("-p")
            .arg("--dangerously-skip-permissions");

        if let Some(sid) = claude_session_id {
            cmd.arg("--resume").arg(sid);
        } else {
            cmd.arg("--no-session-persistence");
        }

        cmd.arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--json-schema")
            .arg(&self.phase_output_schema)
            .arg("--model")
            .arg(model)
            .arg("--system-prompt-file")
            .arg(system_prompt)
            .arg("--max-turns")
            .arg("50");

        // Always pass --mcp-config with --strict-mcp-config to prevent
        // Claude from loading default MCP servers (which would recursively
        // spawn this server). The config is either the RAG server config or
        // an empty config written at construction time.
        cmd.arg("--mcp-config")
            .arg(&self.mcp_config)
            .arg("--strict-mcp-config");

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        info!(
            phase = %context.phase,
            model = model,
            resuming = claude_session_id.is_some(),
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

        // Take stdout for line-by-line streaming.
        let stdout = child.stdout.take().expect("stdout was piped");
        let mut lines = BufReader::new(stdout).lines();

        // Collect stderr in the background for error reporting.
        let stderr_handle = {
            let stderr = child.stderr.take().expect("stderr was piped");
            tokio::spawn(async move {
                let mut buf = String::new();
                let mut reader = BufReader::new(stderr);
                reader.read_to_string(&mut buf).await.ok();
                buf
            })
        };

        // Read stdout lines, forwarding events and capturing the result.
        let mut result_event: Option<ClaudeEnvelope> = None;
        // --json-schema puts the structured output in a StructuredOutput tool
        // call's input (inside an "assistant" event), NOT in the result event's
        // `result` field.  Capture it here so we can use it as the result.
        let mut structured_output: Option<String> = None;

        let stream_result = tokio::time::timeout(
            std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS),
            async {
                while let Some(line) = lines
                    .next_line()
                    .await
                    .map_err(RunnerError::SpawnFailed)?
                {
                    let v: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(e) => {
                            debug!(error = %e, "skipping non-JSON line from child");
                            continue;
                        }
                    };

                    let event_type = v
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("");

                    match event_type {
                        "assistant" => {
                            extract_and_send_events(&v, &event_tx);
                            // Capture StructuredOutput tool call input.
                            if let Some(content) =
                                v.pointer("/message/content").and_then(|c| c.as_array())
                            {
                                for block in content {
                                    if block.get("type").and_then(|t| t.as_str())
                                        == Some("tool_use")
                                        && block.get("name").and_then(|n| n.as_str())
                                            == Some("StructuredOutput")
                                    {
                                        if let Some(input) = block.get("input") {
                                            let serialized = serde_json::to_string(input)
                                                .unwrap_or_default();
                                            debug!(
                                                input_len = serialized.len(),
                                                input_preview = %truncate(&serialized, 120),
                                                "captured StructuredOutput tool call"
                                            );
                                            structured_output = Some(serialized);
                                        } else {
                                            warn!("StructuredOutput tool_use block has no input field");
                                        }
                                    }
                                }
                            }
                        }
                        "result" => {
                            // When --json-schema is used, the structured output
                            // appears in three possible locations (in priority order):
                            //   1. A top-level "structured_output" field in the result event (JSON object)
                            //   2. The StructuredOutput tool_use input captured from assistant events
                            //   3. The "result" text field (only for non-json-schema modes)
                            let so_from_result_event = v
                                .get("structured_output")
                                .filter(|s| !s.is_null())
                                .map(|s| serde_json::to_string(s).unwrap_or_default())
                                .filter(|s| !s.is_empty());

                            let so_from_tool_capture = structured_output.take();

                            let result_str = v
                                .get("result")
                                .and_then(|r| r.as_str())
                                .unwrap_or("")
                                .to_string();

                            let stop_reason_str = v
                                .get("stop_reason")
                                .and_then(|s| s.as_str())
                                .unwrap_or("");
                            let num_turns_val = v
                                .get("num_turns")
                                .and_then(|n| n.as_u64())
                                .unwrap_or(0);

                            // Pick the best source for the phase output.
                            let phase_result = if let Some(so) = so_from_result_event {
                                debug!(source = "result_event.structured_output", "using structured output from result event");
                                so
                            } else if let Some(so) = so_from_tool_capture {
                                debug!(source = "tool_use_capture", "using structured output from StructuredOutput tool call");
                                so
                            } else if !result_str.is_empty() {
                                debug!(source = "result_text", "using result text field (non-schema mode)");
                                result_str.clone()
                            } else {
                                warn!(
                                    stop_reason = stop_reason_str,
                                    num_turns = num_turns_val,
                                    "no structured output found in any source"
                                );
                                String::new()
                            };

                            result_event = Some(ClaudeEnvelope {
                                result: phase_result,
                                total_cost_usd: v
                                    .get("total_cost_usd")
                                    .and_then(|c| c.as_f64())
                                    .unwrap_or(0.0),
                                stop_reason: v
                                    .get("stop_reason")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                num_turns: v
                                    .get("num_turns")
                                    .and_then(|n| n.as_u64())
                                    .unwrap_or(0)
                                    as u32,
                                session_id: v
                                    .get("session_id")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            });
                        }
                        _ => {} // skip system, rate_limit_event, etc.
                    }
                }
                Ok::<(), RunnerError>(())
            },
        )
        .await;

        match stream_result {
            Err(_) => {
                // Timeout: kill the child so it doesn't leak, then capture stderr.
                child.kill().await.ok();
                let stderr = stderr_handle.await.unwrap_or_default();
                warn!(
                    stderr = %stderr,
                    timeout_secs = DEFAULT_TIMEOUT_SECS,
                    "claude subprocess timed out — captured stderr"
                );
                return Err(RunnerError::Timeout {
                    timeout_secs: DEFAULT_TIMEOUT_SECS,
                    stderr,
                });
            }
            Ok(Err(e)) => {
                child.kill().await.ok();
                return Err(e);
            }
            Ok(Ok(())) => {}
        }

        // Wait for child to exit.
        let status = child.wait().await.map_err(RunnerError::SpawnFailed)?;
        let stderr = stderr_handle.await.unwrap_or_default();

        if !status.success() {
            // Claude CLI puts errors in stdout (as JSON result events), not stderr.
            // Include the result text so the caller gets an actionable message.
            let error_detail = result_event
                .as_ref()
                .map(|e| e.result.clone())
                .filter(|r| !r.is_empty())
                .unwrap_or_default();
            let combined = if error_detail.is_empty() {
                stderr.clone()
            } else if stderr.is_empty() {
                error_detail
            } else {
                format!("{stderr}\n{error_detail}")
            };
            warn!(
                exit_code = status.code(),
                stderr = %stderr,
                result = %combined,
                "claude subprocess exited with non-zero status"
            );
            return Err(RunnerError::SubprocessFailed {
                exit_code: status.code(),
                stderr: combined,
            });
        }

        let envelope = result_event.ok_or(RunnerError::MissingResult)?;

        info!(
            cost_usd = envelope.total_cost_usd,
            stop_reason = %envelope.stop_reason,
            num_turns = envelope.num_turns,
            "claude subprocess completed"
        );

        // Parse the actual phase output from the result string.
        let raw_output: RawPhaseOutput = serde_json::from_str(&envelope.result).map_err(|e| {
            warn!(
                raw_result_len = envelope.result.len(),
                raw_result_preview = %truncate(&envelope.result, 200),
                stop_reason = %envelope.stop_reason,
                num_turns = envelope.num_turns,
                "failed to parse phase output"
            );
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
            claude_session_id: if envelope.session_id.is_empty() {
                None
            } else {
                Some(envelope.session_id)
            },
        })
    }
}

// ---------------------------------------------------------------------------
// Stream-json event helpers
// ---------------------------------------------------------------------------

/// Extract tool_use events from an assistant message and send them.
fn extract_and_send_events(
    v: &serde_json::Value,
    event_tx: &Option<mpsc::UnboundedSender<ChildEvent>>,
) {
    let tx = match event_tx {
        Some(tx) => tx,
        None => return,
    };

    let content = match v.pointer("/message/content").and_then(|c| c.as_array()) {
        Some(arr) => arr,
        None => return,
    };

    for block in content {
        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if block_type == "tool_use" {
            let name = block
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            let input = block.get("input").cloned().unwrap_or_default();
            let summary = summarize_tool_input(name, &input);
            let msg = if summary.is_empty() {
                format!("tool: {name}")
            } else {
                format!("tool: {name} {summary}")
            };
            let _ = tx.send(ChildEvent { message: msg });
        }
    }
}

/// Build a short human-readable summary of a tool's input.
fn summarize_tool_input(tool_name: &str, input: &serde_json::Value) -> String {
    match tool_name {
        "Read" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Edit" | "Write" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Grep" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            let path = input.get("path").and_then(|v| v.as_str());
            match path {
                Some(p) => format!("\"{pattern}\" in {p}"),
                None => format!("\"{pattern}\""),
            }
        }
        "Glob" => input
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Bash" => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            truncate(cmd, 80)
        }
        _ => {
            // For unknown tools, show first string value (truncated)
            input
                .as_object()
                .and_then(|obj| obj.values().find_map(|v| v.as_str()))
                .map(|s| truncate(s, 80))
                .unwrap_or_default()
        }
    }
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}…", &s[..max_len])
    }
}
