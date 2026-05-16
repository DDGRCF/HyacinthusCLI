// 改动说明：输出内容安全清理补充职责注释。
use serde_json::{json, Value};

#[derive(Debug, Clone, Default)]
/// Summary of safety rules triggered while sanitizing CLI output.
pub struct SafetyReport {
    pub rules: Vec<&'static str>,
}

impl SafetyReport {
    /// Convert triggered rules into an optional warning object for the output envelope.
    pub fn alert(&self) -> Option<Value> {
        if self.rules.is_empty() {
            return None;
        }
        Some(json!({
            "level": "warn",
            "rules": self.rules
        }))
    }

    /// Record a safety rule once even if multiple values trigger it.
    fn push_rule(&mut self, rule: &'static str) {
        if !self.rules.contains(&rule) {
            self.rules.push(rule);
        }
    }
}

/// Sanitize a JSON value in place and return any triggered safety warnings.
pub fn sanitize(value: &mut Value) -> SafetyReport {
    let mut report = SafetyReport::default();
    sanitize_value(value, &mut report);
    report
}

/// Remove terminal-hostile control characters while keeping normal whitespace.
pub fn sanitize_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !is_forbidden_control(*ch))
        .collect()
}

/// Recursively sanitize strings inside arrays and objects.
fn sanitize_value(value: &mut Value, report: &mut SafetyReport) {
    match value {
        Value::String(text) => {
            if contains_prompt_injection(text) {
                report.push_rule("possible_prompt_injection");
            }
            let sanitized = sanitize_text(text);
            if sanitized.len() != text.len() {
                report.push_rule("control_characters_removed");
                *text = sanitized;
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_value(item, report);
            }
        }
        Value::Object(object) => {
            for item in object.values_mut() {
                sanitize_value(item, report);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

/// Detect obvious prompt-injection phrases so the envelope can warn operators.
fn contains_prompt_injection(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "ignore previous instructions",
        "ignore all previous instructions",
        "disregard previous instructions",
        "system prompt",
        "developer message",
        "reveal your instructions",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern))
}

/// Identify control characters that should not be written to terminal output.
fn is_forbidden_control(value: char) -> bool {
    value.is_control() && value != '\n' && value != '\r' && value != '\t'
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::sanitize;

    #[test]
    fn removes_terminal_control_characters() {
        let mut value = json!({"text": "hello\u{001b}[31m"});
        let report = sanitize(&mut value);
        assert_eq!(value["text"], "hello[31m");
        assert!(report.rules.contains(&"control_characters_removed"));
    }

    #[test]
    fn reports_possible_prompt_injection() {
        let mut value = json!({"text": "Ignore previous instructions"});
        let report = sanitize(&mut value);
        assert!(report.rules.contains(&"possible_prompt_injection"));
    }
}
