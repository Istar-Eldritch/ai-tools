use crate::api::client::Client;
use crate::api::module::{AddModuleWorkItemsRequest, CreateModuleRequest, UpdateModuleRequest};
use crate::config::CliConfig;
use crate::error::{AppError, AppResult};
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
pub struct ModuleArgs {
    #[clap(subcommand)]
    pub command: ModuleCommands,
}

#[derive(Subcommand, Debug)]
pub enum ModuleCommands {
    /// List all modules in a project
    List {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
    },
    /// Get module details
    Get {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Module ID
        #[clap(long)]
        module_id: String,
    },
    /// Create a new module
    Create {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Module name
        #[clap(long)]
        name: String,
        /// Module description
        #[clap(long)]
        description: Option<String>,
        /// Start date (YYYY-MM-DD)
        #[clap(long)]
        start_date: Option<String>,
        /// Target date (YYYY-MM-DD)
        #[clap(long)]
        target_date: Option<String>,
        /// Status (backlog, planned, in-progress, paused, completed, cancelled)
        #[clap(long)]
        status: Option<String>,
        /// Lead user ID
        #[clap(long)]
        lead: Option<String>,
        /// Member user IDs
        #[clap(long)]
        members: Option<Vec<String>>,
    },
    /// Update a module
    Update {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Module ID
        #[clap(long)]
        module_id: String,
        /// New name
        #[clap(long)]
        name: Option<String>,
        /// New description
        #[clap(long)]
        description: Option<String>,
        /// New start date (YYYY-MM-DD)
        #[clap(long)]
        start_date: Option<String>,
        /// New target date (YYYY-MM-DD)
        #[clap(long)]
        target_date: Option<String>,
        /// New status (backlog, planned, in-progress, paused, completed, cancelled)
        #[clap(long)]
        status: Option<String>,
        /// New lead user ID
        #[clap(long)]
        lead: Option<String>,
        /// New member user IDs
        #[clap(long)]
        members: Option<Vec<String>>,
    },
    /// Delete a module
    Delete {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Module ID
        #[clap(long)]
        module_id: String,
    },
    /// Archive a module
    Archive {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Module ID
        #[clap(long)]
        module_id: String,
    },
    /// Unarchive a module
    Unarchive {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Module ID
        #[clap(long)]
        module_id: String,
    },
    /// List all archived modules in a project
    ListArchived {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
    },
    /// Manage module work items
    Items {
        /// Project ID
        #[clap(long)]
        project_id: Option<String>,
        /// Module ID
        #[clap(long)]
        module_id: String,
        #[clap(subcommand)]
        subcommand: ModuleItemCommands,
    },
}

#[derive(Subcommand, Debug)]
pub enum ModuleItemCommands {
    /// List work items in a module
    List,
    /// Add work items to a module
    Add {
        /// Work Item IDs
        #[clap(required = true)]
        item_ids: Vec<String>,
    },
    /// Remove a work item from a module
    Remove {
        /// Work Item ID
        #[clap(long)]
        item_id: String,
    },
}

impl ModuleArgs {
    pub async fn run(
        &self,
        config: &CliConfig,
        workspace_slug: &str,
        project_slug: Option<&str>,
    ) -> AppResult<()> {
        let client = Client::new(config)?;

        match &self.command {
            ModuleCommands::List { project_id } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let modules = client.list_modules(workspace_slug, project_id).await?;
                println!("{}", serde_json::to_string_pretty(&modules).unwrap());
            }
            ModuleCommands::Get {
                project_id,
                module_id,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let module = client
                    .get_module(workspace_slug, project_id, module_id)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&module).unwrap());
            }
            ModuleCommands::Create {
                project_id,
                name,
                description,
                start_date,
                target_date,
                status,
                lead,
                members,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = CreateModuleRequest {
                    name: name.clone(),
                    description: description.clone(),
                    start_date: start_date.clone(),
                    target_date: target_date.clone(),
                    status: status.clone(),
                    lead: lead.clone(),
                    members: members.clone(),
                    external_source: None,
                    external_id: None,
                };
                let module = client
                    .create_module(workspace_slug, project_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&module).unwrap());
            }
            ModuleCommands::Update {
                project_id,
                module_id,
                name,
                description,
                start_date,
                target_date,
                status,
                lead,
                members,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = UpdateModuleRequest {
                    name: name.clone(),
                    description: description.clone(),
                    start_date: start_date.clone(),
                    target_date: target_date.clone(),
                    status: status.clone(),
                    lead: lead.clone(),
                    members: members.clone(),
                    ..Default::default()
                };
                let module = client
                    .update_module(workspace_slug, project_id, module_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&module).unwrap());
            }
            ModuleCommands::Delete {
                project_id,
                module_id,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                client
                    .delete_module(workspace_slug, project_id, module_id)
                    .await?;
                println!("Module deleted successfully");
            }
            ModuleCommands::Archive {
                project_id,
                module_id,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                client
                    .archive_module(workspace_slug, project_id, module_id)
                    .await?;
                println!("Module archived successfully");
            }
            ModuleCommands::Unarchive {
                project_id,
                module_id,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                client
                    .unarchive_module(workspace_slug, project_id, module_id)
                    .await?;
                println!("Module unarchived successfully");
            }
            ModuleCommands::ListArchived { project_id } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let modules = client
                    .list_archived_modules(workspace_slug, project_id)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&modules).unwrap());
            }
            ModuleCommands::Items {
                project_id,
                module_id,
                subcommand,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project ID must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                match subcommand {
                    ModuleItemCommands::List => {
                        let items = client
                            .list_module_work_items(workspace_slug, project_id, module_id)
                            .await?;
                        println!("{}", serde_json::to_string_pretty(&items).unwrap());
                    }
                    ModuleItemCommands::Add { item_ids } => {
                        let req = AddModuleWorkItemsRequest {
                            issues: item_ids.clone(),
                        };
                        client
                            .add_module_work_items(workspace_slug, project_id, module_id, &req)
                            .await?;
                        println!("Work items added to module");
                    }
                    ModuleItemCommands::Remove { item_id } => {
                        client
                            .remove_module_work_item(workspace_slug, project_id, module_id, item_id)
                            .await?;
                        println!("Work item removed from module");
                    }
                }
            }
        }

        Ok(())
    }
}
