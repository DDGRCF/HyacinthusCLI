// 改动说明：配置解析避免临时命令写入缺失 profile，并加固 token 配置文件权限。
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

use crate::cli::OutputFormat;
use crate::output::{CliError, CliResult};

/// Agent client types accepted by backend authorization and profile identity.
pub const SUPPORTED_CLIENT_TYPES: &[&str] = &[
    "hermes",
    "codex",
    "claude",
    "picoclaw",
    "nullclaw",
    "hyacinthus-cli",
];
/// Production backend URL used when flags, env, and profile config do not override it.
pub const DEFAULT_BASE_URL: &str = "https://www.fxzjjzx.cn";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
/// On-disk CLI configuration file containing the active profile and all profiles.
pub struct ConfigFile {
    pub active_profile: Option<String>,
    pub profiles: BTreeMap<String, Profile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// A named CLI profile with backend, Agent identity, token, and local scope hints.
pub struct Profile {
    pub name: String,
    pub base_url: String,
    pub client_instance_id: Option<String>,
    pub client_display_name: Option<String>,
    pub client_type: Option<String>,
    pub default_instance_id: Option<i64>,
    pub default_format: OutputFormat,
    pub token: Option<String>,
    pub scopes: Vec<String>,
    pub raw_api_enabled: bool,
}

#[derive(Debug, Clone)]
/// Fully resolved runtime context used for authenticated backend requests.
pub struct RuntimeContext {
    pub profile_name: String,
    pub base_url: String,
    pub client_instance_id: String,
    pub client_display_name: String,
    pub client_type: String,
    pub instance_id: Option<i64>,
    pub request_id: Option<String>,
    pub token: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub raw_api_enabled: bool,
}

#[derive(Debug, Clone)]
/// Minimal context used when only local scope validation is needed.
pub struct ScopeContext {
    pub profile_name: String,
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
/// Auth status context that reports configured values without requiring a token.
pub struct AuthStatusContext {
    pub profile_name: String,
    pub base_url: Option<String>,
    pub client_instance_id: Option<String>,
    pub client_display_name: Option<String>,
    pub client_type: Option<String>,
    pub instance_id: Option<i64>,
    pub request_id: Option<String>,
    pub token_present: bool,
    pub token_source: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub raw_api_enabled: bool,
}

/// Resolve the config file path from `HYACINTHUS_CONFIG_DIR` or `$HOME/.config`.
pub fn config_path() -> CliResult<PathBuf> {
    if let Ok(dir) = env::var("HYACINTHUS_CONFIG_DIR") {
        return Ok(PathBuf::from(dir).join("config.json"));
    }
    let home = env::var("HOME").map_err(|_| CliError::validation("HOME is not set"))?;
    Ok(PathBuf::from(home)
        .join(".config")
        .join("hyacinthus-cli")
        .join("config.json"))
}

/// Load CLI configuration, returning an empty config when no file exists.
pub fn load_config() -> CliResult<ConfigFile> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(ConfigFile::default());
    }
    let text = fs::read_to_string(&path).map_err(|err| {
        CliError::validation(format!("failed to read config {}: {err}", path.display()))
    })?;
    serde_json::from_str(&text).map_err(|err| {
        CliError::validation(format!("failed to parse config {}: {err}", path.display()))
    })
}

/// Persist CLI configuration as pretty JSON, creating the parent directory if needed.
pub fn save_config(config: &ConfigFile) -> CliResult<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            CliError::validation(format!(
                "failed to create config directory {}: {err}",
                parent.display()
            ))
        })?;
    }
    let text = serde_json::to_string_pretty(config)
        .map_err(|err| CliError::internal(format!("failed to serialize config: {err}")))?;
    fs::write(&path, text).map_err(|err| {
        CliError::validation(format!("failed to write config {}: {err}", path.display()))
    })?;
    secure_config_permissions(&path)?;
    Ok(())
}

/// Restrict the config file so saved Agent tokens are not world-readable.
#[cfg(unix)]
fn secure_config_permissions(path: &Path) -> CliResult<()> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|err| {
        CliError::validation(format!(
            "failed to secure config permissions {}: {err}",
            path.display()
        ))
    })
}

/// Keep a no-op permissions hook for non-Unix builds.
#[cfg(not(unix))]
fn secure_config_permissions(_path: &Path) -> CliResult<()> {
    Ok(())
}

pub fn save_agent_credentials(
    profile_name: &str,
    base_url: &str,
    client_instance_id: &str,
    client_display_name: &str,
    client_type: &str,
    token: String,
    scopes: Vec<String>,
) -> CliResult<()> {
    // Auth wait uses this path to persist the token under the exact Agent instance identity.
    let mut config = load_config()?;
    let profile = config
        .profiles
        .entry(profile_name.to_string())
        .or_insert_with(|| Profile {
            name: profile_name.to_string(),
            base_url: base_url.to_string(),
            client_instance_id: Some(client_instance_id.to_string()),
            client_display_name: Some(client_display_name.to_string()),
            client_type: Some(client_type.to_string()),
            default_instance_id: None,
            default_format: OutputFormat::Json,
            token: None,
            scopes: Vec::new(),
            raw_api_enabled: false,
        });
    profile.base_url = base_url.to_string();
    profile.client_instance_id = Some(client_instance_id.to_string());
    profile.client_display_name = Some(client_display_name.to_string());
    profile.client_type = Some(client_type.to_string());
    profile.token = Some(token);
    profile.scopes = scopes;
    if config.active_profile.is_none() {
        config.active_profile = Some(profile_name.to_string());
    }
    save_config(&config)
}

/// Normalize and validate a backend base URL.
pub fn normalize_base_url(raw: &str) -> CliResult<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(CliError::validation(
            "base_url must start with http:// or https://",
        ));
    }
    Ok(trimmed.to_string())
}

/// Resolve base URL precedence: flag, env, profile, then production default.
fn resolve_base_url(profile: Option<&Profile>, base_url_flag: Option<&str>) -> CliResult<String> {
    let value = base_url_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_BASE_URL").ok())
        .or_else(|| profile.map(|profile| profile.base_url.clone()))
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
    normalize_base_url(&value)
}

fn resolve_client_identity(
    profile: Option<&Profile>,
    profile_name: &str,
) -> CliResult<(String, String, String, bool)> {
    // Preserve instance-specific authorization by deriving identity from profile/env, not HOME alone.
    let inferred_type = infer_client_type(profile_name);
    let client_type = env::var("HYACINTHUS_CLIENT_TYPE")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_type.clone()))
        .or(Some(inferred_type))
        .map(|value| normalize_client_type(&value))
        .transpose()?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CliError::validation("client_type is not configured"))?;
    let client_instance_id = env::var("HYACINTHUS_CLIENT_INSTANCE_ID")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_instance_id.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| generate_client_instance_id(profile_name, &client_type));
    let client_display_name = env::var("HYACINTHUS_CLIENT_DISPLAY_NAME")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_display_name.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_client_display_name(profile_name, &client_type));
    let changed = profile.is_none_or(|profile| {
        profile.client_instance_id.as_deref() != Some(client_instance_id.as_str())
            || profile.client_display_name.as_deref() != Some(client_display_name.as_str())
            || profile.client_type.as_deref() != Some(client_type.as_str())
    });
    Ok((
        client_instance_id,
        client_display_name,
        client_type,
        changed,
    ))
}

pub fn resolve_context(
    profile_flag: Option<&str>,
    base_url_flag: Option<&str>,
    instance_id_flag: Option<i64>,
    request_id_flag: Option<&str>,
) -> CliResult<RuntimeContext> {
    // This is the single source of truth for request identity, instance ID, token, and scopes.
    let mut config = load_config()?;
    let profile_name = resolve_profile_name(&config, profile_flag);
    let profile = config.profiles.get(&profile_name).cloned();
    let (client_instance_id, client_display_name, client_type, identity_changed) =
        resolve_client_identity(profile.as_ref(), &profile_name)?;
    let normalized_base_url = resolve_base_url(profile.as_ref(), base_url_flag)?;
    let identity_from_env = env::var("HYACINTHUS_CLIENT_INSTANCE_ID").is_ok()
        || env::var("HYACINTHUS_CLIENT_DISPLAY_NAME").is_ok()
        || env::var("HYACINTHUS_CLIENT_TYPE").is_ok();
    let inferred_agent_home_profile = profile_name_inferred_from_agent_home(profile_flag);
    if identity_changed && !identity_from_env && (profile.is_some() || inferred_agent_home_profile)
    {
        upsert_profile_identity(
            &mut config,
            &profile_name,
            normalized_base_url.clone(),
            &client_instance_id,
            &client_display_name,
            &client_type,
            profile.as_ref(),
        );
        save_config(&config)?;
    }
    let instance_id = instance_id_flag
        .or_else(|| {
            env::var("HYACINTHUS_INSTANCE_ID")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
        })
        .or_else(|| {
            profile
                .as_ref()
                .and_then(|profile| profile.default_instance_id)
        });
    let request_id = request_id_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_REQUEST_ID").ok())
        .filter(|value| !value.trim().is_empty());
    let env_token = env::var("HYACINTHUS_AGENT_TOKEN").ok();
    let token = if let Some(token) = env_token {
        Some(token)
    } else if let Some(profile) = profile.as_ref() {
        profile.token.clone()
    } else {
        None
    };
    let raw_api_enabled = env::var("HYACINTHUS_RAW_API").ok().as_deref() == Some("1")
        || profile
            .as_ref()
            .map(|profile| profile.raw_api_enabled)
            .unwrap_or(false);
    let scopes = env::var("HYACINTHUS_AGENT_SCOPES")
        .ok()
        .map(|value| parse_scope_list(&value))
        .or_else(|| {
            profile.as_ref().and_then(|profile| {
                if profile.scopes.is_empty() {
                    None
                } else {
                    Some(profile.scopes.clone())
                }
            })
        });
    Ok(RuntimeContext {
        profile_name,
        base_url: normalized_base_url,
        client_instance_id,
        client_display_name,
        client_type,
        instance_id,
        request_id,
        token,
        scopes,
        raw_api_enabled,
    })
}

/// Return whether profile resolution will use an Agent HOME-derived profile name.
fn profile_name_inferred_from_agent_home(profile_flag: Option<&str>) -> bool {
    if profile_flag.is_some() {
        return false;
    }
    if env::var("HYACINTHUS_PROFILE")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return false;
    }
    detect_agent_home_env().is_some()
}

/// Resolve only profile and scope hints for local authorization checks.
pub fn resolve_scope_context(profile_flag: Option<&str>) -> CliResult<ScopeContext> {
    let config = load_config()?;
    let profile_name = resolve_profile_name(&config, profile_flag);
    let profile = config.profiles.get(&profile_name);
    let scopes = env::var("HYACINTHUS_AGENT_SCOPES")
        .ok()
        .map(|value| parse_scope_list(&value))
        .or_else(|| {
            profile.and_then(|profile| {
                if profile.scopes.is_empty() {
                    None
                } else {
                    Some(profile.scopes.clone())
                }
            })
        });
    Ok(ScopeContext {
        profile_name,
        scopes,
    })
}

pub fn resolve_auth_status_context(
    profile_flag: Option<&str>,
    base_url_flag: Option<&str>,
    instance_id_flag: Option<i64>,
    request_id_flag: Option<&str>,
) -> CliResult<AuthStatusContext> {
    // Status must be inspectable before a token exists, so values stay optional here.
    let config = load_config()?;
    let profile_name = resolve_profile_name(&config, profile_flag);
    let profile = config.profiles.get(&profile_name);
    let client_instance_id = env::var("HYACINTHUS_CLIENT_INSTANCE_ID")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_instance_id.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let client_display_name = env::var("HYACINTHUS_CLIENT_DISPLAY_NAME")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_display_name.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let client_type = env::var("HYACINTHUS_CLIENT_TYPE")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_type.clone()))
        .or_else(|| Some(infer_client_type(&profile_name)))
        .map(|value| normalize_client_type(&value))
        .transpose()?
        .filter(|value| !value.is_empty());
    let base_url = Some(resolve_base_url(profile, base_url_flag)?);
    let instance_id = instance_id_flag
        .or_else(|| {
            env::var("HYACINTHUS_INSTANCE_ID")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
        })
        .or_else(|| profile.and_then(|profile| profile.default_instance_id));
    let request_id = request_id_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_REQUEST_ID").ok())
        .filter(|value| !value.trim().is_empty());
    let env_token = env::var("HYACINTHUS_AGENT_TOKEN").ok();
    let (token_present, token_source) = if env_token.is_some() {
        (true, Some("env".to_string()))
    } else if let Some(profile) = profile {
        (
            profile.token.is_some(),
            profile.token.as_ref().map(|_| "config".to_string()),
        )
    } else {
        (false, None)
    };
    let raw_api_enabled = env::var("HYACINTHUS_RAW_API").ok().as_deref() == Some("1")
        || profile
            .map(|profile| profile.raw_api_enabled)
            .unwrap_or(false);
    let scopes = env::var("HYACINTHUS_AGENT_SCOPES")
        .ok()
        .map(|value| parse_scope_list(&value))
        .or_else(|| {
            profile.and_then(|profile| {
                if profile.scopes.is_empty() {
                    None
                } else {
                    Some(profile.scopes.clone())
                }
            })
        });
    Ok(AuthStatusContext {
        profile_name,
        base_url,
        client_instance_id,
        client_display_name,
        client_type,
        instance_id,
        request_id,
        token_present,
        token_source,
        scopes,
        raw_api_enabled,
    })
}

/// Parse comma- or whitespace-separated scope lists.
pub fn parse_scope_list(value: &str) -> Vec<String> {
    value
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

/// Normalize and validate an Agent client type.
pub fn normalize_client_type(value: &str) -> CliResult<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if SUPPORTED_CLIENT_TYPES.contains(&normalized.as_str()) {
        return Ok(normalized);
    }
    Err(CliError::validation(format!(
        "unsupported client_type: {value}; supported values: {}",
        SUPPORTED_CLIENT_TYPES.join(", ")
    )))
}

/// Infer a client type from a profile name when no explicit type is configured.
pub fn infer_client_type(profile_name: &str) -> String {
    let normalized = profile_name.to_ascii_lowercase();
    for client_type in ["hermes", "codex", "claude", "picoclaw", "nullclaw"] {
        if normalized.contains(client_type) {
            return client_type.to_string();
        }
    }
    "hyacinthus-cli".to_string()
}

pub fn complete_profile_identity(
    profile_name: &str,
    client_instance_id: Option<String>,
    client_display_name: Option<String>,
    client_type: Option<String>,
    existing: Option<&Profile>,
) -> CliResult<(String, String, String)> {
    // Used by config set-profile so a profile always has a stable client identity.
    let inferred_type = client_type
        .or_else(|| existing.and_then(|profile| profile.client_type.clone()))
        .unwrap_or_else(|| infer_client_type(profile_name));
    let normalized_type = normalize_client_type(&inferred_type)?;
    let instance_id = client_instance_id
        .or_else(|| existing.and_then(|profile| profile.client_instance_id.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| generate_client_instance_id(profile_name, &normalized_type));
    let display_name = client_display_name
        .or_else(|| existing.and_then(|profile| profile.client_display_name.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_client_display_name(profile_name, &normalized_type));
    Ok((instance_id, display_name, normalized_type))
}

/// Resolve profile-name precedence, including Agent HOME-derived instance profiles.
fn resolve_profile_name(config: &ConfigFile, profile_flag: Option<&str>) -> String {
    if let Some(profile) = profile_flag {
        return profile.to_string();
    }
    if let Ok(profile) = env::var("HYACINTHUS_PROFILE") {
        let trimmed = profile.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some((client_type, path)) = detect_agent_home_env() {
        return profile_name_from_home(&client_type, &path);
    }
    if let Some(profile) = config.active_profile.clone() {
        return profile;
    }
    "local".to_string()
}

/// Detect Agent-specific HOME variables that imply a separate local authorization profile.
fn detect_agent_home_env() -> Option<(String, String)> {
    for (key, client_type) in [
        ("HERMES_HOME", "hermes"),
        ("CODEX_HOME", "codex"),
        ("CLAUDE_HOME", "claude"),
        ("PICOCLAW_HOME", "picoclaw"),
        ("NULLCLAW_HOME", "nullclaw"),
    ] {
        if let Ok(path) = env::var(key) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return Some((client_type.to_string(), trimmed.to_string()));
            }
        }
    }
    None
}

/// Convert an Agent HOME path into a stable profile name.
fn profile_name_from_home(client_type: &str, path: &str) -> String {
    let path_buf = PathBuf::from(path);
    let basename = path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("default")
        .trim_start_matches('.');
    format!("{client_type}-{}", sanitize_profile_part(basename))
}

/// Sanitize user or path-derived text for safe profile-name segments.
fn sanitize_profile_part(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Generate a new Agent client-instance ID scoped to profile and client type.
fn generate_client_instance_id(profile_name: &str, client_type: &str) -> String {
    let suffix = Uuid::new_v4().simple().to_string();
    format!(
        "{client_type}-{}-{}",
        sanitize_profile_part(profile_name),
        &suffix[..8]
    )
}

/// Build a readable display name shown during user authorization.
fn default_client_display_name(profile_name: &str, client_type: &str) -> String {
    format!("{} ({})", title_case_client_type(client_type), profile_name)
}

/// Render client type names for user-facing display.
fn title_case_client_type(client_type: &str) -> String {
    match client_type {
        "hermes" => "Hermes".to_string(),
        "codex" => "Codex".to_string(),
        "claude" => "Claude".to_string(),
        "picoclaw" => "PicoClaw".to_string(),
        "nullclaw" => "NullClaw".to_string(),
        "hyacinthus-cli" => "Hyacinthus CLI".to_string(),
        _ => client_type.to_string(),
    }
}

fn upsert_profile_identity(
    config: &mut ConfigFile,
    profile_name: &str,
    base_url: String,
    client_instance_id: &str,
    client_display_name: &str,
    client_type: &str,
    existing: Option<&Profile>,
) {
    // Keep generated profile identity durable so future auth checks use the same instance.
    let profile = config
        .profiles
        .entry(profile_name.to_string())
        .or_insert_with(|| Profile {
            name: profile_name.to_string(),
            base_url: base_url.clone(),
            client_instance_id: None,
            client_display_name: None,
            client_type: None,
            default_instance_id: existing.and_then(|profile| profile.default_instance_id),
            default_format: existing
                .map(|profile| profile.default_format)
                .unwrap_or(OutputFormat::Json),
            token: existing.and_then(|profile| profile.token.clone()),
            scopes: existing
                .map(|profile| profile.scopes.clone())
                .unwrap_or_default(),
            raw_api_enabled: existing
                .map(|profile| profile.raw_api_enabled)
                .unwrap_or(false),
        });
    profile.base_url = base_url;
    profile.client_instance_id = Some(client_instance_id.to_string());
    profile.client_display_name = Some(client_display_name.to_string());
    profile.client_type = Some(client_type.to_string());
}

pub fn resolve_output_format(
    profile_flag: Option<&str>,
    format_flag: Option<OutputFormat>,
) -> CliResult<OutputFormat> {
    // Output format follows explicit flag, env, active profile, then JSON default.
    if let Some(format) = format_flag {
        return Ok(format);
    }
    if let Ok(value) = env::var("HYACINTHUS_FORMAT") {
        return OutputFormat::from_str(value.as_str()).map_err(CliError::validation);
    }
    let config = load_config()?;
    let profile_name = resolve_profile_name(&config, profile_flag);
    if let Some(profile) = config.profiles.get(&profile_name) {
        return Ok(profile.default_format);
    }
    Ok(OutputFormat::Json)
}

/// Read all stdin into a UTF-8 string for JSON, token, or text input.
pub fn read_stdin_string() -> CliResult<String> {
    let mut buf = String::new();
    io::stdin()
        .read_to_string(&mut buf)
        .map_err(|err| CliError::validation(format!("failed to read stdin: {err}")))?;
    Ok(buf)
}

/// Read a non-empty token from stdin, trimming surrounding whitespace.
pub fn read_token_from_stdin() -> CliResult<String> {
    let token = read_stdin_string()?.trim().to_string();
    if token.is_empty() {
        return Err(CliError::validation("token read from stdin is empty"));
    }
    Ok(token)
}
