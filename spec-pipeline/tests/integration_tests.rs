//! Integration tests for spec-pipeline-mcp.
//!
//! These tests verify serialization round-trips, workflow state transitions,
//! and PhaseOutput deserialization. They do NOT invoke the actual `claude` CLI.

use std::path::PathBuf;

use spec_pipeline_mcp::session::Session;
use spec_pipeline_mcp::workflow::brainstorm::{BrainstormState, DiscoveryPhase};
use spec_pipeline_mcp::workflow::epic::EpicState;
use spec_pipeline_mcp::workflow::spec::SpecState;
use spec_pipeline_mcp::workflow::types::{
    GateResponse, ModelConfig, PhaseRole, SessionState, WorkflowType,
};
use spec_pipeline_mcp::workflow::WorkflowState;

// ---------------------------------------------------------------------------
// Session serialization round-trip
// ---------------------------------------------------------------------------

#[test]
fn session_serialization_round_trip_brainstorm() {
    let session = Session {
        id: uuid::Uuid::new_v4(),
        topic: "test brainstorm".to_string(),
        workflow_state: WorkflowState::Brainstorm(BrainstormState::Discovery(
            DiscoveryPhase::Exploring { turn: 3 },
        )),
        context_refs: vec!["ref1.md".to_string(), "ref2.md".to_string()],
        model_override: Some("opus".to_string()),
        total_cost_usd: 0.42,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let json = serde_json::to_string_pretty(&session).expect("serialize");
    let deserialized: Session = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(deserialized.id, session.id);
    assert_eq!(deserialized.topic, session.topic);
    assert_eq!(deserialized.context_refs, session.context_refs);
    assert_eq!(deserialized.model_override, session.model_override);
    assert!((deserialized.total_cost_usd - session.total_cost_usd).abs() < f64::EPSILON);
}

#[test]
fn session_serialization_round_trip_spec() {
    let session = Session {
        id: uuid::Uuid::new_v4(),
        topic: "test spec".to_string(),
        workflow_state: WorkflowState::Spec(SpecState::Drafting {
            draft_path: PathBuf::from("/tmp/draft.md"),
            revision: 2,
        }),
        context_refs: vec![],
        model_override: None,
        total_cost_usd: 1.23,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let json = serde_json::to_string_pretty(&session).expect("serialize");
    let deserialized: Session = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(deserialized.id, session.id);
    assert_eq!(deserialized.topic, "test spec");
    assert_eq!(
        deserialized.workflow_state.workflow_type(),
        WorkflowType::Spec
    );
    assert_eq!(deserialized.workflow_state.phase_name(), "drafting");
}

#[test]
fn session_serialization_round_trip_epic() {
    let session = Session {
        id: uuid::Uuid::new_v4(),
        topic: "test epic".to_string(),
        workflow_state: WorkflowState::Epic(EpicState::ChildExtraction { turn: 0 }),
        context_refs: vec!["epic-context.md".to_string()],
        model_override: None,
        total_cost_usd: 0.0,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let json = serde_json::to_string_pretty(&session).expect("serialize");
    let deserialized: Session = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(deserialized.id, session.id);
    assert_eq!(
        deserialized.workflow_state.workflow_type(),
        WorkflowType::Epic
    );
    assert_eq!(
        deserialized.workflow_state.phase_name(),
        "child_extraction"
    );
}

// ---------------------------------------------------------------------------
// WorkflowState transitions
// ---------------------------------------------------------------------------

#[test]
fn brainstorm_session_state_running() {
    let ws = WorkflowState::Brainstorm(BrainstormState::Discovery(
        DiscoveryPhase::Exploring { turn: 0 },
    ));
    assert_eq!(ws.session_state(), SessionState::Running);
    assert_eq!(ws.workflow_type(), WorkflowType::Brainstorm);
    assert_eq!(ws.phase_name(), "discovery");
}

#[test]
fn brainstorm_session_state_gate() {
    let ws = WorkflowState::Brainstorm(BrainstormState::AwaitingApproval {
        artifact_path: PathBuf::from("/tmp/brainstorm.md"),
        revision: 0,
    });
    assert_eq!(ws.session_state(), SessionState::WaitingAtGate);
    assert!(ws.gate_content().is_some());
}

#[test]
fn brainstorm_session_state_complete() {
    let ws = WorkflowState::Brainstorm(BrainstormState::Complete {
        artifact_path: PathBuf::from("/tmp/brainstorm.md"),
    });
    assert_eq!(ws.session_state(), SessionState::Complete);
    assert!(ws.gate_content().is_none());
}

#[test]
fn brainstorm_session_state_cancelled() {
    let ws = WorkflowState::Brainstorm(BrainstormState::Cancelled);
    assert_eq!(ws.session_state(), SessionState::Cancelled);
}

#[test]
fn brainstorm_error_gate() {
    let ws = WorkflowState::Brainstorm(BrainstormState::ErrorGate {
        message: "test error".to_string(),
        failed_phase: "discovery".to_string(),
        exit_code: Some(1),
    });
    assert_eq!(ws.session_state(), SessionState::ErrorGate);
    assert!(ws.is_error_gate());
    let gate = ws.gate_content().expect("should have gate content");
    assert!(gate.summary.contains("Error"));
}

#[test]
fn spec_state_transitions() {
    let research = WorkflowState::Spec(SpecState::Research { turn: 0 });
    assert_eq!(research.session_state(), SessionState::Running);
    assert_eq!(research.phase_name(), "research");

    let drafting = WorkflowState::Spec(SpecState::Drafting {
        draft_path: PathBuf::from("/tmp/spec.md"),
        revision: 1,
    });
    assert_eq!(drafting.session_state(), SessionState::Running);
    assert_eq!(drafting.phase_name(), "drafting");

    let approval = WorkflowState::Spec(SpecState::AwaitingApproval {
        artifact_path: PathBuf::from("/tmp/spec.md"),
        revision: 1,
    });
    assert_eq!(approval.session_state(), SessionState::WaitingAtGate);

    let complete = WorkflowState::Spec(SpecState::Complete {
        artifact_path: PathBuf::from("/tmp/spec.md"),
    });
    assert_eq!(complete.session_state(), SessionState::Complete);

    let cancelled = WorkflowState::Spec(SpecState::Cancelled);
    assert_eq!(cancelled.session_state(), SessionState::Cancelled);
}

#[test]
fn epic_state_transitions() {
    let extraction = WorkflowState::Epic(EpicState::ChildExtraction { turn: 0 });
    assert_eq!(extraction.session_state(), SessionState::Running);
    assert_eq!(extraction.phase_name(), "child_extraction");

    let drafting = WorkflowState::Epic(EpicState::Drafting {
        draft_path: PathBuf::from("/tmp/epic.md"),
        revision: 0,
    });
    assert_eq!(drafting.session_state(), SessionState::Running);

    let approval = WorkflowState::Epic(EpicState::AwaitingApproval {
        artifact_path: PathBuf::from("/tmp/epic.md"),
        revision: 2,
    });
    assert_eq!(approval.session_state(), SessionState::WaitingAtGate);
    let gate = approval.gate_content().expect("gate content");
    assert!(gate.suggested_actions.contains(&"approve".to_string()));
}

// ---------------------------------------------------------------------------
// PhaseOutput deserialization
// ---------------------------------------------------------------------------

#[test]
fn phase_output_continue_deserialization() {
    use spec_pipeline_mcp::runner::RawPhaseOutput;
    let json = r#"{"type": "continue"}"#;
    let output: RawPhaseOutput = serde_json::from_str(json).expect("deserialize continue");
    assert!(matches!(output, RawPhaseOutput::Continue));
}

#[test]
fn phase_output_gate_deserialization() {
    use spec_pipeline_mcp::runner::RawPhaseOutput;
    let json = r#"{"type": "gate", "question": "What scope?", "artifact_path": null}"#;
    let output: RawPhaseOutput = serde_json::from_str(json).expect("deserialize gate");
    match output {
        RawPhaseOutput::Gate { question, artifact_path } => {
            assert_eq!(question, "What scope?");
            assert!(artifact_path.is_none());
        }
        _ => panic!("expected Gate variant"),
    }
}

#[test]
fn phase_output_done_deserialization() {
    use spec_pipeline_mcp::runner::RawPhaseOutput;
    let json = r#"{"type": "done", "summary": "All done", "artifact_path": "/tmp/out.md"}"#;
    let output: RawPhaseOutput = serde_json::from_str(json).expect("deserialize done");
    match output {
        RawPhaseOutput::Done { summary, artifact_path } => {
            assert_eq!(summary, "All done");
            assert_eq!(artifact_path, "/tmp/out.md");
        }
        _ => panic!("expected Done variant"),
    }
}

// ---------------------------------------------------------------------------
// GateResponse serialization
// ---------------------------------------------------------------------------

#[test]
fn gate_response_serialization() {
    let approve = GateResponse::Approve;
    let json = serde_json::to_string(&approve).expect("serialize");
    assert!(json.contains("approve"));

    let revise = GateResponse::Revise {
        feedback: "needs more detail".to_string(),
    };
    let json = serde_json::to_string(&revise).expect("serialize");
    assert!(json.contains("revise"));
    assert!(json.contains("needs more detail"));

    let cancel = GateResponse::Cancel;
    let json = serde_json::to_string(&cancel).expect("serialize");
    assert!(json.contains("cancel"));

    let retry = GateResponse::Retry;
    let json = serde_json::to_string(&retry).expect("serialize");
    assert!(json.contains("retry"));
}

// ---------------------------------------------------------------------------
// ModelConfig
// ---------------------------------------------------------------------------

#[test]
fn model_config_defaults() {
    let config = ModelConfig::default();
    assert_eq!(config.for_role(PhaseRole::Discovery), "sonnet");
    assert_eq!(config.for_role(PhaseRole::Synthesis), "sonnet");
    assert_eq!(config.for_role(PhaseRole::Review), "haiku");
}

// ---------------------------------------------------------------------------
// to_error_gate recovery
// ---------------------------------------------------------------------------

#[test]
fn to_error_gate_preserves_workflow_type() {
    let running_brainstorm = WorkflowState::Brainstorm(BrainstormState::Discovery(
        DiscoveryPhase::Exploring { turn: 5 },
    ));
    let error_bs = running_brainstorm.to_error_gate();
    assert_eq!(error_bs.workflow_type(), WorkflowType::Brainstorm);
    assert!(error_bs.is_error_gate());

    let running_spec = WorkflowState::Spec(SpecState::Research { turn: 2 });
    let error_spec = running_spec.to_error_gate();
    assert_eq!(error_spec.workflow_type(), WorkflowType::Spec);
    assert!(error_spec.is_error_gate());

    let running_epic = WorkflowState::Epic(EpicState::ChildExtraction { turn: 1 });
    let error_epic = running_epic.to_error_gate();
    assert_eq!(error_epic.workflow_type(), WorkflowType::Epic);
    assert!(error_epic.is_error_gate());
}

// ---------------------------------------------------------------------------
// Feedback depth limit gate content
// ---------------------------------------------------------------------------

#[test]
fn feedback_depth_limit_removes_revise_action() {
    use spec_pipeline_mcp::phase_runner::FEEDBACK_DEPTH_LIMIT;

    // Under limit: revise should be available
    let under = WorkflowState::Brainstorm(BrainstormState::AwaitingApproval {
        artifact_path: PathBuf::from("/tmp/draft.md"),
        revision: FEEDBACK_DEPTH_LIMIT - 1,
    });
    let gate = under.gate_content().expect("gate content");
    assert!(gate.suggested_actions.contains(&"revise".to_string()));

    // At limit: revise should NOT be available
    let at_limit = WorkflowState::Brainstorm(BrainstormState::AwaitingApproval {
        artifact_path: PathBuf::from("/tmp/draft.md"),
        revision: FEEDBACK_DEPTH_LIMIT,
    });
    let gate = at_limit.gate_content().expect("gate content");
    assert!(!gate.suggested_actions.contains(&"revise".to_string()));
    assert!(gate.suggested_actions.contains(&"approve".to_string()));
    assert!(gate.suggested_actions.contains(&"cancel".to_string()));
    assert!(gate.summary.contains("Revision limit"));
}

#[test]
fn feedback_depth_limit_spec_and_epic() {
    use spec_pipeline_mcp::phase_runner::FEEDBACK_DEPTH_LIMIT;

    let spec_at_limit = WorkflowState::Spec(SpecState::AwaitingApproval {
        artifact_path: PathBuf::from("/tmp/spec.md"),
        revision: FEEDBACK_DEPTH_LIMIT,
    });
    let gate = spec_at_limit.gate_content().expect("gate content");
    assert!(!gate.suggested_actions.contains(&"revise".to_string()));

    let epic_at_limit = WorkflowState::Epic(EpicState::AwaitingApproval {
        artifact_path: PathBuf::from("/tmp/epic.md"),
        revision: FEEDBACK_DEPTH_LIMIT,
    });
    let gate = epic_at_limit.gate_content().expect("gate content");
    assert!(!gate.suggested_actions.contains(&"revise".to_string()));
}

// ---------------------------------------------------------------------------
// WorkflowType Display
// ---------------------------------------------------------------------------

#[test]
fn workflow_type_display() {
    assert_eq!(WorkflowType::Brainstorm.to_string(), "brainstorm");
    assert_eq!(WorkflowType::Spec.to_string(), "spec");
    assert_eq!(WorkflowType::Epic.to_string(), "epic");
}

// ---------------------------------------------------------------------------
// Phase role assignments
// ---------------------------------------------------------------------------

#[test]
fn phase_roles_are_sensible() {
    // Discovery / research phases use Discovery role
    let bs_disc = WorkflowState::Brainstorm(BrainstormState::Discovery(
        DiscoveryPhase::Exploring { turn: 0 },
    ));
    assert_eq!(bs_disc.phase_role(), PhaseRole::Discovery);

    let spec_research = WorkflowState::Spec(SpecState::Research { turn: 0 });
    assert_eq!(spec_research.phase_role(), PhaseRole::Discovery);

    let epic_extract = WorkflowState::Epic(EpicState::ChildExtraction { turn: 0 });
    assert_eq!(epic_extract.phase_role(), PhaseRole::Discovery);

    // Synthesis / drafting phases use Synthesis role
    let bs_synth = WorkflowState::Brainstorm(BrainstormState::Synthesis {
        draft_path: PathBuf::from(""),
        revision: 0,
    });
    assert_eq!(bs_synth.phase_role(), PhaseRole::Synthesis);

    let spec_draft = WorkflowState::Spec(SpecState::Drafting {
        draft_path: PathBuf::from(""),
        revision: 0,
    });
    assert_eq!(spec_draft.phase_role(), PhaseRole::Synthesis);

    let epic_draft = WorkflowState::Epic(EpicState::Drafting {
        draft_path: PathBuf::from(""),
        revision: 0,
    });
    assert_eq!(epic_draft.phase_role(), PhaseRole::Synthesis);
}

// ---------------------------------------------------------------------------
// AwaitingApproval revision field backward compat (serde default)
// ---------------------------------------------------------------------------

#[test]
fn awaiting_approval_without_revision_deserializes() {
    // Simulate a JSON payload from before the revision field was added
    let json = r#"{
        "workflow": "brainstorm",
        "phase": "awaiting_approval",
        "artifact_path": "/tmp/old.md"
    }"#;
    let ws: WorkflowState = serde_json::from_str(json).expect("deserialize old format");
    match ws {
        WorkflowState::Brainstorm(BrainstormState::AwaitingApproval { revision, .. }) => {
            assert_eq!(revision, 0, "missing revision field should default to 0");
        }
        other => panic!("expected Brainstorm AwaitingApproval, got {other:?}"),
    }
}
