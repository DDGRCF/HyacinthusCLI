// 改动说明：配置与输入改为有界读取、原子私有写入，并将已保存凭据绑定到 profile 的后端来源。
use std::collections::BTreeMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

use crate::cli::OutputFormat;
use crate::output::{CliError, CliResult};

/// Maximum serialized CLI configuration size accepted from disk.
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
/// Maximum JSON or text payload accepted from stdin or an input file.
pub const MAX_INPUT_BYTES: u64 = 8 * 1024 * 1024;
/// Maximum Agent token size accepted from environment, argv, stdin, or config.
const MAX_TOKEN_BYTES: usize = 16 * 1024;

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
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(ConfigFile::default()),
        Err(err) => {
            return Err(CliError::validation(format!(
                "failed to inspect config {}: {err}",
                path.display()
            )))
        }
    };
    if metadata.file_type().is_symlink() {
        return Err(CliError::validation(format!(
            "config file must not be a symbolic link: {}",
            path.display()
        )));
    }
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err(CliError::validation(format!(
            "config {} exceeds the {} byte limit",
            path.display(),
            MAX_CONFIG_BYTES
        )));
    }
    let file = OpenOptions::new().read(true).open(&path).map_err(|err| {
        CliError::validation(format!("failed to read config {}: {err}", path.display()))
    })?;
    let text = read_bounded_string(file, MAX_CONFIG_BYTES, "config file")?;
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
    write_config_atomically(&path, text.as_bytes())
}

/// Write a same-directory private temporary file and atomically publish it as config.
fn write_config_atomically(path: &Path, bytes: &[u8]) -> CliResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CliError::validation("config path has no parent directory"))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config.json");
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| -> CliResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp_path).map_err(|err| {
            CliError::validation(format!(
                "failed to create private config temporary file {}: {err}",
                temp_path.display()
            ))
        })?;
        file.write_all(bytes).map_err(|err| {
            CliError::validation(format!(
                "failed to write config temporary file {}: {err}",
                temp_path.display()
            ))
        })?;
        file.sync_all().map_err(|err| {
            CliError::validation(format!(
                "failed to sync config temporary file {}: {err}",
                temp_path.display()
            ))
        })?;
        fs::rename(&temp_path, path).map_err(|err| {
            CliError::validation(format!(
                "failed to publish config {}: {err}",
                path.display()
            ))
        })?;
        secure_config_permissions(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
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
    let token = normalize_token(&token)?;
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
    let trimmed = raw.trim();
    let mut url = reqwest::Url::parse(trimmed)
        .map_err(|err| CliError::validation(format!("invalid base_url: {err}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CliError::validation(
            "base_url scheme must be http or https",
        ));
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(CliError::validation(
            "base_url must contain only an HTTP(S) origin without credentials, path, query, or fragment",
        ));
    }
    url.set_path("");
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Return whether saved credentials still match the effective backend and Agent identity.
fn profile_credentials_match(
    profile: &Profile,
    base_url: &str,
    client_instance_id: &str,
    client_type: &str,
) -> bool {
    normalize_base_url(&profile.base_url).is_ok_and(|value| value == base_url)
        && profile.client_instance_id.as_deref() == Some(client_instance_id)
        && profile.client_type.as_deref() == Some(client_type)
}

/// Normalize a token and reject values that cannot safely become an HTTP header.
pub fn normalize_token(raw: &str) -> CliResult<String> {
    let token = raw.trim();
    if token.is_empty() {
        return Err(CliError::validation("agent token is empty"));
    }
    if token.len() > MAX_TOKEN_BYTES {
        return Err(CliError::validation(format!(
            "agent token exceeds {MAX_TOKEN_BYTES} bytes"
        )));
    }
    if token.chars().any(char::is_whitespace) || !token.is_ascii() {
        return Err(CliError::validation(
            "agent token must be a single ASCII value without whitespace",
        ));
    }
    Ok(token.to_string())
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
    let saved_credentials_match = profile.as_ref().is_some_and(|profile| {
        profile_credentials_match(
            profile,
            &normalized_base_url,
            &client_instance_id,
            &client_type,
        )
    });
    let env_token = env::var("HYACINTHUS_AGENT_TOKEN").ok();
    let token = if let Some(token) = env_token {
        Some(normalize_token(&token)?)
    } else if saved_credentials_match {
        profile
            .as_ref()
            .and_then(|profile| profile.token.as_deref())
            .map(normalize_token)
            .transpose()?
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
            profile
                .as_ref()
                .filter(|_| saved_credentials_match)
                .and_then(|profile| {
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
    let saved_credentials_match = profile.is_some_and(|profile| {
        client_instance_id
            .as_deref()
            .is_some_and(|client_instance_id| {
                client_type.as_deref().is_some_and(|client_type| {
                    profile_credentials_match(
                        profile,
                        base_url.as_deref().unwrap_or_default(),
                        client_instance_id,
                        client_type,
                    )
                })
            })
    });
    let env_token = env::var("HYACINTHUS_AGENT_TOKEN").ok();
    let (token_present, token_source) = if env_token
        .as_deref()
        .is_some_and(|token| normalize_token(token).is_ok())
    {
        (true, Some("env".to_string()))
    } else if let Some(profile) = profile.filter(|_| saved_credentials_match) {
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
            profile
                .filter(|_| saved_credentials_match)
                .and_then(|profile| {
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
    let credentials_changed = existing.is_some_and(|profile| {
        profile.token.is_some()
            && !profile_credentials_match(profile, &base_url, client_instance_id, client_type)
    });
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
    if credentials_changed {
        profile.token = None;
        profile.scopes.clear();
    }
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

/// Read a bounded UTF-8 stream and reject input that exceeds its declared policy.
fn read_bounded_string(reader: impl Read, max_bytes: u64, description: &str) -> CliResult<String> {
    let mut bytes = Vec::new();
    reader
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| CliError::validation(format!("failed to read {description}: {err}")))?;
    if bytes.len() as u64 > max_bytes {
        return Err(CliError::validation(format!(
            "{description} exceeds the {max_bytes} byte limit"
        )));
    }
    String::from_utf8(bytes)
        .map_err(|err| CliError::validation(format!("{description} is not valid UTF-8: {err}")))
}

/// Read one bounded UTF-8 input file for JSON or plain-text commands.
pub fn read_input_file(path: &Path) -> CliResult<String> {
    let file = OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|err| CliError::validation(format!("failed to read {}: {err}", path.display())))?;
    read_bounded_string(file, MAX_INPUT_BYTES, "input file")
}

/// Read bounded UTF-8 stdin for JSON, token, or text input.
pub fn read_stdin_string() -> CliResult<String> {
    read_bounded_string(io::stdin().lock(), MAX_INPUT_BYTES, "stdin")
}

/// Read a non-empty token from stdin, trimming surrounding whitespace.
pub fn read_token_from_stdin() -> CliResult<String> {
    normalize_token(&read_stdin_string()?)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::{normalize_base_url, normalize_token, read_bounded_string};

    #[test]
    fn base_url_accepts_only_an_http_origin() {
        assert_eq!(
            normalize_base_url(" https://example.com/ ").expect("valid origin"),
            "https://example.com"
        );
        for invalid in [
            "file:///tmp/api",
            "https://user:pass@example.com",
            "https://example.com/api",
            "https://example.com?target=api",
            "https://example.com/#fragment",
        ] {
            assert!(normalize_base_url(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn token_rejects_whitespace_and_non_ascii_values() {
        assert_eq!(
            normalize_token(" token-123\n").expect("valid token"),
            "token-123"
        );
        assert!(normalize_token("two tokens").is_err());
        assert!(normalize_token("令牌").is_err());
    }

    #[test]
    fn bounded_reader_rejects_one_byte_over_limit() {
        assert_eq!(
            read_bounded_string(Cursor::new(b"1234"), 4, "test").expect("bounded text"),
            "1234"
        );
        assert!(read_bounded_string(Cursor::new(b"12345"), 4, "test").is_err());
    }
}
