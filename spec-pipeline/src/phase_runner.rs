use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::oneshot;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::prompts::PromptStore;
use crate::runner::{ClaudeRunner, PhaseContext, RawPhaseOutput, RunnerError};
use crate::session::SessionRegistry;
use crate::workflow::brainstorm::{BrainstormState, DiscoveryPhase};
use crate::workflow::types::{GateResponse, ModelConfig};
use crate::workflow::WorkflowState;

/// Map of session IDs to oneshot senders that deliver a gate response.
pub type GateChannelMap = DashMap<Uuid, oneshot::Sender<GateResponse>>;

/// Snapshot of session state needed to build a PhaseContext and invoke claude.
struct PhaseSetup {
    context: PhaseContext,
    model: String,
    prompt_key: String,
}

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

            PhaseSetup {
                context: PhaseContext {
                    topic: session.topic.clone(),
                    workflow_type: "brainstorm".to_string(),
                    phase: phase.to_string(),
                    sub_phase,
                    prior_artifacts,
                    gate_history: vec![], // TODO: populate from session gate_history
                    revision_feedback: None,
                    revision,
                },
                model,
                prompt_key: prompt_key.to_string(),
            }
            // lock dropped here
        };

        // -----------------------------------------------------------------
        // 2. Get prompt path
        // -----------------------------------------------------------------
        let prompt_path = match prompts.get(&setup.prompt_key) {
            Some(p) => p.to_path_buf(),
            None => {
                error!(%session_id, key = %setup.prompt_key, "prompt key not found");
                transition_to_error(
                    &registry,
                    session_id,
                    "Internal error: prompt key not found",
                    &setup.prompt_key,
                )
                .await;
                return;
            }
        };

        // -----------------------------------------------------------------
        // 3. Run the phase (no lock held)
        // -----------------------------------------------------------------
        info!(
            %session_id,
            phase = %setup.context.phase,
            model = %setup.model,
            "running phase"
        );

        let result = runner
            .run_phase(&setup.context, &setup.model, &prompt_path)
            .await;

        // -----------------------------------------------------------------
        // 4. Process result
        // -----------------------------------------------------------------
        match result {
            Ok(run_result) => {
                let action = process_phase_output(
                    session_id,
                    &registry,
                    &setup.context.phase,
                    run_result.output,
                    run_result.cost_usd,
                )
                .await;

                match action {
                    LoopAction::Continue => continue,
                    LoopAction::Break => break,
                    LoopAction::AwaitGate => {
                        match await_gate_response(session_id, &gate_channels).await {
                            Some(response) => {
                                if apply_gate_response(session_id, response, &registry).await {
                                    continue;
                                } else {
                                    break;
                                }
                            }
                            None => {
                                warn!(%session_id, "gate channel dropped without response");
                                break;
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
                    &registry,
                    session_id,
                    &err.to_string(),
                    &setup.context.phase,
                    exit_code,
                )
                .await;

                // Wait for user to decide (retry or cancel)
                match await_gate_response(session_id, &gate_channels).await {
                    Some(response) => {
                        if apply_gate_response(session_id, response, &registry).await {
                            continue;
                        } else {
                            break;
                        }
                    }
                    None => {
                        warn!(
                            %session_id,
                            "gate channel dropped without response (error gate)"
                        );
                        break;
                    }
                }
            }
        }
    }

    info!(%session_id, "brainstorm session loop finished");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// What the main loop should do after processing a phase result.
enum LoopAction {
    Continue,
    Break,
    AwaitGate,
}

/// Process the output of a phase run.  Uses `registry.update()` so locking is
/// handled correctly (no external lock held).
async fn process_phase_output(
    session_id: Uuid,
    registry: &Arc<SessionRegistry>,
    current_phase: &str,
    output: RawPhaseOutput,
    cost_usd: f64,
) -> LoopAction {
    // We need to read the current brainstorm state to decide what to do.
    // Take a snapshot first.
    let bs_snapshot = {
        let handle = match registry.get(session_id) {
            Some(h) => h,
            None => return LoopAction::Break,
        };
        let session = handle.lock().await;
        match &session.workflow_state {
            WorkflowState::Brainstorm(bs) => bs.clone(),
            _ => return LoopAction::Break,
        }
    };

    match output {
        // ---------------------------------------------------------------
        // Continue: increment turn, keep looping
        // ---------------------------------------------------------------
        RawPhaseOutput::Continue => {
            let new_state = match bs_snapshot {
                BrainstormState::Discovery(DiscoveryPhase::Exploring { turn }) => {
                    BrainstormState::Discovery(DiscoveryPhase::Exploring { turn: turn + 1 })
                }
                BrainstormState::Synthesis { draft_path, revision } => {
                    // Synthesis continue -- keep same state
                    BrainstormState::Synthesis { draft_path, revision }
                }
                other => {
                    warn!(%session_id, state = ?other, "unexpected Continue in state");
                    return LoopAction::Break;
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
                return LoopAction::Break;
            }
            LoopAction::Continue
        }

        // ---------------------------------------------------------------
        // Gate: pause for user input
        // ---------------------------------------------------------------
        RawPhaseOutput::Gate { question, .. } => {
            let new_state = match bs_snapshot {
                BrainstormState::Discovery(_) => BrainstormState::Discovery(
                    DiscoveryPhase::AwaitingAnswer {
                        question: question.clone(),
                    },
                ),
                other => {
                    warn!(%session_id, state = ?other, "unexpected Gate in state");
                    return LoopAction::Break;
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
                return LoopAction::Break;
            }
            info!(%session_id, %question, "awaiting user answer at gate");
            LoopAction::AwaitGate
        }

        // ---------------------------------------------------------------
        // Done: advance phase
        // ---------------------------------------------------------------
        RawPhaseOutput::Done {
            artifact_path,
            summary,
        } => {
            info!(%session_id, %summary, artifact = %artifact_path, "phase done");

            match bs_snapshot {
                BrainstormState::Discovery(_) => {
                    // Discovery done -> move to Synthesis
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
                        return LoopAction::Break;
                    }
                    LoopAction::Continue
                }
                BrainstormState::Synthesis { .. } => {
                    // Synthesis done -> AwaitingApproval
                    let path = PathBuf::from(&artifact_path);
                    let new_state = BrainstormState::AwaitingApproval {
                        artifact_path: path,
                    };
                    if let Err(e) = registry
                        .update(session_id, move |s| {
                            s.total_cost_usd += cost_usd;
                            s.workflow_state = WorkflowState::Brainstorm(new_state);
                        })
                        .await
                    {
                        error!(%session_id, error = %e, "failed to persist Synthesis->AwaitingApproval");
                        return LoopAction::Break;
                    }
                    info!(%session_id, "synthesis complete, awaiting approval");
                    LoopAction::AwaitGate
                }
                other => {
                    warn!(%session_id, state = ?other, phase = current_phase, "unexpected Done in state");
                    LoopAction::Break
                }
            }
        }
    }
}

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
/// continue or `false` if it should break.
async fn apply_gate_response(
    session_id: Uuid,
    response: GateResponse,
    registry: &Arc<SessionRegistry>,
) -> bool {
    // Snapshot the current brainstorm state
    let bs = {
        let handle = match registry.get(session_id) {
            Some(h) => h,
            None => {
                error!(%session_id, "session vanished when applying gate response");
                return false;
            }
        };
        let session = handle.lock().await;
        match &session.workflow_state {
            WorkflowState::Brainstorm(bs) => bs.clone(),
            _ => return false,
        }
    };

    match response {
        GateResponse::Approve => match bs {
            BrainstormState::AwaitingApproval { artifact_path } => {
                let new_state = BrainstormState::Complete { artifact_path };
                if let Err(e) = registry
                    .update(session_id, move |s| {
                        s.workflow_state = WorkflowState::Brainstorm(new_state);
                    })
                    .await
                {
                    error!(%session_id, error = %e, "failed to persist Approve");
                    return false;
                }
                info!(%session_id, "brainstorm approved, complete");
                false // done
            }
            _ => {
                warn!(%session_id, state = ?bs, "approve in unexpected state");
                false
            }
        },

        GateResponse::Revise { feedback } => match bs {
            BrainstormState::AwaitingApproval { artifact_path } => {
                let new_state = BrainstormState::Synthesis {
                    draft_path: artifact_path,
                    revision: 1,
                };
                if let Err(e) = registry
                    .update(session_id, move |s| {
                        s.workflow_state = WorkflowState::Brainstorm(new_state);
                    })
                    .await
                {
                    error!(%session_id, error = %e, "failed to persist Revise");
                    return false;
                }
                info!(%session_id, %feedback, "revision requested, returning to synthesis");
                true // continue loop
            }
            _ => {
                warn!(%session_id, state = ?bs, "revise in unexpected state");
                false
            }
        },

        GateResponse::Cancel => {
            let new_state = BrainstormState::Cancelled;
            if let Err(e) = registry
                .update(session_id, move |s| {
                    s.workflow_state = WorkflowState::Brainstorm(new_state);
                })
                .await
            {
                error!(%session_id, error = %e, "failed to persist Cancel");
            }
            info!(%session_id, "brainstorm cancelled by user");
            false
        }

        GateResponse::Retry => match bs {
            BrainstormState::ErrorGate { failed_phase, .. } => {
                let restored = match failed_phase.as_str() {
                    "discovery" => {
                        BrainstormState::Discovery(DiscoveryPhase::Exploring { turn: 0 })
                    }
                    "synthesis" => BrainstormState::Synthesis {
                        draft_path: PathBuf::from(""),
                        revision: 0,
                    },
                    _ => {
                        warn!(%session_id, %failed_phase, "cannot retry unknown phase");
                        return false;
                    }
                };
                if let Err(e) = registry
                    .update(session_id, move |s| {
                        s.workflow_state = WorkflowState::Brainstorm(restored);
                    })
                    .await
                {
                    error!(%session_id, error = %e, "failed to persist Retry");
                    return false;
                }
                info!(%session_id, %failed_phase, "retrying failed phase");
                true // continue loop
            }
            _ => {
                warn!(%session_id, state = ?bs, "retry in unexpected state");
                false
            }
        },
    }
}

/// Transition to ErrorGate state.
async fn transition_to_error(
    registry: &Arc<SessionRegistry>,
    session_id: Uuid,
    message: &str,
    failed_phase: &str,
) {
    transition_to_error_with_code(registry, session_id, message, failed_phase, None).await;
}

/// Transition to ErrorGate state with an optional exit code.
async fn transition_to_error_with_code(
    registry: &Arc<SessionRegistry>,
    session_id: Uuid,
    message: &str,
    failed_phase: &str,
    exit_code: Option<i32>,
) {
    let msg = message.to_string();
    let phase = failed_phase.to_string();
    if let Err(e) = registry
        .update(session_id, move |s| {
            s.workflow_state = WorkflowState::Brainstorm(BrainstormState::ErrorGate {
                message: msg,
                failed_phase: phase,
                exit_code,
            });
        })
        .await
    {
        error!(%session_id, error = %e, "failed to transition to error gate");
    }
}
