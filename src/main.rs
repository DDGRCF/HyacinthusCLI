mod cli;
mod client;
mod commands;
mod config;
mod content_safety;
mod json_query;
mod manifest;
mod notice;
mod output;
mod pagination;
mod query;
mod schema_validate;
mod security;
mod skills;

use clap::Parser;

fn main() {
    let cli = cli::Cli::parse();
    let code = commands::run(cli);
    std::process::exit(code);
}
