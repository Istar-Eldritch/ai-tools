use crate::error::{AppError, AppResult};
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct TagCommand {
    #[clap(subcommand)]
    command: TagCommands,
}

#[derive(Debug, Subcommand)]
enum TagCommands {
    /// List tags on a board
    List {
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Get a specific tag
    Get {
        /// Tag ID
        tag_id: String,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Create a tag
    Create {
        /// Title of the tag
        #[clap(long)]
        title: String,
        /// Fill color (e.g., red, blue, yellow, green, etc.)
        #[clap(long)]
        color: Option<String>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Update a tag
    Update {
        /// Tag ID
        tag_id: String,
        /// Title of the tag
        #[clap(long)]
        title: Option<String>,
        /// Fill color
        #[clap(long)]
        color: Option<String>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Delete a tag
    Delete {
        /// Tag ID
        tag_id: String,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Attach a tag to an item
    Attach {
        /// Tag ID
        #[clap(long)]
        tag_id: String,
        /// Item ID
        #[clap(long)]
        item_id: String,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Detach a tag from an item
    Detach {
        /// Tag ID
        #[clap(long)]
        tag_id: String,
        /// Item ID
        #[clap(long)]
        item_id: String,
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

impl TagCommand {
    pub async fn run(
        &self,
        config: &crate::config::CliConfig,
        global_board: Option<&str>,
    ) -> AppResult<()> {
        let client = crate::api::client::Client::new(config)?;
        match &self.command {
            TagCommands::List { board_id } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let response = client.list_tags(bid).await?;
                println!("{}", serde_json::to_string_pretty(&response.data)?);
            }
            TagCommands::Get { tag_id, board_id } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let tag = client.get_tag(bid, tag_id).await?;
                println!("{}", serde_json::to_string_pretty(&tag)?);
            }
            TagCommands::Create {
                title,
                color,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let req = crate::api::tag::CreateTagRequest {
                    title: title.clone(),
                    fill_color: color.clone(),
                };
                let tag = client.create_tag(bid, &req).await?;
                println!("{}", serde_json::to_string_pretty(&tag)?);
            }
            TagCommands::Update {
                tag_id,
                title,
                color,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let req = crate::api::tag::UpdateTagRequest {
                    title: title.clone(),
                    fill_color: color.clone(),
                };
                let tag = client.update_tag(bid, tag_id, &req).await?;
                println!("{}", serde_json::to_string_pretty(&tag)?);
            }
            TagCommands::Delete { tag_id, board_id } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                client.delete_tag(bid, tag_id).await?;
                println!("Tag deleted successfully");
            }
            TagCommands::Attach {
                tag_id,
                item_id,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let req = crate::api::tag::AttachTagRequest {
                    id: tag_id.clone(),
                };
                client.attach_tag(bid, item_id, &req).await?;
                println!("Tag attached successfully");
            }
            TagCommands::Detach {
                tag_id,
                item_id,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                client.detach_tag(bid, item_id, tag_id).await?;
                println!("Tag detached successfully");
            }
        }
        Ok(())
    }
}
