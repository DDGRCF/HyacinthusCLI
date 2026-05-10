use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::cli::PaginationArgs;
use crate::client::ApiClient;
use crate::output::{CliError, CliResult};
use crate::query;

#[derive(Debug, Clone, Serialize)]
pub struct PageCollection {
    pub pages: Vec<Value>,
    pub page_count: usize,
    pub next_page_token: Option<String>,
    pub stopped_by_limit: bool,
}

pub fn get_all(
    client: &ApiClient,
    path: &str,
    params: Option<Value>,
    args: &PaginationArgs,
) -> CliResult<Value> {
    if !args.page_all {
        let path = query::append_json_params(path, params.as_ref())?;
        return client.get(&path);
    }
    if args.page_limit == 0 {
        return Err(CliError::validation("--page-limit must be greater than 0"));
    }

    let mut pages = Vec::new();
    let mut next_page_token = None;
    let mut stopped_by_limit = false;

    loop {
        let request_params =
            page_params(params.clone(), args.page_size, next_page_token.as_deref())?;
        let request_path = query::append_json_params(path, Some(&request_params))?;
        let page = client.get(&request_path)?;
        next_page_token = extract_next_page_token(&page)?;
        let has_more = page
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        pages.push(page);

        if !has_more || next_page_token.is_none() {
            break;
        }
        if pages.len() as u64 >= args.page_limit {
            stopped_by_limit = true;
            break;
        }
        if args.page_delay > 0 {
            thread::sleep(Duration::from_millis(args.page_delay));
        }
    }

    serde_json::to_value(PageCollection {
        page_count: pages.len(),
        pages,
        next_page_token,
        stopped_by_limit,
    })
    .map_err(|err| CliError::internal(format!("failed to serialize paginated output: {err}")))
}

pub fn dry_run(path: &str, params: Option<Value>, args: &PaginationArgs) -> CliResult<Value> {
    let request_params = page_params(params, args.page_size, None)?;
    let request_path = query::append_json_params(path, Some(&request_params))?;
    Ok(json!({
        "page_all": args.page_all,
        "page_limit": args.page_limit,
        "page_delay_ms": args.page_delay,
        "request_path": request_path
    }))
}

fn page_params(
    params: Option<Value>,
    page_size: Option<u64>,
    page_token: Option<&str>,
) -> CliResult<Value> {
    let mut value = params.unwrap_or_else(|| json!({}));
    let object = value
        .as_object_mut()
        .ok_or_else(|| CliError::validation("--params must be a JSON object"))?;
    if let Some(page_size) = page_size {
        object.insert("page_size".to_string(), json!(page_size));
    }
    if let Some(page_token) = page_token {
        object.insert("page_token".to_string(), json!(page_token));
    }
    Ok(value)
}

fn extract_next_page_token(page: &Value) -> CliResult<Option<String>> {
    match page.get("next_page_token") {
        Some(Value::String(value)) if !value.is_empty() => Ok(Some(value.clone())),
        Some(Value::String(_)) | None => Ok(None),
        Some(_) => Err(CliError::api(
            "next_page_token must be a string when present",
            Some("INVALID_PAGINATION_TOKEN".to_string()),
            Some(page.clone()),
        )),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::dry_run;
    use crate::cli::PaginationArgs;

    #[test]
    fn dry_run_adds_page_size() {
        let value = dry_run(
            "/api",
            Some(json!({"q": "math"})),
            &PaginationArgs {
                page_all: true,
                page_size: Some(50),
                page_limit: 3,
                page_delay: 0,
            },
        )
        .unwrap();
        assert_eq!(value["request_path"], "/api?page_size=50&q=math");
    }
}
