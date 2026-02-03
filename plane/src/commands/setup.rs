use crate::{config::CliConfig, error::AppResult};
use inquire::{Password, PasswordDisplayMode, Text};

pub async fn setup() -> AppResult<()> {
    let api_key = Password::new("API Key:")
        .with_display_mode(PasswordDisplayMode::Masked)
        .with_help_message("You can create an API key in your workspace settings.")
        .prompt()?;

    let workspace = Text::new("Default Workspace:")
        .with_help_message("This is the slug of your default workspace.")
        .prompt_skippable()?;

    let project = Text::new("Default Project:")
        .with_help_message("This is the ID of your default project.")
        .prompt_skippable()?;

    let api_base_url = Text::new("API Base URL:")
        .with_default("https://api.plane.so/")
        .prompt()?;

    let config = CliConfig {
        api_key: Some(api_key.into()),
        workspace,
        project,
        api_base_url: Some(api_base_url),
    };

    config.save()?;

    println!("Configuration saved successfully!");

    Ok(())
}
