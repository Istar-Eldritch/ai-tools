use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use uuid::Uuid;

use crate::acl::context::UserContext;

/// Per-session state stored in the session map.
pub struct SessionState {
    pub id: Uuid,
    pub user_ctx: UserContext,
    pub last_active: std::sync::Mutex<Instant>,
}

/// Thread-safe session store backed by DashMap.
pub struct SessionStore {
    sessions: DashMap<Uuid, Arc<SessionState>>,
    idle_timeout: Duration,
}

impl SessionStore {
    pub fn new(idle_timeout_secs: u64) -> Self {
        Self {
            sessions: DashMap::new(),
            idle_timeout: Duration::from_secs(idle_timeout_secs),
        }
    }

    /// Create a new session for the given user context. Returns the session ID.
    pub fn create(&self, user_ctx: UserContext) -> Uuid {
        let id = Uuid::new_v4();
        let state = Arc::new(SessionState {
            id,
            user_ctx,
            last_active: std::sync::Mutex::new(Instant::now()),
        });
        self.sessions.insert(id, state);
        id
    }

    /// Get a session by ID, updating its last-active timestamp.
    pub fn get(&self, id: &Uuid) -> Option<Arc<SessionState>> {
        let entry = self.sessions.get(id)?;
        let state = entry.value().clone();
        *state.last_active.lock().unwrap() = Instant::now();
        Some(state)
    }

    /// Remove a session by ID.
    pub fn remove(&self, id: &Uuid) -> bool {
        self.sessions.remove(id).is_some()
    }

    /// Evict idle sessions. Returns the number of sessions evicted.
    pub fn evict_idle(&self) -> usize {
        let now = Instant::now();
        let mut evicted = 0;
        self.sessions.retain(|_, state| {
            let last = *state.last_active.lock().unwrap();
            if now.duration_since(last) > self.idle_timeout {
                evicted += 1;
                false
            } else {
                true
            }
        });
        evicted
    }

    /// Start a background task that periodically evicts idle sessions.
    pub fn start_sweeper(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let store = Arc::clone(self);
        let interval = self.idle_timeout / 2;
        let interval = interval.max(Duration::from_secs(30));
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                let evicted = store.evict_idle();
                if evicted > 0 {
                    tracing::info!(evicted, "session sweeper: evicted idle sessions");
                }
            }
        })
    }

    /// Number of active sessions (for metrics/debugging).
    pub fn len(&self) -> usize {
        self.sessions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acl::context::UserContext;

    fn test_ctx() -> UserContext {
        UserContext {
            user_id: Uuid::new_v4(),
            email: "test@example.com".into(),
            is_admin: false,
        }
    }

    #[test]
    fn create_and_get_session() {
        let store = SessionStore::new(1800);
        let id = store.create(test_ctx());
        assert!(store.get(&id).is_some());
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn remove_session() {
        let store = SessionStore::new(1800);
        let id = store.create(test_ctx());
        assert!(store.remove(&id));
        assert!(store.get(&id).is_none());
    }

    #[test]
    fn evict_idle_sessions() {
        let store = SessionStore::new(0); // 0 second timeout = immediate eviction
        let _id = store.create(test_ctx());
        std::thread::sleep(std::time::Duration::from_millis(10));
        let evicted = store.evict_idle();
        assert_eq!(evicted, 1);
        assert_eq!(store.len(), 0);
    }
}
