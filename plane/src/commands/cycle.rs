use crate::api::client::Client;
use crate::api::cycle::{AddCycleWorkItemRequest, CreateCycleRequest, UpdateCycleRequest};
use crate::config::CliConfig;
use crate::error::{AppError, AppResult};
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
pub struct CycleArgs {
    #[clap(subcommand)]
    pub command: CycleCommands,
}

#[derive(Subcommand, Debug)]
pub enum CycleCommands {
    /// List all cycles in a project
    List {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
    },
    /// Get cycle details
    Get {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Cycle ID
        #[clap(long)]
        cycle_id: String,
    },
    /// Create a new cycle
    Create {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Cycle name
        #[clap(long)]
        name: String,
        /// User ID who owns the cycle
        #[clap(long)]
        owned_by: String,
        /// Cycle description
        #[clap(long)]
        description: Option<String>,
        /// Start date (YYYY-MM-DD)
        #[clap(long)]
        start_date: Option<String>,
        /// End date (YYYY-MM-DD)
        #[clap(long)]
        end_date: Option<String>,
    },
    /// Update a cycle
    Update {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Cycle ID
        #[clap(long)]
        cycle_id: String,
        /// New name
        #[clap(long)]
        name: Option<String>,
        /// New description
        #[clap(long)]
        description: Option<String>,
        /// New start date (YYYY-MM-DD)
        #[clap(long)]
        start_date: Option<String>,
        /// New end date (YYYY-MM-DD)
        #[clap(long)]
        end_date: Option<String>,
    },
    /// Delete a cycle
    Delete {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Cycle ID
        #[clap(long)]
        cycle_id: String,
    },
    /// Manage cycle work items
    Items {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Cycle ID
        #[clap(long)]
        cycle_id: String,
        #[clap(subcommand)]
        subcommand: ItemCommands,
    },
}

#[derive(Subcommand, Debug)]
pub enum ItemCommands {
    /// List work items in a cycle
    List,
    /// Add work items to a cycle
    Add {
        /// Work Item IDs
        #[clap(required = true)]
        item_ids: Vec<String>,
    },
    /// Remove a work item from a cycle
    Remove {
        /// Work Item ID
        #[clap(long)]
        item_id: String,
    },
}

impl CycleArgs {
    pub async fn run(
        &self,
        config: &CliConfig,
        workspace_slug: &str,
        project_slug: Option<&str>,
    ) -> AppResult<()> {
        let client = Client::new(config)?;

        match &self.command {
            CycleCommands::List { project_id } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let cycles = client.list_cycles(workspace_slug, project_id).await?;
                println!("{}", serde_json::to_string_pretty(&cycles).unwrap());
            }
            CycleCommands::Get {
                project_id,
                cycle_id,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let cycle = client
                    .get_cycle(workspace_slug, project_id, cycle_id)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&cycle).unwrap());
            }
            CycleCommands::Create {
                project_id,
                name,
                owned_by,
                description,
                start_date,
                end_date,
            } => {
                let project_id_str = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = CreateCycleRequest {
                    name: name.clone(),
                    project_id: project_id_str.to_string(),
                    owned_by: owned_by.clone(),
                    description: description.clone(),
                    start_date: start_date.clone(),
                    end_date: end_date.clone(),
                };
                let cycle = client
                    .create_cycle(workspace_slug, project_id_str, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&cycle).unwrap());
            }
            CycleCommands::Update {
                project_id,
                cycle_id,
                name,
                description,
                start_date,
                end_date,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = UpdateCycleRequest {
                    name: name.clone(),
                    description: description.clone(),
                    start_date: start_date.clone(),
                    end_date: end_date.clone(),
                    ..Default::default()
                };
                let cycle = client
                    .update_cycle(workspace_slug, project_id, cycle_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&cycle).unwrap());
            }
            CycleCommands::Delete {
                project_id,
                cycle_id,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                client
                    .delete_cycle(workspace_slug, project_id, cycle_id)
                    .await?;
                println!("Cycle deleted successfully");
            }
            CycleCommands::Items {
                project_id,
                cycle_id,
                subcommand,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                match subcommand {
                    ItemCommands::List => {
                        let items = client
                            .list_cycle_work_items(workspace_slug, project_id, cycle_id)
                            .await?;
                        println!("{}", serde_json::to_string_pretty(&items).unwrap());
                    }
                    ItemCommands::Add { item_ids } => {
                        let req = AddCycleWorkItemRequest {
                            issues: item_ids.clone(),
                        };
                        client
                            .add_cycle_work_items(workspace_slug, project_id, cycle_id, &req)
                            .await?;
                        println!("Work items added to cycle");
                    }
                    ItemCommands::Remove { item_id } => {
                        client
                            .remove_cycle_work_item(workspace_slug, project_id, cycle_id, item_id)
                            .await?;
                        println!("Work item removed from cycle");
                    }
                }
            }
        }

        Ok(())
    }
}
