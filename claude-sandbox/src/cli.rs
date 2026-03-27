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
    Setup(SetupArgs),

    /// Initialize a project-level sandbox config
    Init(InitArgs),

    /// Check that the sandbox environment is correctly configured
    Check(CheckArgs),

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

#[derive(clap::Args, Debug, Default)]
pub struct SetupArgs {
    /// Print a shell function that shadows `claude` with `claude-sandbox run --`
    #[clap(long)]
    pub shell_function: bool,
}

#[derive(clap::Args, Debug, Default)]
pub struct InitArgs {
    /// Set the default sandbox profile (defaults to "minimal")
    #[clap(long)]
    pub profile: Option<String>,
}

#[derive(clap::Args, Debug, Default)]
pub struct CheckArgs {
    /// Override the sandbox profile to check
    #[clap(long)]
    pub profile: Option<String>,
}
