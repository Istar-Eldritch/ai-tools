use crate::{
    api::{
        client::Client,
        link::{CreateLinkRequest, UpdateLinkRequest},
    },
    config::CliConfig,
    error::AppError,
};
use clap::{Args, Subcommand};

#[derive(Args)]
pub struct LinkCommand {
    #[clap(subcommand)]
    subcommand: LinkSubcommand,
}

impl LinkCommand {
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
enum LinkSubcommand {
    /// List all links for a work item
    List(ListLinks),
    /// Get details of a specific link
    Get(GetLink),
    /// Create a new link
    Create(CreateLink),
    /// Update an existing link
    Update(UpdateLink),
    /// Delete a link
    Delete(DeleteLink),
}

impl LinkSubcommand {
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
                let links = client
                    .list_links(workspace_slug, project_id, &list.work_item_id)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&links)?);
            }
            Self::Get(get) => {
                let project_id = get.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let link = client
                    .get_link(workspace_slug, project_id, &get.work_item_id, &get.link_id)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&link)?);
            }
            Self::Create(create) => {
                let project_id = create.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = CreateLinkRequest {
                    url: create.url.clone(),
                    title: create.title.clone(),
                };
                let link = client
                    .create_link(workspace_slug, project_id, &create.work_item_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&link)?);
            }
            Self::Update(update) => {
                let project_id = update.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let req = UpdateLinkRequest {
                    url: update.url.clone(),
                    title: update.title.clone(),
                };
                let link = client
                    .update_link(
                        workspace_slug,
                        project_id,
                        &update.work_item_id,
                        &update.link_id,
                        &req,
                    )
                    .await?;
                println!("{}", serde_json::to_string_pretty(&link)?);
            }
            Self::Delete(delete) => {
                let project_id = delete.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                client
                    .delete_link(
                        workspace_slug,
                        project_id,
                        &delete.work_item_id,
                        &delete.link_id,
                    )
                    .await?;
                println!("Link deleted successfully");
            }
        }

        Ok(())
    }
}

#[derive(Args)]
struct ListLinks {
    /// The work item ID to list links for
    #[clap(long)]
    work_item_id: String,
    #[clap(long)]
    project_id: Option<String>,
}

#[derive(Args)]
struct GetLink {
    /// The ID of the link to retrieve
    link_id: String,
    /// The work item ID the link belongs to
    #[clap(long)]
    work_item_id: String,
    #[clap(long)]
    project_id: Option<String>,
}

#[derive(Args)]
struct CreateLink {
    /// URL of the external resource (required)
    #[clap(long)]
    url: String,
    /// The work item ID to attach the link to
    #[clap(long)]
    work_item_id: String,
    /// Title or description of the link
    #[clap(long)]
    title: Option<String>,
    #[clap(long)]
    project_id: Option<String>,
}

#[derive(Args)]
struct UpdateLink {
    /// The ID of the link to update
    link_id: String,
    /// The work item ID the link belongs to
    #[clap(long)]
    work_item_id: String,
    /// New URL for the link
    #[clap(long)]
    url: Option<String>,
    /// New title for the link
    #[clap(long)]
    title: Option<String>,
    #[clap(long)]
    project_id: Option<String>,
}

#[derive(Args)]
struct DeleteLink {
    /// The ID of the link to delete
    link_id: String,
    /// The work item ID the link belongs to
    #[clap(long)]
    work_item_id: String,
    #[clap(long)]
    project_id: Option<String>,
}
