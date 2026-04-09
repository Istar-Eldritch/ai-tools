pub mod auth_handler;
pub mod mcp_handler;
pub mod middleware;
pub mod oauth_state;
pub mod session;

use std::sync::Arc;

use actix_web::web;
use sqlx::PgPool;

use crate::acl::authorized_server::AuthorizedMcpServer;
use crate::auth::api_key::ApiKeyCache;
use crate::auth::google::GoogleOAuthClient;
use crate::http::oauth_state::{PendingAuthStore, PendingCodeStore};
use crate::http::session::SessionStore;

/// Shared application state for the Actix Web server.
pub struct AppState {
    pub pool: PgPool,
    pub google_oauth: GoogleOAuthClient,
    pub google_client_id: String,
    pub oauth_redirect_uri: String,
    pub external_url: String,
    pub api_key_cache: Arc<ApiKeyCache>,
    pub sessions: Arc<SessionStore>,
    pub pending_auth: PendingAuthStore,
    pub pending_codes: PendingCodeStore,
    pub authorized_server: AuthorizedMcpServer,
    pub first_admin_email: Option<String>,
}

/// Configure Actix Web routes.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route(
        "/.well-known/oauth-authorization-server",
        web::get().to(auth_handler::discovery),
    )
    .route("/auth/google", web::get().to(auth_handler::authorize))
    .route("/auth/callback", web::get().to(auth_handler::callback))
    .route("/oauth/token", web::post().to(auth_handler::token))
    .route("/mcp", web::post().to(mcp_handler::handle_mcp))
    .route("/mcp", web::get().to(mcp_handler::handle_mcp_get))
    .route("/mcp", web::delete().to(mcp_handler::handle_mcp_delete));
}
