use std::sync::Arc;

use rmcp::model::{
    LoggingLevel, LoggingMessageNotificationParam, NumberOrString, ProgressNotificationParam,
    ProgressToken,
};
use rmcp::service::Peer;
use rmcp::service::RoleServer;
use serde::Serialize;
use tokio::sync::RwLock;
use tracing::warn;
use uuid::Uuid;

/// Handle to the MCP client peer, populated during the MCP handshake.
pub type PeerHandle = Arc<RwLock<Option<Peer<RoleServer>>>>;

/// Cloneable notifier that emits MCP notifications for session state changes.
#[derive(Clone)]
pub struct SessionNotifier {
    peer: PeerHandle,
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
        }
    }

    /// Returns the inner handle so the MCP handler can set the peer during init.
    pub fn peer_handle(&self) -> PeerHandle {
        Arc::clone(&self.peer)
    }

    /// Emit both `notifications/progress` and `notifications/message` for the event.
    pub async fn notify(&self, event: &SessionEvent) {
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
