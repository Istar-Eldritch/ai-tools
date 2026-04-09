use std::sync::Arc;

use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        CallToolResult, Content, Implementation, InitializeRequestParams, InitializeResult,
        ServerCapabilities, ServerInfo,
    },
    schemars, tool, tool_handler, tool_router,
    service::{RoleServer, RequestContext},
};
use serde::Deserialize;
use tracing::info;
use uuid::Uuid;

use chrono::Utc;
use spec_pipeline_mcp::notifier::{
    PeerHandle, SessionEvent as NotifEvent, SessionEventType, SessionNotifier,
};
use spec_pipeline_mcp::phase_runner::{self, GateChannelMap};
use spec_pipeline_mcp::prompts::PromptStore;
use spec_pipeline_mcp::runner::ClaudeRunner;
use spec_pipeline_mcp::session::SessionRegistry;
use spec_pipeline_mcp::workflow::{
    BrainstormState, EpicState, GateResponse, ImplementState, ModelConfig, SessionState, SpecState,
    WorkflowState, WorkflowType,
};
use spec_pipeline_mcp::workflow::brainstorm::DiscoveryPhase;

// -- Request parameter structs --

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpecStartParams {
    /// The type of workflow to start: "brainstorm", "spec", "epic", or "implement".
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
    /// The type of response: "approve", "revise", "cancel", "retry", or "configure".
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
    /// Filter by workflow type: "brainstorm", "spec", "epic", or "implement".
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
    notifier: SessionNotifier,
    peer_handle: PeerHandle,
    tool_router: ToolRouter<McpServer>,
}

impl McpServer {
    pub fn new(
        registry: Arc<SessionRegistry>,
        runner: Arc<ClaudeRunner>,
        gate_channels: Arc<GateChannelMap>,
        model_config: ModelConfig,
        prompts: Arc<PromptStore>,
        notifier: SessionNotifier,
    ) -> Self {
        let peer_handle = notifier.peer_handle();
        Self {
            registry,
            runner,
            gate_channels,
            model_config,
            prompts,
            notifier,
            peer_handle,
            tool_router: Self::tool_router(),
        }
    }
}

impl McpServer {
    /// Spawn the session loop for a given workflow type. Used both at creation
    /// and when resuming a recovered session that was at a gate.
    fn spawn_session_loop(&self, session_id: Uuid, workflow_type: WorkflowType) {
        let registry = Arc::clone(&self.registry);
        let runner = Arc::clone(&self.runner);
        let gate_channels = Arc::clone(&self.gate_channels);
        let model_config = self.model_config.clone();
        let prompts = Arc::clone(&self.prompts);
        let notifier = self.notifier.clone();
        match workflow_type {
            WorkflowType::Brainstorm => {
                tokio::spawn(async move {
                    phase_runner::run_brainstorm_session(
                        session_id, registry, runner, gate_channels,
                        model_config, prompts, notifier,
                    ).await;
                });
            }
            WorkflowType::Spec => {
                tokio::spawn(async move {
                    phase_runner::run_spec_session(
                        session_id, registry, runner, gate_channels,
                        model_config, prompts, notifier,
                    ).await;
                });
            }
            WorkflowType::Epic => {
                tokio::spawn(async move {
                    phase_runner::run_epic_session(
                        session_id, registry, runner, gate_channels,
                        model_config, prompts, notifier,
                    ).await;
                });
            }
            WorkflowType::Implement => {
                tokio::spawn(async move {
                    phase_runner::run_implement_session(
                        session_id, registry, runner, gate_channels,
                        model_config, prompts, notifier,
                    ).await;
                });
            }
        }
    }
}

// -- Tool implementations --

#[tool_router]
impl McpServer {
    #[tool(
        description = "Start a new spec-pipeline workflow session. Creates a session for the given workflow type (brainstorm, spec, epic, or implement) and topic. For implement workflows, topic must be the path to an existing spec file. Returns immediately with the session ID in Running state. Subscribe to spec/sessionEvent notifications for real-time progress updates. The server emits structured notifications on every phase transition, gate arrival, completion, and error — no polling required. Use spec_status only for a one-time snapshot (e.g. on reconnect)."
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
            WorkflowType::Spec => WorkflowState::Spec(SpecState::Research { turn: 0, gate_answer: None }),
            WorkflowType::Epic => WorkflowState::Epic(EpicState::ChildExtraction { turn: 0 }),
            WorkflowType::Implement => {
                // For implement, validate the spec file exists.
                let spec_path = std::path::Path::new(&params.topic);
                if !spec_path.exists() {
                    return Err(McpError::invalid_params(
                        format!("Spec file not found: '{}'", params.topic),
                        None,
                    ));
                }
                WorkflowState::Implement(ImplementState::PhaseExtraction)
            }
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

        // Create watch channel so notifications can signal state transitions.
        let _rx = self.notifier.create_watch(session_id);

        // Spawn the async workflow loop for the appropriate workflow type.
        self.spawn_session_loop(session_id, workflow_type);

        // Emit initial phase_transition so clients know the workflow started.
        {
            let phase = match workflow_type {
                WorkflowType::Brainstorm => "discovery",
                WorkflowType::Spec => "research",
                WorkflowType::Epic => "child_extraction",
                WorkflowType::Implement => "phase_extraction",
            };

            self.notifier
                .notify_event(&NotifEvent {
                    schema_version: "1",
                    session_id,
                    workflow_type: workflow_type.to_string(),
                    event_type: SessionEventType::PhaseTransition,
                    session_state: "Running".into(),
                    phase: phase.to_string(),
                    sub_phase: None,
                    message: format!("Workflow started: {workflow_type}"),
                    gate_content: None,
                    progress: 0.0,
                    total_cost_usd: 0.0,
                    timestamp: Utc::now(),
                    error: None,
                })
                .await;
        }

        // Return immediately — client receives progress via spec/sessionEvent notifications.
        build_session_snapshot(session_id, &self.registry).await
    }

    #[tool(
        description = "Check the status of an existing spec-pipeline session. Returns detailed information about the session including workflow type, phase, state, and any gate content. Do not poll this tool — subscribe to spec/sessionEvent notifications for real-time updates. Use this only for a one-time snapshot, e.g. on reconnect."
    )]
    async fn spec_status(
        &self,
        Parameters(params): Parameters<SpecStatusParams>,
    ) -> Result<CallToolResult, McpError> {
        let id = parse_uuid(&params.session_id)?;
        build_session_snapshot(id, &self.registry).await
    }

    #[tool(
        description = "Respond to a spec-pipeline session gate. Sends a user response (approve, revise, cancel, retry) to a session that is waiting at a gate. Returns immediately after delivering the response. A gate_response_received notification is emitted, followed by phase_transition notifications as the workflow resumes. Subscribe to spec/sessionEvent notifications for real-time progress — no polling required."
    )]
    async fn spec_respond(
        &self,
        Parameters(params): Parameters<SpecRespondParams>,
    ) -> Result<CallToolResult, McpError> {
        let id = parse_uuid(&params.session_id)?;

        // Parse response_type into a GateResponse
        let gate_response = match params.response_type.as_str() {
            "approve" => GateResponse::Approve { content: params.content.clone() },
            "revise" => GateResponse::Revise {
                feedback: params.content.unwrap_or_default(),
            },
            "cancel" => GateResponse::Cancel,
            "retry" => GateResponse::Retry,
            "configure" => GateResponse::Configure {
                config_json: params.content.unwrap_or_default(),
            },
            other => {
                return Err(McpError::invalid_params(
                    format!(
                        "Invalid response_type '{}'. Must be one of: approve, revise, cancel, retry, configure",
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

        // Verify the session is actually at a gate
        {
            let session = handle.lock().await;
            let state = session.session_state();
            if !matches!(state, SessionState::WaitingAtGate | SessionState::ErrorGate) {
                return Err(McpError::invalid_params(
                    format!("Session {id} is not at a gate (state: {state:?})"),
                    None,
                ));
            }
        }

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
                // No gate channel — recovered session whose loop isn't running.
                // Apply the response directly and restart the loop in the new state.
                info!(
                    session_id = %id,
                    response_type = %params.response_type,
                    "no gate channel; applying response directly to recovered session"
                );
                let wt = {
                    let h = self.registry.get(id).ok_or_else(|| {
                        McpError::internal_error(format!("Session {id} vanished"), None)
                    })?;
                    let s = h.lock().await;
                    s.workflow_state.workflow_type()
                };
                let should_continue = phase_runner::apply_gate_response(
                    id,
                    gate_response,
                    &self.registry,
                    &wt.to_string(),
                    &self.notifier,
                )
                .await;
                if should_continue {
                    self.spawn_session_loop(id, wt);
                }
                // Response was applied directly; report success.
                true
            }
        };

        if !sent {
            // Gate response couldn't be delivered — return immediately with current state.
            return build_session_snapshot(id, &self.registry).await;
        }

        // Emit gate_response_received notification
        {
            let handle = self.registry.get(id).ok_or_else(|| {
                McpError::internal_error(format!("Session {id} vanished"), None)
            })?;
            let session = handle.lock().await;
            let wt = session.workflow_state.workflow_type().to_string();
            let phase = session.workflow_state.phase_name().to_string();
            let sub_phase = session.workflow_state.sub_phase_name().map(|s| s.to_string());
            let cost = session.total_cost_usd;
            drop(session);

            self.notifier
                .notify_event(&NotifEvent {
                    schema_version: "1",
                    session_id: id,
                    workflow_type: wt,
                    event_type: SessionEventType::GateResponseReceived,
                    session_state: "Running".into(),
                    phase,
                    sub_phase,
                    message: format!("Gate response accepted: {}", params.response_type),
                    gate_content: None,
                    progress: 0.0,
                    total_cost_usd: cost,
                    timestamp: Utc::now(),
                    error: None,
                })
                .await;
        }

        build_session_snapshot(id, &self.registry).await
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

        // Emit cancellation notification
        {
            let handle = self.registry.get(id).ok_or_else(|| {
                McpError::internal_error(format!("Session {id} vanished"), None)
            })?;
            let session = handle.lock().await;
            let wt = session.workflow_state.workflow_type().to_string();
            let phase = session.workflow_state.phase_name().to_string();
            let cost = session.total_cost_usd;
            drop(session);

            self.notifier
                .notify_event(&NotifEvent {
                    schema_version: "1",
                    session_id: id,
                    workflow_type: wt,
                    event_type: SessionEventType::WorkflowCancelled,
                    session_state: "Cancelled".into(),
                    phase,
                    sub_phase: None,
                    message: "Workflow cancelled by user".into(),
                    gate_content: None,
                    progress: 0.0,
                    total_cost_usd: cost,
                    timestamp: Utc::now(),
                    error: None,
                })
                .await;
        }

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
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_logging()
                .build(),
        )
        .with_server_info(Implementation::new(
            "spec-pipeline-mcp",
            env!("CARGO_PKG_VERSION"),
        ))
    }

    fn initialize(
        &self,
        request: InitializeRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<InitializeResult, McpError>> + Send + '_ {
        let peer = context.peer.clone();
        async move {
            // Store the peer so background tasks can send notifications
            {
                let mut guard = self.peer_handle.write().await;
                *guard = Some(peer);
            }
            // Replicate default initialize behavior
            if context.peer.peer_info().is_none() {
                context.peer.set_peer_info(request);
            }
            Ok(self.get_info())
        }
    }
}

// -- Helpers --

/// Parse a string into a WorkflowType, returning an MCP error on invalid input.
fn parse_workflow_type(s: &str) -> Result<WorkflowType, McpError> {
    match s {
        "brainstorm" => Ok(WorkflowType::Brainstorm),
        "spec" => Ok(WorkflowType::Spec),
        "epic" => Ok(WorkflowType::Epic),
        "implement" => Ok(WorkflowType::Implement),
        _ => Err(McpError::invalid_params(
            format!(
                "Invalid workflow_type '{}'. Must be one of: brainstorm, spec, epic, implement",
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

/// Read the full session state from the registry and return it as a CallToolResult.
async fn build_session_snapshot(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
) -> Result<CallToolResult, McpError> {
    let handle = registry.get(session_id).ok_or_else(|| {
        McpError::internal_error(format!("Session {session_id} vanished"), None)
    })?;

    let session = handle.lock().await;
    let state = session.session_state();

    let last_activity = registry.last_activity(session_id);

    let state_str = format!("{:?}", state);
    let event_type = match state_str.as_str() {
        "Complete" => "workflow_complete",
        "Cancelled" => "workflow_cancelled",
        "ErrorGate" => "workflow_error",
        "WaitingAtGate" => "gate_arrived",
        _ => "phase_transition",
    };

    let json = serde_json::json!({
        "schema_version": "1",
        "session_id": session.id.to_string(),
        "topic": session.topic,
        "workflow_type": session.workflow_state.workflow_type().to_string(),
        "event_type": event_type,
        "session_state": state_str,
        "phase": session.workflow_state.phase_name(),
        "sub_phase": session.workflow_state.sub_phase_name(),
        "context_refs": session.context_refs,
        "model_override": session.model_override,
        "total_cost_usd": session.total_cost_usd,
        "gate_content": session.workflow_state.gate_content(),
        "last_activity": last_activity,
        "created_at": session.created_at.to_rfc3339(),
        "updated_at": session.updated_at.to_rfc3339(),
    });

    Ok(CallToolResult::success(vec![Content::text(
        serde_json::to_string_pretty(&json).map_err(|e| serialization_error(e))?,
    )]))
}
