use std::sync::Arc;

use actix_web::HttpRequest;
use sqlx::PgPool;

use crate::acl::context::UserContext;
use crate::auth::api_key::{hash_key, ApiKeyCache};
use crate::db::queries;

/// Extract and validate an API key from the Authorization header.
/// Returns Ok(UserContext) on success, Err(message) on failure.
pub async fn extract_user_from_api_key(
    req: &HttpRequest,
    pool: &PgPool,
    cache: &Arc<ApiKeyCache>,
) -> Result<UserContext, String> {
    let auth_header = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "missing Authorization header".to_string())?;

    let token = if let Some(stripped) = auth_header.strip_prefix("Bearer ") {
        stripped.trim()
    } else {
        return Err("Authorization header must use Bearer scheme".into());
    };

    if token.is_empty() {
        return Err("empty bearer token".into());
    }

    let key_hash = hash_key(token);

    // Check cache first
    if let Some(user) = cache.get(&key_hash) {
        return Ok(UserContext::from(user));
    }

    // Cache miss: look up in database
    let api_key = queries::get_active_api_key_by_hash(pool, &key_hash)
        .await
        .map_err(|e| format!("database error: {e}"))?
        .ok_or_else(|| "invalid or revoked API key".to_string())?;

    let user = queries::get_user_by_id(pool, api_key.user_id)
        .await
        .map_err(|e| format!("database error: {e}"))?
        .ok_or_else(|| "user not found for API key".to_string())?;

    // Update last_used_at (fire-and-forget)
    let pool_clone = pool.clone();
    let key_id = api_key.id;
    tokio::spawn(async move {
        let _ = queries::touch_api_key(&pool_clone, key_id).await;
    });

    // Populate cache
    cache.insert(key_hash, user.clone());

    Ok(UserContext::from(user))
}
