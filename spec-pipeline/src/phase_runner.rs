use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::oneshot;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::notifier::{SessionEvent, SessionNotifier, progress_for};
use crate::prompts::PromptStore;
use crate::runner::{ClaudeRunner, PhaseContext, RawPhaseOutput, RunnerError};
use crate::session::SessionRegistry;
use crate::workflow::brainstorm::{BrainstormState, DiscoveryPhase};
use crate::workflow::epic::EpicState;
use crate::workflow::spec::SpecState;
use crate::workflow::types::{GateResponse, ModelConfig};
use crate::workflow::WorkflowState;

/// Maximum number of revision round-trips before forcing approve-or-cancel.
pub const FEEDBACK_DEPTH_LIMIT: u32 = 5;

/// Map of session IDs to oneshot senders that deliver a gate response.
pub type GateChannelMap = DashMap<Uuid, oneshot::Sender<GateResponse>>;

/// Snapshot of session state needed to build a PhaseContext and invoke claude.
struct PhaseSetup {
    context: PhaseContext,
    model: String,
    prompt_key: String,
    workflow_type: String,
}

// ============================================================================
// Brainstorm session
// ============================================================================

/// Run a brainstorm session to completion (or until cancelled / errored).
///
/// This function is meant to be `tokio::spawn`-ed.  It loops through discovery
/// and synthesis phases, pausing at gates for user input delivered via
/// `gate_channels`.
pub async fn run_brainstorm_session(
    session_id: Uuid,
    registry: Arc<SessionRegistry>,
    runner: Arc<ClaudeRunner>,
    gate_channels: Arc<GateChannelMap>,
    model_config: ModelConfig,
    prompts: Arc<PromptStore>,
    notifier: SessionNotifier,
) {
    info!(%session_id, "brainstorm session loop starting");

    loop {
        // -----------------------------------------------------------------
        // 1. Read current state, build context (short-lived lock)
        // -----------------------------------------------------------------
        let setup = {
            let handle = match registry.get(session_id) {
                Some(h) => h,
                None => {
                    error!(%session_id, "session vanished from registry");
                    return;
                }
            };
            let session = handle.lock().await;

            let bs = match &session.workflow_state {
                WorkflowState::Brainstorm(bs) => bs.clone(),
                other => {
                    warn!(%session_id, state = ?other, "session is not a brainstorm workflow");
                    return;
                }
            };

            // Determine phase and prompt key
            let (phase, sub_phase, prompt_key) = match &bs {
                BrainstormState::Discovery(dp) => {
                    let sub = match dp {
                        DiscoveryPhase::Exploring { .. } => "exploring",
                        DiscoveryPhase::AwaitingAnswer { .. } => "awaiting_answer",
                    };
                    ("discovery", Some(sub.to_string()), "brainstorm/discovery")
                }
                BrainstormState::Synthesis { .. } => {
                    ("synthesis", None, "brainstorm/synthesis")
                }
                // Terminal / gate states -- nothing to run
                BrainstormState::Complete { .. }
                | BrainstormState::Cancelled
                | BrainstormState::AwaitingApproval { .. }
                | BrainstormState::ErrorGate { .. } => {
                    info!(%session_id, phase = bs.phase_name(), "session in terminal/gate state, exiting loop");
                    return;
                }
            };

            let revision = match &bs {
                BrainstormState::Synthesis { revision, .. } => *revision,
                _ => 0,
            };

            let prior_artifacts: Vec<String> = bs
                .artifact_paths()
                .into_iter()
                .map(|p| p.display().to_string())
                .collect();

            // Choose model: session override wins, then config for role
            let role = bs.phase_role();
            let model = session
                .model_override
                .clone()
                .unwrap_or_else(|| model_config.for_role(role).to_string());

            let context_refs = session.context_refs.clone();

            PhaseSetup {
                context: PhaseContext {
                    topic: session.topic.clone(),
                    workflow_type: "brainstorm".to_string(),
                    phase: phase.to_string(),
                    sub_phase,
                    prior_artifacts,
                    context_refs,
                    gate_history: vec![],
                    revision_feedback: None,
                    revision,
                },
                model,
                prompt_key: prompt_key.to_string(),
                workflow_type: "brainstorm".to_string(),
            }
            // lock dropped here
        };

        // Run phase and process result via the generic loop body
        match run_phase_and_process(
            session_id,
            &registry,
            &runner,
            &gate_channels,
            &prompts,
            setup,
            &notifier,
        )
        .await
        {
            LoopAction::Continue => continue,
            LoopAction::Break => break,
        }
    }

    info!(%session_id, "brainstorm session loop finished");
}

// ============================================================================
// Spec session
// ============================================================================

/// Run a spec session to completion (Research -> Drafting -> AwaitingApproval -> Complete).
pub async fn run_spec_session(
    session_id: Uuid,
    registry: Arc<SessionRegistry>,
    runner: Arc<ClaudeRunner>,
    gate_channels: Arc<GateChannelMap>,
    model_config: ModelConfig,
    prompts: Arc<PromptStore>,
    notifier: SessionNotifier,
) {
    info!(%session_id, "spec session loop starting");

    loop {
        let setup = {
            let handle = match registry.get(session_id) {
                Some(h) => h,
                None => {
                    error!(%session_id, "session vanished from registry");
                    return;
                }
            };
            let session = handle.lock().await;

            let ss = match &session.workflow_state {
                WorkflowState::Spec(ss) => ss.clone(),
                other => {
                    warn!(%session_id, state = ?other, "session is not a spec workflow");
                    return;
                }
            };

            let (phase, prompt_key) = match &ss {
                SpecState::Research { .. } => ("research", "spec/research"),
                SpecState::Drafting { .. } => ("drafting", "spec/drafting"),
                // Terminal / gate states
                SpecState::Complete { .. }
                | SpecState::Cancelled
                | SpecState::AwaitingApproval { .. }
                | SpecState::ErrorGate { .. } => {
                    info!(%session_id, phase = ss.phase_name(), "session in terminal/gate state, exiting loop");
                    return;
                }
            };

            let revision = match &ss {
                SpecState::Drafting { revision, .. } => *revision,
                _ => 0,
            };

            let prior_artifacts: Vec<String> = ss
                .artifact_paths()
                .into_iter()
                .map(|p| p.display().to_string())
                .collect();

            let role = ss.phase_role();
            let model = session
                .model_override
                .clone()
                .unwrap_or_else(|| model_config.for_role(role).to_string());

            let context_refs = session.context_refs.clone();

            PhaseSetup {
                context: PhaseContext {
                    topic: session.topic.clone(),
                    workflow_type: "spec".to_string(),
                    phase: phase.to_string(),
                    sub_phase: None,
                    prior_artifacts,
                    context_refs,
                    gate_history: vec![],
                    revision_feedback: None,
                    revision,
                },
                model,
                prompt_key: prompt_key.to_string(),
                workflow_type: "spec".to_string(),
            }
        };

        match run_phase_and_process(
            session_id,
            &registry,
            &runner,
            &gate_channels,
            &prompts,
            setup,
            &notifier,
        )
        .await
        {
            LoopAction::Continue => continue,
            LoopAction::Break => break,
        }
    }

    info!(%session_id, "spec session loop finished");
}

// ============================================================================
// Epic session
// ============================================================================

/// Run an epic session to completion (ChildExtraction -> Drafting -> AwaitingApproval -> Complete).
pub async fn run_epic_session(
    session_id: Uuid,
    registry: Arc<SessionRegistry>,
    runner: Arc<ClaudeRunner>,
    gate_channels: Arc<GateChannelMap>,
    model_config: ModelConfig,
    prompts: Arc<PromptStore>,
    notifier: SessionNotifier,
) {
    info!(%session_id, "epic session loop starting");

    loop {
        let setup = {
            let handle = match registry.get(session_id) {
                Some(h) => h,
                None => {
                    error!(%session_id, "session vanished from registry");
                    return;
                }
            };
            let session = handle.lock().await;

            let es = match &session.workflow_state {
                WorkflowState::Epic(es) => es.clone(),
                other => {
                    warn!(%session_id, state = ?other, "session is not an epic workflow");
                    return;
                }
            };

            let (phase, prompt_key) = match &es {
                EpicState::ChildExtraction { .. } => ("child_extraction", "epic/child_extraction"),
                EpicState::Drafting { .. } => ("drafting", "epic/drafting"),
                // Terminal / gate states
                EpicState::Complete { .. }
                | EpicState::Cancelled
                | EpicState::AwaitingApproval { .. }
                | EpicState::ErrorGate { .. } => {
                    info!(%session_id, phase = es.phase_name(), "session in terminal/gate state, exiting loop");
                    return;
                }
            };

            let revision = match &es {
                EpicState::Drafting { revision, .. } => *revision,
                _ => 0,
            };

            let prior_artifacts: Vec<String> = es
                .artifact_paths()
                .into_iter()
                .map(|p| p.display().to_string())
                .collect();

            let role = es.phase_role();
            let model = session
                .model_override
                .clone()
                .unwrap_or_else(|| model_config.for_role(role).to_string());

            let context_refs = session.context_refs.clone();

            PhaseSetup {
                context: PhaseContext {
                    topic: session.topic.clone(),
                    workflow_type: "epic".to_string(),
                    phase: phase.to_string(),
                    sub_phase: None,
                    prior_artifacts,
                    context_refs,
                    gate_history: vec![],
                    revision_feedback: None,
                    revision,
                },
                model,
                prompt_key: prompt_key.to_string(),
                workflow_type: "epic".to_string(),
            }
        };

        match run_phase_and_process(
            session_id,
            &registry,
            &runner,
            &gate_channels,
            &prompts,
            setup,
            &notifier,
        )
        .await
        {
            LoopAction::Continue => continue,
            LoopAction::Break => break,
        }
    }

    info!(%session_id, "epic session loop finished");
}

// ===========================================================================
// Generic phase execution and processing
// ===========================================================================

/// What the main loop should do after processing a phase result.
enum LoopAction {
    Continue,
    Break,
}

/// Run a single phase and process its result, including gate handling.
/// Returns LoopAction to tell the caller whether to continue or break.
async fn run_phase_and_process(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    runner: &Arc<ClaudeRunner>,
    gate_channels: &Arc<GateChannelMap>,
    prompts: &Arc<PromptStore>,
    setup: PhaseSetup,
    notifier: &SessionNotifier,
) -> LoopAction {
    // Get prompt path
    let prompt_path = match prompts.get(&setup.prompt_key) {
        Some(p) => p.to_path_buf(),
        None => {
            error!(%session_id, key = %setup.prompt_key, "prompt key not found");
            transition_to_error(
                registry,
                session_id,
                "Internal error: prompt key not found",
                &setup.prompt_key,
                &setup.workflow_type,
            )
            .await;
            return LoopAction::Break;
        }
    };

    // Notify: phase starting
    {
        let (progress, total) = progress_for(&setup.workflow_type, &setup.context.phase, false);
        notifier
            .notify(&SessionEvent {
                session_id,
                workflow_type: setup.workflow_type.clone(),
                session_state: "Running".into(),
                phase: setup.context.phase.clone(),
                sub_phase: setup.context.sub_phase.clone(),
                message: format!("{}: {} phase running", setup.workflow_type, setup.context.phase),
                gate_content: None,
                progress,
                total,
            })
            .await;
    }

    // Run the phase (no lock held)
    info!(
        %session_id,
        phase = %setup.context.phase,
        model = %setup.model,
        "running phase"
    );

    let result = runner
        .run_phase(&setup.context, &setup.model, &prompt_path)
        .await;

    // Process result
    match result {
        Ok(run_result) => {
            let action = process_phase_output(
                session_id,
                registry,
                &setup.context.phase,
                run_result.output,
                run_result.cost_usd,
                &setup.workflow_type,
            )
            .await;

            match action {
                InternalAction::Continue => LoopAction::Continue,
                InternalAction::Break => LoopAction::Break,
                InternalAction::AwaitGate => {
                    // Notify: session waiting at gate
                    notify_current_state(session_id, registry, notifier).await;

                    match await_gate_response(session_id, gate_channels).await {
                        Some(response) => {
                            if apply_gate_response(
                                session_id,
                                response,
                                registry,
                                &setup.workflow_type,
                                notifier,
                            )
                            .await
                            {
                                LoopAction::Continue
                            } else {
                                LoopAction::Break
                            }
                        }
                        None => {
                            warn!(%session_id, "gate channel dropped without response");
                            LoopAction::Break
                        }
                    }
                }
            }
        }

        Err(err) => {
            let exit_code = match &err {
                RunnerError::SubprocessFailed { exit_code, .. } => *exit_code,
                _ => None,
            };
            error!(%session_id, error = %err, "phase runner error");
            transition_to_error_with_code(
                registry,
                session_id,
                &err.to_string(),
                &setup.context.phase,
                exit_code,
                &setup.workflow_type,
            )
            .await;

            // Notify: error gate
            notify_current_state(session_id, registry, notifier).await;

            // Wait for user to decide (retry or cancel)
            match await_gate_response(session_id, gate_channels).await {
                Some(response) => {
                    if apply_gate_response(
                        session_id,
                        response,
                        registry,
                        &setup.workflow_type,
                        notifier,
                    )
                    .await
                    {
                        LoopAction::Continue
                    } else {
                        LoopAction::Break
                    }
                }
                None => {
                    warn!(
                        %session_id,
                        "gate channel dropped without response (error gate)"
                    );
                    LoopAction::Break
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Internal action that the output processing returns.
enum InternalAction {
    Continue,
    Break,
    AwaitGate,
}

/// Process the output of a phase run.  Dispatches to the appropriate
/// workflow-specific handler.
async fn process_phase_output(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    current_phase: &str,
    output: RawPhaseOutput,
    cost_usd: f64,
    workflow_type: &str,
) -> InternalAction {
    match workflow_type {
        "brainstorm" => {
            process_brainstorm_output(session_id, registry, current_phase, output, cost_usd).await
        }
        "spec" => {
            process_spec_output(session_id, registry, current_phase, output, cost_usd).await
        }
        "epic" => {
            process_epic_output(session_id, registry, current_phase, output, cost_usd).await
        }
        _ => {
            error!(%session_id, %workflow_type, "unknown workflow type in process_phase_output");
            InternalAction::Break
        }
    }
}

// ---------------------------------------------------------------------------
// Brainstorm output processing
// ---------------------------------------------------------------------------

async fn process_brainstorm_output(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    current_phase: &str,
    output: RawPhaseOutput,
    cost_usd: f64,
) -> InternalAction {
    let bs_snapshot = {
        let handle = match registry.get(session_id) {
            Some(h) => h,
            None => return InternalAction::Break,
        };
        let session = handle.lock().await;
        match &session.workflow_state {
            WorkflowState::Brainstorm(bs) => bs.clone(),
            _ => return InternalAction::Break,
        }
    };

    match output {
        RawPhaseOutput::Continue => {
            let new_state = match bs_snapshot {
                BrainstormState::Discovery(DiscoveryPhase::Exploring { turn }) => {
                    BrainstormState::Discovery(DiscoveryPhase::Exploring { turn: turn + 1 })
                }
                BrainstormState::Synthesis { draft_path, revision } => {
                    BrainstormState::Synthesis { draft_path, revision }
                }
                other => {
                    warn!(%session_id, state = ?other, "unexpected Continue in state");
                    return InternalAction::Break;
                }
            };

            if let Err(e) = registry
                .update(session_id, move |s| {
                    s.total_cost_usd += cost_usd;
                    s.workflow_state = WorkflowState::Brainstorm(new_state);
                })
                .await
            {
                error!(%session_id, error = %e, "failed to persist Continue");
                return InternalAction::Break;
            }
            InternalAction::Continue
        }

        RawPhaseOutput::Gate { question, .. } => {
            let new_state = match bs_snapshot {
                BrainstormState::Discovery(_) => BrainstormState::Discovery(
                    DiscoveryPhase::AwaitingAnswer {
                        question: question.clone(),
                    },
                ),
                other => {
                    warn!(%session_id, state = ?other, "unexpected Gate in state");
                    return InternalAction::Break;
                }
            };

            if let Err(e) = registry
                .update(session_id, move |s| {
                    s.total_cost_usd += cost_usd;
                    s.workflow_state = WorkflowState::Brainstorm(new_state);
                })
                .await
            {
                error!(%session_id, error = %e, "failed to persist Gate");
                return InternalAction::Break;
            }
            info!(%session_id, %question, "awaiting user answer at gate");
            InternalAction::AwaitGate
        }

        RawPhaseOutput::Done {
            artifact_path,
            summary,
        } => {
            info!(%session_id, %summary, artifact = %artifact_path, "phase done");

            match bs_snapshot {
                BrainstormState::Discovery(_) => {
                    let draft = if artifact_path.is_empty() {
                        PathBuf::from("")
                    } else {
                        PathBuf::from(&artifact_path)
                    };
                    let new_state = BrainstormState::Synthesis {
                        draft_path: draft,
                        revision: 0,
                    };
                    if let Err(e) = registry
                        .update(session_id, move |s| {
                            s.total_cost_usd += cost_usd;
                            s.workflow_state = WorkflowState::Brainstorm(new_state);
                        })
                        .await
                    {
                        error!(%session_id, error = %e, "failed to persist Discovery->Synthesis");
                        return InternalAction::Break;
                    }
                    InternalAction::Continue
                }
                BrainstormState::Synthesis { revision, .. } => {
                    let path = PathBuf::from(&artifact_path);
                    let new_state = BrainstormState::AwaitingApproval {
                        artifact_path: path,
                        revision,
                    };
                    if let Err(e) = registry
                        .update(session_id, move |s| {
                            s.total_cost_usd += cost_usd;
                            s.workflow_state = WorkflowState::Brainstorm(new_state);
                        })
                        .await
                    {
                        error!(%session_id, error = %e, "failed to persist Synthesis->AwaitingApproval");
                        return InternalAction::Break;
                    }
                    info!(%session_id, %revision, "synthesis complete, awaiting approval");
                    InternalAction::AwaitGate
                }
                other => {
                    warn!(%session_id, state = ?other, phase = current_phase, "unexpected Done in state");
                    InternalAction::Break
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Spec output processing
// ---------------------------------------------------------------------------

async fn process_spec_output(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    current_phase: &str,
    output: RawPhaseOutput,
    cost_usd: f64,
) -> InternalAction {
    let ss_snapshot = {
        let handle = match registry.get(session_id) {
            Some(h) => h,
            None => return InternalAction::Break,
        };
        let session = handle.lock().await;
        match &session.workflow_state {
            WorkflowState::Spec(ss) => ss.clone(),
            _ => return InternalAction::Break,
        }
    };

    match output {
        RawPhaseOutput::Continue => {
            let new_state = match ss_snapshot {
                SpecState::Research { turn } => SpecState::Research { turn: turn + 1 },
                SpecState::Drafting { draft_path, revision } => {
                    SpecState::Drafting { draft_path, revision }
                }
                other => {
                    warn!(%session_id, state = ?other, "unexpected Continue in spec state");
                    return InternalAction::Break;
                }
            };

            if let Err(e) = registry
                .update(session_id, move |s| {
                    s.total_cost_usd += cost_usd;
                    s.workflow_state = WorkflowState::Spec(new_state);
                })
                .await
            {
                error!(%session_id, error = %e, "failed to persist spec Continue");
                return InternalAction::Break;
            }
            InternalAction::Continue
        }

        RawPhaseOutput::Gate { question, .. } => {
            // Spec research can produce gates for clarifying questions.
            // We don't have a sub-state for it in SpecState, so we use ErrorGate
            // as a holding pattern with the question text.
            // For now, log and break -- spec gates are not supported in phase design.
            warn!(%session_id, %question, phase = current_phase, "gate in spec workflow (not expected)");
            InternalAction::Break
        }

        RawPhaseOutput::Done {
            artifact_path,
            summary,
        } => {
            info!(%session_id, %summary, artifact = %artifact_path, "spec phase done");

            match ss_snapshot {
                SpecState::Research { .. } => {
                    let draft = if artifact_path.is_empty() {
                        PathBuf::from("")
                    } else {
                        PathBuf::from(&artifact_path)
                    };
                    let new_state = SpecState::Drafting {
                        draft_path: draft,
                        revision: 0,
                    };
                    if let Err(e) = registry
                        .update(session_id, move |s| {
                            s.total_cost_usd += cost_usd;
                            s.workflow_state = WorkflowState::Spec(new_state);
                        })
                        .await
                    {
                        error!(%session_id, error = %e, "failed to persist Research->Drafting");
                        return InternalAction::Break;
                    }
                    InternalAction::Continue
                }
                SpecState::Drafting { revision, .. } => {
                    let path = PathBuf::from(&artifact_path);
                    let new_state = SpecState::AwaitingApproval {
                        artifact_path: path,
                        revision,
                    };
                    if let Err(e) = registry
                        .update(session_id, move |s| {
                            s.total_cost_usd += cost_usd;
                            s.workflow_state = WorkflowState::Spec(new_state);
                        })
                        .await
                    {
                        error!(%session_id, error = %e, "failed to persist Drafting->AwaitingApproval");
                        return InternalAction::Break;
                    }
                    info!(%session_id, %revision, "spec drafting complete, awaiting approval");
                    InternalAction::AwaitGate
                }
                other => {
                    warn!(%session_id, state = ?other, phase = current_phase, "unexpected Done in spec state");
                    InternalAction::Break
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Epic output processing
// ---------------------------------------------------------------------------

async fn process_epic_output(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    current_phase: &str,
    output: RawPhaseOutput,
    cost_usd: f64,
) -> InternalAction {
    let es_snapshot = {
        let handle = match registry.get(session_id) {
            Some(h) => h,
            None => return InternalAction::Break,
        };
        let session = handle.lock().await;
        match &session.workflow_state {
            WorkflowState::Epic(es) => es.clone(),
            _ => return InternalAction::Break,
        }
    };

    match output {
        RawPhaseOutput::Continue => {
            let new_state = match es_snapshot {
                EpicState::ChildExtraction { turn } => {
                    EpicState::ChildExtraction { turn: turn + 1 }
                }
                EpicState::Drafting { draft_path, revision } => {
                    EpicState::Drafting { draft_path, revision }
                }
                other => {
                    warn!(%session_id, state = ?other, "unexpected Continue in epic state");
                    return InternalAction::Break;
                }
            };

            if let Err(e) = registry
                .update(session_id, move |s| {
                    s.total_cost_usd += cost_usd;
                    s.workflow_state = WorkflowState::Epic(new_state);
                })
                .await
            {
                error!(%session_id, error = %e, "failed to persist epic Continue");
                return InternalAction::Break;
            }
            InternalAction::Continue
        }

        RawPhaseOutput::Gate { question, .. } => {
            warn!(%session_id, %question, phase = current_phase, "gate in epic workflow (not expected)");
            InternalAction::Break
        }

        RawPhaseOutput::Done {
            artifact_path,
            summary,
        } => {
            info!(%session_id, %summary, artifact = %artifact_path, "epic phase done");

            match es_snapshot {
                EpicState::ChildExtraction { .. } => {
                    let draft = if artifact_path.is_empty() {
                        PathBuf::from("")
                    } else {
                        PathBuf::from(&artifact_path)
                    };
                    let new_state = EpicState::Drafting {
                        draft_path: draft,
                        revision: 0,
                    };
                    if let Err(e) = registry
                        .update(session_id, move |s| {
                            s.total_cost_usd += cost_usd;
                            s.workflow_state = WorkflowState::Epic(new_state);
                        })
                        .await
                    {
                        error!(%session_id, error = %e, "failed to persist ChildExtraction->Drafting");
                        return InternalAction::Break;
                    }
                    InternalAction::Continue
                }
                EpicState::Drafting { revision, .. } => {
                    let path = PathBuf::from(&artifact_path);
                    let new_state = EpicState::AwaitingApproval {
                        artifact_path: path,
                        revision,
                    };
                    if let Err(e) = registry
                        .update(session_id, move |s| {
                            s.total_cost_usd += cost_usd;
                            s.workflow_state = WorkflowState::Epic(new_state);
                        })
                        .await
                    {
                        error!(%session_id, error = %e, "failed to persist Drafting->AwaitingApproval (epic)");
                        return InternalAction::Break;
                    }
                    info!(%session_id, %revision, "epic drafting complete, awaiting approval");
                    InternalAction::AwaitGate
                }
                other => {
                    warn!(%session_id, state = ?other, phase = current_phase, "unexpected Done in epic state");
                    InternalAction::Break
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

/// Insert a oneshot channel, wait for the response.
async fn await_gate_response(
    session_id: Uuid,
    gate_channels: &Arc<GateChannelMap>,
) -> Option<GateResponse> {
    let (tx, rx) = oneshot::channel();
    gate_channels.insert(session_id, tx);
    rx.await.ok()
}

/// Apply a gate response to the session, returning `true` if the loop should
/// continue or `false` if it should break.  Works for all workflow types.
async fn apply_gate_response(
    session_id: Uuid,
    response: GateResponse,
    registry: &Arc<SessionRegistry>,
    workflow_type: &str,
    notifier: &SessionNotifier,
) -> bool {
    // Snapshot the current workflow state
    let ws = {
        let handle = match registry.get(session_id) {
            Some(h) => h,
            None => {
                error!(%session_id, "session vanished when applying gate response");
                return false;
            }
        };
        let session = handle.lock().await;
        session.workflow_state.clone()
    };

    let result = match response {
        GateResponse::Approve => apply_approve(session_id, registry, &ws, workflow_type).await,
        GateResponse::Revise { feedback } => {
            apply_revise(session_id, registry, &ws, workflow_type, &feedback).await
        }
        GateResponse::Cancel => apply_cancel(session_id, registry, workflow_type).await,
        GateResponse::Retry => apply_retry(session_id, registry, &ws, workflow_type).await,
    };

    // Notify after applying the gate response (complete, cancelled, or next phase)
    notify_current_state(session_id, registry, notifier).await;

    result
}

async fn apply_approve(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    ws: &WorkflowState,
    workflow_type: &str,
) -> bool {
    let new_ws = match ws {
        WorkflowState::Brainstorm(BrainstormState::AwaitingApproval { artifact_path, .. }) => {
            WorkflowState::Brainstorm(BrainstormState::Complete {
                artifact_path: artifact_path.clone(),
            })
        }
        WorkflowState::Spec(SpecState::AwaitingApproval { artifact_path, .. }) => {
            WorkflowState::Spec(SpecState::Complete {
                artifact_path: artifact_path.clone(),
            })
        }
        WorkflowState::Epic(EpicState::AwaitingApproval { artifact_path, .. }) => {
            WorkflowState::Epic(EpicState::Complete {
                artifact_path: artifact_path.clone(),
            })
        }
        _ => {
            warn!(%session_id, state = ?ws, "approve in unexpected state");
            return false;
        }
    };

    if let Err(e) = registry
        .update(session_id, move |s| {
            s.workflow_state = new_ws;
        })
        .await
    {
        error!(%session_id, error = %e, "failed to persist Approve");
        return false;
    }
    info!(%session_id, %workflow_type, "approved, complete");
    false // done
}

async fn apply_revise(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    ws: &WorkflowState,
    workflow_type: &str,
    feedback: &str,
) -> bool {
    // Extract current revision count and artifact path from AwaitingApproval
    let (revision, artifact_path) = match ws {
        WorkflowState::Brainstorm(BrainstormState::AwaitingApproval {
            artifact_path,
            revision,
        }) => (*revision, artifact_path.clone()),
        WorkflowState::Spec(SpecState::AwaitingApproval {
            artifact_path,
            revision,
        }) => (*revision, artifact_path.clone()),
        WorkflowState::Epic(EpicState::AwaitingApproval {
            artifact_path,
            revision,
        }) => (*revision, artifact_path.clone()),
        _ => {
            warn!(%session_id, state = ?ws, "revise in unexpected state");
            return false;
        }
    };

    // Check feedback depth limit
    let next_revision = revision + 1;
    if revision >= FEEDBACK_DEPTH_LIMIT {
        warn!(
            %session_id,
            %revision,
            limit = FEEDBACK_DEPTH_LIMIT,
            "feedback depth limit reached, rejecting revision request"
        );
        // The gate_content already tells the user they can only approve or cancel.
        // We simply refuse to apply the revise.
        return false;
    }

    let new_ws = match workflow_type {
        "brainstorm" => WorkflowState::Brainstorm(BrainstormState::Synthesis {
            draft_path: artifact_path,
            revision: next_revision,
        }),
        "spec" => WorkflowState::Spec(SpecState::Drafting {
            draft_path: artifact_path,
            revision: next_revision,
        }),
        "epic" => WorkflowState::Epic(EpicState::Drafting {
            draft_path: artifact_path,
            revision: next_revision,
        }),
        _ => {
            error!(%session_id, %workflow_type, "unknown workflow type in apply_revise");
            return false;
        }
    };

    if let Err(e) = registry
        .update(session_id, move |s| {
            s.workflow_state = new_ws;
        })
        .await
    {
        error!(%session_id, error = %e, "failed to persist Revise");
        return false;
    }
    info!(%session_id, %workflow_type, %feedback, revision = next_revision, "revision requested");
    true // continue loop
}

async fn apply_cancel(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    workflow_type: &str,
) -> bool {
    let new_ws = match workflow_type {
        "brainstorm" => WorkflowState::Brainstorm(BrainstormState::Cancelled),
        "spec" => WorkflowState::Spec(SpecState::Cancelled),
        "epic" => WorkflowState::Epic(EpicState::Cancelled),
        _ => {
            error!(%session_id, %workflow_type, "unknown workflow type in apply_cancel");
            return false;
        }
    };

    if let Err(e) = registry
        .update(session_id, move |s| {
            s.workflow_state = new_ws;
        })
        .await
    {
        error!(%session_id, error = %e, "failed to persist Cancel");
    }
    info!(%session_id, %workflow_type, "cancelled by user");
    false
}

async fn apply_retry(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    ws: &WorkflowState,
    workflow_type: &str,
) -> bool {
    let new_ws = match ws {
        WorkflowState::Brainstorm(BrainstormState::ErrorGate { failed_phase, .. }) => {
            match failed_phase.as_str() {
                "discovery" => WorkflowState::Brainstorm(BrainstormState::Discovery(
                    DiscoveryPhase::Exploring { turn: 0 },
                )),
                "synthesis" => WorkflowState::Brainstorm(BrainstormState::Synthesis {
                    draft_path: PathBuf::from(""),
                    revision: 0,
                }),
                _ => {
                    warn!(%session_id, %failed_phase, "cannot retry unknown brainstorm phase");
                    return false;
                }
            }
        }
        WorkflowState::Spec(SpecState::ErrorGate { failed_phase, .. }) => {
            match failed_phase.as_str() {
                "research" => WorkflowState::Spec(SpecState::Research { turn: 0 }),
                "drafting" => WorkflowState::Spec(SpecState::Drafting {
                    draft_path: PathBuf::from(""),
                    revision: 0,
                }),
                _ => {
                    warn!(%session_id, %failed_phase, "cannot retry unknown spec phase");
                    return false;
                }
            }
        }
        WorkflowState::Epic(EpicState::ErrorGate { failed_phase, .. }) => {
            match failed_phase.as_str() {
                "child_extraction" => {
                    WorkflowState::Epic(EpicState::ChildExtraction { turn: 0 })
                }
                "drafting" => WorkflowState::Epic(EpicState::Drafting {
                    draft_path: PathBuf::from(""),
                    revision: 0,
                }),
                _ => {
                    warn!(%session_id, %failed_phase, "cannot retry unknown epic phase");
                    return false;
                }
            }
        }
        _ => {
            warn!(%session_id, state = ?ws, "retry in unexpected state");
            return false;
        }
    };

    if let Err(e) = registry
        .update(session_id, move |s| {
            s.workflow_state = new_ws;
        })
        .await
    {
        error!(%session_id, error = %e, "failed to persist Retry");
        return false;
    }
    info!(%session_id, %workflow_type, "retrying failed phase");
    true // continue loop
}

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

/// Read the current session state and emit an MCP notification.
async fn notify_current_state(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    notifier: &SessionNotifier,
) {
    let handle = match registry.get(session_id) {
        Some(h) => h,
        None => return,
    };
    let session = handle.lock().await;

    let state = session.session_state();
    let phase = session.workflow_state.phase_name().to_string();
    let sub_phase = session.workflow_state.sub_phase_name().map(|s| s.to_string());
    let wt = session.workflow_state.workflow_type().to_string();
    let state_str = format!("{state:?}");
    let gate_content = session
        .workflow_state
        .gate_content()
        .and_then(|gc| serde_json::to_value(gc).ok());

    let at_gate = matches!(
        state_str.as_str(),
        "WaitingAtGate" | "ErrorGate"
    );
    let (progress, total) = progress_for(&wt, &phase, at_gate);

    let message = match state_str.as_str() {
        "Complete" => format!("{wt}: complete"),
        "Cancelled" => format!("{wt}: cancelled"),
        "ErrorGate" => format!("{wt}: error in {phase} phase"),
        "WaitingAtGate" => format!("{wt}: waiting for input ({phase})"),
        _ => format!("{wt}: {phase} phase running"),
    };

    drop(session);

    notifier
        .notify(&SessionEvent {
            session_id,
            workflow_type: wt,
            session_state: state_str,
            phase,
            sub_phase,
            message,
            gate_content,
            progress,
            total,
        })
        .await;
}

// ---------------------------------------------------------------------------
// Error transition helpers
// ---------------------------------------------------------------------------

/// Transition to ErrorGate state.
async fn transition_to_error(
    registry: &Arc<SessionRegistry>,
    session_id: Uuid,
    message: &str,
    failed_phase: &str,
    workflow_type: &str,
) {
    transition_to_error_with_code(registry, session_id, message, failed_phase, None, workflow_type)
        .await;
}

/// Transition to ErrorGate state with an optional exit code.
async fn transition_to_error_with_code(
    registry: &Arc<SessionRegistry>,
    session_id: Uuid,
    message: &str,
    failed_phase: &str,
    exit_code: Option<i32>,
    workflow_type: &str,
) {
    let msg = message.to_string();
    let phase = failed_phase.to_string();
    let wt = workflow_type.to_string();
    if let Err(e) = registry
        .update(session_id, move |s| {
            s.workflow_state = make_error_gate(&wt, msg, phase, exit_code);
        })
        .await
    {
        error!(%session_id, error = %e, "failed to transition to error gate");
    }
}

/// Build an ErrorGate WorkflowState for the given workflow type.
fn make_error_gate(
    workflow_type: &str,
    message: String,
    failed_phase: String,
    exit_code: Option<i32>,
) -> WorkflowState {
    match workflow_type {
        "spec" => WorkflowState::Spec(SpecState::ErrorGate {
            message,
            failed_phase,
            exit_code,
        }),
        "epic" => WorkflowState::Epic(EpicState::ErrorGate {
            message,
            failed_phase,
            exit_code,
        }),
        _ => WorkflowState::Brainstorm(BrainstormState::ErrorGate {
            message,
            failed_phase,
            exit_code,
        }),
    }
}
