use actix_web::{web, HttpResponse};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::auth::api_key;
use crate::db::queries;

use super::AppState;

/// Percent-encode a string for use as a URL query parameter value,
/// using the `url` crate's `form_urlencoded` serialiser which handles
/// multi-byte characters correctly.
fn urlencoded(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// GET /.well-known/oauth-authorization-server
pub async fn discovery(state: web::Data<AppState>) -> HttpResponse {
    let base = state.external_url.trim_end_matches('/');
    HttpResponse::Ok().json(serde_json::json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/auth/google"),
        "token_endpoint": format!("{base}/oauth/token"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }))
}

#[derive(Deserialize)]
pub struct AuthorizeQuery {
    pub redirect_uri: String,
    pub state: String,
    pub code_challenge: String,
    pub code_challenge_method: Option<String>,
}

/// GET /auth/google — redirect to Google consent screen
pub async fn authorize(
    state: web::Data<AppState>,
    query: web::Query<AuthorizeQuery>,
) -> HttpResponse {
    let method = query
        .code_challenge_method
        .clone()
        .unwrap_or_else(|| "S256".into());

    if method != "S256" {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "unsupported code_challenge_method"
        }));
    }

    // Validate redirect_uri against the configured allowlist.
    // If the allowlist is non-empty, the provided redirect_uri must be an exact match.
    if !state.allowed_redirect_uris.is_empty()
        && !state
            .allowed_redirect_uris
            .iter()
            .any(|allowed| allowed == &query.redirect_uri)
    {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "redirect_uri not allowed"
        }));
    }

    // Store pending auth state
    state.pending_auth.insert(
        query.state.clone(),
        query.redirect_uri.clone(),
        query.code_challenge.clone(),
        method,
    );

    // Build Google authorization URL manually so we control the state parameter.
    // The oauth2 crate's authorize_url() generates its own random CSRF token,
    // but we need to pass through the client's state so we can look up
    // the pending auth on callback.
    let client_id = &state.google_client_id;
    let redirect_uri = &state.oauth_redirect_uri;
    let google_auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={client_id}\
         &redirect_uri={redirect_uri}\
         &response_type=code\
         &scope=openid%20email%20profile\
         &state={}\
         &access_type=online",
        urlencoded(&query.state)
    );

    HttpResponse::Found()
        .append_header(("Location", google_auth_url))
        .finish()
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub code: String,
    pub state: String,
}

/// GET /auth/callback — Google redirects here after consent
pub async fn callback(
    state: web::Data<AppState>,
    query: web::Query<CallbackQuery>,
) -> HttpResponse {
    // Look up our pending auth by state
    let pending = match state.pending_auth.take(&query.state) {
        Some(p) => p,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "invalid or expired state parameter"
            }));
        }
    };

    // Exchange code with Google
    let user_info = match state.google_oauth.exchange_code(&query.code).await {
        Ok(info) => info,
        Err(e) => {
            tracing::error!(error = %e, "Google code exchange failed");
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "failed to exchange authorization code"
            }));
        }
    };

    // Upsert user in our database
    let display_name = user_info.name.unwrap_or_else(|| user_info.email.clone());
    let user = match queries::upsert_user(
        &state.pool,
        &user_info.sub,
        &user_info.email,
        &display_name,
    )
    .await
    {
        Ok(u) => u,
        Err(e) => {
            tracing::error!(error = %e, "user upsert failed");
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "internal server error"
            }));
        }
    };

    // Auto-promote first admin if configured
    if let Some(ref first_admin) = state.first_admin_email {
        if user.email == *first_admin && !user.is_admin {
            let _ = queries::set_user_admin(&state.pool, &user.email, true).await;
            tracing::info!(email = %user.email, "auto-promoted first admin");
        }
    }

    // Generate an auth code that the client can exchange for an API key
    let auth_code = uuid::Uuid::new_v4().to_string();
    state.pending_codes.insert(
        auth_code.clone(),
        user.id,
        pending.redirect_uri.clone(),
        pending.code_challenge.clone(),
        pending.code_challenge_method.clone(),
    );

    // Redirect back to client with the code
    let redirect = format!(
        "{}?code={}&state={}",
        pending.redirect_uri,
        urlencoded(&auth_code),
        urlencoded(&query.state),
    );

    HttpResponse::Found()
        .append_header(("Location", redirect))
        .finish()
}

#[derive(Deserialize)]
pub struct TokenRequest {
    pub grant_type: String,
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: Option<String>,
}

/// POST /oauth/token — exchange auth code + PKCE verifier for API key
pub async fn token(
    state: web::Data<AppState>,
    form: web::Form<TokenRequest>,
) -> HttpResponse {
    if form.grant_type != "authorization_code" {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "unsupported_grant_type"
        }));
    }

    let pending = match state.pending_codes.take(&form.code) {
        Some(p) => p,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "invalid or expired authorization code"
            }));
        }
    };

    // Verify redirect_uri matches what was used in the authorization request.
    // Per RFC 6749 §4.1.3, if redirect_uri was included in the authorization
    // request it MUST be present and identical in the token request.
    match &form.redirect_uri {
        Some(provided) if provided != &pending.redirect_uri => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "redirect_uri mismatch"
            }));
        }
        None if !pending.redirect_uri.is_empty() => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "redirect_uri required"
            }));
        }
        _ => {}
    }

    // Verify PKCE
    if !verify_pkce_s256(&form.code_verifier, &pending.code_challenge) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "invalid_grant",
            "error_description": "PKCE verification failed"
        }));
    }

    // Generate API key
    let plaintext = api_key::generate_key();
    let hash = api_key::hash_key(&plaintext);

    match queries::insert_api_key(&state.pool, pending.user_id, &hash, "oauth").await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "access_token": plaintext,
            "token_type": "Bearer",
        })),
        Err(e) => {
            tracing::error!(error = %e, "failed to insert API key");
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "server_error"
            }))
        }
    }
}

/// Verify PKCE S256: SHA256(verifier) base64url-encoded == challenge
fn verify_pkce_s256(verifier: &str, challenge: &str) -> bool {
    use base64::Engine;
    let hash = Sha256::digest(verifier.as_bytes());
    let computed = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash);
    computed == challenge
}
