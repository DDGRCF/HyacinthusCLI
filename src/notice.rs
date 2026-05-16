// 改动说明：CLI 版本与技能刷新提示补充职责注释。
use std::env;

use serde_json::{json, Value};

/// Build optional update notices controlled by environment variables.
pub fn build(include_notice: bool) -> Option<Value> {
    if !include_notice {
        return None;
    }
    let mut notice = serde_json::Map::new();
    if let Ok(latest) = env::var("HYACINTHUS_CLI_LATEST_VERSION") {
        if is_newer(&latest, env!("CARGO_PKG_VERSION")) {
            notice.insert(
                "update".to_string(),
                json!({
                    "current": env!("CARGO_PKG_VERSION"),
                    "latest": latest,
                    "message": "A newer HyacinthusCLI is available"
                }),
            );
        }
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
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
    }
}
