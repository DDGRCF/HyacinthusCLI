use std::time::Duration;

use reqwest::blocking::Client;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::RuntimeContext;
use crate::output::{CliError, CliResult};

#[derive(Debug, Clone)]
pub struct ApiClient {
    client: Client,
    context: RuntimeContext,
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

fn backend_code(value: &Value) -> Option<String> {
    value.get("code").and_then(|code| {
        code.as_str()
            .map(ToOwned::to_owned)
            .or_else(|| code.as_i64().map(|value| value.to_string()))
            .or_else(|| code.as_u64().map(|value| value.to_string()))
    })
}
