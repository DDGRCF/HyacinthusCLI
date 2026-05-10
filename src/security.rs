use serde_json::Value;

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

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}
