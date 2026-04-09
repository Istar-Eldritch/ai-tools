pub mod brainstorm;
pub mod epic;
pub mod implement;
pub mod spec;
pub mod types;

pub use brainstorm::BrainstormState;
pub use epic::EpicState;
pub use implement::ImplementState;
pub use spec::SpecState;
pub use types::{
    ErrorContext, GateContent, GateResponse, ModelConfig, PhaseOutput, PhaseRole, SessionState,
    WorkflowType,
};

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Trait for types that represent a workflow phase state machine.
pub trait WorkflowPhase {
    /// Human-readable name of the current phase.
    fn phase_name(&self) -> &str;

    /// Human-readable name of the current sub-phase, if any.
    fn sub_phase_name(&self) -> Option<&str>;

    /// Which model tier this phase should use.
    fn phase_role(&self) -> PhaseRole;

    /// Paths to artifacts produced so far.
    fn artifact_paths(&self) -> Vec<&PathBuf>;
}

/// Trait for states that can present a gate to the user.
pub trait HasGate {
    /// Build the gate content to show the user, if currently at a gate.
    fn gate_content(&self) -> Option<GateContent>;

    /// Whether the current state is an error gate.
    fn is_error_gate(&self) -> bool;
}

// --- WorkflowPhase trait impls ---

impl WorkflowPhase for BrainstormState {
    fn phase_name(&self) -> &str {
        self.phase_name()
    }

    fn sub_phase_name(&self) -> Option<&str> {
        self.sub_phase_name()
    }

    fn phase_role(&self) -> PhaseRole {
        self.phase_role()
    }

    fn artifact_paths(&self) -> Vec<&PathBuf> {
        self.artifact_paths()
    }
}

impl WorkflowPhase for SpecState {
    fn phase_name(&self) -> &str {
        self.phase_name()
    }

    fn sub_phase_name(&self) -> Option<&str> {
        self.sub_phase_name()
    }

    fn phase_role(&self) -> PhaseRole {
        self.phase_role()
    }

    fn artifact_paths(&self) -> Vec<&PathBuf> {
        self.artifact_paths()
    }
}

impl WorkflowPhase for EpicState {
    fn phase_name(&self) -> &str {
        self.phase_name()
    }

    fn sub_phase_name(&self) -> Option<&str> {
        self.sub_phase_name()
    }

    fn phase_role(&self) -> PhaseRole {
        self.phase_role()
    }

    fn artifact_paths(&self) -> Vec<&PathBuf> {
        self.artifact_paths()
    }
}

impl WorkflowPhase for ImplementState {
    fn phase_name(&self) -> &str {
        self.phase_name()
    }

    fn sub_phase_name(&self) -> Option<&str> {
        self.sub_phase_name()
    }

    fn phase_role(&self) -> PhaseRole {
        self.phase_role()
    }

    fn artifact_paths(&self) -> Vec<&PathBuf> {
        self.artifact_paths()
    }
}

// --- HasGate trait impls ---

impl HasGate for BrainstormState {
    fn gate_content(&self) -> Option<GateContent> {
        match self {
            BrainstormState::AwaitingApproval {
                artifact_path,
                revision,
            } => {
                let mut actions = vec!["approve".to_string()];
                if *revision < crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    actions.push("revise".to_string());
                }
                actions.push("cancel".to_string());
                let summary = if *revision >= crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    format!(
                        "Brainstorm draft is ready for review. Revision limit ({}) reached — please approve or cancel.",
                        crate::phase_runner::FEEDBACK_DEPTH_LIMIT
                    )
                } else {
                    "Brainstorm draft is ready for review.".to_string()
                };
                Some(GateContent {
                    summary,
                    artifact_path: Some(artifact_path.clone()),
                    suggested_actions: actions,
                })
            }
            BrainstormState::ErrorGate { message, .. } => Some(GateContent {
                summary: format!("Error: {message}"),
                artifact_path: None,
                suggested_actions: vec!["retry".to_string(), "cancel".to_string()],
            }),
            _ => None,
        }
    }

    fn is_error_gate(&self) -> bool {
        matches!(self, BrainstormState::ErrorGate { .. })
    }
}

impl HasGate for SpecState {
    fn gate_content(&self) -> Option<GateContent> {
        match self {
            SpecState::AwaitingApproval {
                artifact_path,
                revision,
            } => {
                let mut actions = vec!["approve".to_string()];
                if *revision < crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    actions.push("revise".to_string());
                }
                actions.push("cancel".to_string());
                let summary = if *revision >= crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    format!(
                        "Spec draft is ready for review. Revision limit ({}) reached — please approve or cancel.",
                        crate::phase_runner::FEEDBACK_DEPTH_LIMIT
                    )
                } else {
                    "Spec draft is ready for review.".to_string()
                };
                Some(GateContent {
                    summary,
                    artifact_path: Some(artifact_path.clone()),
                    suggested_actions: actions,
                })
            }
            SpecState::AwaitingAnswer { question } => Some(GateContent {
                summary: question.clone(),
                artifact_path: None,
                suggested_actions: vec!["approve".to_string(), "cancel".to_string()],
            }),
            SpecState::ErrorGate { message, .. } => Some(GateContent {
                summary: format!("Error: {message}"),
                artifact_path: None,
                suggested_actions: vec!["retry".to_string(), "cancel".to_string()],
            }),
            _ => None,
        }
    }

    fn is_error_gate(&self) -> bool {
        matches!(self, SpecState::ErrorGate { .. })
    }
}

impl HasGate for EpicState {
    fn gate_content(&self) -> Option<GateContent> {
        match self {
            EpicState::AwaitingApproval {
                artifact_path,
                revision,
            } => {
                let mut actions = vec!["approve".to_string()];
                if *revision < crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    actions.push("revise".to_string());
                }
                actions.push("cancel".to_string());
                let summary = if *revision >= crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    format!(
                        "Epic draft is ready for review. Revision limit ({}) reached — please approve or cancel.",
                        crate::phase_runner::FEEDBACK_DEPTH_LIMIT
                    )
                } else {
                    "Epic draft is ready for review.".to_string()
                };
                Some(GateContent {
                    summary,
                    artifact_path: Some(artifact_path.clone()),
                    suggested_actions: actions,
                })
            }
            EpicState::ErrorGate { message, .. } => Some(GateContent {
                summary: format!("Error: {message}"),
                artifact_path: None,
                suggested_actions: vec!["retry".to_string(), "cancel".to_string()],
            }),
            _ => None,
        }
    }

    fn is_error_gate(&self) -> bool {
        matches!(self, EpicState::ErrorGate { .. })
    }
}

impl HasGate for ImplementState {
    fn gate_content(&self) -> Option<GateContent> {
        match self {
            ImplementState::Configuring { phases, config } => {
                let phase_list: Vec<String> = phases
                    .iter()
                    .map(|p| format!("  Phase {}: {} ({})", p.number, p.description, p.slug))
                    .collect();
                let summary = format!(
                    "Implement workflow ready. Review extracted phases and model configuration.\n\n\
                     Phases:\n{}\n\n\
                     Model config:\n\
                     - planner: {}\n\
                     - reviewer: {}\n\
                     - reviser: {}\n\
                     - implementer: {}\n\
                     - plan_revision_limit: {}\n\
                     - code_revision_limit: {}\n\
                     - skip_plan_generation: {}\n\n\
                     Respond with 'approve' to begin, 'configure' with JSON to adjust, or 'cancel'.",
                    phase_list.join("\n"),
                    config.planner,
                    config.reviewer,
                    config.reviser,
                    config.implementer,
                    config.plan_revision_limit,
                    config.code_revision_limit,
                    config.skip_plan_generation,
                );
                Some(GateContent {
                    summary,
                    artifact_path: None,
                    suggested_actions: vec![
                        "approve".to_string(),
                        "configure".to_string(),
                        "cancel".to_string(),
                    ],
                })
            }
            ImplementState::AwaitingApproval { metrics, approval_revision, .. } => {
                let total_plan_cycles: u32 = metrics.iter().map(|m| m.plan_cycles).sum();
                let total_code_cycles: u32 = metrics.iter().map(|m| m.code_cycles).sum();
                let first_pass_count = metrics.iter().filter(|m| m.code_approved_first_pass).count();
                let total_phases = metrics.len();

                let mut actions = vec!["approve".to_string()];
                if *approval_revision < crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    actions.push("revise".to_string());
                }
                actions.push("cancel".to_string());

                let summary = if *approval_revision >= crate::phase_runner::FEEDBACK_DEPTH_LIMIT {
                    format!(
                        "Implementation complete. {} phases implemented. Plan cycles: {} total. \
                         Code cycles: {} total. Code approved on first pass: {}/{} phases. \
                         Revision limit ({}) reached -- please approve or cancel.",
                        total_phases, total_plan_cycles, total_code_cycles,
                        first_pass_count, total_phases,
                        crate::phase_runner::FEEDBACK_DEPTH_LIMIT,
                    )
                } else {
                    format!(
                        "Implementation complete. {} phases implemented. Plan cycles: {} total. \
                         Code cycles: {} total. Code approved on first pass: {}/{} phases.",
                        total_phases, total_plan_cycles, total_code_cycles,
                        first_pass_count, total_phases,
                    )
                };

                Some(GateContent {
                    summary,
                    artifact_path: None,
                    suggested_actions: actions,
                })
            }
            ImplementState::ErrorGate { message, .. } => Some(GateContent {
                summary: format!("Error: {message}"),
                artifact_path: None,
                suggested_actions: vec!["retry".to_string(), "cancel".to_string()],
            }),
            _ => None,
        }
    }

    fn is_error_gate(&self) -> bool {
        matches!(self, ImplementState::ErrorGate { .. })
    }
}

// --- Unified WorkflowState ---

/// Unified state enum that wraps all workflow-specific state machines.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "workflow")]
pub enum WorkflowState {
    #[serde(rename = "brainstorm")]
    Brainstorm(BrainstormState),
    #[serde(rename = "spec")]
    Spec(SpecState),
    #[serde(rename = "epic")]
    Epic(EpicState),
    #[serde(rename = "implement")]
    Implement(ImplementState),
}

impl WorkflowState {
    /// The type of workflow this state belongs to.
    pub fn workflow_type(&self) -> WorkflowType {
        match self {
            Self::Brainstorm(_) => WorkflowType::Brainstorm,
            Self::Spec(_) => WorkflowType::Spec,
            Self::Epic(_) => WorkflowType::Epic,
            Self::Implement(_) => WorkflowType::Implement,
        }
    }

    /// Derive the high-level session state from the current workflow state.
    pub fn session_state(&self) -> SessionState {
        match self {
            Self::Brainstorm(s) => match s {
                BrainstormState::Discovery(_) | BrainstormState::Synthesis { .. } => {
                    SessionState::Running
                }
                BrainstormState::AwaitingApproval { .. } => SessionState::WaitingAtGate,
                BrainstormState::ErrorGate { .. } => SessionState::ErrorGate,
                BrainstormState::Complete { .. } => SessionState::Complete,
                BrainstormState::Cancelled => SessionState::Cancelled,
            },
            Self::Spec(s) => match s {
                SpecState::Research { .. } | SpecState::Drafting { .. } => SessionState::Running,
                SpecState::AwaitingAnswer { .. } => SessionState::WaitingAtGate,
                SpecState::AwaitingApproval { .. } => SessionState::WaitingAtGate,
                SpecState::ErrorGate { .. } => SessionState::ErrorGate,
                SpecState::Complete { .. } => SessionState::Complete,
                SpecState::Cancelled => SessionState::Cancelled,
            },
            Self::Epic(s) => match s {
                EpicState::ChildExtraction { .. } | EpicState::Drafting { .. } => {
                    SessionState::Running
                }
                EpicState::AwaitingApproval { .. } => SessionState::WaitingAtGate,
                EpicState::ErrorGate { .. } => SessionState::ErrorGate,
                EpicState::Complete { .. } => SessionState::Complete,
                EpicState::Cancelled => SessionState::Cancelled,
            },
            Self::Implement(s) => match s {
                ImplementState::PhaseExtraction
                | ImplementState::PlanGeneration { .. }
                | ImplementState::PlanReview { .. }
                | ImplementState::PlanRevision { .. }
                | ImplementState::Implementation { .. }
                | ImplementState::CodeReview { .. }
                | ImplementState::CodeRevision { .. }
                | ImplementState::IterationReview { .. }
                | ImplementState::IterationRevision { .. } => SessionState::Running,
                ImplementState::Configuring { .. }
                | ImplementState::AwaitingApproval { .. } => SessionState::WaitingAtGate,
                ImplementState::ErrorGate { .. } => SessionState::ErrorGate,
                ImplementState::Complete { .. } => SessionState::Complete,
                ImplementState::Cancelled => SessionState::Cancelled,
            },
        }
    }

    /// Delegate to the inner state's phase name.
    pub fn phase_name(&self) -> &str {
        match self {
            Self::Brainstorm(s) => s.phase_name(),
            Self::Spec(s) => s.phase_name(),
            Self::Epic(s) => s.phase_name(),
            Self::Implement(s) => s.phase_name(),
        }
    }

    /// Delegate to the inner state's sub-phase name.
    pub fn sub_phase_name(&self) -> Option<&str> {
        match self {
            Self::Brainstorm(s) => s.sub_phase_name(),
            Self::Spec(s) => s.sub_phase_name(),
            Self::Epic(s) => s.sub_phase_name(),
            Self::Implement(s) => s.sub_phase_name(),
        }
    }

    /// Delegate to the inner state's phase role.
    pub fn phase_role(&self) -> PhaseRole {
        match self {
            Self::Brainstorm(s) => s.phase_role(),
            Self::Spec(s) => s.phase_role(),
            Self::Epic(s) => s.phase_role(),
            Self::Implement(s) => s.phase_role(),
        }
    }

    /// Delegate to the inner state's artifact paths.
    pub fn artifact_paths(&self) -> Vec<&PathBuf> {
        match self {
            Self::Brainstorm(s) => s.artifact_paths(),
            Self::Spec(s) => s.artifact_paths(),
            Self::Epic(s) => s.artifact_paths(),
            Self::Implement(s) => s.artifact_paths(),
        }
    }

    /// Delegate to the inner state's gate content.
    pub fn gate_content(&self) -> Option<GateContent> {
        match self {
            Self::Brainstorm(s) => s.gate_content(),
            Self::Spec(s) => s.gate_content(),
            Self::Epic(s) => s.gate_content(),
            Self::Implement(s) => s.gate_content(),
        }
    }

    /// Whether the current state is an error gate.
    pub fn is_error_gate(&self) -> bool {
        match self {
            Self::Brainstorm(s) => s.is_error_gate(),
            Self::Spec(s) => s.is_error_gate(),
            Self::Epic(s) => s.is_error_gate(),
            Self::Implement(s) => s.is_error_gate(),
        }
    }

    /// Transition a Running state into an ErrorGate, preserving the workflow type.
    ///
    /// Used during session recovery to move sessions that were running when the
    /// process crashed into an error state so the user can decide what to do.
    pub fn to_error_gate(&self) -> Self {
        match self {
            Self::Brainstorm(s) => {
                let phase = s.phase_name().to_string();
                Self::Brainstorm(BrainstormState::ErrorGate {
                    message: "Session interrupted; recovered after restart.".to_string(),
                    failed_phase: phase,
                    exit_code: None,
                })
            }
            Self::Spec(s) => {
                let phase = s.phase_name().to_string();
                Self::Spec(SpecState::ErrorGate {
                    message: "Session interrupted; recovered after restart.".to_string(),
                    failed_phase: phase,
                    exit_code: None,
                })
            }
            Self::Epic(s) => {
                let phase = s.phase_name().to_string();
                Self::Epic(EpicState::ErrorGate {
                    message: "Session interrupted; recovered after restart.".to_string(),
                    failed_phase: phase,
                    exit_code: None,
                })
            }
            Self::Implement(s) => {
                let phase = s.phase_name().to_string();
                Self::Implement(ImplementState::ErrorGate {
                    message: "Session interrupted; recovered after restart.".to_string(),
                    failed_phase: phase,
                    exit_code: None,
                })
            }
        }
    }
}
