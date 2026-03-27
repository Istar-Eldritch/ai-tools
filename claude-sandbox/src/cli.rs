use clap::{Parser, Subcommand};

#[derive(Parser)]
#[clap(author, version, about = "Wrap claude in a bwrap filesystem sandbox")]
#[clap(propagate_version = true)]
pub struct Cli {
    #[clap(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Run claude inside a sandbox (default when no subcommand given)
    Run(RunArgs),

    /// Interactive first-time setup
    Setup,

    /// Initialize a project-level sandbox config
    Init,

    /// Check that the sandbox environment is correctly configured
    Check,

    /// List available sandbox profiles
    ListProfiles,
}

#[derive(clap::Args, Debug, Default)]
pub struct RunArgs {
    /// Print the bwrap command that would be executed, then exit
    #[clap(long)]
    pub dry_run: bool,

    /// Override the sandbox profile to use
    #[clap(long)]
    pub profile: Option<String>,

    /// Arguments to pass through to claude
    #[clap(last = true)]
    pub claude_args: Vec<String>,
}
