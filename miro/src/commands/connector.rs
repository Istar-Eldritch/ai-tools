use crate::error::{AppError, AppResult};
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct ConnectorCommand {
    #[clap(subcommand)]
    command: ConnectorCommands,
}

#[derive(Debug, Subcommand)]
enum ConnectorCommands {
    /// List connectors on a board
    List {
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Get a specific connector
    Get {
        /// Connector ID
        connector_id: String,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Create a connector between two items
    Create {
        /// Start item ID
        #[clap(long)]
        start_item: String,
        /// End item ID
        #[clap(long)]
        end_item: String,
        /// Connector shape (straight, elbowed, curved)
        #[clap(long)]
        shape: Option<String>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Delete a connector
    Delete {
        /// Connector ID
        connector_id: String,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
}

fn resolve_board_id<'a>(
    arg: Option<&'a str>,
    global: Option<&'a str>,
) -> AppResult<&'a str> {
    arg.or(global).ok_or_else(|| {
        AppError::General(
            "Board ID must be provided via --board-id or the global --board flag".to_string(),
        )
    })
}

impl ConnectorCommand {
    pub async fn run(
        &self,
        config: &crate::config::CliConfig,
        global_board: Option<&str>,
    ) -> AppResult<()> {
        let client = crate::api::client::Client::new(config)?;
        match &self.command {
            ConnectorCommands::List { board_id } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let response = client.list_connectors(bid).await?;
                println!("{}", serde_json::to_string_pretty(&response.data)?);
            }
            ConnectorCommands::Get {
                connector_id,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let connector = client.get_connector(bid, connector_id).await?;
                println!("{}", serde_json::to_string_pretty(&connector)?);
            }
            ConnectorCommands::Create {
                start_item,
                end_item,
                shape,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let req = crate::api::connector::CreateConnectorRequest {
                    start_item: crate::api::connector::ConnectorEndpoint {
                        id: start_item.clone(),
                        position: None,
                    },
                    end_item: crate::api::connector::ConnectorEndpoint {
                        id: end_item.clone(),
                        position: None,
                    },
                    shape: shape.clone(),
                };
                let connector = client.create_connector(bid, &req).await?;
                println!("{}", serde_json::to_string_pretty(&connector)?);
            }
            ConnectorCommands::Delete {
                connector_id,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                client.delete_connector(bid, connector_id).await?;
                println!("Connector deleted successfully");
            }
        }
        Ok(())
    }
}
