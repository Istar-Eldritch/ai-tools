use crate::{api::client::Client, config::CliConfig, error::AppError};
use clap::{Args, Subcommand};

#[derive(Args)]
pub struct StateCommand {
    #[clap(subcommand)]
    subcommand: StateSubcommand,
}

impl StateCommand {
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
enum StateSubcommand {
    Create(CreateState),
    Delete(DeleteState),
    List(ListStates),
}

impl StateSubcommand {
    async fn execute(
        &self,
        config: &CliConfig,
        workspace_slug: &str,
        project_slug: Option<&str>,
    ) -> Result<(), AppError> {
        let client = Client::new(config)?;

        match self {
            Self::Create(create) => {
                let project_id = create.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let state = client
                    .create_state(workspace_slug, project_id, &create.name, &create.color)
                    .await?;

                println!("{}", serde_json::to_string_pretty(&state)?);
            }
            Self::Delete(delete) => {
                let project_id = delete.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                client
                    .delete_state(workspace_slug, project_id, &delete.state_id)
                    .await?;

                println!("State deleted");
            }
            Self::List(list) => {
                let project_id = list.project_id.as_deref().or(project_slug).ok_or_else(|| {
                    AppError::General(
                        "Project slug must be provided either via --project-id flag or in the config file"
                            .to_string(),
                    )
                })?;
                let states = client.list_states(workspace_slug, project_id).await?;

                println!("{}", serde_json::to_string_pretty(&states)?);
            }
        }

        Ok(())
    }
}

#[derive(Args)]
struct CreateState {
    #[clap(long)]
    project_id: Option<String>,
    name: String,
    color: String,
}

#[derive(Args)]
struct DeleteState {
    #[clap(long)]
    project_id: Option<String>,
    state_id: String,
}

#[derive(Args)]
struct ListStates {
    #[clap(long)]
    project_id: Option<String>,
}
