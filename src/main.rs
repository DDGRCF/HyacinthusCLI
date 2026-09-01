// 改动说明：CLI 入口注册隐藏的 pointer-fenced Claw runtime guard。
#![allow(clippy::result_large_err)]

mod claw_guard;
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

/// Parse command-line arguments, execute the command, and exit with its mapped code.
fn main() {
    let cli = cli::Cli::parse();
    let code = commands::run(cli);
    std::process::exit(code);
}
