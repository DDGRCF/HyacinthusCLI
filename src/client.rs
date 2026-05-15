// 改动说明：Agent 授权会话客户端升级为实例级授权模型并携带实例头。
use std::time::Duration;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::RuntimeContext;
use crate::output::{CliError, CliResult};

#[derive(Debug, Clone)]
pub struct ApiClient {
    client: Client,
    context: RuntimeContext,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthSessionCreated {
    pub session_id: String,
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

impl ApiClient {
    pub fn new(context: RuntimeContext) -> CliResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|err| CliError::internal(format!("failed to create HTTP client: {err}")))?;
        Ok(Self { client, context })
    }

    pub fn get(&self, path: &str) -> CliResult<Value> {
        self.request("GET", path, None)
    }

    pub fn post(&self, path: &str, body: Value) -> CliResult<Value> {
        self.request("POST", path, Some(body))
    }

    pub fn put(&self, path: &str, body: Value) -> CliResult<Value> {
        self.request("PUT", path, Some(body))
    }

    pub fn raw(&self, method: &str, path: &str, body: Option<Value>) -> CliResult<Value> {
        self.request(method, path, body)
    }

    fn request(&self, method: &str, path: &str, body: Option<Value>) -> CliResult<Value> {
        let token = self
            .context
            .token
            .as_deref()
            .ok_or_else(|| CliError::auth("agent token is not configured"))?;
        let url = format!("{}{}", self.context.base_url, path);
        let request_id = self
            .context
            .request_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let builder = match method {
            "GET" => self.client.get(&url),
            "POST" => self.client.post(&url),
            "PUT" => self.client.put(&url),
            "PATCH" => self.client.patch(&url),
            "DELETE" => self.client.delete(&url),
            _ => {
                return Err(CliError::validation(format!(
                    "unsupported method: {method}"
                )))
            }
        }
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
        let status = response.status();
        let value = response.json::<Value>().map_err(|err| {
            CliError::api(format!("invalid backend JSON response: {err}"), None, None)
        })?;
        if !status.is_success() {
            let code = backend_code(&value);
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("backend request failed")
                .to_string();
            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err(CliError::auth(message));
            }
            return Err(CliError::api(message, code, Some(value)));
        }
        let code = value.get("code").and_then(Value::as_i64).unwrap_or(0);
        if code != 0 {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("backend returned non-zero code")
                .to_string();
            return Err(CliError::api(
                message,
                backend_code(&value).or_else(|| Some(code.to_string())),
                Some(value),
            ));
        }
        Ok(value.get("data").cloned().unwrap_or_else(|| json!(null)))
    }
}

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

pub fn get_auth_session(base_url: &str, session_id: &str) -> CliResult<AuthSessionStatus> {
    public_request(
        base_url,
        "GET",
        &format!("/api/v1/agent/auth/sessions/{session_id}"),
        None,
    )
}

fn public_request<T: for<'de> Deserialize<'de>>(
    base_url: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> CliResult<T> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| CliError::internal(format!("failed to create HTTP client: {err}")))?;
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let builder = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        _ => {
            return Err(CliError::validation(format!(
                "unsupported method: {method}"
            )))
        }
    }
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
    let status = response.status();
    let value = response.json::<Value>().map_err(|err| {
        CliError::api(format!("invalid backend JSON response: {err}"), None, None)
    })?;
    if !status.is_success() {
        let message = value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("backend request failed")
            .to_string();
        return Err(CliError::api(message, backend_code(&value), Some(value)));
    }
    let code = value.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 {
        let message = value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("backend returned non-zero code")
            .to_string();
        return Err(CliError::api(
            message,
            backend_code(&value).or_else(|| Some(code.to_string())),
            Some(value),
        ));
    }
    let data = value.get("data").cloned().unwrap_or_else(|| json!(null));
    serde_json::from_value(data)
        .map_err(|err| CliError::api(format!("invalid auth session response: {err}"), None, None))
}

fn backend_code(value: &Value) -> Option<String> {
    value.get("code").and_then(|code| {
        code.as_str()
            .map(ToOwned::to_owned)
            .or_else(|| code.as_i64().map(|value| value.to_string()))
            .or_else(|| code.as_u64().map(|value| value.to_string()))
    })
}
