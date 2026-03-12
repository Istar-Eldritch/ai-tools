use crate::commands;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[clap(author, version, about = "CLI for the Miro REST API", long_about = None)]
#[clap(propagate_version = true)]
pub struct Cli {
    #[clap(subcommand)]
    pub command: Commands,

    /// The board ID. Overrides the default board in the config file.
    #[clap(long, global = true)]
    pub board: Option<String>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Manage boards
    Board(commands::board::BoardCommand),
    /// Manage board items (sticky notes, shapes, text, cards, etc.)
    Item(commands::item::ItemCommand),
    /// Manage connectors between items
    Connector(commands::connector::ConnectorCommand),
    /// Manage tags
    Tag(commands::tag::TagCommand),
    /// Setup the CLI
    Setup,
    /// Generate shell completion scripts
    Completion {
        /// The shell to generate completions for
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },
}
