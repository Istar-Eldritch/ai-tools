use crate::error::{AppError, AppResult};
use clap::{Args, Subcommand};
use serde_json::Value;

#[derive(Debug, Args)]
pub struct ItemCommand {
    #[clap(subcommand)]
    command: ItemCommands,
}

#[derive(Debug, Subcommand)]
enum ItemCommands {
    /// List all items on a board
    List {
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Get a specific item
    Get {
        /// Item ID
        item_id: String,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Create a sticky note
    CreateStickyNote {
        /// Content of the sticky note
        #[clap(long)]
        content: String,
        /// X position
        #[clap(long)]
        x: Option<f64>,
        /// Y position
        #[clap(long)]
        y: Option<f64>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Create a shape
    CreateShape {
        /// Content/text of the shape
        #[clap(long)]
        content: Option<String>,
        /// Shape type (rectangle, circle, triangle, etc.)
        #[clap(long, default_value = "rectangle")]
        shape: String,
        /// X position
        #[clap(long)]
        x: Option<f64>,
        /// Y position
        #[clap(long)]
        y: Option<f64>,
        /// Width
        #[clap(long)]
        width: Option<f64>,
        /// Height
        #[clap(long)]
        height: Option<f64>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Create a text item
    CreateText {
        /// Content of the text item
        #[clap(long)]
        content: String,
        /// X position
        #[clap(long)]
        x: Option<f64>,
        /// Y position
        #[clap(long)]
        y: Option<f64>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Create a card
    CreateCard {
        /// Title of the card
        #[clap(long)]
        title: String,
        /// Description of the card
        #[clap(long)]
        description: Option<String>,
        /// X position
        #[clap(long)]
        x: Option<f64>,
        /// Y position
        #[clap(long)]
        y: Option<f64>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Create a frame
    CreateFrame {
        /// Title of the frame
        #[clap(long)]
        title: String,
        /// X position
        #[clap(long)]
        x: Option<f64>,
        /// Y position
        #[clap(long)]
        y: Option<f64>,
        /// Width
        #[clap(long)]
        width: Option<f64>,
        /// Height
        #[clap(long)]
        height: Option<f64>,
        /// Board ID
        #[clap(long)]
        board_id: Option<String>,
    },
    /// Delete an item
    Delete {
        /// Item ID
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

fn build_position(x: Option<f64>, y: Option<f64>) -> Option<crate::api::item::Position> {
    if x.is_some() || y.is_some() {
        Some(crate::api::item::Position {
            x,
            y,
            origin: Some("center".to_string()),
        })
    } else {
        None
    }
}

fn build_geometry(
    width: Option<f64>,
    height: Option<f64>,
) -> Option<crate::api::item::Geometry> {
    if width.is_some() || height.is_some() {
        Some(crate::api::item::Geometry { width, height })
    } else {
        None
    }
}

impl ItemCommand {
    pub async fn run(
        &self,
        config: &crate::config::CliConfig,
        global_board: Option<&str>,
    ) -> AppResult<()> {
        let client = crate::api::client::Client::new(config)?;
        match &self.command {
            ItemCommands::List { board_id } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let response = client.list_items(bid).await?;
                println!("{}", serde_json::to_string_pretty(&response.data)?);
            }
            ItemCommands::Get { item_id, board_id } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let item = client.get_item(bid, item_id).await?;
                println!("{}", serde_json::to_string_pretty(&item)?);
            }
            ItemCommands::CreateStickyNote {
                content,
                x,
                y,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let req = crate::api::item::CreateItemRequest {
                    data: Some(serde_json::json!({ "content": content })),
                    position: build_position(*x, *y),
                    ..Default::default()
                };
                let item = client.create_sticky_note(bid, &req).await?;
                println!("{}", serde_json::to_string_pretty(&item)?);
            }
            ItemCommands::CreateShape {
                content,
                shape,
                x,
                y,
                width,
                height,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let mut data = serde_json::json!({ "shape": shape });
                if let Some(c) = content {
                    data["content"] = Value::String(c.clone());
                }
                let req = crate::api::item::CreateItemRequest {
                    data: Some(data),
                    position: build_position(*x, *y),
                    geometry: build_geometry(*width, *height),
                    ..Default::default()
                };
                let item = client.create_shape(bid, &req).await?;
                println!("{}", serde_json::to_string_pretty(&item)?);
            }
            ItemCommands::CreateText {
                content,
                x,
                y,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let req = crate::api::item::CreateItemRequest {
                    data: Some(serde_json::json!({ "content": content })),
                    position: build_position(*x, *y),
                    ..Default::default()
                };
                let item = client.create_text(bid, &req).await?;
                println!("{}", serde_json::to_string_pretty(&item)?);
            }
            ItemCommands::CreateCard {
                title,
                description,
                x,
                y,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let mut data = serde_json::json!({ "title": title });
                if let Some(d) = description {
                    data["description"] = Value::String(d.clone());
                }
                let req = crate::api::item::CreateItemRequest {
                    data: Some(data),
                    position: build_position(*x, *y),
                    ..Default::default()
                };
                let item = client.create_card(bid, &req).await?;
                println!("{}", serde_json::to_string_pretty(&item)?);
            }
            ItemCommands::CreateFrame {
                title,
                x,
                y,
                width,
                height,
                board_id,
            } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                let req = crate::api::item::CreateItemRequest {
                    data: Some(serde_json::json!({ "title": title, "type": "freeform" })),
                    position: build_position(*x, *y),
                    geometry: build_geometry(*width, *height),
                    ..Default::default()
                };
                let item = client.create_frame(bid, &req).await?;
                println!("{}", serde_json::to_string_pretty(&item)?);
            }
            ItemCommands::Delete { item_id, board_id } => {
                let bid = resolve_board_id(board_id.as_deref(), global_board)?;
                client.delete_item(bid, item_id).await?;
                println!("Item deleted successfully");
            }
        }
        Ok(())
    }
}
