use clap::{CommandFactory, Parser};
use clap_complete::generate;
use miro_cli::cli::{Cli, Commands};
use miro_cli::commands;
use miro_cli::config::CliConfig;
use miro_cli::error::{AppError, AppResult};

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

    let board_id = cli.board.as_deref().or(config.team_id.as_deref());

    match cli.command {
        Commands::Board(cmd) => cmd.run(&config).await?,
        Commands::Item(cmd) => cmd.run(&config, board_id).await?,
        Commands::Connector(cmd) => cmd.run(&config, board_id).await?,
        Commands::Tag(cmd) => cmd.run(&config, board_id).await?,
        Commands::Setup => unreachable!(),
        Commands::Completion { .. } => unreachable!(),
    }

    Ok(())
}
