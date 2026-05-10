use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::cli::OutputFormat;
use crate::output::{CliError, CliResult};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConfigFile {
    pub active_profile: Option<String>,
    pub profiles: BTreeMap<String, Profile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub base_url: String,
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
            default_instance_id: None,
            default_format: OutputFormat::Json,
            token: None,
            scopes: Vec::new(),
            raw_api_enabled: false,
        });
    profile.base_url = base_url.to_string();
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

pub fn resolve_context(
    profile_flag: Option<&str>,
    base_url_flag: Option<&str>,
    instance_id_flag: Option<i64>,
    request_id_flag: Option<&str>,
) -> CliResult<RuntimeContext> {
    let config = load_config()?;
    let profile_name = profile_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_PROFILE").ok())
        .or(config.active_profile.clone())
        .unwrap_or_else(|| "default".to_string());
    let profile = config.profiles.get(&profile_name);
    let base_url = base_url_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_BASE_URL").ok())
        .or_else(|| profile.map(|profile| profile.base_url.clone()))
        .ok_or_else(|| CliError::validation("base_url is not configured"))?;
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
    let token = if let Some(token) = env_token {
        Some(token)
    } else if let Some(profile) = profile {
        profile.token.clone()
    } else {
        None
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
    Ok(RuntimeContext {
        profile_name,
        base_url: normalize_base_url(&base_url)?,
        instance_id,
        request_id,
        token,
        scopes,
        raw_api_enabled,
    })
}

pub fn resolve_scope_context(profile_flag: Option<&str>) -> CliResult<ScopeContext> {
    let config = load_config()?;
    let profile_name = profile_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_PROFILE").ok())
        .or(config.active_profile.clone())
        .unwrap_or_else(|| "default".to_string());
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
    let profile_name = profile_flag
        .map(ToOwned::to_owned)
        .or_else(|| env::var("HYACINTHUS_PROFILE").ok())
        .or(config.active_profile.clone())
        .unwrap_or_else(|| "default".to_string());
    let profile = config.profiles.get(&profile_name);
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
