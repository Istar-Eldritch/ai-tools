mod mcp;

use std::sync::Arc;

use clap::{Parser, Subcommand};
use rmcp::ServiceExt;
use rmcp::transport::stdio;
use spec_pipeline_mcp::config::Config;
use spec_pipeline_mcp::phase_runner::GateChannelMap;
use spec_pipeline_mcp::prompts::PromptStore;
use spec_pipeline_mcp::runner::ClaudeRunner;
use spec_pipeline_mcp::session::{SessionRegistry, SessionStore};
use spec_pipeline_mcp::workflow::types::ModelConfig;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::mcp::McpServer;

#[derive(Parser)]
#[command(
    name = "spec-pipeline-mcp",
    version,
    about = "Spec Pipeline MCP Server — structured specification workflow via MCP"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the MCP server (stdio transport)
    Serve(Config),
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
            let log_dir = config.resolved_log_dir();
            let state_dir = config.resolved_state_dir();
            std::fs::create_dir_all(&log_dir).ok();
            std::fs::create_dir_all(&state_dir).ok();

            let file_appender =
                tracing_appender::rolling::daily(&log_dir, "spec-pipeline-mcp.log");

            let env_filter =
                EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

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
                let _ = std::fs::write(&crash_path, format!("{info}\n\n{backtrace}"));
            }));

            tracing::info!(
                log_dir = %log_dir.display(),
                state_dir = %state_dir.display(),
                "spec-pipeline-mcp server starting"
            );

            let store = SessionStore::new(state_dir.clone())?;
            let registry = Arc::new(SessionRegistry::new(store)?);

            let runner = Arc::new(
                ClaudeRunner::new(config.rag_mcp_config.clone())
                    .map_err(|e| anyhow::anyhow!("Failed to create ClaudeRunner: {e}"))?,
            );
            let prompts = Arc::new(
                PromptStore::new()
                    .map_err(|e| anyhow::anyhow!("Failed to create PromptStore: {e}"))?,
            );
            let gate_channels = Arc::new(GateChannelMap::default());
            let model_config = ModelConfig::default();

            let server = McpServer::new(
                registry,
                runner,
                gate_channels,
                model_config,
                prompts,
            );

            tracing::info!("MCP server ready; listening on stdio");

            // Start serving on stdio FIRST so the MCP handshake completes
            // before any slow validation. The client will timeout and kill us
            // if we don't respond to the initialize request quickly.
            let service = server
                .serve(stdio())
                .await
                .inspect_err(|e| tracing::error!(error = ?e, "MCP serve error"))?;

            // Validate Claude CLI availability in the background after the
            // MCP transport is established. Failures are logged as warnings
            // rather than crashing the server — tool calls that need the CLI
            // will produce clear errors on their own.
            tokio::spawn(async move {
                tracing::info!("Validating Claude CLI availability...");
                match spec_pipeline_mcp::validation::validate_claude_cli().await {
                    Ok(version) => tracing::info!(claude_version = %version, "Claude CLI found"),
                    Err(e) => tracing::warn!(error = %e, "Claude CLI validation failed (tools that need it will error)"),
                }
                tracing::info!("Probing Claude credentials...");
                match spec_pipeline_mcp::validation::validate_claude_credentials().await {
                    Ok(()) => tracing::info!("Claude credentials validated"),
                    Err(e) => tracing::warn!(error = %e, "Claude credential validation failed (tools that need it will error)"),
                }
            });

            service.waiting().await?;

            tracing::info!("MCP server shut down cleanly");
            Ok(())
        }
    }
}
