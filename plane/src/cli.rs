use crate::commands;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[clap(author, version, about, long_about = None)]
#[clap(propagate_version = true)]
pub struct Cli {
    #[clap(subcommand)]
    pub command: Commands,

    /// The workspace slug. Overrides the default workspace in the config file.
    #[clap(long, global = true)]
    pub workspace: Option<String>,

    /// The project slug. Overrides the default project in the config file.
    #[clap(long, global = true)]
    pub project: Option<String>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Manage work items
    WorkItem(Box<commands::work_item::WorkItem>),
    /// Manage projects
    Project(commands::project::Project),
    /// Manage cycles
    Cycle(commands::cycle::CycleArgs),
    /// Manage modules
    Module(commands::module::ModuleArgs),
    /// Manage states
    State(commands::state::StateCommand),
    /// Manage labels
    Label(commands::label::LabelCommand),
    /// Manage links
    Link(commands::link::LinkCommand),
    /// Manage user information
    User(commands::user::UserCommand),
    /// Setup the CLI
    Setup,
    /// Generate shell completion scripts
    Completion {
        /// The shell to generate completions for
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },
}
