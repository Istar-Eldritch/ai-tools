use clap::{CommandFactory, Parser};
use clap_complete::generate;
use plane_cli::cli::{Cli, Commands};
use plane_cli::commands;
use plane_cli::config::CliConfig;
use plane_cli::error::{AppError, AppResult};

fn main() -> Result<(), AppError> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(run())
}

async fn run() -> AppResult<()> {
    let cli = Cli::parse();

    if let Commands::Setup = cli.command {
        return commands::setup::setup().await;
    }

    if let Commands::Completion { shell } = cli.command {
        let mut cmd = Cli::command();
        let bin_name = cmd.get_name().to_string();
        generate(shell, &mut cmd, bin_name, &mut std::io::stdout());
        return Ok(());
    }

    let config = CliConfig::new()?;

    let workspace_slug = cli
        .workspace
        .as_deref()
        .or(config.workspace.as_deref())
        .ok_or_else(|| {
            AppError::General(
                "Workspace slug must be provided either via --workspace flag or in the config file"
                    .to_string(),
            )
        })?;

    let project_slug = cli.project.as_deref().or(config.project.as_deref());

    match cli.command {
        Commands::WorkItem(work_item) => {
            work_item.run(&config, workspace_slug, project_slug).await?
        }
        Commands::Project(project) => project.run(&config, workspace_slug, project_slug).await?,
        Commands::Cycle(cycle) => cycle.run(&config, workspace_slug, project_slug).await?,
        Commands::Module(module) => module.run(&config, workspace_slug, project_slug).await?,
        Commands::State(state) => state.execute(&config, workspace_slug, project_slug).await?,
        Commands::Label(label) => label.execute(&config, workspace_slug, project_slug).await?,
        Commands::Link(link) => link.execute(&config, workspace_slug, project_slug).await?,
        Commands::User(user) => user.execute(&config, workspace_slug, project_slug).await?,
        Commands::Setup => unreachable!(),
        Commands::Completion { .. } => unreachable!(),
    }

    Ok(())
}
