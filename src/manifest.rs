// 改动说明：能力 manifest 结构、兼容性检查和校验流程补充职责注释。
use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::output::{CliError, CliResult};
use crate::schema_validate;

/// Capability manifest bundled into the CLI binary at compile time.
const EMBEDDED_MANIFEST: &str = include_str!("../assets/agent-cli-capabilities.yaml");

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Full capability manifest used by the CLI and backend to agree on Agent operations.
pub struct CapabilityManifest {
    pub version: String,
    pub backend_min_version: String,
    pub capabilities: Vec<Capability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// One executable Agent capability and its request/response contract.
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
    pub deprecated: bool,
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

/// Reject deprecated capabilities or capabilities requiring a newer CLI/backend version.
pub fn ensure_supported(capability: &Capability) -> CliResult<()> {
    if capability.deprecated {
        return Err(CliError::validation(format!(
            "capability is deprecated: {}",
            capability.id
        )));
    }
    if version_is_newer(&capability.min_backend_version, env!("CARGO_PKG_VERSION")) {
        return Err(CliError::validation(format!(
            "capability {} requires backend/CLI version {} or newer",
            capability.id, capability.min_backend_version
        )));
    }
    Ok(())
}

/// Build a compact compatibility summary for doctor and manifest verification output.
pub fn compatibility_summary(manifest: &CapabilityManifest) -> Value {
    let unsupported = manifest
        .capabilities
        .iter()
        .filter(|capability| {
            capability.deprecated
                || version_is_newer(&capability.min_backend_version, env!("CARGO_PKG_VERSION"))
        })
        .map(|capability| {
            serde_json::json!({
                "id": capability.id,
                "deprecated": capability.deprecated,
                "min_backend_version": capability.min_backend_version
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "manifest_version": manifest.version,
        "backend_min_version": manifest.backend_min_version,
        "cli_version": env!("CARGO_PKG_VERSION"),
        "ok": unsupported.is_empty(),
        "unsupported_capabilities": unsupported
    })
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
    if capability.id.trim().is_empty() {
        issues.push(manifest_issue(id.clone(), "id", "id is required"));
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
    if !["GET", "POST", "PUT"].contains(&capability.method.as_str()) {
        issues.push(manifest_issue(
            id.clone(),
            "method",
            "method must be GET, POST, or PUT",
        ));
    }
    if !capability.path.starts_with("/api/v1/agent/") {
        issues.push(manifest_issue(
            id.clone(),
            "path",
            "path must start with /api/v1/agent/",
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
    for scope in &capability.required_scopes {
        if !scope.contains(':') {
            issues.push(manifest_issue(
                id.clone(),
                "required_scopes",
                format!("scope `{scope}` must include a domain prefix"),
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

/// Compare dotted numeric versions and treat unparsable versions as not newer.
fn version_is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
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
    use super::version_is_newer;

    #[test]
    fn compares_versions() {
        assert!(version_is_newer("0.2.0", "0.1.9"));
        assert!(!version_is_newer("0.1.0", "0.1.0"));
    }
}
