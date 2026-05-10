use std::fmt;
use std::str::FromStr;

use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Parser)]
#[command(
    name = "hyacinthus",
    version,
    about = "Agent-oriented CLI for Hyacinthus"
)]
pub struct Cli {
    #[arg(long, global = true)]
    pub profile: Option<String>,
    #[arg(long, global = true)]
    pub base_url: Option<String>,
    #[arg(long, global = true)]
    pub instance_id: Option<i64>,
    #[arg(long, global = true)]
    pub request_id: Option<String>,
    #[arg(long, value_enum, global = true)]
    pub format: Option<OutputFormat>,
    #[arg(long, short = 'q', global = true)]
    pub jq: Option<String>,
    #[arg(long, global = true)]
    pub no_notice: bool,
    #[arg(long, global = true)]
    pub verbose: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Clone, Debug, Subcommand)]
pub enum Command {
    Admin(AdminCommand),
    Claw(ClawCommand),
    Config(ConfigCommand),
    Auth(AuthCommand),
    Doctor(DoctorArgs),
    Capability(CapabilityCommand),
    Api(ApiArgs),
    Schema(SchemaArgs),
    Requirements(RequirementsCommand),
    Skills(SkillsCommand),
    Completion(CompletionArgs),
}

#[derive(Clone, Debug, Args)]
pub struct AdminCommand {
    #[command(subcommand)]
    pub command: AdminSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum AdminSubcommand {
    Status,
}

#[derive(Clone, Debug, Args)]
pub struct ClawCommand {
    #[command(subcommand)]
    pub command: ClawSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum ClawSubcommand {
    Status,
    Skills(ClawSkillsCommand),
}

#[derive(Clone, Debug, Args)]
pub struct ClawSkillsCommand {
    #[command(subcommand)]
    pub command: ClawSkillsSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum ClawSkillsSubcommand {
    List(ClawSkillsListArgs),
}

#[derive(Clone, Debug, Args)]
pub struct ClawSkillsListArgs {
    #[arg(long)]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct ConfigCommand {
    #[command(subcommand)]
    pub command: ConfigSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum ConfigSubcommand {
    SetProfile(SetProfileArgs),
    Use(ProfileNameArgs),
    Show(ProfileShowArgs),
    List,
    Remove(ProfileNameArgs),
    SetToken(SetTokenArgs),
}

#[derive(Clone, Debug, Args)]
pub struct SetProfileArgs {
    pub name: String,
    #[arg(long)]
    pub base_url: String,
    #[arg(long)]
    pub default_instance_id: Option<i64>,
    #[arg(long, value_enum)]
    pub default_format: Option<OutputFormat>,
    #[arg(long)]
    pub scopes: Option<String>,
    #[arg(long, default_value_t = false)]
    pub raw_api_enabled: bool,
}

#[derive(Clone, Debug, Args)]
pub struct ProfileNameArgs {
    pub name: String,
}

#[derive(Clone, Debug, Args)]
pub struct ProfileShowArgs {
    #[arg(long)]
    pub profile: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct SetTokenArgs {
    #[arg(long)]
    pub profile: Option<String>,
    #[arg(long)]
    pub token: Option<String>,
    #[arg(long)]
    pub token_stdin: bool,
}

#[derive(Clone, Debug, Args)]
pub struct AuthCommand {
    #[command(subcommand)]
    pub command: AuthSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum AuthSubcommand {
    Status,
    Login(AuthLoginArgs),
    Grant(AuthLoginArgs),
    Check(AuthCheckArgs),
    Scopes(AuthScopesArgs),
    Logout,
}

#[derive(Clone, Debug, Args)]
pub struct AuthLoginArgs {
    #[arg(long)]
    pub scope: Option<String>,
    #[arg(long, default_value = "hyacinthus-cli")]
    pub client_name: String,
    #[arg(long)]
    pub wait: bool,
    #[arg(long, default_value_t = 30)]
    pub poll_limit: u64,
}

#[derive(Clone, Debug, Args)]
pub struct AuthCheckArgs {
    #[arg(long)]
    pub scope: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct AuthScopesArgs {
    #[arg(long)]
    pub domain: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct DoctorArgs {
    #[arg(long)]
    pub offline: bool,
    #[arg(long)]
    pub strict: bool,
}

#[derive(Clone, Debug, Args)]
pub struct CapabilityCommand {
    #[command(subcommand)]
    pub command: CapabilitySubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum CapabilitySubcommand {
    List(CapabilityListArgs),
    Schema(CapabilityIdArgs),
    Verify(CapabilityVerifyArgs),
    Diff(CapabilityDiffArgs),
    Run(CapabilityRunArgs),
}

#[derive(Clone, Debug, Args)]
pub struct CapabilityListArgs {
    #[arg(long)]
    pub remote: bool,
}

#[derive(Clone, Debug, Args)]
pub struct CapabilityIdArgs {
    pub id: String,
    #[arg(long)]
    pub remote: bool,
}

#[derive(Clone, Debug, Args)]
pub struct CapabilityVerifyArgs {
    #[arg(long)]
    pub remote: bool,
    #[arg(long)]
    pub strict: bool,
}

#[derive(Clone, Debug, Args)]
pub struct CapabilityDiffArgs {
    #[arg(long)]
    pub remote: bool,
    #[arg(long)]
    pub strict: bool,
}

#[derive(Clone, Debug, Args)]
pub struct CapabilityRunArgs {
    pub id: String,
    #[arg(long)]
    pub remote: bool,
    #[arg(long)]
    pub data: Option<String>,
    #[arg(long)]
    pub params: Option<String>,
    #[command(flatten)]
    pub pagination: PaginationArgs,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct ApiArgs {
    pub method: String,
    pub path: String,
    #[arg(long)]
    pub params: Option<String>,
    #[command(flatten)]
    pub pagination: PaginationArgs,
    #[arg(long)]
    pub data: Option<String>,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args, Default)]
pub struct PaginationArgs {
    #[arg(long)]
    pub page_all: bool,
    #[arg(long)]
    pub page_size: Option<u64>,
    #[arg(long, default_value_t = 10)]
    pub page_limit: u64,
    #[arg(long, default_value_t = 200)]
    pub page_delay: u64,
}

#[derive(Clone, Debug, Args)]
pub struct SchemaArgs {
    pub path: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct RequirementsCommand {
    #[command(subcommand)]
    pub command: RequirementsSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum RequirementsSubcommand {
    Options,
    Parse(RequirementsParseArgs),
    Import(RequirementsImportArgs),
}

#[derive(Clone, Debug, Args)]
pub struct RequirementsParseArgs {
    #[arg(long)]
    pub instance_id: Option<i64>,
    #[arg(long)]
    pub file: Option<String>,
    #[arg(long)]
    pub data: Option<String>,
    #[arg(long)]
    pub text: Option<String>,
    #[arg(long)]
    pub preset_city: Option<String>,
    #[arg(long)]
    pub preset_contact_phone: Option<String>,
    #[arg(long)]
    pub preset_contact_wechat: Option<String>,
    #[arg(long)]
    pub subject_group_aliases_json: Option<String>,
    #[arg(long)]
    pub priority_rules_json: Option<String>,
    #[arg(long, default_value_t = true)]
    pub force_ai: bool,
    #[arg(long = "no-force-ai", default_value_t = false)]
    pub no_force_ai: bool,
    #[arg(long, default_value_t = true)]
    pub enable_ai_fallback: bool,
    #[arg(long = "no-enable-ai-fallback", default_value_t = false)]
    pub no_enable_ai_fallback: bool,
    #[arg(long)]
    pub skip_geocode: bool,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct RequirementsImportArgs {
    #[arg(long)]
    pub instance_id: Option<i64>,
    #[arg(long)]
    pub file: Option<String>,
    #[arg(long)]
    pub data: Option<String>,
    #[arg(long)]
    pub idempotency_key: Option<String>,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
pub struct SkillsCommand {
    #[command(subcommand)]
    pub command: SkillsSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
pub enum SkillsSubcommand {
    List,
    Show(SkillNameArgs),
    Export(SkillsExportArgs),
    Check(SkillsCheckArgs),
}

#[derive(Clone, Debug, Args)]
pub struct SkillNameArgs {
    pub name: String,
}

#[derive(Clone, Debug, Args)]
pub struct SkillsExportArgs {
    #[arg(long)]
    pub dir: String,
}

#[derive(Clone, Debug, Args)]
pub struct SkillsCheckArgs {
    #[arg(long)]
    pub dir: String,
}

#[derive(Clone, Debug, Args)]
pub struct CompletionArgs {
    pub shell: String,
}

#[derive(Copy, Clone, Debug, Serialize, Deserialize, ValueEnum, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Json,
    Pretty,
    Table,
    Ndjson,
    Csv,
}

impl fmt::Display for OutputFormat {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::Json => "json",
            Self::Pretty => "pretty",
            Self::Table => "table",
            Self::Ndjson => "ndjson",
            Self::Csv => "csv",
        };
        formatter.write_str(value)
    }
}

impl FromStr for OutputFormat {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "json" => Ok(Self::Json),
            "pretty" => Ok(Self::Pretty),
            "table" => Ok(Self::Table),
            "ndjson" => Ok(Self::Ndjson),
            "csv" => Ok(Self::Csv),
            _ => Err(format!("unsupported output format: {value}")),
        }
    }
}
