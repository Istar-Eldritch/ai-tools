mod mcp;

use clap::{Parser, Subcommand};
use rag_mcp::chunking::ChunkConfig;
use rag_mcp::config::Config;
use rag_mcp::db;
use rag_mcp::embedding::EmbeddingService;
use rag_mcp::pipelines::delete::DeletePipeline;
use rag_mcp::pipelines::directory_ingest::DirectoryIngestPipeline;
use rag_mcp::pipelines::ingest::IngestPipeline;
use rag_mcp::pipelines::search::SearchPipeline;
use rag_mcp::storage::S3Storage;
use rmcp::transport::stdio;
use rmcp::ServiceExt;
use tracing_subscriber::EnvFilter;

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
            tracing_subscriber::fmt()
                .with_env_filter(
                    EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| EnvFilter::new("info")),
                )
                .with_writer(std::io::stderr)
                .with_ansi(false)
                .init();

            tracing::info!("RAG MCP server starting");

            let pool = db::connect(&config.database_url, config.db_max_connections).await?;
            tracing::info!("database connected and migrations applied");

            let storage = S3Storage::new(&config).await?;
            tracing::info!("S3 storage initialised");

            let embedding = EmbeddingService::new(&config.embedding_model)?;
            tracing::info!(model = %config.embedding_model, "embedding service loaded");

            let chunk_config = ChunkConfig {
                chunk_size: config.chunk_size,
                overlap: config.chunk_overlap,
            };

            let ingest_pipeline = IngestPipeline::new(
                pool.clone(),
                storage.clone(),
                chunk_config,
                embedding.clone(),
            );
            let search_pipeline = SearchPipeline::new(pool.clone(), embedding.clone());
            let delete_pipeline = DeletePipeline::new(pool.clone(), storage.clone());

            let directory_ingest_pipeline = DirectoryIngestPipeline::new(
                ingest_pipeline.clone(),
                delete_pipeline.clone(),
                pool.clone(),
            );

            let server = McpServer::new(
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
    }
}
