use serde::{Deserialize, Serialize};

use super::types::PhaseRole;

/// A single phase extracted from the spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedPhase {
    /// 1-indexed phase number.
    pub number: u32,
    /// Filesystem-safe slug derived from the focus description.
    pub slug: String,
    /// Full focus description from the spec.
    pub description: String,
}

/// User-configurable model assignments for the implement workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImplementConfig {
    /// Model used to review code.
    pub reviewer: String,
    /// Model used to revise code after review.
    pub reviser: String,
    /// Model used to implement code changes.
    pub implementer: String,
    /// Max code review+revision cycles per phase before forcing advancement.
    pub code_revision_limit: u32,
}

impl Default for ImplementConfig {
    fn default() -> Self {
        Self {
            reviewer: "sonnet".to_string(),
            reviser: "sonnet".to_string(),
            implementer: "opus".to_string(),
            code_revision_limit: 3,
        }
    }
}

/// Metrics collected for a single implementation phase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseMetrics {
    pub phase_number: u32,
    pub code_cycles: u32,
    pub code_approved_first_pass: bool,
}

/// State machine for the implement workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase")]
pub enum ImplementState {
    /// Extracting phases from the spec file.
    #[serde(rename = "phase_extraction")]
    PhaseExtraction,

    /// Waiting for user to review extracted phases and confirm model config.
    #[serde(rename = "configuring")]
    Configuring {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
    },

    /// Implementing the current phase.
    #[serde(rename = "implementation")]
    Implementation {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// Reviewing the implementation of the current phase.
    #[serde(rename = "code_review")]
    CodeReview {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        code_revision: u32,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// Revising the implementation based on code review feedback.
    #[serde(rename = "code_revision")]
    CodeRevision {
        phases: Vec<ExtractedPhase>,
        current_phase_idx: usize,
        code_revision: u32,
        review_feedback: String,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
    },

    /// All phases complete -- awaiting user approval.
    #[serde(rename = "awaiting_approval")]
    AwaitingApproval {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
        approval_revision: u32,
    },

    /// Global review of the full implementation (post-approval iteration).
    #[serde(rename = "iteration_review")]
    IterationReview {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
        iteration: u32,
    },

    /// Global revision of the full implementation.
    #[serde(rename = "iteration_revision")]
    IterationRevision {
        phases: Vec<ExtractedPhase>,
        config: ImplementConfig,
        metrics: Vec<PhaseMetrics>,
        iteration: u32,
        review_feedback: String,
    },

    /// Workflow completed successfully.
    #[serde(rename = "complete")]
    Complete {
        spec_path: String,
        metrics: Vec<PhaseMetrics>,
    },

    /// Workflow was cancelled.
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

impl ImplementState {
    /// Human-readable name of the current phase.
    pub fn phase_name(&self) -> &str {
        match self {
            Self::PhaseExtraction => "phase_extraction",
            Self::Configuring { .. } => "configuring",
            Self::Implementation { .. } => "implementation",
            Self::CodeReview { .. } => "code_review",
            Self::CodeRevision { .. } => "code_revision",
            Self::AwaitingApproval { .. } => "awaiting_approval",
            Self::IterationReview { .. } => "iteration_review",
            Self::IterationRevision { .. } => "iteration_revision",
            Self::Complete { .. } => "complete",
            Self::Cancelled => "cancelled",
            Self::ErrorGate { .. } => "error_gate",
        }
    }

    /// Human-readable name of the current sub-phase, if any.
    pub fn sub_phase_name(&self) -> Option<&str> {
        // For implement, the phase_name already captures the sub-phase granularity.
        None
    }

    /// Which model tier this phase should use.
    pub fn phase_role(&self) -> PhaseRole {
        match self {
            Self::PhaseExtraction => PhaseRole::Discovery,
            Self::Implementation { .. } => PhaseRole::Synthesis,
            Self::CodeReview { .. } => PhaseRole::Review,
            Self::CodeRevision { .. } => PhaseRole::Synthesis,
            Self::IterationReview { .. } => PhaseRole::Review,
            Self::IterationRevision { .. } => PhaseRole::Synthesis,
            Self::Configuring { .. } => PhaseRole::Review,
            Self::AwaitingApproval { .. } => PhaseRole::Review,
            Self::Complete { .. } => PhaseRole::Review,
            Self::Cancelled => PhaseRole::Review,
            Self::ErrorGate { .. } => PhaseRole::Review,
        }
    }

    /// Paths to artifacts produced so far.
    ///
    /// The implement workflow stores plan paths as bare filenames resolved at
    /// runtime against a TempDir, so no PathBuf artifacts are tracked in state.
    pub fn artifact_paths(&self) -> Vec<&std::path::PathBuf> {
        vec![]
    }
}
