use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{info, warn};
use uuid::Uuid;

use crate::workflow::{SessionState, WorkflowState, WorkflowType};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/// A persistent session that tracks a single workflow execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: Uuid,
    pub topic: String,
    pub workflow_state: WorkflowState,
    pub context_refs: Vec<String>,
    pub model_override: Option<String>,
    pub total_cost_usd: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Session {
    /// Derive the high-level session state from the current workflow state.
    pub fn session_state(&self) -> SessionState {
        self.workflow_state.session_state()
    }
}

// ---------------------------------------------------------------------------
// SessionSummary
// ---------------------------------------------------------------------------

/// Lightweight view of a session for listing purposes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: Uuid,
    pub topic: String,
    pub workflow_type: WorkflowType,
    pub session_state: SessionState,
    pub phase: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// SessionStore (disk I/O)
// ---------------------------------------------------------------------------

/// Handles reading and writing session JSON files to disk.
pub struct SessionStore {
    state_dir: PathBuf,
}

impl SessionStore {
    /// Create a new store, ensuring the state directory exists.
    pub fn new(state_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&state_dir)
            .with_context(|| format!("Failed to create session state dir: {}", state_dir.display()))?;
        Ok(Self { state_dir })
    }

    /// Atomically persist a session to disk (write tmp + rename).
    pub fn save(&self, session: &Session) -> Result<()> {
        let path = self.session_path(session.id);
        let tmp_path = path.with_extension("json.tmp");

        let json = serde_json::to_string_pretty(session)
            .context("Failed to serialize session")?;

        std::fs::write(&tmp_path, json.as_bytes())
            .with_context(|| format!("Failed to write tmp file: {}", tmp_path.display()))?;

        std::fs::rename(&tmp_path, &path)
            .with_context(|| format!("Failed to rename tmp to: {}", path.display()))?;

        Ok(())
    }

    /// Load all sessions from disk, skipping files that fail to parse.
    pub fn load_all(&self) -> Vec<Session> {
        let mut sessions = Vec::new();

        let entries = match std::fs::read_dir(&self.state_dir) {
            Ok(e) => e,
            Err(err) => {
                warn!(dir = %self.state_dir.display(), %err, "Failed to read session state dir");
                return sessions;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(err) => {
                    warn!(%err, "Failed to read dir entry");
                    continue;
                }
            };

            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let data = match std::fs::read_to_string(&path) {
                Ok(d) => d,
                Err(err) => {
                    warn!(file = %path.display(), %err, "Failed to read session file");
                    continue;
                }
            };

            match serde_json::from_str::<Session>(&data) {
                Ok(session) => sessions.push(session),
                Err(err) => {
                    warn!(file = %path.display(), %err, "Failed to deserialize session file");
                }
            }
        }

        sessions
    }

    /// Delete a session file from disk.
    pub fn delete(&self, id: Uuid) -> Result<()> {
        let path = self.session_path(id);
        if path.exists() {
            std::fs::remove_file(&path)
                .with_context(|| format!("Failed to delete session file: {}", path.display()))?;
        }
        Ok(())
    }

    fn session_path(&self, id: Uuid) -> PathBuf {
        self.state_dir.join(format!("{id}.json"))
    }
}

// ---------------------------------------------------------------------------
// SessionRegistry (in-memory + persistence)
// ---------------------------------------------------------------------------

/// In-memory session registry backed by disk persistence.
pub struct SessionRegistry {
    sessions: DashMap<Uuid, Arc<Mutex<Session>>>,
    store: SessionStore,
    /// Latest child-agent activity per session (in-memory only, not persisted).
    activity: DashMap<Uuid, String>,
}

impl SessionRegistry {
    /// Create a new registry, recovering any persisted sessions.
    pub fn new(store: SessionStore) -> Result<Self> {
        let registry = Self {
            sessions: DashMap::new(),
            store,
            activity: DashMap::new(),
        };
        registry.recover()?;
        Ok(registry)
    }

    /// Create a new session and persist it.
    pub fn create(
        &self,
        topic: String,
        workflow_state: WorkflowState,
        context_refs: Vec<String>,
        model_override: Option<String>,
    ) -> Result<Uuid> {
        let now = Utc::now();
        let session = Session {
            id: Uuid::new_v4(),
            topic,
            workflow_state,
            context_refs,
            model_override,
            total_cost_usd: 0.0,
            created_at: now,
            updated_at: now,
        };
        let id = session.id;
        self.store.save(&session)?;
        self.sessions.insert(id, Arc::new(Mutex::new(session)));
        info!(%id, "Session created");
        Ok(id)
    }

    /// Get a handle to a session by id.
    pub fn get(&self, id: Uuid) -> Option<Arc<Mutex<Session>>> {
        self.sessions.get(&id).map(|entry| Arc::clone(entry.value()))
    }

    /// Update a session by applying a closure, then persist the result.
    pub async fn update(&self, id: Uuid, f: impl FnOnce(&mut Session)) -> Result<()> {
        let handle = self
            .sessions
            .get(&id)
            .map(|entry| Arc::clone(entry.value()))
            .with_context(|| format!("Session {id} not found"))?;

        let mut session = handle.lock().await;
        f(&mut session);
        session.updated_at = Utc::now();
        self.store.save(&session)?;
        Ok(())
    }

    /// List sessions, optionally filtering by completion state and workflow type.
    pub async fn list(
        &self,
        include_completed: bool,
        workflow_type: Option<WorkflowType>,
        limit: usize,
    ) -> Vec<SessionSummary> {
        let mut summaries = Vec::new();

        for entry in self.sessions.iter() {
            let session = entry.value().lock().await;
            let state = session.session_state();

            if !include_completed
                && matches!(state, SessionState::Complete | SessionState::Cancelled)
            {
                continue;
            }

            let wt = session.workflow_state.workflow_type();
            if let Some(ref filter) = workflow_type {
                if wt != *filter {
                    continue;
                }
            }

            summaries.push(SessionSummary {
                id: session.id,
                topic: session.topic.clone(),
                workflow_type: wt,
                session_state: state,
                phase: session.workflow_state.phase_name().to_string(),
                created_at: session.created_at,
                updated_at: session.updated_at,
            });
        }

        // Most recently updated first.
        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        summaries.truncate(limit);
        summaries
    }

    /// Update the latest activity message for a session (in-memory only).
    pub fn set_activity(&self, id: Uuid, message: String) {
        self.activity.insert(id, message);
    }

    /// Get the latest activity message for a session, if any.
    pub fn last_activity(&self, id: Uuid) -> Option<String> {
        self.activity.get(&id).map(|v| v.clone())
    }

    /// Cancel a session by transitioning its workflow state to Cancelled.
    pub async fn cancel(&self, id: Uuid) -> Result<()> {
        let handle = self
            .sessions
            .get(&id)
            .map(|entry| Arc::clone(entry.value()))
            .with_context(|| format!("Session {id} not found"))?;

        let mut session = handle.lock().await;
        let state = session.session_state();

        if matches!(state, SessionState::Complete | SessionState::Cancelled) {
            bail!("Session {id} is already in terminal state: {state:?}");
        }

        // Transition to the Cancelled variant for the appropriate workflow.
        session.workflow_state = match session.workflow_state.workflow_type() {
            WorkflowType::Brainstorm => {
                WorkflowState::Brainstorm(crate::workflow::BrainstormState::Cancelled)
            }
            WorkflowType::Spec => WorkflowState::Spec(crate::workflow::SpecState::Cancelled),
            WorkflowType::Epic => WorkflowState::Epic(crate::workflow::EpicState::Cancelled),
        };
        session.updated_at = Utc::now();
        self.store.save(&session)?;
        info!(%id, "Session cancelled");
        Ok(())
    }

    /// Recover persisted sessions: any that were Running are moved to ErrorGate.
    fn recover(&self) -> Result<()> {
        let sessions = self.store.load_all();
        let count = sessions.len();

        for mut session in sessions {
            let state = session.session_state();
            if state == SessionState::Running {
                info!(id = %session.id, phase = session.workflow_state.phase_name(), "Recovering interrupted session");
                session.workflow_state = session.workflow_state.to_error_gate();
                session.updated_at = Utc::now();
                self.store.save(&session)?;
            }

            self.sessions
                .insert(session.id, Arc::new(Mutex::new(session)));
        }

        if count > 0 {
            info!(count, "Recovered sessions from disk");
        }

        Ok(())
    }
}
