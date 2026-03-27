use clap::Parser;
use claude_sandbox::cli::{Cli, Commands, RunArgs};
use claude_sandbox::commands;
use claude_sandbox::error::AppResult;

fn main() -> AppResult<()> {
    let cli = Cli::parse();

    let command = cli.command.unwrap_or(Commands::Run(RunArgs::default()));

    match command {
        Commands::Run(args) => commands::run::execute(args),
        Commands::Setup => commands::setup::execute(),
        Commands::Init => commands::init::execute(),
        Commands::Check => commands::check::execute(),
        Commands::ListProfiles => commands::list_profiles::execute(),
    }
}
