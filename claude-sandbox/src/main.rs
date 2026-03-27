use clap::Parser;
use claude_sandbox::cli::{Cli, Commands, RunArgs};
use claude_sandbox::commands;
use claude_sandbox::error::AppResult;

fn main() -> AppResult<()> {
    let cli = Cli::parse();

    let command = cli.command.unwrap_or(Commands::Run(RunArgs::default()));

    match command {
        Commands::Run(args) => commands::run::execute(args),
        Commands::Setup(args) => commands::setup::execute(args),
        Commands::Init(args) => commands::init::execute(args),
        Commands::Check(args) => commands::check::execute(args),
        Commands::ListProfiles => commands::list_profiles::execute(),
    }
}
