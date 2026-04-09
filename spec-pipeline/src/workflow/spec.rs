use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::types::PhaseRole;

/// State machine for the spec workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase")]
pub enum SpecState {
    /// Researching the problem space.
    #[serde(rename = "research")]
    Research {
        turn: u32,
        /// Answer from a prior gate question, if any.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        gate_answer: Option<String>,
    },
    /// Research paused — waiting for user answer to a clarifying question.
    #[serde(rename = "awaiting_answer")]
    AwaitingAnswer { question: String },
    /// Drafting the specification document.
    #[serde(rename = "drafting")]
    Drafting {
        draft_path: PathBuf,
        revision: u32,
        /// Revision feedback from the user, if this is a revision cycle.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        feedback: Option<String>,
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

impl SpecState {
    /// Human-readable name of the current phase.
    pub fn phase_name(&self) -> &str {
        match self {
            Self::Research { .. } => "research",
            Self::AwaitingAnswer { .. } => "awaiting_answer",
            Self::Drafting { .. } => "drafting",
            Self::AwaitingApproval { .. } => "awaiting_approval",
            Self::Complete { .. } => "complete",
            Self::Cancelled => "cancelled",
            Self::ErrorGate { .. } => "error_gate",
        }
    }

    /// Human-readable name of the current sub-phase, if any.
    pub fn sub_phase_name(&self) -> Option<&str> {
        None
    }

    /// Which model tier this phase should use.
    pub fn phase_role(&self) -> PhaseRole {
        match self {
            Self::Research { .. } => PhaseRole::Discovery,
            Self::AwaitingAnswer { .. } => PhaseRole::Discovery,
            Self::Drafting { .. } => PhaseRole::Synthesis,
            Self::AwaitingApproval { .. } => PhaseRole::Review,
            Self::Complete { .. } => PhaseRole::Review,
            Self::Cancelled => PhaseRole::Review,
            Self::ErrorGate { .. } => PhaseRole::Review,
        }
    }

    /// Paths to artifacts produced so far.
    pub fn artifact_paths(&self) -> Vec<&PathBuf> {
        match self {
            Self::Drafting { draft_path, .. } => vec![draft_path],
            Self::AwaitingApproval { artifact_path, .. } => vec![artifact_path],
            Self::Complete { artifact_path } => vec![artifact_path],
            _ => vec![],
        }
    }
}
