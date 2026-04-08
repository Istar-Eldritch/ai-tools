mod mcp;

use clap::{Parser, Subcommand};
use rmcp::ServiceExt;
use rmcp::transport::stdio;
use spec_pipeline_mcp::config::Config;
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

            let server = McpServer::new();

            tracing::info!("MCP server ready; listening on stdio");

            let service = server
                .serve(stdio())
                .await
                .inspect_err(|e| tracing::error!(error = ?e, "MCP serve error"))?;

            service.waiting().await?;

            tracing::info!("MCP server shut down cleanly");
            Ok(())
        }
    }
}
