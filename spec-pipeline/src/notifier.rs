use std::sync::Arc;

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
    pub session_id: Uuid,
    pub workflow_type: String,
    pub session_state: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_phase: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_content: Option<serde_json::Value>,
    pub progress: f64,
    pub total: f64,
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

    /// Emit both `notifications/progress` and `notifications/message` for the event,
    /// and signal the watch channel so blocking tool calls wake up.
    pub async fn notify(&self, event: &SessionEvent) {
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

        // notifications/progress — session UUID as token
        let progress_param = ProgressNotificationParam {
            progress_token: ProgressToken(NumberOrString::String(
                event.session_id.to_string().into(),
            )),
            progress: event.progress,
            total: Some(event.total),
            message: Some(event.message.clone()),
        };

        if let Err(e) = peer.notify_progress(progress_param).await {
            warn!(error = %e, "failed to send progress notification");
        }

        // notifications/message — structured JSON payload
        let data = serde_json::to_value(event).unwrap_or_default();
        let log_param = LoggingMessageNotificationParam::new(LoggingLevel::Info, data)
            .with_logger("spec-pipeline");

        if let Err(e) = peer.notify_logging_message(log_param).await {
            warn!(error = %e, "failed to send logging notification");
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
        let log_param = LoggingMessageNotificationParam::new(LoggingLevel::Info, data)
            .with_logger("spec-pipeline.agent");

        if let Err(e) = peer.notify_logging_message(log_param).await {
            warn!(error = %e, "failed to send child event notification");
        }
    }

    /// Send a keepalive progress notification (used during blocking waits).
    pub async fn send_keepalive(&self, session_id: Uuid, message: &str, progress: f64, total: f64) {
        let guard = self.peer.read().await;
        let peer = match guard.as_ref() {
            Some(p) => p,
            None => return,
        };

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
    let total = 4.0;
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

        _ => 1.0,
    };
    (progress, total)
}
