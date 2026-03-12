use crate::error::AppResult;
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct BoardCommand {
    #[clap(subcommand)]
    command: BoardCommands,
}

#[derive(Debug, Subcommand)]
enum BoardCommands {
    /// List boards
    List,
    /// Get a single board
    Get {
        /// Board ID
        board_id: String,
    },
    /// Create a new board
    Create {
        /// Name of the board
        #[clap(long)]
        name: String,
        /// Description of the board
        #[clap(long)]
        description: Option<String>,
    },
    /// Update a board
    Update {
        /// Board ID
        board_id: String,
        /// Name of the board
        #[clap(long)]
        name: Option<String>,
        /// Description of the board
        #[clap(long)]
        description: Option<String>,
    },
    /// Delete a board
    Delete {
        /// Board ID
        board_id: String,
    },
    /// Copy a board
    Copy {
        /// Board ID to copy
        board_id: String,
    },
}

impl BoardCommand {
    pub async fn run(&self, config: &crate::config::CliConfig) -> AppResult<()> {
        let client = crate::api::client::Client::new(config)?;
        match &self.command {
            BoardCommands::List => {
                let response = client.list_boards().await?;
                println!("{}", serde_json::to_string_pretty(&response.data)?);
            }
            BoardCommands::Get { board_id } => {
                let board = client.get_board(board_id).await?;
                println!("{}", serde_json::to_string_pretty(&board)?);
            }
            BoardCommands::Create { name, description } => {
                let req = crate::api::board::CreateBoardRequest {
                    name: name.clone(),
                    description: description.clone(),
                };
                let board = client.create_board(&req).await?;
                println!("{}", serde_json::to_string_pretty(&board)?);
            }
            BoardCommands::Update {
                board_id,
                name,
                description,
            } => {
                let req = crate::api::board::UpdateBoardRequest {
                    name: name.clone(),
                    description: description.clone(),
                };
                let board = client.update_board(board_id, &req).await?;
                println!("{}", serde_json::to_string_pretty(&board)?);
            }
            BoardCommands::Delete { board_id } => {
                client.delete_board(board_id).await?;
                println!("Board deleted successfully");
            }
            BoardCommands::Copy { board_id } => {
                let board = client.copy_board(board_id).await?;
                println!("{}", serde_json::to_string_pretty(&board)?);
            }
        }
        Ok(())
    }
}
