use std::sync::Mutex;
use std::time::{Duration, Instant};

use lru::LruCache;
use rand::Rng;
use sha2::{Digest, Sha256};

use crate::db::models::User;

/// Base62 alphabet for key encoding.
const BASE62: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// API key prefix.
const KEY_PREFIX: &str = "rag_";

/// Generate a new plaintext API key: `rag_` + base62(32 random bytes).
pub fn generate_key() -> String {
    let mut rng = rand::thread_rng();
    let random_bytes: Vec<u8> = (0..32).map(|_| rng.r#gen::<u8>()).collect();
    let encoded: String = random_bytes
        .iter()
        .map(|b| BASE62[(*b as usize) % BASE62.len()] as char)
        .collect();
    format!("{KEY_PREFIX}{encoded}")
}

/// Compute the SHA-256 hash of a plaintext API key, returning a hex string.
pub fn hash_key(plaintext: &str) -> String {
    format!("{:x}", Sha256::digest(plaintext.as_bytes()))
}

/// A cached entry for a validated API key -> User lookup.
struct CachedUser {
    user: User,
    cached_at: Instant,
}

/// LRU cache for API key hash -> User, with TTL-based expiration.
pub struct ApiKeyCache {
    inner: Mutex<LruCache<String, CachedUser>>,
    ttl: Duration,
}

impl ApiKeyCache {
    /// Create a new cache with the given capacity and TTL.
    pub fn new(capacity: usize, ttl_secs: u64) -> Self {
        Self {
            inner: Mutex::new(LruCache::new(
                std::num::NonZeroUsize::new(capacity).expect("cache capacity must be > 0"),
            )),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    /// Get a cached user for the given key hash, if present and not expired.
    pub fn get(&self, key_hash: &str) -> Option<User> {
        let mut cache = self.inner.lock().unwrap();
        if let Some(entry) = cache.get(key_hash) {
            if entry.cached_at.elapsed() < self.ttl {
                return Some(entry.user.clone());
            }
            // Expired — remove it
            cache.pop(key_hash);
        }
        None
    }

    /// Insert a user into the cache keyed by the API key hash.
    pub fn insert(&self, key_hash: String, user: User) {
        let mut cache = self.inner.lock().unwrap();
        cache.put(
            key_hash,
            CachedUser {
                user,
                cached_at: Instant::now(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_key_has_prefix() {
        let key = generate_key();
        assert!(key.starts_with("rag_"));
        assert_eq!(key.len(), 4 + 32); // prefix + 32 base62 chars
    }

    #[test]
    fn hash_key_is_deterministic() {
        let key = "rag_testkey123";
        assert_eq!(hash_key(key), hash_key(key));
    }

    #[test]
    fn hash_key_differs_for_different_keys() {
        assert_ne!(hash_key("rag_aaa"), hash_key("rag_bbb"));
    }

    #[test]
    fn cache_hit_within_ttl() {
        let cache = ApiKeyCache::new(10, 60);
        let user = User {
            id: uuid::Uuid::new_v4(),
            google_sub: "sub".into(),
            email: "test@example.com".into(),
            display_name: "Test".into(),
            is_admin: false,
            created_at: chrono::Utc::now(),
        };
        cache.insert("hash1".into(), user.clone());
        let cached = cache.get("hash1");
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().email, "test@example.com");
    }

    #[test]
    fn cache_miss_for_unknown_key() {
        let cache = ApiKeyCache::new(10, 60);
        assert!(cache.get("nonexistent").is_none());
    }
}
