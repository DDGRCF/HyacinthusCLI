use serde_json::Value;

use crate::output::{CliError, CliResult};

pub fn append_json_params(path: &str, params: Option<&Value>) -> CliResult<String> {
    let Some(params) = params else {
        return Ok(path.to_string());
    };
    let object = params
        .as_object()
        .ok_or_else(|| CliError::validation("--params must be a JSON object"))?;
    if object.is_empty() {
        return Ok(path.to_string());
    }
    let mut pairs = Vec::with_capacity(object.len());
    for (key, value) in object {
        if value.is_null() {
            continue;
        }
        match value {
            Value::String(text) => pairs.push(format!("{}={}", encode(key), encode(text))),
            Value::Bool(value) => pairs.push(format!("{}={}", encode(key), value)),
            Value::Number(value) => pairs.push(format!("{}={}", encode(key), value)),
            Value::Array(values) => {
                for item in values {
                    pairs.push(format!("{}={}", encode(key), encode(&query_value(item)?)));
                }
            }
            Value::Object(_) | Value::Null => {
                return Err(CliError::validation(format!(
                    "--params value for `{key}` must be scalar or array"
                )))
            }
        }
    }
    if pairs.is_empty() {
        return Ok(path.to_string());
    }
    let separator = if path.contains('?') { "&" } else { "?" };
    Ok(format!("{path}{separator}{}", pairs.join("&")))
}

fn query_value(value: &Value) -> CliResult<String> {
    match value {
        Value::String(text) => Ok(text.clone()),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => Err(CliError::validation(
            "--params arrays may only contain scalar values",
        )),
    }
}

fn encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => {
                let encoded = format!("%{byte:02X}");
                encoded.chars().collect::<Vec<_>>()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::append_json_params;

    #[test]
    fn appends_scalar_params() {
        let path = append_json_params("/api", Some(&json!({"q":"高一 数学","limit":2}))).unwrap();
        assert_eq!(
            path,
            "/api?limit=2&q=%E9%AB%98%E4%B8%80%20%E6%95%B0%E5%AD%A6"
        );
    }

    #[test]
    fn appends_repeated_array_params() {
        let path = append_json_params("/api?existing=1", Some(&json!({"id":[1,2]}))).unwrap();
        assert_eq!(path, "/api?existing=1&id=1&id=2");
    }
}
