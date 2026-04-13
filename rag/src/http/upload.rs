use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use dashmap::DashMap;
use uuid::Uuid;

/// A staged file upload awaiting consumption by the `ingest` tool.
pub struct StagedUpload {
    pub bytes: Bytes,
    pub filename: String,
    pub content_type: String,
    pub created_at: Instant,
}

/// Thread-safe store for staged uploads, keyed by UUID token.
///
/// Tokens are single-use: `take()` removes the entry atomically.
/// A background sweeper calls `evict_expired()` periodically to remove
/// entries that were never consumed.
#[derive(Clone)]
pub struct UploadStore {
    inner: Arc<DashMap<Uuid, StagedUpload>>,
    ttl: Duration,
}

impl UploadStore {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    /// Stage an upload and return its token UUID.
    pub fn insert(&self, upload: StagedUpload) -> Uuid {
        let token = Uuid::new_v4();
        self.inner.insert(token, upload);
        token
    }

    /// Consume (remove) a staged upload by token.
    /// Returns `None` if the token does not exist or has expired.
    pub fn take(&self, token: &Uuid) -> Option<StagedUpload> {
        let (_, entry) = self.inner.remove(token)?;
        if entry.created_at.elapsed() > self.ttl {
            return None;
        }
        Some(entry)
    }

    /// Remove all expired entries.
    pub fn evict_expired(&self) {
        self.inner
            .retain(|_, entry| entry.created_at.elapsed() <= self.ttl);
    }

    /// Number of staged uploads (for metrics/debugging).
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Returns `true` if there are no staged uploads.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_upload(size: usize) -> StagedUpload {
        StagedUpload {
            bytes: Bytes::from(vec![0u8; size]),
            filename: "test.pdf".into(),
            content_type: "application/pdf".into(),
            created_at: Instant::now(),
        }
    }

    #[test]
    fn insert_and_take() {
        let store = UploadStore::new(300);
        let token = store.insert(make_upload(100));
        let upload = store.take(&token);
        assert!(upload.is_some());
        assert_eq!(upload.unwrap().bytes.len(), 100);
    }

    #[test]
    fn single_use_token() {
        let store = UploadStore::new(300);
        let token = store.insert(make_upload(100));
        assert!(store.take(&token).is_some());
        assert!(store.take(&token).is_none()); // second take fails
    }

    #[test]
    fn expired_token_returns_none() {
        let store = UploadStore::new(0); // instant expiration
        let token = store.insert(make_upload(100));
        std::thread::sleep(std::time::Duration::from_millis(10));
        assert!(store.take(&token).is_none());
    }

    #[test]
    fn evict_expired_removes_entries() {
        let store = UploadStore::new(0);
        store.insert(make_upload(100));
        store.insert(make_upload(200));
        assert_eq!(store.len(), 2);
        std::thread::sleep(std::time::Duration::from_millis(10));
        store.evict_expired();
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn nonexistent_token_returns_none() {
        let store = UploadStore::new(300);
        assert!(store.take(&Uuid::new_v4()).is_none());
    }
}
