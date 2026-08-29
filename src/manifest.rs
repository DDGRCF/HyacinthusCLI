// 改动说明：能力清单只接受当前闭合字段，彻底拒绝旧 deprecated 契约。
use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::output::{CliError, CliResult};
use crate::schema_validate;

/// Capability manifest bundled into the CLI binary at compile time.
const EMBEDDED_MANIFEST: &str = include_str!("../assets/agent-cli-capabilities.yaml");

/// Full capability manifest used by the CLI and backend to agree on Agent operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilityManifest {
    pub version: String,
    pub backend_min_version: String,
    pub capabilities: Vec<Capability>,
}

/// One executable Agent capability and its request/response contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capability {
    pub id: String,
    pub title: String,
    pub description: String,
    pub domain: String,
    pub command: String,
    pub method: String,
    pub path: String,
    pub required_scopes: Vec<String>,
    pub risk_level: String,
    pub supports_dry_run: Value,
    pub supports_idempotency: bool,
    pub supports_pagination: bool,
    pub supports_file_upload: bool,
    pub min_backend_version: String,
    pub introduced_in: String,
    pub request_schema: Value,
    pub response_schema: Value,
    pub examples: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Manifest validation issue associated with either the whole manifest or one capability.
pub struct ManifestIssue {
    pub capability_id: Option<String>,
    pub field: String,
    pub message: String,
}

/// Load the embedded YAML capability manifest.
pub fn load_embedded() -> CliResult<CapabilityManifest> {
    serde_yaml::from_str(EMBEDDED_MANIFEST)
        .map_err(|err| CliError::internal(format!("invalid embedded manifest: {err}")))
}

/// Look up one embedded capability by ID.
pub fn find_capability(id: &str) -> CliResult<Capability> {
    let manifest = load_embedded()?;
    manifest
        .capabilities
        .into_iter()
        .find(|capability| capability.id == id)
        .ok_or_else(|| CliError::validation(format!("unknown capability: {id}")))
}

/// Rejects capabilities whose executable contract is not current and valid.
pub fn ensure_supported(capability: &Capability) -> CliResult<()> {
    ensure_valid_capability(capability)
}

/// Reject a malformed capability before its method, path, scopes, or schemas are executed.
pub fn ensure_valid_capability(capability: &Capability) -> CliResult<()> {
    let mut issues = Vec::new();
    validate_capability(capability, &mut BTreeSet::new(), &mut issues);
    if issues.is_empty() {
        return Ok(());
    }
    let detail = serde_json::to_value(&issues)
        .map_err(|err| CliError::internal(format!("failed to serialize manifest issues: {err}")))?;
    Err(CliError::validation_with_detail(
        format!("invalid capability contract: {}", capability.id),
        detail,
    ))
}

/// Reject an invalid remote manifest before comparison or execution uses its contents.
pub fn ensure_valid_manifest(manifest: &CapabilityManifest) -> CliResult<()> {
    let issues = validate_manifest(manifest);
    if issues.is_empty() {
        return Ok(());
    }
    let detail = serde_json::to_value(&issues)
        .map_err(|err| CliError::internal(format!("failed to serialize manifest issues: {err}")))?;
    Err(CliError::validation_with_detail(
        "invalid capability manifest",
        detail,
    ))
}

/// Validate a capability ID before it is interpolated into an API path.
pub fn validate_capability_id(id: &str) -> CliResult<()> {
    if valid_capability_id(id) {
        return Ok(());
    }
    Err(CliError::validation(
        "capability ID must contain 1-96 lowercase letters, digits, dots, hyphens, or underscores",
    ))
}

/// Validate top-level and per-capability manifest invariants.
pub fn validate_manifest(manifest: &CapabilityManifest) -> Vec<ManifestIssue> {
    let mut issues = Vec::new();
    if manifest.version.trim().is_empty() {
        issues.push(manifest_issue(None, "version", "version is required"));
    }
    if manifest.backend_min_version.trim().is_empty() {
        issues.push(manifest_issue(
            None,
            "backend_min_version",
            "backend_min_version is required",
        ));
    } else if parse_version(&manifest.backend_min_version).is_none() {
        issues.push(manifest_issue(
            None,
            "backend_min_version",
            "backend_min_version must be a dotted numeric version",
        ));
    }
    if manifest.capabilities.is_empty() {
        issues.push(manifest_issue(
            None,
            "capabilities",
            "at least one capability is required",
        ));
    }

    let mut ids = BTreeSet::new();
    for capability in &manifest.capabilities {
        validate_capability(capability, &mut ids, &mut issues);
    }
    issues
}

fn validate_capability(
    capability: &Capability,
    ids: &mut BTreeSet<String>,
    issues: &mut Vec<ManifestIssue>,
) {
    // Keep manifest defects explicit so frontend, backend, and CLI contract drift is visible.
    let id = Some(capability.id.clone());
    if !valid_capability_id(&capability.id) {
        issues.push(manifest_issue(
            id.clone(),
            "id",
            "id must contain 1-96 lowercase letters, digits, dots, hyphens, or underscores",
        ));
    } else if !ids.insert(capability.id.clone()) {
        issues.push(manifest_issue(id.clone(), "id", "id must be unique"));
    }
    for (field, value) in [
        ("title", capability.title.as_str()),
        ("description", capability.description.as_str()),
        ("domain", capability.domain.as_str()),
        ("command", capability.command.as_str()),
        ("path", capability.path.as_str()),
        (
            "min_backend_version",
            capability.min_backend_version.as_str(),
        ),
        ("introduced_in", capability.introduced_in.as_str()),
    ] {
        if value.trim().is_empty() {
            issues.push(manifest_issue(
                id.clone(),
                field,
                format!("{field} is required"),
            ));
        }
    }
    for (field, value) in [
        (
            "min_backend_version",
            capability.min_backend_version.as_str(),
        ),
        ("introduced_in", capability.introduced_in.as_str()),
    ] {
        if !value.trim().is_empty() && parse_version(value).is_none() {
            issues.push(manifest_issue(
                id.clone(),
                field,
                format!("{field} must be a dotted numeric version"),
            ));
        }
    }
    if !["GET", "POST", "PUT"].contains(&capability.method.as_str()) {
        issues.push(manifest_issue(
            id.clone(),
            "method",
            "method must be GET, POST, or PUT",
        ));
    }
    if crate::client::validate_api_path(&capability.path, "/api/v1/agent/").is_err() {
        issues.push(manifest_issue(
            id.clone(),
            "path",
            "path must be a safe relative path under /api/v1/agent/",
        ));
    }
    if !["read", "write", "high-risk-write", "admin-maintenance"]
        .contains(&capability.risk_level.as_str())
    {
        issues.push(manifest_issue(
            id.clone(),
            "risk_level",
            "risk_level is not supported",
        ));
    }
    if capability.required_scopes.is_empty() {
        issues.push(manifest_issue(
            id.clone(),
            "required_scopes",
            "at least one required scope is expected",
        ));
    }
    let mut scopes = BTreeSet::new();
    for scope in &capability.required_scopes {
        if scope.trim() != scope
            || !scope.contains(':')
            || scope.chars().any(char::is_control)
            || !scopes.insert(scope)
        {
            issues.push(manifest_issue(
                id.clone(),
                "required_scopes",
                format!("scope `{scope}` must be unique, trimmed, and include a domain prefix"),
            ));
        }
    }
    if capability
        .request_schema
        .get("type")
        .and_then(Value::as_str)
        != Some("object")
    {
        issues.push(manifest_issue(
            id.clone(),
            "request_schema",
            "request_schema.type must be object",
        ));
    }
    for error in schema_validate::validate_schema_definition(&capability.request_schema) {
        issues.push(manifest_issue(id.clone(), "request_schema", error));
    }
    let response_type = capability
        .response_schema
        .get("type")
        .and_then(Value::as_str);
    if !matches!(response_type, Some("object" | "array")) {
        issues.push(manifest_issue(
            id,
            "response_schema",
            "response_schema.type must be object or array",
        ));
    }
    for error in schema_validate::validate_schema_definition(&capability.response_schema) {
        issues.push(manifest_issue(
            Some(capability.id.clone()),
            "response_schema",
            error,
        ));
    }
}

/// Return whether an ID is safe for manifest lookup and one URL path segment.
fn valid_capability_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && !id.starts_with('.')
        && !id.ends_with('.')
        && !id.contains("..")
        && id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'_')
        })
}

fn manifest_issue(
    capability_id: Option<String>,
    field: impl Into<String>,
    message: impl Into<String>,
) -> ManifestIssue {
    // Centralize issue construction so validation output stays stable.
    ManifestIssue {
        capability_id,
        field: field.into(),
        message: message.into(),
    }
}

/// Parse dotted numeric semantic-version-like strings.
fn parse_version(value: &str) -> Option<Vec<u64>> {
    value
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{load_embedded, validate_capability_id, CapabilityManifest};

    /// Rejects capability identifiers that could escape the Agent path namespace.
    #[test]
    fn rejects_capability_ids_that_can_change_a_request_path() {
        assert!(validate_capability_id("requirements.batch_parse").is_ok());
        assert!(validate_capability_id("../admin").is_err());
        assert!(validate_capability_id("requirements%2fadmin").is_err());
    }

    /// Rejects the removed deprecated-capability marker at the manifest boundary.
    #[test]
    fn rejects_removed_deprecated_capability_field() {
        let manifest = load_embedded().expect("embedded manifest parses");
        let mut value = serde_json::to_value(manifest).expect("manifest serializes");
        value["capabilities"][0]["deprecated"] = serde_json::json!(false);
        assert!(serde_json::from_value::<CapabilityManifest>(value).is_err());
    }
}
