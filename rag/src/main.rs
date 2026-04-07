mod chunking;
mod config;
mod db;
mod embedding;
mod error;
mod mcp;
mod pipelines;
mod storage;

use clap::{Parser, Subcommand};
use config::Config;

#[derive(Parser)]
#[command(name = "rag-mcp", version, about = "RAG MCP Server — semantic search over a document knowledge base")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the MCP server
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
            println!("RAG MCP server starting.");
            let _pool = db::connect(&config.database_url, config.db_max_connections).await?;
            println!("Database connected and migrations applied.");
            Ok(())
        }
    }
}
