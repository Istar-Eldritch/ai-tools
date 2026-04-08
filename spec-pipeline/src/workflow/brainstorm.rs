use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::types::PhaseRole;

/// State machine for the brainstorm workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase")]
pub enum BrainstormState {
    /// Open-ended discovery conversation.
    #[serde(rename = "discovery")]
    Discovery(DiscoveryPhase),
    /// Synthesising a draft document from discovery notes.
    #[serde(rename = "synthesis")]
    Synthesis {
        draft_path: PathBuf,
        revision: u32,
    },
    /// Draft is ready for user approval.
    #[serde(rename = "awaiting_approval")]
    AwaitingApproval {
        artifact_path: PathBuf,
        #[serde(default)]
        revision: u32,
    },
    /// Workflow completed successfully.
    #[serde(rename = "complete")]
    Complete { artifact_path: PathBuf },
    /// Workflow was cancelled by the user.
    #[serde(rename = "cancelled")]
    Cancelled,
    /// A phase failed; waiting for user decision.
    #[serde(rename = "error_gate")]
    ErrorGate {
        message: String,
        failed_phase: String,
        exit_code: Option<i32>,
    },
}

/// Sub-phases within discovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "sub_phase")]
pub enum DiscoveryPhase {
    /// Actively exploring the topic.
    #[serde(rename = "exploring")]
    Exploring { turn: u32 },
    /// Waiting for the user to answer a question.
    #[serde(rename = "awaiting_answer")]
    AwaitingAnswer { question: String },
}

impl BrainstormState {
    /// Human-readable name of the current phase.
    pub fn phase_name(&self) -> &str {
        match self {
            Self::Discovery(_) => "discovery",
            Self::Synthesis { .. } => "synthesis",
            Self::AwaitingApproval { .. } => "awaiting_approval",
            Self::Complete { .. } => "complete",
            Self::Cancelled => "cancelled",
            Self::ErrorGate { .. } => "error_gate",
        }
    }

    /// Human-readable name of the current sub-phase, if any.
    pub fn sub_phase_name(&self) -> Option<&str> {
        match self {
            Self::Discovery(DiscoveryPhase::Exploring { .. }) => Some("exploring"),
            Self::Discovery(DiscoveryPhase::AwaitingAnswer { .. }) => Some("awaiting_answer"),
            _ => None,
        }
    }

    /// Which model tier this phase should use.
    pub fn phase_role(&self) -> PhaseRole {
        match self {
            Self::Discovery(_) => PhaseRole::Discovery,
            Self::Synthesis { .. } => PhaseRole::Synthesis,
            Self::AwaitingApproval { .. } => PhaseRole::Review,
            Self::Complete { .. } => PhaseRole::Review,
            Self::Cancelled => PhaseRole::Review,
            Self::ErrorGate { .. } => PhaseRole::Review,
        }
    }

    /// Paths to artifacts produced so far.
    pub fn artifact_paths(&self) -> Vec<&PathBuf> {
        match self {
            Self::Synthesis { draft_path, .. } => vec![draft_path],
            Self::AwaitingApproval { artifact_path, .. } => vec![artifact_path],
            Self::Complete { artifact_path } => vec![artifact_path],
            _ => vec![],
        }
    }
}
