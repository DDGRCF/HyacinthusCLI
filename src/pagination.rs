// 改动说明：分页聚合限制页数、体积与延迟，并检测重复游标以避免循环请求和无界内存占用。
use std::collections::BTreeSet;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::cli::PaginationArgs;
use crate::client::ApiClient;
use crate::output::{CliError, CliResult};
use crate::query;

/// Maximum number of pages one CLI invocation may retain in memory.
const MAX_PAGE_LIMIT: u64 = 100;
/// Maximum requested backend page size.
const MAX_PAGE_SIZE: u64 = 1_000;
/// Maximum aggregate serialized page bytes retained for output.
const MAX_COLLECTION_BYTES: usize = 64 * 1024 * 1024;
/// Maximum delay between page requests.
const MAX_PAGE_DELAY_MS: u64 = 60_000;
/// Maximum opaque continuation token length accepted from the backend.
const MAX_PAGE_TOKEN_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, Serialize)]
/// Aggregated result produced when `--page-all` follows continuation tokens.
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
    // Without --page-all, preserve the normal single-request GET behavior.
    if !args.page_all {
        let path = query::append_json_params(path, params.as_ref())?;
        return client.get(&path);
    }
    validate_args(args)?;

    let mut pages = Vec::new();
    let mut next_page_token = None;
    let mut stopped_by_limit = false;
    let mut seen_tokens = BTreeSet::new();
    let mut collection_bytes = 0_usize;

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
        collection_bytes = collection_bytes.saturating_add(
            serde_json::to_vec(&page)
                .map_err(|err| {
                    CliError::internal(format!("failed to measure paginated output: {err}"))
                })?
                .len(),
        );
        if collection_bytes > MAX_COLLECTION_BYTES {
            return Err(CliError::validation(format!(
                "paginated output exceeds the {MAX_COLLECTION_BYTES} byte aggregate limit"
            )));
        }
        pages.push(page);

        if !has_more || next_page_token.is_none() {
            break;
        }
        let Some(token) = next_page_token.as_ref() else {
            break;
        };
        if !seen_tokens.insert(token.clone()) {
            return Err(CliError::api(
                "backend repeated a pagination token",
                Some("PAGINATION_TOKEN_LOOP".to_string()),
                None,
            ));
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

/// Describe the paginated request that would be sent during a dry run.
pub fn dry_run(path: &str, params: Option<Value>, args: &PaginationArgs) -> CliResult<Value> {
    validate_args(args)?;
    let request_params = page_params(params, args.page_size, None)?;
    let request_path = query::append_json_params(path, Some(&request_params))?;
    Ok(json!({
        "page_all": args.page_all,
        "page_limit": args.page_limit,
        "page_delay_ms": args.page_delay,
        "request_path": request_path
    }))
}

/// Validate pagination controls before issuing requests or describing a dry run.
fn validate_args(args: &PaginationArgs) -> CliResult<()> {
    if !(1..=MAX_PAGE_LIMIT).contains(&args.page_limit) {
        return Err(CliError::validation(format!(
            "--page-limit must be between 1 and {MAX_PAGE_LIMIT}"
        )));
    }
    if args
        .page_size
        .is_some_and(|size| !(1..=MAX_PAGE_SIZE).contains(&size))
    {
        return Err(CliError::validation(format!(
            "--page-size must be between 1 and {MAX_PAGE_SIZE}"
        )));
    }
    if args.page_delay > MAX_PAGE_DELAY_MS {
        return Err(CliError::validation(format!(
            "--page-delay must not exceed {MAX_PAGE_DELAY_MS} milliseconds"
        )));
    }
    Ok(())
}

fn page_params(
    params: Option<Value>,
    page_size: Option<u64>,
    page_token: Option<&str>,
) -> CliResult<Value> {
    // Pagination params are merged into existing query params so filters are retained.
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

/// Extract and validate the backend continuation token from one page response.
fn extract_next_page_token(page: &Value) -> CliResult<Option<String>> {
    match page.get("next_page_token") {
        Some(Value::String(value))
            if !value.is_empty()
                && value.len() <= MAX_PAGE_TOKEN_BYTES
                && !value.chars().any(char::is_control) =>
        {
            Ok(Some(value.clone()))
        }
        Some(Value::String(value)) if value.is_empty() => Ok(None),
        Some(Value::String(_)) => Err(CliError::api(
            "next_page_token exceeds the CLI limit or contains control characters",
            Some("INVALID_PAGINATION_TOKEN".to_string()),
            Some(page.clone()),
        )),
        None => Ok(None),
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

    #[test]
    fn dry_run_rejects_resource_exhausting_controls() {
        let error = dry_run(
            "/api",
            None,
            &PaginationArgs {
                page_all: true,
                page_size: Some(1_001),
                page_limit: 101,
                page_delay: 60_001,
            },
        )
        .expect_err("must reject");
        assert_eq!(error.error_type, "validation");
    }
}
