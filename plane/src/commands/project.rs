use crate::error::{AppError, AppResult};
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct Project {
    #[clap(subcommand)]
    command: ProjectCommands,
}

#[derive(Debug, Subcommand)]
enum ProjectCommands {
    /// Get a single project
    Get {
        /// Project ID
        project_id: Option<String>,
    },
    /// List projects
    List,
    /// Create a project
    Create {
        /// Name of the project
        #[clap(long)]
        name: String,
        /// Identifier of the project
        #[clap(long)]
        identifier: String,
        /// Description of the project
        #[clap(long)]
        description: Option<String>,
    },
    /// Update a project
    Update {
        /// Project ID
        project_id: Option<String>,
        /// Name of the project
        #[clap(long)]
        name: Option<String>,
        /// Description of the project
        #[clap(long)]
        description: Option<String>,
    },
    /// Delete a project
    Delete {
        /// Project ID
        project_id: Option<String>,
    },
}

impl Project {
    pub async fn run(
        &self,
        config: &crate::config::CliConfig,
        workspace_slug: &str,
        project_slug: Option<&str>,
    ) -> AppResult<()> {
        let client = crate::api::client::Client::new(config)?;
        match &self.command {
            ProjectCommands::Get { project_id } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via argument or in the config file"
                            .to_string(),
                    )
                })?;
                let project = client.get_project(workspace_slug, project_id).await?;
                println!("{}", serde_json::to_string_pretty(&project)?);
            }
            ProjectCommands::List => {
                let projects = client.list_projects(workspace_slug).await?;
                println!("{}", serde_json::to_string_pretty(&projects)?);
            }
            ProjectCommands::Create {
                name,
                identifier,
                description,
            } => {
                let req = crate::api::project::CreateProjectRequest {
                    name: name.clone(),
                    identifier: identifier.clone(),
                    description: description.clone(),
                };
                let project = client.create_project(workspace_slug, &req).await?;
                println!("{}", serde_json::to_string_pretty(&project)?);
            }
            ProjectCommands::Update {
                project_id,
                name,
                description,
            } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via argument or in the config file"
                            .to_string(),
                    )
                })?;
                let req = crate::api::project::UpdateProjectRequest {
                    name: name.clone(),
                    description: description.clone(),
                };
                let project = client
                    .update_project(workspace_slug, project_id, &req)
                    .await?;
                println!("{}", serde_json::to_string_pretty(&project)?);
            }
            ProjectCommands::Delete { project_id } => {
                let project_id = project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via argument or in the config file"
                            .to_string(),
                    )
                })?;
                client.delete_project(workspace_slug, project_id).await?;
                println!("Project deleted successfully");
            }
        }
        Ok(())
    }
}
