use std::sync::Arc;

use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, Implementation, ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;
use tracing::info;
use uuid::Uuid;

use spec_pipeline_mcp::phase_runner::{self, GateChannelMap};
use spec_pipeline_mcp::prompts::PromptStore;
use spec_pipeline_mcp::runner::ClaudeRunner;
use spec_pipeline_mcp::session::SessionRegistry;
use spec_pipeline_mcp::workflow::{
    BrainstormState, EpicState, GateResponse, ModelConfig, SpecState, WorkflowState, WorkflowType,
};
use spec_pipeline_mcp::workflow::brainstorm::DiscoveryPhase;

// -- Request parameter structs --

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpecStartParams {
    /// The type of workflow to start: "brainstorm", "spec", or "epic".
    pub workflow_type: String,
    /// The topic or subject for this workflow session.
    pub topic: String,
    /// Optional list of context references (file paths, URLs, etc.) to inform the workflow.
    pub context_refs: Option<Vec<String>>,
    /// Optional model override (e.g. "opus", "sonnet", "haiku").
    pub model: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpecStatusParams {
    /// The UUID of the session to query.
    pub session_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpecRespondParams {
    /// The UUID of the session to respond to.
    pub session_id: String,
    /// The type of response: "approve", "revise", "cancel", or "retry".
    pub response_type: String,
    /// Optional content for the response (e.g. revision feedback).
    pub content: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpecCancelParams {
    /// The UUID of the session to cancel.
    pub session_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpecListParams {
    /// Whether to include completed and cancelled sessions. Defaults to false.
    pub include_completed: Option<bool>,
    /// Filter by workflow type: "brainstorm", "spec", or "epic".
    pub workflow_type: Option<String>,
    /// Maximum number of sessions to return. Defaults to 20.
    pub limit: Option<usize>,
}

// -- McpServer --

#[derive(Clone)]
pub struct McpServer {
    registry: Arc<SessionRegistry>,
    runner: Arc<ClaudeRunner>,
    gate_channels: Arc<GateChannelMap>,
    model_config: ModelConfig,
    prompts: Arc<PromptStore>,
    tool_router: ToolRouter<McpServer>,
}

impl McpServer {
    pub fn new(
        registry: Arc<SessionRegistry>,
        runner: Arc<ClaudeRunner>,
        gate_channels: Arc<GateChannelMap>,
        model_config: ModelConfig,
        prompts: Arc<PromptStore>,
    ) -> Self {
        Self {
            registry,
            runner,
            gate_channels,
            model_config,
            prompts,
            tool_router: Self::tool_router(),
        }
    }
}

// -- Tool implementations --

#[tool_router]
impl McpServer {
    #[tool(
        description = "Start a new spec-pipeline workflow session. Creates a session for the given workflow type (brainstorm, spec, or epic) and topic. Returns the session ID and initial status."
    )]
    async fn spec_start(
        &self,
        Parameters(params): Parameters<SpecStartParams>,
    ) -> Result<CallToolResult, McpError> {
        let workflow_type = parse_workflow_type(&params.workflow_type)?;

        let initial_state = match workflow_type {
            WorkflowType::Brainstorm => {
                WorkflowState::Brainstorm(BrainstormState::Discovery(DiscoveryPhase::Exploring {
                    turn: 0,
                }))
            }
            WorkflowType::Spec => WorkflowState::Spec(SpecState::Research { turn: 0 }),
            WorkflowType::Epic => WorkflowState::Epic(EpicState::ChildExtraction { turn: 0 }),
        };

        let context_refs = params.context_refs.unwrap_or_default();

        let session_id = self
            .registry
            .create(
                params.topic,
                initial_state,
                context_refs,
                params.model,
            )
            .map_err(anyhow_to_mcp)?;

        // Spawn the async workflow loop for brainstorm sessions.
        if workflow_type == WorkflowType::Brainstorm {
            let registry = Arc::clone(&self.registry);
            let runner = Arc::clone(&self.runner);
            let gate_channels = Arc::clone(&self.gate_channels);
            let model_config = self.model_config.clone();
            let prompts = Arc::clone(&self.prompts);
            tokio::spawn(async move {
                phase_runner::run_brainstorm_session(
                    session_id,
                    registry,
                    runner,
                    gate_channels,
                    model_config,
                    prompts,
                )
                .await;
            });
        }

        let json = serde_json::json!({
            "session_id": session_id.to_string(),
            "status": "running",
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string(&json).map_err(|e| serialization_error(e))?,
        )]))
    }

    #[tool(
        description = "Check the status of an existing spec-pipeline session. Returns detailed information about the session including workflow type, phase, state, and any gate content."
    )]
    async fn spec_status(
        &self,
        Parameters(params): Parameters<SpecStatusParams>,
    ) -> Result<CallToolResult, McpError> {
        let id = parse_uuid(&params.session_id)?;

        let handle = self.registry.get(id).ok_or_else(|| {
            McpError::invalid_params(format!("Session not found: {id}"), None)
        })?;

        let session = handle.lock().await;
        let state = session.session_state();

        let json = serde_json::json!({
            "session_id": session.id.to_string(),
            "topic": session.topic,
            "workflow_type": session.workflow_state.workflow_type().to_string(),
            "session_state": format!("{:?}", state),
            "phase": session.workflow_state.phase_name(),
            "sub_phase": session.workflow_state.sub_phase_name(),
            "context_refs": session.context_refs,
            "model_override": session.model_override,
            "total_cost_usd": session.total_cost_usd,
            "gate_content": session.workflow_state.gate_content(),
            "created_at": session.created_at.to_rfc3339(),
            "updated_at": session.updated_at.to_rfc3339(),
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json).map_err(|e| serialization_error(e))?,
        )]))
    }

    #[tool(
        description = "Respond to a spec-pipeline session gate. Sends a user response (approve, revise, cancel, retry) to a session that is waiting at a gate."
    )]
    async fn spec_respond(
        &self,
        Parameters(params): Parameters<SpecRespondParams>,
    ) -> Result<CallToolResult, McpError> {
        let id = parse_uuid(&params.session_id)?;

        // Parse response_type into a GateResponse
        let gate_response = match params.response_type.as_str() {
            "approve" => GateResponse::Approve,
            "revise" => GateResponse::Revise {
                feedback: params.content.unwrap_or_default(),
            },
            "cancel" => GateResponse::Cancel,
            "retry" => GateResponse::Retry,
            other => {
                return Err(McpError::invalid_params(
                    format!(
                        "Invalid response_type '{}'. Must be one of: approve, revise, cancel, retry",
                        other
                    ),
                    None,
                ));
            }
        };

        // Verify the session exists
        let handle = self.registry.get(id).ok_or_else(|| {
            McpError::invalid_params(format!("Session not found: {id}"), None)
        })?;

        // Read current state for the response (short lock)
        let current_state = {
            let session = handle.lock().await;
            format!("{:?}", session.session_state())
        };

        // Send the response through the gate channel
        let sent = match self.gate_channels.remove(&id) {
            Some((_, tx)) => {
                let response_type_str = params.response_type.clone();
                match tx.send(gate_response) {
                    Ok(()) => {
                        info!(
                            session_id = %id,
                            response_type = %response_type_str,
                            "gate response sent to session loop"
                        );
                        true
                    }
                    Err(_) => {
                        info!(
                            session_id = %id,
                            response_type = %response_type_str,
                            "gate channel receiver dropped (session may have ended)"
                        );
                        false
                    }
                }
            }
            None => {
                info!(
                    session_id = %id,
                    response_type = %params.response_type,
                    "no gate channel found (session not waiting at a gate)"
                );
                false
            }
        };

        let json = serde_json::json!({
            "session_id": id.to_string(),
            "acknowledged": sent,
            "response_type": params.response_type,
            "current_state": current_state,
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string(&json).map_err(|e| serialization_error(e))?,
        )]))
    }

    #[tool(
        description = "Cancel an active spec-pipeline session. Transitions the session to a cancelled state. Cannot cancel sessions that are already complete or cancelled."
    )]
    async fn spec_cancel(
        &self,
        Parameters(params): Parameters<SpecCancelParams>,
    ) -> Result<CallToolResult, McpError> {
        let id = parse_uuid(&params.session_id)?;

        self.registry.cancel(id).await.map_err(anyhow_to_mcp)?;

        let json = serde_json::json!({
            "session_id": id.to_string(),
            "status": "cancelled",
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string(&json).map_err(|e| serialization_error(e))?,
        )]))
    }

    #[tool(
        description = "List spec-pipeline sessions. Returns a summary of sessions optionally filtered by completion state and workflow type. Results are ordered by most recently updated first."
    )]
    async fn spec_list(
        &self,
        Parameters(params): Parameters<SpecListParams>,
    ) -> Result<CallToolResult, McpError> {
        let include_completed = params.include_completed.unwrap_or(false);
        let limit = params.limit.unwrap_or(20);

        let workflow_type = match params.workflow_type {
            Some(ref wt) => Some(parse_workflow_type(wt)?),
            None => None,
        };

        let summaries = self
            .registry
            .list(include_completed, workflow_type, limit)
            .await;

        let json = serde_json::to_string(&summaries).map_err(|e| serialization_error(e))?;

        Ok(CallToolResult::success(vec![Content::text(json)]))
    }
}

// -- ServerHandler --

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "spec-pipeline-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
    }
}

// -- Helpers --

/// Parse a string into a WorkflowType, returning an MCP error on invalid input.
fn parse_workflow_type(s: &str) -> Result<WorkflowType, McpError> {
    match s {
        "brainstorm" => Ok(WorkflowType::Brainstorm),
        "spec" => Ok(WorkflowType::Spec),
        "epic" => Ok(WorkflowType::Epic),
        _ => Err(McpError::invalid_params(
            format!(
                "Invalid workflow_type '{}'. Must be one of: brainstorm, spec, epic",
                s
            ),
            None,
        )),
    }
}

/// Parse a UUID string, returning an MCP error on invalid input.
fn parse_uuid(s: &str) -> Result<Uuid, McpError> {
    Uuid::parse_str(s).map_err(|_| {
        McpError::invalid_params(format!("Invalid UUID: '{s}'"), None)
    })
}

/// Convert an anyhow::Error into an McpError.
fn anyhow_to_mcp(e: anyhow::Error) -> McpError {
    tracing::error!(error = %e, "tool call error");
    McpError::internal_error(format!("{e:#}"), None)
}

/// Create an McpError for serialization failures.
fn serialization_error(e: serde_json::Error) -> McpError {
    McpError::internal_error(format!("serialization error: {e}"), None)
}
