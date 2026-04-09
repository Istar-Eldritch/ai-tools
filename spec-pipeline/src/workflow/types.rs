use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// The kind of workflow being executed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowType {
    Brainstorm,
    Spec,
    Epic,
}

impl std::fmt::Display for WorkflowType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Brainstorm => write!(f, "brainstorm"),
            Self::Spec => write!(f, "spec"),
            Self::Epic => write!(f, "epic"),
        }
    }
}

/// High-level session state derived from the current workflow phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    Running,
    WaitingAtGate,
    ErrorGate,
    Complete,
    Cancelled,
}

/// User response to a gate prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GateResponse {
    /// User approved the gate; proceed to next phase.
    /// Content carries an optional answer (e.g. for research questions).
    #[serde(rename = "approve")]
    Approve { content: Option<String> },
    /// User requested revisions with feedback.
    #[serde(rename = "revise")]
    Revise { feedback: String },
    /// User chose to cancel the workflow.
    #[serde(rename = "cancel")]
    Cancel,
    /// User chose to retry after an error gate.
    #[serde(rename = "retry")]
    Retry,
}

/// Output returned by a phase execution step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PhaseOutput {
    /// Phase completed; continue to the next phase automatically.
    #[serde(rename = "continue")]
    Continue,
    /// Phase reached a gate; wait for user input.
    #[serde(rename = "gate")]
    Gate { content: GateContent },
    /// Workflow is done; final artifact produced.
    #[serde(rename = "done")]
    Done { artifact_path: PathBuf },
}

/// Content presented to the user at a gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateContent {
    /// Human-readable summary of what was produced.
    pub summary: String,
    /// Path to the artifact being reviewed, if any.
    pub artifact_path: Option<PathBuf>,
    /// Suggested actions the user can take.
    pub suggested_actions: Vec<String>,
}

/// Context captured when a phase fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorContext {
    /// Human-readable error message.
    pub message: String,
    /// The phase that was running when the error occurred.
    pub failed_phase: String,
    /// Process exit code, if available.
    pub exit_code: Option<i32>,
}

/// Which model tier to use for a given role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PhaseRole {
    Discovery,
    Synthesis,
    Review,
}

/// Model configuration for each phase role.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// Model used for discovery / exploration phases.
    pub discovery: String,
    /// Model used for synthesis / drafting phases.
    pub synthesis: String,
    /// Model used for review / validation phases.
    pub review: String,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            discovery: "sonnet".to_string(),
            synthesis: "sonnet".to_string(),
            review: "haiku".to_string(),
        }
    }
}

impl ModelConfig {
    /// Look up the model name for a given phase role.
    pub fn for_role(&self, role: PhaseRole) -> &str {
        match role {
            PhaseRole::Discovery => &self.discovery,
            PhaseRole::Synthesis => &self.synthesis,
            PhaseRole::Review => &self.review,
        }
    }
}
