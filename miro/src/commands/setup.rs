use crate::{config::CliConfig, error::AppResult};
use inquire::{Password, PasswordDisplayMode, Text};

pub async fn setup() -> AppResult<()> {
    let access_token = Password::new("Access Token:")
        .with_display_mode(PasswordDisplayMode::Masked)
        .with_help_message("Create an access token in your Miro app settings.")
        .prompt()?;

    let team_id = Text::new("Default Team ID:")
        .with_help_message("Optional. The ID of your default team.")
        .prompt_skippable()?;

    let api_base_url = Text::new("API Base URL:")
        .with_default("https://api.miro.com/")
        .prompt()?;

    let config = CliConfig {
        access_token: Some(access_token.into()),
        team_id,
        api_base_url: Some(api_base_url),
    };

    config.save()?;

    println!("Configuration saved successfully!");

    Ok(())
}
