mod mcp;

use std::path::PathBuf;
use std::sync::Arc;

use actix_web::{web, App, HttpServer};
use clap::{Parser, Subcommand};
use rag_mcp::acl::authorized_server::AuthorizedMcpServer;
use rag_mcp::auth::api_key::ApiKeyCache;
use rag_mcp::auth::google::GoogleOAuthClient;
use rag_mcp::chunking::ChunkConfig;
use rag_mcp::config::{Config, HttpConfig};
use rag_mcp::db;
use rag_mcp::embedding::EmbeddingService;
use rag_mcp::http::oauth_state::{PendingAuthStore, PendingCodeStore};
use rag_mcp::http::session::SessionStore;
use rag_mcp::http::{self as http_mod, AppState};
use rag_mcp::pipelines::delete::DeletePipeline;
use rag_mcp::pipelines::directory_ingest::DirectoryIngestPipeline;
use rag_mcp::pipelines::ingest::IngestPipeline;
use rag_mcp::pipelines::search::SearchPipeline;
use rag_mcp::storage::S3Storage;
use rmcp::transport::stdio;
use rmcp::ServiceExt;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::mcp::McpServer;

#[derive(Parser)]
#[command(
    name = "rag-mcp",
    version,
    about = "RAG MCP Server — semantic search over a document knowledge base"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the MCP server (stdio transport)
    Serve(Config),
    /// Start the HTTP/MCP server (Actix Web, Streamable HTTP)
    ServeHttp(HttpConfig),
    /// Admin commands
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
}

#[derive(Subcommand)]
enum AdminAction {
    /// Promote a user to admin by email
    Promote(AdminPromoteArgs),
}

#[derive(clap::Args)]
struct AdminPromoteArgs {
    /// Database URL
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,
    /// Email of the user to promote
    email: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match dotenvy::dotenv() {
        Ok(_) => {}
        Err(dotenvy::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("Warning: failed to load .env file: {e}"),
    }

    let cli = Cli::parse();

    match cli.command {
        Commands::Serve(config) => {
            let log_dir = std::env::var("RAG_LOG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| {
                    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
                    PathBuf::from(home).join(".local/state/rag-mcp")
                });
            std::fs::create_dir_all(&log_dir).ok();

            let file_appender = tracing_appender::rolling::daily(&log_dir, "rag-mcp.log");

            let env_filter = EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info"));

            let stderr_layer = tracing_subscriber::fmt::layer()
                .with_writer(std::io::stderr)
                .with_ansi(false);

            let file_layer = tracing_subscriber::fmt::layer()
                .with_writer(file_appender)
                .with_ansi(false);

            tracing_subscriber::registry()
                .with(env_filter)
                .with(stderr_layer)
                .with(file_layer)
                .init();

            // Log panics through tracing so they hit the file appender
            let panic_log_dir = log_dir.clone();
            std::panic::set_hook(Box::new(move |info| {
                let backtrace = std::backtrace::Backtrace::force_capture();
                tracing::error!(%info, %backtrace, "PANIC");
                // Also write directly to a crash file in case tracing fails to flush
                let crash_path = panic_log_dir.join("crash.log");
                let _ = std::fs::write(
                    &crash_path,
                    format!("{info}\n\n{backtrace}"),
                );
            }));

            tracing::info!(log_dir = %log_dir.display(), "RAG MCP server starting");

            let pool = db::connect(&config.database_url, config.db_max_connections).await?;
            tracing::info!("database connected and migrations applied");

            let storage = S3Storage::from_config(&config)?;
            if storage.is_none() {
                tracing::warn!("S3 storage not configured; document uploads will be skipped");
            } else {
                tracing::info!("S3 storage initialised");
            }

            let embedding = EmbeddingService::new(&config.embedding_model)?;
            tracing::info!(model = %config.embedding_model, "embedding service loaded");

            let chunk_config = ChunkConfig {
                chunk_size: config.chunk_size,
                overlap: config.chunk_overlap,
                min_chunk_size: config.min_chunk_size,
            };

            let ingest_pipeline = IngestPipeline::new(
                pool.clone(),
                storage.clone(),
                chunk_config,
                embedding.clone(),
            );
            let search_pipeline = SearchPipeline::new(
                pool.clone(),
                embedding.clone(),
                config.dedup_threshold,
                config.dedup_candidate_factor,
            );
            let delete_pipeline = DeletePipeline::new(pool.clone(), storage.clone());

            let directory_ingest_pipeline = DirectoryIngestPipeline::new(
                ingest_pipeline.clone(),
                delete_pipeline.clone(),
                pool.clone(),
            );

            let server = McpServer::new(
                pool.clone(),
                ingest_pipeline,
                search_pipeline,
                delete_pipeline,
                directory_ingest_pipeline,
            );

            tracing::info!("MCP server ready; listening on stdio");

            let service = server
                .serve(stdio())
                .await
                .inspect_err(|e| tracing::error!(error = ?e, "MCP serve error"))?;

            service.waiting().await?;

            tracing::info!("MCP server shut down cleanly");
            Ok(())
        }
        Commands::ServeHttp(http_config) => {
            let config = &http_config.base;

            init_tracing();

            tracing::info!("RAG MCP HTTP server starting");

            let pool = db::connect(&config.database_url, config.db_max_connections).await?;
            tracing::info!("database connected and migrations applied");

            let s3_params = config.require_s3()?;
            let storage = S3Storage::from_params(&s3_params);
            tracing::info!("S3 storage initialised");

            let embedding = EmbeddingService::new(&config.embedding_model)?;
            tracing::info!(model = %config.embedding_model, "embedding service loaded");

            let chunk_config = ChunkConfig {
                chunk_size: config.chunk_size,
                overlap: config.chunk_overlap,
                min_chunk_size: config.min_chunk_size,
            };

            let ingest_pipeline = IngestPipeline::new(
                pool.clone(),
                Some(storage.clone()),
                chunk_config,
                embedding.clone(),
            );
            let search_pipeline = SearchPipeline::new(
                pool.clone(),
                embedding.clone(),
                config.dedup_threshold,
                config.dedup_candidate_factor,
            );
            let delete_pipeline = DeletePipeline::new(pool.clone(), Some(storage.clone()));

            let google_oauth = GoogleOAuthClient::new(
                &http_config.google_client_id,
                &http_config.google_client_secret,
                &http_config.oauth_redirect_uri,
            )?;

            let api_key_cache = Arc::new(ApiKeyCache::new(1000, http_config.api_key_cache_ttl_secs));
            let sessions = Arc::new(SessionStore::new(http_config.mcp_session_idle_secs));
            sessions.start_sweeper();

            let pending_auth = Arc::new(PendingAuthStore::new(300));
            let pending_codes = Arc::new(PendingCodeStore::new(300));

            // Sweep expired pending OAuth state and code entries every 60 seconds.
            {
                let pa = Arc::clone(&pending_auth);
                tokio::spawn(async move {
                    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
                    loop {
                        ticker.tick().await;
                        pa.evict_expired();
                    }
                });
            }
            {
                let pc = Arc::clone(&pending_codes);
                tokio::spawn(async move {
                    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
                    loop {
                        ticker.tick().await;
                        pc.evict_expired();
                    }
                });
            }

            let authorized_server = AuthorizedMcpServer::new(
                pool.clone(),
                ingest_pipeline,
                search_pipeline,
                delete_pipeline,
                Arc::clone(&api_key_cache),
            );

            // Derive external URL from the OAuth redirect URI
            let external_url = http_config
                .oauth_redirect_uri
                .trim_end_matches("/auth/callback")
                .to_string();

            let app_state = web::Data::new(AppState {
                pool,
                google_oauth,
                google_client_id: http_config.google_client_id.clone(),
                oauth_redirect_uri: http_config.oauth_redirect_uri.clone(),
                external_url,
                api_key_cache,
                sessions,
                pending_auth,
                pending_codes,
                authorized_server,
                first_admin_email: http_config.first_admin_email.clone(),
                allowed_redirect_uris: http_config.allowed_redirect_uris.clone(),
            });

            let bind_addr = http_config.http_bind.clone();
            tracing::info!(bind = %bind_addr, "HTTP server starting");

            HttpServer::new(move || {
                App::new()
                    .app_data(app_state.clone())
                    .configure(http_mod::configure_routes)
            })
            .bind(&bind_addr)?
            .run()
            .await?;

            tracing::info!("HTTP server shut down cleanly");
            Ok(())
        }
        Commands::Admin { action } => {
            init_tracing();

            match action {
                AdminAction::Promote(args) => {
                    let pool = db::connect(&args.database_url, 1).await?;
                    match rag_mcp::db::queries::set_user_admin(&pool, &args.email, true).await? {
                        Some(user) => {
                            println!("Promoted {} ({}) to admin", user.email, user.id);
                        }
                        None => {
                            eprintln!("User with email '{}' not found", args.email);
                            std::process::exit(1);
                        }
                    }
                    Ok(())
                }
            }
        }
    }
}

/// Shared tracing initialisation for non-stdio subcommands.
fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(std::io::stderr)
                .with_ansi(true),
        )
        .init();
}
