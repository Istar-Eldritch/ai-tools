use crate::error::AppResult;
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct UserCommand {
    #[clap(subcommand)]
    command: UserCommands,
}

#[derive(Debug, Subcommand)]
enum UserCommands {
    /// Get current authenticated user information
    Me,
}

impl UserCommand {
    pub async fn execute(
        &self,
        config: &crate::config::CliConfig,
        _workspace_slug: &str,
        _project_slug: Option<&str>,
    ) -> AppResult<()> {
        let client = crate::api::client::Client::new(config)?;
        match &self.command {
            UserCommands::Me => {
                let user = client.get_current_user().await?;
                println!("{}", serde_json::to_string_pretty(&user)?);
            }
        }
        Ok(())
    }
}
