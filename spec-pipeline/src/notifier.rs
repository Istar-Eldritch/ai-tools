use std::sync::Arc;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use rmcp::model::{
    LoggingLevel, LoggingMessageNotificationParam, NumberOrString, ProgressNotificationParam,
    ProgressToken,
};
use rmcp::service::Peer;
use rmcp::service::RoleServer;
use serde::Serialize;
use tokio::sync::{RwLock, watch};
use tracing::warn;
use uuid::Uuid;

use crate::workflow::SessionState;

/// Handle to the MCP client peer, populated during the MCP handshake.
pub type PeerHandle = Arc<RwLock<Option<Peer<RoleServer>>>>;

/// The type of session event being emitted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionEventType {
    PhaseTransition,
    GateArrived,
    GateResponseReceived,
    WorkflowComplete,
    WorkflowError,
    WorkflowCancelled,
    Keepalive,
}

/// Error details included in `workflow_error` events.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorContent {
    pub message: String,
    pub failed_phase: String,
    pub exit_code: Option<i32>,
}

/// Per-session watch channels so MCP tool handlers can block until state changes.
type StateWatchMap = DashMap<Uuid, watch::Sender<SessionState>>;

/// Cloneable notifier that emits MCP notifications for session state changes.
#[derive(Clone)]
pub struct SessionNotifier {
    peer: PeerHandle,
    watches: Arc<StateWatchMap>,
}

/// Describes a session state change event.
#[derive(Debug, Clone, Serialize)]
pub struct SessionEvent {
    pub schema_version: &'static str,
    pub session_id: Uuid,
    pub workflow_type: String,
    pub event_type: SessionEventType,
    pub session_state: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_phase: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_content: Option<serde_json::Value>,
    pub progress: f64,
    pub total_cost_usd: f64,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorContent>,
}

impl SessionNotifier {
    pub fn new() -> Self {
        Self {
            peer: Arc::new(RwLock::new(None)),
            watches: Arc::new(DashMap::new()),
        }
    }

    /// Returns the inner handle so the MCP handler can set the peer during init.
    pub fn peer_handle(&self) -> PeerHandle {
        Arc::clone(&self.peer)
    }

    /// Create a watch channel for a new session. Returns the receiver.
    pub fn create_watch(&self, session_id: Uuid) -> watch::Receiver<SessionState> {
        let (tx, rx) = watch::channel(SessionState::Running);
        self.watches.insert(session_id, tx);
        rx
    }

    /// Subscribe to an existing session's state changes.
    pub fn subscribe(&self, session_id: Uuid) -> Option<watch::Receiver<SessionState>> {
        self.watches.get(&session_id).map(|tx| tx.subscribe())
    }

    /// Remove the watch channel for a session (cleanup after completion).
    pub fn remove_watch(&self, session_id: Uuid) {
        self.watches.remove(&session_id);
    }

    /// Emit a structured `spec/sessionEvent` custom MCP notification,
    /// plus the existing `notifications/progress` for progress-bar clients.
    /// Also signals the watch channel so blocking tool calls wake up.
    pub async fn notify_event(&self, event: &SessionEvent) {
        // Signal watch channel
        if let Some(tx) = self.watches.get(&event.session_id) {
            let state = parse_session_state(&event.session_state);
            let _ = tx.send(state);
        }

        let guard = self.peer.read().await;
        let peer = match guard.as_ref() {
            Some(p) => p,
            None => return, // peer not yet available (pre-handshake)
        };

        // spec/sessionEvent — structured custom notification
        let params = serde_json::to_value(event).unwrap_or_default();
        let custom = rmcp::model::CustomNotification::new("spec/sessionEvent", Some(params));
        if let Err(e) = peer
            .send_notification(rmcp::model::ServerNotification::CustomNotification(custom))
            .await
        {
            warn!(error = %e, "failed to send spec/sessionEvent notification");
        }

        // notifications/progress — retained for progress-bar clients
        let at_gate = matches!(event.session_state.as_str(), "WaitingAtGate" | "ErrorGate");
        let (progress, total) = progress_for(&event.workflow_type, &event.phase, at_gate);
        let progress_param = ProgressNotificationParam {
            progress_token: ProgressToken(NumberOrString::String(
                event.session_id.to_string().into(),
            )),
            progress,
            total: Some(total),
            message: Some(event.message.clone()),
        };

        if let Err(e) = peer.notify_progress(progress_param).await {
            warn!(error = %e, "failed to send progress notification");
        }
    }

    /// Forward a child agent event as an MCP log notification.
    pub async fn notify_child_event(&self, session_id: Uuid, phase: &str, message: &str) {
        let guard = self.peer.read().await;
        let peer = match guard.as_ref() {
            Some(p) => p,
            None => return,
        };

        let data = serde_json::json!({
            "session_id": session_id,
            "phase": phase,
            "child_event": message,
        });
        let log_param = LoggingMessageNotificationParam::new(LoggingLevel::Debug, data)
            .with_logger("spec-pipeline.agent");

        if let Err(e) = peer.notify_logging_message(log_param).await {
            warn!(error = %e, "failed to send child event notification");
        }
    }

    /// Send a keepalive — both as spec/sessionEvent and as notifications/progress.
    pub async fn send_keepalive(
        &self,
        session_id: Uuid,
        workflow_type: &str,
        phase: &str,
        message: &str,
        progress: f64,
        total: f64,
    ) {
        let guard = self.peer.read().await;
        let peer = match guard.as_ref() {
            Some(p) => p,
            None => return,
        };

        // spec/sessionEvent keepalive
        let event = SessionEvent {
            schema_version: "1",
            session_id,
            workflow_type: workflow_type.to_string(),
            event_type: SessionEventType::Keepalive,
            session_state: "WaitingAtGate".into(),
            phase: phase.to_string(),
            sub_phase: None,
            message: message.to_string(),
            gate_content: None,
            progress,
            total_cost_usd: 0.0,
            timestamp: Utc::now(),
            error: None,
        };

        let params = serde_json::to_value(&event).unwrap_or_default();
        let custom = rmcp::model::CustomNotification::new("spec/sessionEvent", Some(params));
        if let Err(e) = peer
            .send_notification(rmcp::model::ServerNotification::CustomNotification(custom))
            .await
        {
            warn!(error = %e, "failed to send keepalive spec/sessionEvent notification");
        }

        // Also send progress notification (existing behavior)
        let progress_param = ProgressNotificationParam {
            progress_token: ProgressToken(NumberOrString::String(
                session_id.to_string().into(),
            )),
            progress,
            total: Some(total),
            message: Some(message.to_string()),
        };

        if let Err(e) = peer.notify_progress(progress_param).await {
            warn!(error = %e, "failed to send keepalive progress notification");
        }
    }
}

/// Parse a session state string (from Debug format) into a SessionState enum.
fn parse_session_state(s: &str) -> SessionState {
    match s {
        "Running" => SessionState::Running,
        "WaitingAtGate" => SessionState::WaitingAtGate,
        "ErrorGate" => SessionState::ErrorGate,
        "Complete" => SessionState::Complete,
        "Cancelled" => SessionState::Cancelled,
        _ => SessionState::Running,
    }
}

/// Map workflow type + phase to a (progress, total) pair.
pub fn progress_for(workflow_type: &str, phase: &str, at_gate: bool) -> (f64, f64) {
    let total = if workflow_type == "implement" { 8.0 } else { 4.0 };
    let progress = match (workflow_type, phase) {
        ("brainstorm", "discovery") => {
            if at_gate {
                1.5
            } else {
                1.0
            }
        }
        ("brainstorm", "synthesis") => 2.0,
        ("brainstorm", "awaiting_approval") => 3.0,
        ("brainstorm", "complete") => 4.0,

        ("spec", "research") => 1.0,
        ("spec", "drafting") => 2.0,
        ("spec", "awaiting_approval") => 3.0,
        ("spec", "complete") => 4.0,

        ("epic", "child_extraction") => 1.0,
        ("epic", "drafting") => 2.0,
        ("epic", "awaiting_approval") => 3.0,
        ("epic", "complete") => 4.0,

        ("implement", "phase_extraction") => 1.0,
        ("implement", "configuring") => 2.0,
        ("implement", "plan_generation") => 3.0,
        ("implement", "plan_review") => 4.0,
        ("implement", "plan_revision") => 4.0,
        ("implement", "implementation") => 5.0,
        ("implement", "code_review") => 6.0,
        ("implement", "code_revision") => 6.0,
        ("implement", "awaiting_approval") => 7.0,
        ("implement", "iteration_review") => 7.5,
        ("implement", "iteration_revision") => 7.5,
        ("implement", "complete") => 8.0,

        _ => 1.0,
    };
    (progress, total)
}
