use std::time::{Duration, Instant};

use dashmap::DashMap;

/// Pending OAuth authorization state: maps state token -> (client_redirect_uri, code_challenge, created_at).
pub struct PendingAuthStore {
    entries: DashMap<String, PendingAuth>,
    ttl: Duration,
}

pub struct PendingAuth {
    pub redirect_uri: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
    pub created_at: Instant,
}

impl PendingAuthStore {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            entries: DashMap::new(),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    pub fn insert(
        &self,
        state: String,
        redirect_uri: String,
        code_challenge: String,
        code_challenge_method: String,
    ) {
        self.entries.insert(
            state,
            PendingAuth {
                redirect_uri,
                code_challenge,
                code_challenge_method,
                created_at: Instant::now(),
            },
        );
    }

    /// Take (remove) a pending auth entry, returning None if expired or absent.
    pub fn take(&self, state: &str) -> Option<PendingAuth> {
        let (_, entry) = self.entries.remove(state)?;
        if entry.created_at.elapsed() > self.ttl {
            return None;
        }
        Some(entry)
    }

    /// Evict expired entries.
    pub fn evict_expired(&self) {
        self.entries
            .retain(|_, entry| entry.created_at.elapsed() <= self.ttl);
    }
}

/// Pending authorization codes: maps code -> (user_id, redirect_uri, code_challenge, created_at).
pub struct PendingCodeStore {
    entries: DashMap<String, PendingCode>,
    ttl: Duration,
}

pub struct PendingCode {
    pub user_id: uuid::Uuid,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
    pub created_at: Instant,
}

impl PendingCodeStore {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            entries: DashMap::new(),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    pub fn insert(
        &self,
        code: String,
        user_id: uuid::Uuid,
        redirect_uri: String,
        code_challenge: String,
        code_challenge_method: String,
    ) {
        self.entries.insert(
            code,
            PendingCode {
                user_id,
                redirect_uri,
                code_challenge,
                code_challenge_method,
                created_at: Instant::now(),
            },
        );
    }

    /// Take (remove) a pending code entry, returning None if expired or absent.
    pub fn take(&self, code: &str) -> Option<PendingCode> {
        let (_, entry) = self.entries.remove(code)?;
        if entry.created_at.elapsed() > self.ttl {
            return None;
        }
        Some(entry)
    }

    pub fn evict_expired(&self) {
        self.entries
            .retain(|_, entry| entry.created_at.elapsed() <= self.ttl);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_auth_insert_and_take() {
        let store = PendingAuthStore::new(300);
        store.insert(
            "state123".into(),
            "http://client/callback".into(),
            "challenge".into(),
            "S256".into(),
        );
        let entry = store.take("state123");
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().redirect_uri, "http://client/callback");
        // Second take should return None
        assert!(store.take("state123").is_none());
    }

    #[test]
    fn pending_auth_expired_returns_none() {
        let store = PendingAuthStore::new(0); // instant expiration
        store.insert("s".into(), "r".into(), "c".into(), "S256".into());
        std::thread::sleep(std::time::Duration::from_millis(10));
        assert!(store.take("s").is_none());
    }

    #[test]
    fn pending_code_insert_and_take() {
        let store = PendingCodeStore::new(300);
        let uid = uuid::Uuid::new_v4();
        store.insert(
            "code123".into(),
            uid,
            "http://client/callback".into(),
            "challenge".into(),
            "S256".into(),
        );
        let entry = store.take("code123");
        assert!(entry.is_some());
        let entry = entry.unwrap();
        assert_eq!(entry.user_id, uid);
        assert_eq!(entry.redirect_uri, "http://client/callback");
    }
}
