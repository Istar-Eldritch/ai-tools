use crate::api::client::Client;
use crate::error::{AppError, AppResult};
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct WorkItem {
    #[clap(subcommand)]
    command: WorkItemCommands,
}

#[derive(Debug, Subcommand)]
enum WorkItemCommands {
    /// Create a new work item
    Create(CreateWorkItemArgs),
    /// Get a single work item
    Get(GetWorkItemArgs),
    /// Update a single work item
    Update(UpdateWorkItemArgs),
    /// List work items
    List(WorkItemListArgs),
    /// Search work items
    Search(SearchWorkItemArgs),
    /// Delete a work item
    Delete(DeleteWorkItemArgs),
    /// Get a work item by human-readable identifier (e.g. PROJ-123)
    GetByIdentifier(GetWorkItemByIdentifierArgs),
}

#[derive(Debug, Args)]
pub struct SearchWorkItemArgs {
    /// Text query to search for in work item names and descriptions.
    #[clap(long)]
    pub search: String,
    /// Filter results to a specific project by ID.
    #[clap(long)]
    pub project: Option<String>,
}

#[derive(Debug, Args)]
pub struct CreateWorkItemArgs {
    /// The project ID
    #[clap(long)]
    pub project_id: Option<String>,
    /// Name of the work item.
    #[clap(long)]
    pub name: String,
    /// HTML-formatted description of the work item.
    #[clap(long)]
    pub description_html: Option<String>,
    /// ID of the state for the work item.
    #[clap(long)]
    pub state: Option<String>,
    /// Array of user IDs to assign to the work item.
    #[clap(long)]
    pub assignees: Option<Vec<String>>,
    /// Priority level. Possible values: `none`, `urgent`, `high`, `medium`, `low`.
    #[clap(long)]
    pub priority: Option<String>,
    /// Array of label IDs to apply to the work item.
    #[clap(long)]
    pub labels: Option<Vec<String>>,
    /// ID of the parent work item.
    #[clap(long)]
    pub parent: Option<String>,
    /// Estimate points for the work item (0-7).
    #[clap(long)]
    pub estimate_point: Option<String>,
    /// ID of the work item type.
    #[clap(long)]
    pub issue_type: Option<String>,
    /// ID of the module the work item belongs to.
    #[clap(long)]
    pub module: Option<String>,
    /// Start date in YYYY-MM-DD format.
    #[clap(long)]
    pub start_date: Option<String>,
    /// Target completion date in YYYY-MM-DD format.
    #[clap(long)]
    pub target_date: Option<String>,
}

#[derive(Debug, Args)]
pub struct GetWorkItemArgs {
    /// The project ID
    #[clap(long)]
    pub project_id: Option<String>,
    /// The work item ID
    #[clap(long)]
    pub work_item_id: String,
}

#[derive(Debug, Args)]
pub struct UpdateWorkItemArgs {
    /// The project ID
    #[clap(long)]
    pub project_id: Option<String>,
    /// The work item ID
    #[clap(long)]
    pub work_item_id: String,
    /// Name of the work item.
    #[clap(long)]
    pub name: Option<String>,
    /// HTML-formatted description of the work item.
    #[clap(long)]
    pub description_html: Option<String>,
    /// ID of the state for the work item.
    #[clap(long)]
    pub state: Option<String>,
    /// Array of user IDs to assign to the work item.
    #[clap(long)]
    pub assignees: Option<Vec<String>>,
    /// Priority level. Possible values: `none`, `urgent`, `high`, `medium`, `low`.
    #[clap(long)]
    pub priority: Option<String>,
    /// Array of label IDs to apply to the work item.
    #[clap(long)]
    pub labels: Option<Vec<String>>,
    /// ID of the parent work item.
    #[clap(long)]
    pub parent: Option<String>,
    /// Estimate points for the work item (0-7).
    #[clap(long)]
    pub estimate_point: Option<String>,
    /// ID of the work item type.
    #[clap(long)]
    pub issue_type: Option<String>,
    /// ID of the module the work item belongs to.
    #[clap(long)]
    pub module: Option<String>,
    /// Start date in YYYY-MM-DD format.
    #[clap(long)]
    pub start_date: Option<String>,
    /// Target completion date in YYYY-MM-DD format.
    #[clap(long)]
    pub target_date: Option<String>,
}

#[derive(Debug, Args)]
pub struct DeleteWorkItemArgs {
    /// The project ID
    #[clap(long)]
    pub project_id: Option<String>,
    /// The work item ID
    #[clap(long)]
    pub work_item_id: String,
}

#[derive(Debug, Args)]
pub struct GetWorkItemByIdentifierArgs {
    /// The work item identifier (e.g. PROJ-123)
    #[clap(long)]
    pub identifier: String,
}

#[derive(Debug, Args)]
pub struct WorkItemListArgs {
    /// The project ID
    #[clap(long)]
    pub project_id: Option<String>,
}

impl WorkItem {
    pub async fn run(
        &self,
        config: &crate::config::CliConfig,
        workspace_slug: &str,
        project_slug: Option<&str>,
    ) -> AppResult<()> {
        match &self.command {
            WorkItemCommands::Create(args) => {
                let project_id = args.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;

                let client = Client::new(config)?;

                let req = crate::api::work_item::CreateWorkItemRequest {
                    name: args.name.clone(),
                    description_html: args.description_html.clone(),
                    state: args.state.clone(),
                    assignees: args.assignees.clone(),
                    priority: args.priority.clone(),
                    labels: args.labels.clone(),
                    parent: args.parent.clone(),
                    estimate_point: args.estimate_point.clone(),
                    issue_type: args.issue_type.clone(),
                    module: args.module.clone(),
                    start_date: args.start_date.clone(),
                    target_date: args.target_date.clone(),
                };

                let work_item = client
                    .create_work_item(workspace_slug, project_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&work_item)?);
            }
            WorkItemCommands::Get(args) => {
                let project_id = args.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;

                let client = Client::new(config)?;

                let work_item = client
                    .get_work_item(workspace_slug, project_id, &args.work_item_id)
                    .await?;

                println!("{}", serde_json::to_string_pretty(&work_item)?);
            }
            WorkItemCommands::Update(args) => {
                let project_id = args.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;

                let client = Client::new(config)?;

                let req = crate::api::work_item::UpdateWorkItemRequest {
                    name: args.name.clone(),
                    description_html: args.description_html.clone(),
                    state: args.state.clone(),
                    assignees: args.assignees.clone(),
                    priority: args.priority.clone(),
                    labels: args.labels.clone(),
                    parent: args.parent.clone(),
                    estimate_point: args.estimate_point.clone(),
                    issue_type: args.issue_type.clone(),
                    module: args.module.clone(),
                    start_date: args.start_date.clone(),
                    target_date: args.target_date.clone(),
                };

                let work_item = client
                    .update_work_item(workspace_slug, project_id, &args.work_item_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&work_item)?);
            }
            WorkItemCommands::List(args) => {
                let project_id = args.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;

                let client = Client::new(config)?;

                let work_items = client.get_work_items(workspace_slug, project_id).await?;
                println!("{}", serde_json::to_string_pretty(&work_items)?);
            }
            WorkItemCommands::Search(args) => {
                let client = Client::new(config)?;

                // Use provided project, or fallback to default project_slug, or None
                let project_filter = args.project.as_deref().or(project_slug);

                let work_items = client
                    .search_work_items(workspace_slug, &args.search, project_filter)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&work_items)?);
            }
            WorkItemCommands::Delete(args) => {
                let project_id = args.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;

                let client = Client::new(config)?;

                client
                    .delete_work_item(workspace_slug, project_id, &args.work_item_id)
                    .await?;
                println!("Work item deleted successfully");
            }
            WorkItemCommands::GetByIdentifier(args) => {
                let client = Client::new(config)?;

                let work_item = client
                    .get_work_item_by_identifier(workspace_slug, &args.identifier)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&work_item)?);
            }
        }
        Ok(())
    }
}
