use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

use crate::cli::OutputFormat;
use crate::output::{CliError, CliResult};

pub const SUPPORTED_CLIENT_TYPES: &[&str] = &[
    "hermes",
    "codex",
    "claude",
    "picoclaw",
    "nullclaw",
    "hyacinthus-cli",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConfigFile {
    pub active_profile: Option<String>,
    pub profiles: BTreeMap<String, Profile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct ScopeContext {
    pub profile_name: String,
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
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
    })
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

pub fn normalize_base_url(raw: &str) -> CliResult<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(CliError::validation(
            "base_url must start with http:// or https://",
        ));
    }
    Ok(trimmed.to_string())
}

fn resolve_client_identity(
    profile: Option<&Profile>,
    profile_name: &str,
) -> CliResult<(String, String, String, bool)> {
    let inferred_type = infer_client_type(profile_name);
    let client_instance_id = env::var("HYACINTHUS_CLIENT_INSTANCE_ID")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_instance_id.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| generate_client_instance_id(profile_name, &inferred_type));
    let client_display_name = env::var("HYACINTHUS_CLIENT_DISPLAY_NAME")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_display_name.clone()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_client_display_name(profile_name, &inferred_type));
    let client_type = env::var("HYACINTHUS_CLIENT_TYPE")
        .ok()
        .or_else(|| profile.and_then(|item| item.client_type.clone()))
        .or(Some(inferred_type))
        .map(|value| normalize_client_type(&value))
        .transpose()?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CliError::validation("client_type is not configured"))?;
    let changed = profile.is_none_or(|profile| {
        profile.client_instance_id.as_deref() != Some(client_instance_id.as_str())
            || profile.client_display_name.as_deref() != Some(client_display_name.as_str())
            || profile.client_type.as_deref() != Some(client_type.as_str())
    });
    Ok((client_instance_id, client_display_name, client_type, changed))
}

pub fn resolve_context(
    profile_flag: Option<&str>,
    base_url_flag: Option<&str>,
    instance_id_flag: Option<i64>,
    request_id_flag: Option<&str>,
) -> CliResult<RuntimeContext> {
    let mut config = load_config()?;
    let profile_name = resolve_profile_name(&config, profile_flag);
    let profile = config.profiles.get(&profile_name).cloned();
    let (client_instance_id, client_display_name, client_type, identity_changed) =
        resolve_client_identity(profile, &profile_name)?;
    let base_url = base_url_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_BASE_URL").ok())
        .or_else(|| profile.as_ref().map(|profile| profile.base_url.clone()))
        .ok_or_else(|| CliError::validation("base_url is not configured"))?;
    let normalized_base_url = normalize_base_url(&base_url)?;
    if identity_changed {
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
        .or_else(|| profile.as_ref().and_then(|profile| profile.default_instance_id));
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
    let base_url = base_url_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_BASE_URL").ok())
        .or_else(|| profile.map(|profile| profile.base_url.clone()))
        .map(|value| normalize_base_url(&value))
        .transpose()?;
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

pub fn parse_scope_list(value: &str) -> Vec<String> {
    value
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub fn resolve_output_format(
    profile_flag: Option<&str>,
    format_flag: Option<OutputFormat>,
) -> CliResult<OutputFormat> {
    if let Some(format) = format_flag {
        return Ok(format);
    }
    if let Ok(value) = env::var("HYACINTHUS_FORMAT") {
        return OutputFormat::from_str(value.as_str()).map_err(CliError::validation);
    }
    let config = load_config()?;
    let profile_name = profile_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_PROFILE").ok())
        .or(config.active_profile.clone());
    if let Some(profile_name) = profile_name {
        if let Some(profile) = config.profiles.get(&profile_name) {
            return Ok(profile.default_format);
        }
    }
    Ok(OutputFormat::Json)
}

pub fn read_stdin_string() -> CliResult<String> {
    let mut buf = String::new();
    io::stdin()
        .read_to_string(&mut buf)
        .map_err(|err| CliError::validation(format!("failed to read stdin: {err}")))?;
    Ok(buf)
}

pub fn read_token_from_stdin() -> CliResult<String> {
    let token = read_stdin_string()?.trim().to_string();
    if token.is_empty() {
        return Err(CliError::validation("token read from stdin is empty"));
    }
    Ok(token)
}
