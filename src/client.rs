// 改动说明：HTTP 客户端绑定 API 来源、禁用重定向并限制响应体，避免凭据泄漏和无界内存占用。
use std::io::Read;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::RuntimeContext;
use crate::output::{CliError, CliResult};
use crate::security;

/// Maximum decoded backend JSON body accepted by one CLI request.
const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
/// Overall timeout for one backend request; long-running work is polled as a job.
const REQUEST_TIMEOUT_SECS: u64 = 60;
/// TCP/TLS connection timeout kept shorter than the full request timeout.
const CONNECT_TIMEOUT_SECS: u64 = 10;
/// Maximum URL path and query length accepted from built-in or raw commands.
const MAX_API_PATH_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone)]
/// Authenticated backend client that injects Agent identity headers.
pub struct ApiClient {
    client: Client,
    context: RuntimeContext,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
/// Public authorization-session payload returned when a user must approve access.
pub struct AuthSessionCreated {
    pub session_id: String,
    pub device_code: String,
    pub client_instance_id: String,
    pub client_display_name: String,
    pub client_type: String,
    pub user_code: String,
    pub verification_uri: String,
    pub authorize_url: String,
    pub qr_code_text: String,
    pub required_scopes: Vec<String>,
    pub expires_at: String,
    pub expires_in_seconds: u64,
    pub poll_interval_seconds: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
/// Authorization-session status returned while polling or after approval.
pub struct AuthSessionStatus {
    pub session_id: String,
    pub client_instance_id: String,
    pub client_display_name: String,
    pub client_type: String,
    pub status: String,
    #[serde(default)]
    pub user_code: Option<String>,
    #[serde(default)]
    pub verification_uri: Option<String>,
    #[serde(default)]
    pub authorize_url: Option<String>,
    #[serde(default)]
    pub qr_code_text: Option<String>,
    pub required_scopes: Vec<String>,
    pub expires_at: String,
    #[serde(default)]
    pub expires_in_seconds: Option<u64>,
    pub poll_interval_seconds: u64,
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub scopes: Vec<String>,
}

/// Validated Rust HTTP response envelope shared by authenticated and public calls.
struct BackendEnvelope {
    code: i64,
    data: Value,
    message: String,
    raw: Value,
}

/// Decode the exact Rust `{ code, message, data }` response shape without permissive defaults.
fn decode_backend_envelope(value: Value) -> CliResult<BackendEnvelope> {
    let object = value.as_object().ok_or_else(|| {
        CliError::api(
            "invalid backend response envelope: expected an object",
            None,
            Some(redacted_detail(value.clone())),
        )
    })?;
    let code = object.get("code").and_then(Value::as_i64).ok_or_else(|| {
        CliError::api(
            "invalid backend response envelope: code must be an integer",
            None,
            Some(redacted_detail(value.clone())),
        )
    })?;
    let message = object
        .get("message")
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
        .ok_or_else(|| {
            CliError::api(
                "invalid backend response envelope: message must be a non-empty string",
                None,
                Some(redacted_detail(value.clone())),
            )
        })?
        .to_owned();
    let data = object.get("data").cloned().ok_or_else(|| {
        CliError::api(
            "invalid backend response envelope: data field is required",
            None,
            Some(redacted_detail(value.clone())),
        )
    })?;
    Ok(BackendEnvelope {
        code,
        data,
        message,
        raw: value,
    })
}

/// Redact credential-shaped fields before a backend payload enters CLI error output.
fn redacted_detail(mut value: Value) -> Value {
    security::redact_value(&mut value);
    value
}

/// Build the shared bounded HTTP client without following credential-bearing redirects.
fn build_http_client() -> CliResult<Client> {
    Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(Policy::none())
        .build()
        .map_err(|err| CliError::internal(format!("failed to create HTTP client: {err}")))
}

/// Read and decode one bounded JSON response without trusting `Content-Length` alone.
fn decode_response(response: reqwest::blocking::Response) -> CliResult<(u16, BackendEnvelope)> {
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err(CliError::api(
            format!(
                "backend response exceeds the {} byte CLI limit",
                MAX_RESPONSE_BYTES
            ),
            Some("RESPONSE_TOO_LARGE".to_string()),
            None,
        ));
    }
    let mut body = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|err| CliError::network(format!("failed to read backend response: {err}")))?;
    if body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(CliError::api(
            format!(
                "backend response exceeds the {} byte CLI limit",
                MAX_RESPONSE_BYTES
            ),
            Some("RESPONSE_TOO_LARGE".to_string()),
            None,
        ));
    }
    let value = serde_json::from_slice::<Value>(&body).map_err(|err| {
        CliError::api(format!("invalid backend JSON response: {err}"), None, None)
    })?;
    Ok((status, decode_backend_envelope(value)?))
}

/// Validate a relative backend API path and reject traversal or alternate-origin forms.
pub fn validate_api_path(path: &str, required_prefix: &str) -> CliResult<()> {
    if path.len() > MAX_API_PATH_BYTES {
        return Err(CliError::validation(format!(
            "API path exceeds {MAX_API_PATH_BYTES} bytes"
        )));
    }
    if !path.starts_with(required_prefix)
        || path.starts_with("//")
        || path.contains('#')
        || path.contains('\\')
        || path.chars().any(char::is_control)
    {
        return Err(CliError::validation(format!(
            "API path must be a safe relative path starting with {required_prefix}"
        )));
    }
    let path_only = path.split_once('?').map_or(path, |(value, _)| value);
    let lower_path = path_only.to_ascii_lowercase();
    if lower_path.contains("%2e")
        || lower_path.contains("%2f")
        || lower_path.contains("%5c")
        || path_only
            .split('/')
            .any(|segment| matches!(segment, "." | ".."))
    {
        return Err(CliError::validation(
            "API path must not contain encoded separators or traversal segments",
        ));
    }
    Ok(())
}

/// Join a validated API path to the configured origin and keep the final origin unchanged.
fn request_url(base_url: &str, path: &str, required_prefix: &str) -> CliResult<reqwest::Url> {
    validate_api_path(path, required_prefix)?;
    let base = reqwest::Url::parse(base_url)
        .map_err(|err| CliError::validation(format!("invalid base_url: {err}")))?;
    let url = base
        .join(path)
        .map_err(|err| CliError::validation(format!("invalid API path: {err}")))?;
    if base.origin() != url.origin() {
        return Err(CliError::validation(
            "API path must not change the configured backend origin",
        ));
    }
    Ok(url)
}

/// Validate an identifier before interpolating it into an authorization URL segment.
pub fn validate_path_identifier(value: &str, field: &str, max_len: usize) -> CliResult<()> {
    if value.is_empty()
        || value.len() > max_len
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(CliError::validation(format!(
            "{field} must be 1-{max_len} ASCII letters, digits, hyphens, or underscores"
        )));
    }
    Ok(())
}

/// Prefer a structured business code from `data.code`, then use the numeric envelope code.
fn backend_error_code(envelope: &BackendEnvelope) -> String {
    envelope
        .data
        .get("code")
        .and_then(|code| {
            code.as_str()
                .map(ToOwned::to_owned)
                .or_else(|| code.as_i64().map(|value| value.to_string()))
                .or_else(|| code.as_u64().map(|value| value.to_string()))
        })
        .unwrap_or_else(|| envelope.code.to_string())
}

impl ApiClient {
    /// Build a backend client with the runtime profile and a bounded request timeout.
    pub fn new(context: RuntimeContext) -> CliResult<Self> {
        let client = build_http_client()?;
        Ok(Self { client, context })
    }

    /// Run an authenticated GET request against an `/api/v1` backend path.
    pub fn get(&self, path: &str) -> CliResult<Value> {
        self.request("GET", path, None)
    }

    /// Run an authenticated POST request with a JSON body.
    pub fn post(&self, path: &str, body: Value) -> CliResult<Value> {
        self.request("POST", path, Some(body))
    }

    /// Run an authenticated PUT request with a JSON body.
    pub fn put(&self, path: &str, body: Value) -> CliResult<Value> {
        self.request("PUT", path, Some(body))
    }

    /// Run an authenticated request for the guarded raw API command.
    pub fn raw(&self, method: &str, path: &str, body: Option<Value>) -> CliResult<Value> {
        self.request(method, path, body)
    }

    /// Send one authenticated request and unwrap the backend `{ code, data }` envelope.
    fn request(&self, method: &str, path: &str, body: Option<Value>) -> CliResult<Value> {
        let token = self
            .context
            .token
            .as_deref()
            .ok_or_else(|| CliError::auth("agent token is not configured"))?;
        let url = request_url(&self.context.base_url, path, "/api/v1/")?;
        let request_id = self
            .context
            .request_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let method = match method {
            "GET" => Method::GET,
            "POST" => Method::POST,
            "PUT" => Method::PUT,
            "PATCH" => Method::PATCH,
            "DELETE" => Method::DELETE,
            _ => {
                return Err(CliError::validation(format!(
                    "unsupported method: {method}"
                )))
            }
        };
        let builder = self
            .client
            .request(method, url)
            .header("X-Agent-Key", token)
            .header("X-Agent-Client-Instance", &self.context.client_instance_id)
            .header("X-Agent-Client-Type", &self.context.client_type)
            .header("X-Request-ID", request_id)
            .header(
                "User-Agent",
                concat!("HyacinthusCLI/", env!("CARGO_PKG_VERSION")),
            );
        let builder = if let Some(body) = body {
            builder.json(&body)
        } else {
            builder
        };
        let response = builder
            .send()
            .map_err(|err| CliError::network(format!("request failed: {err}")))?;
        let (status, envelope) = decode_response(response)?;
        if !(200..300).contains(&status) {
            let message = envelope.message.clone();
            if status == 401 || status == 403 {
                return Err(CliError::auth(message));
            }
            return Err(CliError::api(
                message,
                Some(backend_error_code(&envelope)),
                Some(redacted_detail(envelope.raw)),
            ));
        }
        if envelope.code != 0 {
            return Err(CliError::api(
                envelope.message.clone(),
                Some(backend_error_code(&envelope)),
                Some(redacted_detail(envelope.raw)),
            ));
        }
        Ok(envelope.data)
    }
}

/// Create a public authorization session before an Agent token exists.
pub fn create_auth_session(
    base_url: &str,
    scopes: &[String],
    client_instance_id: &str,
    client_display_name: &str,
    client_type: &str,
) -> CliResult<AuthSessionCreated> {
    let body = json!({
        "scopes": scopes,
        "client_instance_id": client_instance_id,
        "client_display_name": client_display_name,
        "client_type": client_type
    });
    public_request(base_url, "POST", "/api/v1/agent/auth/sessions", Some(body))
}

/// Poll the current authorization-session state with its device-only secret.
pub fn poll_auth_session(
    base_url: &str,
    session_id: &str,
    device_code: &str,
) -> CliResult<AuthSessionStatus> {
    validate_path_identifier(session_id, "session_id", 128)?;
    public_request(
        base_url,
        "POST",
        &format!("/api/v1/agent/auth/sessions/{session_id}/poll"),
        Some(json!({ "device_code": device_code })),
    )
}

/// Acknowledge a locally saved token so the backend atomically removes retryable plaintext.
pub fn acknowledge_auth_session(
    base_url: &str,
    session_id: &str,
    device_code: &str,
) -> CliResult<Value> {
    validate_path_identifier(session_id, "session_id", 128)?;
    public_request(
        base_url,
        "POST",
        &format!("/api/v1/agent/auth/sessions/{session_id}/ack"),
        Some(json!({ "device_code": device_code })),
    )
}

fn public_request<T: for<'de> Deserialize<'de>>(
    base_url: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> CliResult<T> {
    // Authorization session endpoints are public because no Agent token exists yet.
    let client = build_http_client()?;
    let url = request_url(base_url, path, "/api/v1/agent/auth/")?;
    let method = match method {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => {
            return Err(CliError::validation(format!(
                "unsupported method: {method}"
            )))
        }
    };
    let builder = client.request(method, url).header(
        "User-Agent",
        concat!("HyacinthusCLI/", env!("CARGO_PKG_VERSION")),
    );
    let builder = if let Some(body) = body {
        builder.json(&body)
    } else {
        builder
    };
    let response = builder
        .send()
        .map_err(|err| CliError::network(format!("request failed: {err}")))?;
    let (status, envelope) = decode_response(response)?;
    if !(200..300).contains(&status) {
        return Err(CliError::api(
            envelope.message.clone(),
            Some(backend_error_code(&envelope)),
            Some(redacted_detail(envelope.raw)),
        ));
    }
    if envelope.code != 0 {
        return Err(CliError::api(
            envelope.message.clone(),
            Some(backend_error_code(&envelope)),
            Some(redacted_detail(envelope.raw)),
        ));
    }
    serde_json::from_value(envelope.data)
        .map_err(|err| CliError::api(format!("invalid auth session response: {err}"), None, None))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{backend_error_code, decode_backend_envelope, validate_api_path};

    /// Ensures a success response cannot silently omit canonical envelope fields.
    #[test]
    fn rejects_permissive_success_envelopes() {
        for malformed in [
            json!({"message": "success", "data": {}}),
            json!({"code": 0, "data": {}}),
            json!({"code": 0, "message": "success"}),
        ] {
            let error = decode_backend_envelope(malformed)
                .err()
                .expect("must reject");
            assert!(error.message.contains("invalid backend response envelope"));
        }
    }

    /// Ensures structured data codes replace scalar detail as the business error contract.
    #[test]
    fn reads_structured_business_error_code() {
        let envelope = decode_backend_envelope(json!({
            "code": 4290,
            "message": "quota exceeded",
            "data": {"code": "REQUIREMENT_COPY_LIMIT_EXCEEDED"}
        }))
        .expect("canonical envelope");
        assert_eq!(
            backend_error_code(&envelope),
            "REQUIREMENT_COPY_LIMIT_EXCEEDED"
        );
    }

    #[test]
    fn rejects_paths_that_can_escape_the_api_namespace() {
        assert!(validate_api_path("/api/v1/agent/capabilities", "/api/v1/").is_ok());
        for invalid in [
            "//example.com/api/v1/admin",
            "/api/v1/../admin",
            "/api/v1/%2e%2e/admin",
            "/api/v1/admin#fragment",
            "/api/v1/admin\\users",
        ] {
            assert!(
                validate_api_path(invalid, "/api/v1/").is_err(),
                "accepted {invalid}"
            );
        }
    }

    #[test]
    fn malformed_envelope_details_are_redacted() {
        let error = decode_backend_envelope(json!({"access_token": "secret"}))
            .err()
            .expect("must reject");
        assert_eq!(
            error.detail.expect("detail")["access_token"],
            "***REDACTED***"
        );
    }
}
