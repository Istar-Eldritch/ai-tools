use crate::{
    api::{
        client::Client,
        label::{CreateLabelRequest, UpdateLabelRequest},
    },
    config::CliConfig,
    error::AppError,
};
use clap::{Args, Subcommand};

#[derive(Args)]
pub struct LabelCommand {
    #[clap(subcommand)]
    subcommand: LabelSubcommand,
}

impl LabelCommand {
    pub async fn execute(
        &self,
        config: &CliConfig,
        workspace_slug: &str,
        project_slug: Option<&str>,
    ) -> Result<(), AppError> {
        self.subcommand
            .execute(config, workspace_slug, project_slug)
            .await
    }
}

#[derive(Subcommand)]
enum LabelSubcommand {
    /// List all labels in a project
    List(ListLabels),
    /// Get details of a specific label
    Get(GetLabel),
    /// Create a new label
    Create(CreateLabel),
    /// Update an existing label
    Update(UpdateLabel),
    /// Delete a label
    Delete(DeleteLabel),
}

impl LabelSubcommand {
    async fn execute(
        &self,
        config: &CliConfig,
        workspace_slug: &str,
        project_slug: Option<&str>,
    ) -> Result<(), AppError> {
        let client = Client::new(config)?;

        match self {
            Self::List(list) => {
                let project_id = list.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let labels = client.list_labels(workspace_slug, project_id).await?;
                println!("{}", serde_json::to_string_pretty(&labels)?);
            }
            Self::Get(get) => {
                let project_id = get.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let label = client
                    .get_label(workspace_slug, project_id, &get.label_id)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&label)?);
            }
            Self::Create(create) => {
                let project_id = create.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = CreateLabelRequest {
                    name: create.name.clone(),
                    description: create.description.clone(),
                    color: create.color.clone(),
                    parent: create.parent.clone(),
                };
                let label = client
                    .create_label(workspace_slug, project_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&label)?);
            }
            Self::Update(update) => {
                let project_id = update.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = UpdateLabelRequest {
                    name: update.name.clone(),
                    description: update.description.clone(),
                    color: update.color.clone(),
                    parent: update.parent.clone(),
                };
                let label = client
                    .update_label(workspace_slug, project_id, &update.label_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&label)?);
            }
            Self::Delete(delete) => {
                let project_id = delete.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                client
                    .delete_label(workspace_slug, project_id, &delete.label_id)
                    .await?;
                println!("Label deleted");
            }
        }

        Ok(())
    }
}

#[derive(Args)]
struct ListLabels {
    #[clap(long)]
    project_id: Option<String>,
}

#[derive(Args)]
struct GetLabel {
    #[clap(long)]
    project_id: Option<String>,
    /// The ID of the label to retrieve
    label_id: String,
}

#[derive(Args)]
struct CreateLabel {
    #[clap(long)]
    project_id: Option<String>,
    /// Name of the label
    name: String,
    /// Description of the label
    #[clap(long)]
    description: Option<String>,
    /// Hex color code (e.g., #ffffff)
    #[clap(long)]
    color: Option<String>,
    /// Parent label ID
    #[clap(long)]
    parent: Option<String>,
}

#[derive(Args)]
struct UpdateLabel {
    #[clap(long)]
    project_id: Option<String>,
    /// The ID of the label to update
    label_id: String,
    /// New name for the label
    #[clap(long)]
    name: Option<String>,
    /// New description for the label
    #[clap(long)]
    description: Option<String>,
    /// New color for the label
    #[clap(long)]
    color: Option<String>,
    /// New parent label ID
    #[clap(long)]
    parent: Option<String>,
}

#[derive(Args)]
struct DeleteLabel {
    #[clap(long)]
    project_id: Option<String>,
    /// The ID of the label to delete
    label_id: String,
}
