// 改动说明：Agent device flow 使用精确 session 路径与冻结 DTO，命令失败只读顶层 error_code。
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
/// Maximum accepted length of the backend's closed machine-readable error code.
const MAX_ERROR_CODE_BYTES: usize = 128;

#[derive(Debug, Clone)]
/// Authenticated backend client that injects Agent identity headers.
pub struct ApiClient {
    client: Client,
    context: RuntimeContext,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
/// Agent authorization 支持的封闭 client family。
pub enum AgentClientType {
    Claude,
    Codex,
    Hermes,
    #[serde(rename = "hyacinthus-cli")]
    HyacinthusCli,
    Nullclaw,
    Picoclaw,
}

impl AgentClientType {
    /// 返回传输与配置比较共用的 canonical client type。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Hermes => "hermes",
            Self::HyacinthusCli => "hyacinthus-cli",
            Self::Nullclaw => "nullclaw",
            Self::Picoclaw => "picoclaw",
        }
    }
}

impl std::fmt::Display for AgentClientType {
    /// 以 canonical wire value 格式化，拒绝业务层裸字符串分支。
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
/// Device flow 完成后唯一允许的 token type。
pub enum AgentTokenType {
    Agent,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
/// Public authorization-session payload returned when a user must approve access.
pub struct AuthSessionCreated {
    pub session_id: String,
    pub device_code: String,
    pub client_instance_id: String,
    pub client_display_name: String,
    pub client_type: AgentClientType,
    pub user_code: String,
    pub verification_uri: String,
    pub authorize_url: String,
    pub qr_code_text: String,
    pub required_scopes: Vec<String>,
    pub expires_at: String,
    pub expires_in_seconds: u64,
    pub poll_interval_seconds: u64,
    pub revision: u64,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
/// Authorization-session status returned while polling or after approval.
pub struct AuthSessionStatus {
    pub session_id: String,
    pub client_instance_id: String,
    pub client_display_name: String,
    pub client_type: AgentClientType,
    pub status: AgentAuthSessionState,
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
    pub token_type: Option<AgentTokenType>,
    pub scopes: Vec<String>,
    pub revision: u64,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
/// Agent device authorization 的封闭生命周期状态。
pub enum AgentAuthSessionState {
    Approved,
    Acknowledged,
    Denied,
    DeliveryCancelled,
    DeliveryExpired,
    Expired,
    Pending,
}

impl AgentAuthSessionState {
    /// 返回后端 JSON 与 CLI 输出共用的 canonical snake_case 值。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::Acknowledged => "acknowledged",
            Self::Denied => "denied",
            Self::DeliveryCancelled => "delivery_cancelled",
            Self::DeliveryExpired => "delivery_expired",
            Self::Expired => "expired",
            Self::Pending => "pending",
        }
    }
}

impl std::fmt::Display for AgentAuthSessionState {
    /// 以 canonical 值格式化，避免业务层重新拼接裸字符串。
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
/// Agent token 落盘后清除服务端可恢复明文的回执。
pub struct AuthSessionAcknowledged {
    pub session_id: String,
    pub revision: u64,
    pub status: AgentAuthSessionState,
    pub result: AgentAuthAcknowledgementResult,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
/// 区分首次持久 ACK 与同一幂等命令的精确重放。
pub enum AgentAuthAcknowledgementResult {
    Acknowledged,
    AlreadyAcknowledged,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
/// Owner/current Agent grant 的封闭生命周期状态。
enum AgentGrantState {
    Active,
    Expired,
    Revoked,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
/// Agent grant 撤销主体的封闭类型。
enum AgentGrantRevocationActorKind {
    Administrator,
    Agent,
    Owner,
    System,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
/// Agent grant 撤销原因的封闭类型。
enum AgentGrantRevocationReason {
    AdministratorRevoked,
    AgentDeliveryExpired,
    AgentSelfRevoked,
    OwnerRevoked,
    SystemRevoked,
    UserInvalidated,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
/// Current Agent token 的无 secret 投影。
struct CurrentAgentGrant {
    token_id: String,
    client_instance_id: String,
    client_type: AgentClientType,
    scopes: Vec<String>,
    state: AgentGrantState,
    expires_at: String,
    created_at: String,
    updated_at: String,
    revoked_at: Option<String>,
    revocation_actor_kind: Option<AgentGrantRevocationActorKind>,
    revocation_reason: Option<AgentGrantRevocationReason>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
/// Current Agent token 撤销命令的封闭结果。
enum AgentGrantRevocationOutcome {
    AlreadyRevoked,
    Revoked,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
/// Current Agent token 首次或重复撤销的 typed 结果。
struct CurrentAgentGrantRevocation {
    token_id: String,
    outcome: AgentGrantRevocationOutcome,
    revoked_at: String,
    actor_kind: AgentGrantRevocationActorKind,
    reason: AgentGrantRevocationReason,
}

/// Validated Rust HTTP response envelope shared by authenticated and public calls.
struct BackendEnvelope {
    code: i64,
    error_code: Option<String>,
    data: Value,
    message: String,
    raw: Value,
}

/// Decode the exact Rust envelope while keeping optional top-level error_code explicit.
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
    let error_code = match object.get("error_code") {
        None | Some(Value::Null) => None,
        Some(Value::String(error_code))
            if !error_code.is_empty()
                && error_code.trim() == error_code
                && error_code.len() <= MAX_ERROR_CODE_BYTES =>
        {
            Some(error_code.clone())
        }
        Some(_) => {
            return Err(CliError::api(
                "invalid backend response envelope: error_code must be a non-empty bounded string",
                Some("BACKEND_PROTOCOL_ERROR".to_string()),
                Some(redacted_detail(value.clone())),
            ));
        }
    };
    let data = object.get("data").cloned().ok_or_else(|| {
        CliError::api(
            "invalid backend response envelope: data field is required",
            None,
            Some(redacted_detail(value.clone())),
        )
    })?;
    Ok(BackendEnvelope {
        code,
        error_code,
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

/// Require the sole machine-readable code on a non-success HTTP response.
fn required_error_code(envelope: &BackendEnvelope) -> CliResult<String> {
    envelope.error_code.clone().ok_or_else(|| {
        CliError::api(
            "invalid backend error envelope: top-level error_code is required",
            Some("BACKEND_PROTOCOL_ERROR".to_string()),
            Some(redacted_detail(envelope.raw.clone())),
        )
    })
}

/// Identify the closed authentication failures that use the CLI authentication exit class.
fn is_auth_error_code(error_code: &str) -> bool {
    matches!(
        error_code,
        "AUTH_AGENT_INVALID"
            | "PERMISSION_DENIED"
            | "AGENT_INSTANCE_MISMATCH"
            | "MISSING_AGENT_SCOPE"
    )
}

/// Convert one non-success HTTP envelope using error_code as the only semantic branch.
fn backend_failure(envelope: BackendEnvelope) -> CliError {
    let error_code = match required_error_code(&envelope) {
        Ok(error_code) => error_code,
        Err(error) => return error,
    };
    let message = envelope.message.clone();
    let detail = Some(redacted_detail(envelope.raw));
    if is_auth_error_code(&error_code) {
        return CliError::backend_auth(message, error_code, detail);
    }
    CliError::api(message, Some(error_code), detail)
}

/// Enforce the success-only half of the envelope contract.
fn success_data(envelope: BackendEnvelope) -> CliResult<Value> {
    if envelope.code != 0 || envelope.error_code.is_some() {
        return Err(CliError::api(
            "invalid backend success envelope",
            Some("BACKEND_PROTOCOL_ERROR".to_string()),
            Some(redacted_detail(envelope.raw)),
        ));
    }
    Ok(envelope.data)
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

    /// Run an authenticated DELETE request without a request body.
    pub fn delete(&self, path: &str) -> CliResult<Value> {
        self.request("DELETE", path, None)
    }

    /// 读取并严格验证 canonical current Agent grant。
    pub fn current_agent_grant(&self) -> CliResult<Value> {
        strict_contract_value::<CurrentAgentGrant>(
            self.get("/api/v1/agent/auth/tokens/current")?,
            "current Agent grant",
        )
    }

    /// 撤销 current Agent grant 并验证 revoked/already_revoked 结果。
    pub fn revoke_current_agent_grant(&self) -> CliResult<Value> {
        strict_contract_value::<CurrentAgentGrantRevocation>(
            self.delete("/api/v1/agent/auth/tokens/current")?,
            "current Agent grant revocation",
        )
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
            return Err(backend_failure(envelope));
        }
        success_data(envelope)
    }
}

/// 将后端 data 按 deny_unknown_fields DTO 验证后重新转为输出 JSON。
fn strict_contract_value<T>(value: Value, label: &str) -> CliResult<Value>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let decoded = serde_json::from_value::<T>(value).map_err(|error| {
        CliError::api(
            format!("invalid {label} response: {error}"),
            Some("BACKEND_PROTOCOL_ERROR".to_string()),
            None,
        )
    })?;
    serde_json::to_value(decoded)
        .map_err(|error| CliError::internal(format!("failed to encode {label}: {error}")))
}

/// Create a public authorization session before an Agent token exists.
pub fn create_auth_session(
    base_url: &str,
    scopes: &[String],
    client_instance_id: &str,
    client_display_name: &str,
    client_type: &str,
    request_id: &str,
) -> CliResult<AuthSessionCreated> {
    let body = json!({
        "scopes": scopes,
        "client_instance_id": client_instance_id,
        "client_display_name": client_display_name,
        "client_type": client_type
    });
    public_request(
        base_url,
        "POST",
        "/api/v1/agent/auth/sessions",
        Some(body),
        Some(request_id),
    )
}

/// Poll the exact authorization-session state with its path identity and device-only secret.
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
        None,
    )
}

/// Acknowledge a locally saved token so the backend atomically removes retryable plaintext.
pub fn acknowledge_auth_session(
    base_url: &str,
    session_id: &str,
    device_code: &str,
    expected_revision: u64,
    request_id: &str,
) -> CliResult<AuthSessionAcknowledged> {
    validate_path_identifier(session_id, "session_id", 128)?;
    public_request(
        base_url,
        "POST",
        &format!("/api/v1/agent/auth/sessions/{session_id}/ack"),
        Some(json!({
            "device_code": device_code,
            "expected_revision": expected_revision
        })),
        Some(request_id),
    )
}

fn public_request<T: for<'de> Deserialize<'de>>(
    base_url: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
    request_id: Option<&str>,
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
    let builder = if let Some(request_id) = request_id {
        let request_id = Uuid::parse_str(request_id)
            .map_err(|_| CliError::validation("auth command request id must be a UUID"))?
            .to_string();
        builder.header("Idempotency-Key", request_id)
    } else {
        builder
    };
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
        return Err(backend_failure(envelope));
    }
    serde_json::from_value(success_data(envelope)?)
        .map_err(|err| CliError::api(format!("invalid auth session response: {err}"), None, None))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{decode_backend_envelope, required_error_code, success_data, validate_api_path};

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

    /// Ensures only the top-level error_code is accepted as the backend error contract.
    #[test]
    fn reads_only_top_level_error_code() {
        let envelope = decode_backend_envelope(json!({
            "code": 4290,
            "error_code": "REQUIREMENT_COPY_LIMIT_EXCEEDED",
            "message": "quota exceeded",
            "data": {"code": "LEGACY_CODE"}
        }))
        .expect("canonical envelope");
        assert_eq!(
            required_error_code(&envelope).expect("top-level error code"),
            "REQUIREMENT_COPY_LIMIT_EXCEEDED"
        );
    }

    /// Ensures numeric code, message, and data.code cannot act as compatibility fallbacks.
    #[test]
    fn rejects_legacy_error_code_fallbacks() {
        let envelope = decode_backend_envelope(json!({
            "code": 4010,
            "message": "AUTH_SESSION_REVOKED",
            "data": {"code": "AUTH_SESSION_REVOKED"}
        }))
        .expect("shape remains decodable");

        let error = required_error_code(&envelope).expect_err("error_code must be required");
        assert_eq!(error.code.as_deref(), Some("BACKEND_PROTOCOL_ERROR"));
    }

    /// Ensures 2xx responses cannot smuggle an error code or nonzero numeric code.
    #[test]
    fn rejects_ambiguous_success_envelopes() {
        for envelope in [
            json!({"code": 1, "message": "failure", "data": null}),
            json!({"code": 0, "error_code": "SHOULD_NOT_EXIST", "message": "success", "data": {}}),
        ] {
            let error = success_data(decode_backend_envelope(envelope).expect("envelope"))
                .expect_err("must reject ambiguous success");
            assert_eq!(error.code.as_deref(), Some("BACKEND_PROTOCOL_ERROR"));
        }
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
