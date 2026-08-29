// 改动说明：版本提醒禁用重定向、限制响应体，并只向官方 GitHub API 发送通用 GitHub token。
use std::env;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config;

const CACHE_FILE_NAME: &str = "notice-cache.json";
const DEFAULT_REPO: &str = "DDGRCF/HyacinthusCLI";
const CHECK_INTERVAL_HOURS: i64 = 24;
const REQUEST_TIMEOUT_SECS: u64 = 2;
const MAX_RELEASE_RESPONSE_BYTES: u64 = 256 * 1024;
const MAX_NOTICE_CACHE_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Cached release check result used to avoid contacting GitHub on every command.
struct NoticeCache {
    checked_at: DateTime<Utc>,
    #[serde(default)]
    latest_version: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    install_hint: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Minimal GitHub release payload needed for update notices.
struct GithubRelease {
    tag_name: Option<String>,
    html_url: Option<String>,
}

/// Build optional update notices controlled by environment variables.
pub fn build(include_notice: bool) -> Option<Value> {
    if !include_notice {
        return None;
    }
    let mut notice = serde_json::Map::new();
    if let Some(update) = env_update_notice().or_else(remote_update_notice) {
        notice.insert("update".to_string(), update);
    }
    if let Ok(target) = env::var("HYACINTHUS_SKILLS_TARGET_VERSION") {
        if is_newer(&target, env!("CARGO_PKG_VERSION")) {
            notice.insert(
                "skills".to_string(),
                json!({
                    "current": env!("CARGO_PKG_VERSION"),
                    "target": target,
                    "message": "Bundled Agent skills should be refreshed"
                }),
            );
        }
    }
    if notice.is_empty() {
        None
    } else {
        Some(Value::Object(notice))
    }
}

/// Build an update notice from the explicit environment override.
fn env_update_notice() -> Option<Value> {
    let latest = env::var("HYACINTHUS_CLI_LATEST_VERSION").ok()?;
    update_notice(&latest, None, None)
}

/// Build an update notice from cached or freshly fetched release metadata.
fn remote_update_notice() -> Option<Value> {
    if remote_notice_disabled() {
        return None;
    }
    if let Some(cache) = read_fresh_cache() {
        return cache
            .latest_version
            .as_deref()
            .and_then(|latest| update_notice(latest, cache.html_url, cache.install_hint));
    }
    let cache = fetch_release_cache().unwrap_or_else(|| NoticeCache {
        checked_at: Utc::now(),
        latest_version: None,
        html_url: None,
        install_hint: None,
    });
    write_cache(&cache);
    cache
        .latest_version
        .as_deref()
        .and_then(|latest| update_notice(latest, cache.html_url, cache.install_hint))
}

/// Respect explicit disable flags and keep env-cleared tests from spamming network calls.
fn remote_notice_disabled() -> bool {
    if env_flag("HYACINTHUS_CLI_DISABLE_REMOTE_NOTICE") {
        return true;
    }
    if env::var("HYACINTHUS_CLI_RELEASE_API_URL").is_ok()
        || env_flag("HYACINTHUS_CLI_ENABLE_REMOTE_NOTICE")
    {
        return false;
    }
    env::var("HYACINTHUS_CONFIG_DIR").is_ok() && env::var("HOME").is_err()
}

/// Read boolean-like environment flags.
fn env_flag(name: &str) -> bool {
    env::var(name)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

/// Fetch the latest GitHub release and convert it into a cache entry.
fn fetch_release_cache() -> Option<NoticeCache> {
    let release_url = reqwest::Url::parse(&release_api_url()).ok()?;
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .ok()?;
    let mut request = client
        .get(release_url.clone())
        .header(
            "User-Agent",
            concat!("HyacinthusCLI/", env!("CARGO_PKG_VERSION")),
        )
        .header("Accept", "application/vnd.github+json");
    if release_url.scheme() == "https" && release_url.host_str() == Some("api.github.com") {
        if let Some(token) = github_token() {
            request = request.bearer_auth(token);
        }
    }
    let response = request.send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RELEASE_RESPONSE_BYTES)
    {
        return None;
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_RELEASE_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_RELEASE_RESPONSE_BYTES {
        return None;
    }
    let release = serde_json::from_slice::<GithubRelease>(&bytes).ok()?;
    let raw_tag = release.tag_name?;
    let latest = normalize_version(&raw_tag)?;
    Some(NoticeCache {
        checked_at: Utc::now(),
        latest_version: Some(latest.clone()),
        html_url: release.html_url,
        install_hint: Some(format!(
            "npx @ddgrcf/hyacinthus-cli install --version {}",
            install_tag(&latest)
        )),
    })
}

/// Return the GitHub release API URL, allowing tests and private mirrors to override it.
fn release_api_url() -> String {
    env::var("HYACINTHUS_CLI_RELEASE_API_URL").unwrap_or_else(|_| {
        let repo = env::var("HYACINTHUS_CLI_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string());
        format!("https://api.github.com/repos/{repo}/releases/latest")
    })
}

/// Read the first supported GitHub token environment variable.
fn github_token() -> Option<String> {
    env::var("GITHUB_TOKEN")
        .ok()
        .or_else(|| env::var("GH_TOKEN").ok())
        .filter(|value| !value.trim().is_empty())
}

/// Build the user-facing update notice when the candidate is newer.
fn update_notice(latest: &str, url: Option<String>, install_hint: Option<String>) -> Option<Value> {
    if !is_newer(latest, env!("CARGO_PKG_VERSION")) {
        return None;
    }
    let mut notice = serde_json::Map::new();
    notice.insert(
        "current".to_string(),
        Value::String(env!("CARGO_PKG_VERSION").to_string()),
    );
    notice.insert("latest".to_string(), Value::String(latest.to_string()));
    notice.insert(
        "message".to_string(),
        Value::String("A newer HyacinthusCLI is available".to_string()),
    );
    if let Some(url) = url {
        notice.insert("url".to_string(), Value::String(url));
    }
    if let Some(install_hint) = install_hint {
        notice.insert("install".to_string(), Value::String(install_hint));
    }
    Some(Value::Object(notice))
}

/// Return a version tag accepted by the npm installer.
fn install_tag(version: &str) -> String {
    if version.starts_with('v') {
        version.to_string()
    } else {
        format!("v{version}")
    }
}

/// Normalize release tags before comparing or rendering versions.
fn normalize_version(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_start_matches('v');
    if parse_version(trimmed).is_some() {
        Some(trimmed.to_string())
    } else {
        None
    }
}

/// Read a cache entry that is still inside the refresh interval.
fn read_fresh_cache() -> Option<NoticeCache> {
    let path = cache_path()?;
    let metadata = fs::symlink_metadata(&path).ok()?;
    if metadata.file_type().is_symlink() || metadata.len() > MAX_NOTICE_CACHE_BYTES {
        return None;
    }
    let file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_NOTICE_CACHE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_NOTICE_CACHE_BYTES {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    let cache = serde_json::from_str::<NoticeCache>(&text).ok()?;
    let age = Utc::now().signed_duration_since(cache.checked_at);
    if age.num_hours() < CHECK_INTERVAL_HOURS {
        Some(cache)
    } else {
        None
    }
}

/// Persist a cache entry and ignore failures because notices are non-blocking.
fn write_cache(cache: &NoticeCache) {
    let Some(path) = cache_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let Ok(text) = serde_json::to_string_pretty(cache) else {
        return;
    };
    let _ = fs::write(path, text);
}

/// Place the notice cache next to the main CLI config file.
fn cache_path() -> Option<PathBuf> {
    let config_path = config::config_path().ok()?;
    Some(config_path.with_file_name(CACHE_FILE_NAME))
}

/// Return whether a candidate dotted version is newer than the current version.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
    }
}

/// Parse a dotted numeric version into comparable components.
fn parse_version(value: &str) -> Option<Vec<u64>> {
    value
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{install_tag, is_newer, normalize_version};

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("v0.2.0", "0.1.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
    }

    #[test]
    fn normalizes_release_tags() {
        assert_eq!(normalize_version("v0.2.0").as_deref(), Some("0.2.0"));
        assert_eq!(install_tag("0.2.0"), "v0.2.0");
        assert!(normalize_version("nightly").is_none());
    }
}
