// 改动说明：统一输出信封、错误类型和表格格式化补充职责注释。
use serde::Serialize;
use serde_json::{json, Value};

use crate::cli::OutputFormat;
use crate::content_safety;
use crate::json_query;
use crate::notice;

/// Exit code for backend API failures.
pub const EXIT_API: i32 = 1;
/// Exit code for local validation failures.
pub const EXIT_VALIDATION: i32 = 2;
/// Exit code for authentication and authorization failures.
pub const EXIT_AUTH: i32 = 3;
/// Exit code for network failures.
pub const EXIT_NETWORK: i32 = 4;
/// Exit code for unexpected internal CLI failures.
pub const EXIT_INTERNAL: i32 = 5;
/// Exit code for write operations that require explicit `--yes`.
pub const EXIT_CONFIRMATION_REQUIRED: i32 = 10;

#[derive(Debug, Clone)]
/// Structured CLI error rendered into the standard JSON envelope.
pub struct CliError {
    pub exit_code: i32,
    pub error_type: &'static str,
    pub code: Option<String>,
    pub message: String,
    pub hint: Option<String>,
    pub detail: Option<Value>,
    pub risk: Option<Value>,
    pub retryable: bool,
}

impl CliError {
    /// Create a local validation error.
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_VALIDATION,
            error_type: "validation",
            code: Some("VALIDATION_FAILED".to_string()),
            message: message.into(),
            hint: None,
            detail: None,
            risk: None,
            retryable: false,
        }
    }

    /// Create a local validation error with structured detail.
    pub fn validation_with_detail(message: impl Into<String>, detail: Value) -> Self {
        Self {
            exit_code: EXIT_VALIDATION,
            error_type: "validation",
            code: Some("VALIDATION_FAILED".to_string()),
            message: message.into(),
            hint: None,
            detail: Some(detail),
            risk: None,
            retryable: false,
        }
    }

    /// Create an authentication error with token setup guidance.
    pub fn auth(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_AUTH,
            error_type: "auth",
            code: Some("AUTH_FAILED".to_string()),
            message: message.into(),
            hint: Some(
                "configure HYACINTHUS_AGENT_TOKEN or run `hyacinthus config set-token`".to_string(),
            ),
            detail: None,
            risk: None,
            retryable: false,
        }
    }

    /// Create a retryable network error.
    pub fn network(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_NETWORK,
            error_type: "network",
            code: Some("NETWORK_ERROR".to_string()),
            message: message.into(),
            hint: Some("check backend base_url, network, and proxy settings".to_string()),
            detail: None,
            risk: None,
            retryable: true,
        }
    }

    /// Create a backend API error, preserving backend code and detail when available.
    pub fn api(message: impl Into<String>, code: Option<String>, detail: Option<Value>) -> Self {
        Self {
            exit_code: EXIT_API,
            error_type: "api",
            code,
            message: message.into(),
            hint: None,
            detail,
            risk: None,
            retryable: false,
        }
    }

    /// Create a missing-scope error for local scope checks.
    pub fn missing_scope(missing: Vec<String>, required: Vec<String>) -> Self {
        let message = format!("missing required scope: {}", missing.join(", "));
        Self {
            exit_code: EXIT_AUTH,
            error_type: "missing_scope",
            code: Some("MISSING_SCOPE".to_string()),
            message,
            hint: Some(
                "ask an owner/super_admin to issue an Agent token with the required scope"
                    .to_string(),
            ),
            detail: Some(json!({
                "missing_scopes": missing,
                "required_scopes": required
            })),
            risk: None,
            retryable: false,
        }
    }

    /// Create an auth-required handoff error with URL, QR, and session metadata.
    pub fn auth_required(message: impl Into<String>, detail: Value) -> Self {
        Self {
            exit_code: EXIT_AUTH,
            error_type: "auth_required",
            code: Some("AUTH_REQUIRED".to_string()),
            message: message.into(),
            hint: Some(
                "open authorize_url or send qr_code_text to the user, then run auth wait --session-id <session_id>"
                    .to_string(),
            ),
            detail: Some(detail),
            risk: None,
            retryable: true,
        }
    }

    /// Build a structured auth error for interactive authorization handoff failures.
    pub fn auth_flow(
        code: impl Into<String>,
        message: impl Into<String>,
        detail: Value,
        retryable: bool,
    ) -> Self {
        Self {
            exit_code: EXIT_AUTH,
            error_type: "auth",
            code: Some(code.into()),
            message: message.into(),
            hint: Some(
                "open authorize_url or send qr_code_text to the user, then retry auth wait --session-id <session_id>"
                    .to_string(),
            ),
            detail: Some(detail),
            risk: None,
            retryable,
        }
    }

    /// Create an unexpected internal CLI error.
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_INTERNAL,
            error_type: "internal",
            code: Some("INTERNAL_ERROR".to_string()),
            message: message.into(),
            hint: None,
            detail: None,
            risk: None,
            retryable: false,
        }
    }

    /// Require explicit confirmation for a risky operation.
    pub fn confirmation_required(action: impl Into<String>, level: impl Into<String>) -> Self {
        let action = action.into();
        let level = level.into();
        Self {
            exit_code: EXIT_CONFIRMATION_REQUIRED,
            error_type: "confirmation_required",
            code: Some("CONFIRMATION_REQUIRED".to_string()),
            message: format!("{action} requires confirmation"),
            hint: Some("add --yes to confirm".to_string()),
            detail: None,
            risk: Some(json!({ "level": level, "action": action })),
            retryable: true,
        }
    }

    /// Require explicit confirmation and include structured pending changes.
    pub fn confirmation_required_with_detail(
        action: impl Into<String>,
        level: impl Into<String>,
        detail: Value,
    ) -> Self {
        let action = action.into();
        let level = level.into();
        Self {
            exit_code: EXIT_CONFIRMATION_REQUIRED,
            error_type: "confirmation_required",
            code: Some("CONFIRMATION_REQUIRED".to_string()),
            message: format!("{action} requires confirmation"),
            hint: Some("review the listed changes and add --yes to confirm".to_string()),
            detail: Some(detail),
            risk: Some(json!({ "level": level, "action": action })),
            retryable: true,
        }
    }
}

/// Standard result type for CLI command execution.
pub type CliResult<T> = Result<T, CliError>;

/// Print a successful CLI envelope and return exit code 0.
pub fn print_success<T: Serialize>(
    data: T,
    meta: Value,
    format: OutputFormat,
    jq: Option<&str>,
    include_notice: bool,
) -> i32 {
    let mut envelope = json!({ "ok": true, "data": data, "meta": meta });
    attach_notice(&mut envelope, include_notice);
    attach_content_safety_alert(&mut envelope);
    let value = match jq {
        Some(expression) => match json_query::apply(&envelope, expression) {
            Ok(value) => value,
            Err(err) => return print_error(&err, json!({ "jq": expression }), format, false),
        },
        None => envelope,
    };
    print_value(&value, format);
    0
}

/// Print a failed CLI envelope and return the mapped exit code.
pub fn print_error(err: &CliError, meta: Value, format: OutputFormat, include_notice: bool) -> i32 {
    let mut envelope = json!({
        "ok": false,
        "error": {
            "type": err.error_type,
            "code": err.code,
            "message": err.message,
            "hint": err.hint,
            "detail": err.detail,
            "risk": err.risk,
            "retryable": err.retryable
        },
        "meta": meta
    });
    attach_notice(&mut envelope, include_notice);
    attach_content_safety_alert(&mut envelope);
    print_value(&envelope, format);
    err.exit_code
}

/// Print a JSON value in the selected output format.
pub fn print_value(value: &Value, format: OutputFormat) {
    match format {
        OutputFormat::Json => {
            print_json_line(value);
        }
        OutputFormat::Ndjson => print_ndjson(value),
        OutputFormat::Pretty => print_pretty(value),
        OutputFormat::Table => print_table(value),
        OutputFormat::Csv => print_csv(value),
    }
}

/// Print one compact JSON line.
fn print_json_line(value: &Value) {
    match serde_json::to_string(value) {
        Ok(text) => println!("{text}"),
        Err(err) => eprintln!("failed to serialize output: {err}"),
    }
}

/// Print pretty JSON for humans.
fn print_pretty(value: &Value) {
    match serde_json::to_string_pretty(value) {
        Ok(text) => println!("{text}"),
        Err(err) => eprintln!("failed to serialize output: {err}"),
    }
}

/// Print tabular records as newline-delimited JSON when multiple records exist.
fn print_ndjson(value: &Value) {
    let records = tabular_records(value);
    if records.len() <= 1 {
        print_json_line(value);
        return;
    }
    for record in records {
        print_json_line(&record);
    }
}

/// Print scalar fields from tabular records as a tab-separated table.
fn print_table(value: &Value) {
    let records = tabular_records(value);
    if records.is_empty() {
        print_pretty(value);
        return;
    }
    let columns = tabular_columns(&records);
    if columns.is_empty() {
        print_pretty(value);
        return;
    }
    println!("{}", columns.join("\t"));
    for record in records {
        let cells = columns
            .iter()
            .map(|column| scalar_to_text(record.get(column).unwrap_or(&Value::Null)))
            .collect::<Vec<_>>();
        println!("{}", cells.join("\t"));
    }
}

/// Print scalar fields from tabular records as CSV.
fn print_csv(value: &Value) {
    let records = tabular_records(value);
    if records.is_empty() {
        print_json_line(value);
        return;
    }
    let columns = tabular_columns(&records);
    if columns.is_empty() {
        print_json_line(value);
        return;
    }
    println!(
        "{}",
        columns
            .iter()
            .map(|column| csv_escape(column))
            .collect::<Vec<_>>()
            .join(",")
    );
    for record in records {
        let cells = columns
            .iter()
            .map(|column| csv_escape(&scalar_to_text(record.get(column).unwrap_or(&Value::Null))))
            .collect::<Vec<_>>();
        println!("{}", cells.join(","));
    }
}

/// Extract the best-effort record list from standard CLI envelopes or raw arrays.
fn tabular_records(value: &Value) -> Vec<Value> {
    if let Some(data) = value.get("data") {
        if let Some(array) = data.as_array() {
            return array.clone();
        }
        for key in ["capabilities", "rows", "profiles", "checks", "failed_rows"] {
            if let Some(array) = data.get(key).and_then(Value::as_array) {
                return array.clone();
            }
        }
        if data.is_object() {
            return vec![data.clone()];
        }
    }
    if let Some(array) = value.as_array() {
        return array.clone();
    }
    if value.is_object() {
        return vec![value.clone()];
    }
    Vec::new()
}

/// Select scalar columns in first-seen order with a bounded column count.
fn tabular_columns(records: &[Value]) -> Vec<String> {
    let mut columns = Vec::new();
    for record in records {
        if let Some(object) = record.as_object() {
            for (key, value) in object {
                if !is_scalar(value) || columns.iter().any(|column| column == key) {
                    continue;
                }
                columns.push(key.clone());
                if columns.len() >= 12 {
                    return columns;
                }
            }
        }
    }
    columns
}

/// Return whether a JSON value can be represented directly in table or CSV cells.
fn is_scalar(value: &Value) -> bool {
    matches!(
        value,
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
    )
}

/// Convert scalar JSON values to terminal-safe cell text.
fn scalar_to_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => content_safety::sanitize_text(value),
        _ => match serde_json::to_string(value) {
            Ok(text) => text,
            Err(err) => format!("serialization_error:{err}"),
        },
    }
}

/// Sanitize output and attach a warning when risky content is detected.
fn attach_content_safety_alert(envelope: &mut Value) {
    let report = content_safety::sanitize(envelope);
    if let Some(alert) = report.alert() {
        envelope["_content_safety_alert"] = alert;
    }
}

/// Attach optional CLI update notices to the output envelope.
fn attach_notice(envelope: &mut Value, include_notice: bool) {
    if let Some(notice) = notice::build(include_notice) {
        envelope["_notice"] = notice;
    }
}

/// Escape one CSV cell according to basic RFC 4180 rules.
fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}
