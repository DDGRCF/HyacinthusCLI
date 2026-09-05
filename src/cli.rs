// 改动说明：需求解析使用严格默认和显式 --lenient，并移除重复的 auth grant 别名。
use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Parser)]
#[command(
    name = "hyacinthus",
    version,
    about = "Agent-oriented CLI for 风信子家教中心"
)]
/// Top-level command-line options shared by all Hyacinthus CLI commands.
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
/// Root command groups exposed by the CLI.
pub enum Command {
    Admin(AdminCommand),
    Claw(ClawCommand),
    Config(ConfigCommand),
    Auth(AuthCommand),
    Doctor(DoctorArgs),
    Capability(CapabilityCommand),
    Api(ApiArgs),
    Schema(SchemaArgs),
    User(Box<UserCommand>),
    Requirements(RequirementsCommand),
    Skills(SkillsCommand),
    Completion(CompletionArgs),
    #[command(name = "__claw-runtime-guard", hide = true)]
    ClawRuntimeGuard(ClawRuntimeGuardArgs),
    #[command(name = "__claw-runtime-probe", hide = true)]
    ClawRuntimeProbe(ClawRuntimeProbeArgs),
}

/// Carries the exact canonical activation identity required while PicoClaw is supervised.
#[derive(Clone, Debug, Args)]
pub struct ClawRuntimeGuardArgs {
    #[arg(long)]
    pub authority_path: PathBuf,
    #[arg(long)]
    pub pointer_digest: String,
    #[arg(long)]
    pub instance: String,
    #[arg(long)]
    pub release_digest: String,
    #[arg(long, value_parser = clap::value_parser!(u64).range(1..))]
    pub activation_fence: u64,
    #[arg(long, value_parser = clap::value_parser!(u64).range(1..))]
    pub runtime_epoch: u64,
    #[arg(long)]
    pub program_name: String,
    #[arg(long)]
    pub guard_nonce: Uuid,
    #[arg(long, value_parser = clap::value_parser!(u16).range(1..))]
    pub health_port: u16,
}

/// Carries the sole loopback endpoint accepted by the container-local readiness probe.
#[derive(Clone, Debug, Args)]
pub struct ClawRuntimeProbeArgs {
    #[arg(long, value_parser = clap::value_parser!(u16).range(1..))]
    pub health_port: u16,
}

#[derive(Clone, Debug, Args)]
/// Administrative command group wrapper.
pub struct AdminCommand {
    #[command(subcommand)]
    pub command: AdminSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Administrative operations that are safe for Agent status inspection.
pub enum AdminSubcommand {
    Status,
}

#[derive(Clone, Debug, Args)]
/// Claw operations command group wrapper.
pub struct ClawCommand {
    #[command(subcommand)]
    pub command: ClawSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Claw operations available through the Agent CLI.
pub enum ClawSubcommand {
    Status,
    Skills(ClawSkillsCommand),
}

#[derive(Clone, Debug, Args)]
/// Claw skill command group wrapper.
pub struct ClawSkillsCommand {
    #[command(subcommand)]
    pub command: ClawSkillsSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Claw skill subcommands.
pub enum ClawSkillsSubcommand {
    List(ClawSkillsListArgs),
}

#[derive(Clone, Debug, Args)]
/// Filters for listing runtime skills installed in Claw.
pub struct ClawSkillsListArgs {
    #[arg(long)]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Configuration command group wrapper.
pub struct ConfigCommand {
    #[command(subcommand)]
    pub command: ConfigSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Profile and token configuration operations.
pub enum ConfigSubcommand {
    SetProfile(SetProfileArgs),
    Use(ProfileNameArgs),
    Show(ProfileShowArgs),
    List,
    Remove(ProfileNameArgs),
    SetToken(SetTokenArgs),
}

#[derive(Clone, Debug, Args)]
/// Arguments for creating or updating a named CLI profile.
pub struct SetProfileArgs {
    pub name: String,
    #[arg(long)]
    pub base_url: String,
    #[arg(long)]
    pub client_instance_id: Option<String>,
    #[arg(long)]
    pub client_display_name: Option<String>,
    #[arg(long)]
    pub client_type: Option<String>,
    #[arg(long)]
    pub default_instance_id: Option<i64>,
    #[arg(long, value_enum)]
    pub default_format: Option<OutputFormat>,
    #[arg(long)]
    pub scopes: Option<String>,
    #[arg(long, default_value_t = false)]
    pub raw_api_enabled: bool,
    #[arg(long = "no-raw-api-enabled", default_value_t = false)]
    pub no_raw_api_enabled: bool,
}

#[derive(Clone, Debug, Args)]
/// Arguments that identify a profile by name.
pub struct ProfileNameArgs {
    pub name: String,
}

#[derive(Clone, Debug, Args)]
/// Arguments for showing a specific profile or the active profile.
pub struct ProfileShowArgs {
    #[arg(long)]
    pub profile: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for storing an Agent token in a profile.
pub struct SetTokenArgs {
    #[arg(long)]
    pub profile: Option<String>,
    #[arg(long)]
    pub token: Option<String>,
    #[arg(long)]
    pub token_stdin: bool,
}

#[derive(Clone, Debug, Args)]
/// Authorization command group wrapper.
pub struct AuthCommand {
    #[command(subcommand)]
    pub command: AuthSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Authorization lifecycle operations for Agent-scoped credentials.
pub enum AuthSubcommand {
    Status,
    Login(AuthLoginArgs),
    Wait(AuthWaitArgs),
    Check(AuthCheckArgs),
    Scopes(AuthScopesArgs),
    Token(AuthTokenCommand),
    Logout(AuthLogoutArgs),
}

#[derive(Clone, Debug, Args)]
/// Arguments for starting an authorization session.
pub struct AuthLoginArgs {
    #[arg(long)]
    pub scope: Option<String>,
    #[arg(long)]
    pub wait: bool,
    #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(1..=600))]
    pub poll_limit: u64,
    #[arg(long)]
    pub pending_state: Option<PathBuf>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for waiting on an existing revision-bound authorization session.
pub struct AuthWaitArgs {
    #[arg(long)]
    pub session_id: Option<String>,
    #[arg(long, requires = "session_id")]
    pub device_secret_stdin: bool,
    #[arg(long, requires = "device_secret_stdin")]
    pub expected_revision: Option<u64>,
    #[arg(long)]
    pub pending_state: Option<PathBuf>,
    #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(1..=600))]
    pub poll_limit: u64,
}

#[derive(Clone, Debug, Args)]
/// Wrapper for durable Agent token status and revocation operations.
pub struct AuthTokenCommand {
    #[command(subcommand)]
    pub command: AuthTokenSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Operations for the current bound Agent token.
pub enum AuthTokenSubcommand {
    Status,
    Revoke,
}

#[derive(Clone, Debug, Args)]
/// Arguments for revoking the current Agent token and clearing local credentials.
pub struct AuthLogoutArgs {
    #[arg(long)]
    pub local_only: bool,
}

#[derive(Clone, Debug, Args)]
/// Arguments for checking whether local credentials cover required scopes.
pub struct AuthCheckArgs {
    #[arg(long)]
    pub scope: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for listing available scopes from the capability manifest.
pub struct AuthScopesArgs {
    #[arg(long)]
    pub domain: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for environment and manifest diagnostics.
pub struct DoctorArgs {
    #[arg(long)]
    pub offline: bool,
    #[arg(long)]
    pub strict: bool,
}

#[derive(Clone, Debug, Args)]
/// Capability command group wrapper.
pub struct CapabilityCommand {
    #[command(subcommand)]
    pub command: CapabilitySubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Capability manifest operations used for schema discovery and execution.
pub enum CapabilitySubcommand {
    List(CapabilityListArgs),
    Schema(CapabilityIdArgs),
    Verify(CapabilityVerifyArgs),
    Diff(CapabilityDiffArgs),
    Run(CapabilityRunArgs),
}

#[derive(Clone, Debug, Args)]
/// Arguments for listing embedded or backend capabilities.
pub struct CapabilityListArgs {
    #[arg(long)]
    pub remote: bool,
}

#[derive(Clone, Debug, Args)]
/// Arguments that identify a capability by ID.
pub struct CapabilityIdArgs {
    pub id: String,
    #[arg(long)]
    pub remote: bool,
}

#[derive(Clone, Debug, Args)]
/// Arguments for validating capability manifest consistency.
pub struct CapabilityVerifyArgs {
    #[arg(long)]
    pub remote: bool,
    #[arg(long)]
    pub strict: bool,
}

#[derive(Clone, Debug, Args)]
/// Arguments for comparing embedded and backend capability manifests.
pub struct CapabilityDiffArgs {
    #[arg(long)]
    pub remote: bool,
    #[arg(long)]
    pub strict: bool,
}

#[derive(Clone, Debug, Args)]
/// Arguments for executing a manifest capability through the generic runner.
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
/// Arguments for the guarded raw API escape hatch.
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
/// Shared pagination controls for endpoints that expose continuation tokens.
pub struct PaginationArgs {
    #[arg(long)]
    pub page_all: bool,
    #[arg(long, value_parser = clap::value_parser!(u64).range(1..=1000))]
    pub page_size: Option<u64>,
    #[arg(long, default_value_t = 10, value_parser = clap::value_parser!(u64).range(1..=100))]
    pub page_limit: u64,
    #[arg(long, default_value_t = 200, value_parser = clap::value_parser!(u64).range(0..=60000))]
    pub page_delay: u64,
}

#[derive(Clone, Debug, Args)]
/// Arguments for printing a capability schema by path or ID.
pub struct SchemaArgs {
    pub path: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Current-user profile command group wrapper.
pub struct UserCommand {
    #[command(subcommand)]
    pub command: UserSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Current-user profile operations supported by Agent automation.
pub enum UserSubcommand {
    Me,
    Update(Box<UserUpdateArgs>),
}

#[derive(Clone, Debug, Args)]
/// Arguments for updating the current authorized user's profile.
pub struct UserUpdateArgs {
    #[arg(long)]
    pub data: Option<String>,
    #[arg(long)]
    pub display_name: Option<String>,
    #[arg(long)]
    pub gender: Option<String>,
    #[arg(long)]
    pub birth_date: Option<String>,
    #[arg(long)]
    pub bio: Option<String>,
    #[arg(long)]
    pub default_address: Option<String>,
    #[arg(long)]
    pub lng: Option<f64>,
    #[arg(long)]
    pub lat: Option<f64>,
    #[arg(long)]
    pub contact_wechat: Option<String>,
    #[arg(long)]
    pub want_to_teach: Option<bool>,
    #[arg(long)]
    pub want_to_learn: Option<bool>,
    #[arg(long)]
    pub current_role: Option<String>,
    #[arg(long)]
    pub province: Option<String>,
    #[arg(long)]
    pub city: Option<String>,
    #[arg(long)]
    pub district: Option<String>,
    #[arg(long)]
    pub postal_code: Option<String>,
    #[arg(long)]
    pub emergency_contact_name: Option<String>,
    #[arg(long)]
    pub emergency_contact_phone: Option<String>,
    #[arg(long)]
    pub emergency_contact_relation: Option<String>,
    #[arg(long)]
    pub education_items_json: Option<String>,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Requirements command group wrapper.
pub struct RequirementsCommand {
    #[command(subcommand)]
    pub command: RequirementsSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Requirements workflows supported by Agent automation.
pub enum RequirementsSubcommand {
    Options,
    Search(RequirementsSearchArgs),
    Extend(RequirementsExtendArgs),
    Parse(RequirementsParseArgs),
    Import(RequirementsImportArgs),
    ImportRaw(RequirementsImportRawArgs),
    PriorityRules(RequirementsPriorityRulesCommand),
    Catalog(RequirementsCatalogCommand),
}

#[derive(Clone, Debug, Args)]
/// Requirements priority rule command group wrapper.
pub struct RequirementsPriorityRulesCommand {
    #[command(subcommand)]
    pub command: RequirementsPriorityRulesSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Priority rule maintenance operations for requirement codes.
pub enum RequirementsPriorityRulesSubcommand {
    List(RequirementsPriorityRulesListArgs),
    Add(RequirementsPriorityRuleAddArgs),
    Update(RequirementsPriorityRuleUpdateArgs),
    Delete(RequirementsPriorityRuleIdWriteArgs),
    Enable(RequirementsPriorityRuleIdWriteArgs),
    Disable(RequirementsPriorityRuleIdWriteArgs),
    Preview(RequirementsPriorityRulesListArgs),
    Matches(RequirementsPriorityRuleMatchesArgs),
    Refresh(RequirementsPriorityRuleIdWriteArgs),
    ImportJson(RequirementsPriorityRuleImportJsonArgs),
    ExportJson(RequirementsPriorityRuleExportJsonArgs),
}

#[derive(Clone, Debug, Args)]
/// Arguments for listing or previewing requirement priority rules.
pub struct RequirementsPriorityRulesListArgs {
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for creating a requirement priority rule.
pub struct RequirementsPriorityRuleAddArgs {
    #[arg(long)]
    pub pattern: String,
    #[arg(long)]
    pub priority: i64,
    #[arg(long)]
    pub description: Option<String>,
    #[arg(long)]
    pub sort_order: Option<i64>,
    #[arg(long)]
    pub disabled: bool,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for updating a requirement priority rule.
pub struct RequirementsPriorityRuleUpdateArgs {
    pub rule_id: i64,
    #[arg(long)]
    pub pattern: Option<String>,
    #[arg(long)]
    pub priority: Option<i64>,
    #[arg(long)]
    pub description: Option<String>,
    #[arg(long)]
    pub sort_order: Option<i64>,
    #[arg(long)]
    pub enabled: bool,
    #[arg(long)]
    pub disabled: bool,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for write operations that target one priority rule.
pub struct RequirementsPriorityRuleIdWriteArgs {
    pub rule_id: i64,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for listing requirements matched by one priority rule.
pub struct RequirementsPriorityRuleMatchesArgs {
    pub rule_id: i64,
    #[arg(long, default_value_t = 1)]
    pub page: i64,
    #[arg(long, default_value_t = 20)]
    pub page_size: i64,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for importing requirement priority rules from JSON.
pub struct RequirementsPriorityRuleImportJsonArgs {
    #[arg(long)]
    pub file: Option<String>,
    #[arg(long)]
    pub data: Option<String>,
    #[arg(long)]
    pub replace: bool,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for exporting requirement priority rules as JSON.
pub struct RequirementsPriorityRuleExportJsonArgs {
    #[arg(long)]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Requirements catalog command group wrapper.
pub struct RequirementsCatalogCommand {
    #[command(subcommand)]
    pub command: RequirementsCatalogSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Catalog maintenance operations for subjects and grades.
pub enum RequirementsCatalogSubcommand {
    CreateMissing(RequirementsCatalogCreateMissingArgs),
    Reorder(RequirementsCatalogReorderArgs),
}

#[derive(Clone, Debug, Args)]
/// Arguments for searching existing requirements by keyword.
pub struct RequirementsSearchArgs {
    #[arg(long)]
    pub keyword: String,
    #[arg(long, value_enum, default_value_t = RequirementSearchScope::Active)]
    pub scope: RequirementSearchScope,
    #[arg(long, default_value_t = 0)]
    pub skip: u64,
    #[arg(long, default_value_t = 20)]
    pub limit: u64,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for extending one requirement deadline by requirement code.
pub struct RequirementsExtendArgs {
    pub requirement_code: String,
    #[arg(long)]
    pub expires_at: Option<String>,
    #[arg(long)]
    pub instance_id: Option<i64>,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Copy, Clone, Debug, Serialize, Deserialize, ValueEnum, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
/// Requirement lifecycle scope selected by requirement search.
pub enum RequirementSearchScope {
    Active,
    All,
    Invalid,
    Expired,
}

impl std::fmt::Display for RequirementSearchScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Active => "active",
            Self::All => "all",
            Self::Invalid => "invalid",
            Self::Expired => "expired",
        };
        write!(f, "{value}")
    }
}

#[derive(Clone, Debug, Args)]
/// Arguments for parsing raw requirement text into confirmable rows.
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
    /// Enables reviewed field aliases and noncanonical ordering without invoking AI.
    #[arg(long, default_value_t = false)]
    pub lenient: bool,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for importing already confirmed requirement rows.
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
/// Arguments for parsing raw requirement text and importing auto-confirmed rows.
pub struct RequirementsImportRawArgs {
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
    /// Enables reviewed field aliases and noncanonical ordering without invoking AI.
    #[arg(long, default_value_t = false)]
    pub lenient: bool,
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
/// Arguments for creating missing subject or grade catalog entries.
pub struct RequirementsCatalogCreateMissingArgs {
    #[arg(long)]
    pub file: Option<String>,
    #[arg(long)]
    pub data: Option<String>,
    #[arg(long)]
    pub subject: Vec<String>,
    #[arg(long)]
    pub grade: Vec<String>,
    #[arg(long)]
    pub subject_category: Option<String>,
    #[arg(long)]
    pub grade_category: Option<String>,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Clone, Debug, Args)]
/// Arguments for reordering subject or grade catalog entries.
pub struct RequirementsCatalogReorderArgs {
    #[arg(long, value_enum)]
    pub target: CatalogTarget,
    #[arg(long)]
    pub ids: String,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub yes: bool,
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Copy, Clone, Debug, Serialize, Deserialize, ValueEnum, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
/// Catalog type selected by catalog reorder operations.
pub enum CatalogTarget {
    Subjects,
    Grades,
}

impl fmt::Display for CatalogTarget {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::Subjects => "subjects",
            Self::Grades => "grades",
        };
        formatter.write_str(value)
    }
}

#[derive(Clone, Debug, Args)]
/// Bundled skill command group wrapper.
pub struct SkillsCommand {
    #[command(subcommand)]
    pub command: SkillsSubcommand,
}

#[derive(Clone, Debug, Subcommand)]
/// Bundled Agent skill discovery and export operations.
pub enum SkillsSubcommand {
    List,
    Show(SkillNameArgs),
    Export(SkillsExportArgs),
    Check(SkillsCheckArgs),
}

#[derive(Clone, Debug, Args)]
/// Arguments that identify a bundled skill by name.
pub struct SkillNameArgs {
    pub name: String,
}

#[derive(Clone, Debug, Args)]
/// Arguments for exporting bundled skills to a workspace directory.
pub struct SkillsExportArgs {
    #[arg(long)]
    pub dir: String,
}

#[derive(Clone, Debug, Args)]
/// Arguments for checking a workspace skill installation.
pub struct SkillsCheckArgs {
    #[arg(long)]
    pub dir: String,
}

#[derive(Clone, Debug, Args)]
/// Arguments for generating shell completion scripts.
pub struct CompletionArgs {
    pub shell: String,
}

#[derive(Copy, Clone, Debug, Serialize, Deserialize, ValueEnum, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
/// Output encodings supported by the CLI envelope printer.
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
