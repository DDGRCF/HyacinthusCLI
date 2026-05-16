// 改动说明：敏感字段脱敏工具补充职责注释。
use serde_json::Value;

/// Key fragments treated as sensitive when rendering dry-run or config output.
const SENSITIVE_MARKERS: &[&str] = &[
    "token",
    "secret",
    "password",
    "authorization",
    "api_key",
    "agent_key",
    "access_key",
    "x-agent-key",
];

/// Redact sensitive values recursively in JSON objects and arrays.
pub fn redact_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if is_sensitive_key(key) {
                    *child = Value::String("***REDACTED***".to_string());
                } else {
                    redact_value(child);
                }
            }
        }
        Value::Array(items) => {
            for child in items {
                redact_value(child);
            }
        }
        _ => {}
    }
}

/// Detect whether a JSON object key likely contains a credential.
fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}
