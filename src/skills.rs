// 改动说明：内置 Agent skill 导出与校验逻辑补充职责注释。
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::output::{CliError, CliResult};

/// Shared skill content embedded into the binary.
const SHARED_SKILL: &str = include_str!("../skills/hyacinthus-shared/SKILL.md");
/// Requirement workflow skill content embedded into the binary.
const REQUIREMENTS_SKILL: &str = include_str!("../skills/hyacinthus-requirements/SKILL.md");
/// Agent runtime authorization skill content embedded into the binary.
const AGENT_RUNTIME_SKILL: &str = include_str!("../skills/hyacinthus-agent-runtime/SKILL.md");

#[derive(Debug, Clone, Serialize)]
/// Bundled skill metadata and optional markdown content.
pub struct Skill {
    pub name: &'static str,
    pub description: &'static str,
    pub path: &'static str,
    pub version: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
/// Summary returned after exporting bundled skills to disk.
pub struct SkillExportSummary {
    pub dir: String,
    pub version: &'static str,
    pub exported: Vec<SkillExportItem>,
    pub manifest_path: String,
}

#[derive(Debug, Clone, Serialize)]
/// One exported skill file entry.
pub struct SkillExportItem {
    pub name: &'static str,
    pub path: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
/// Summary returned after checking an installed skill directory.
pub struct SkillCheckSummary {
    pub dir: String,
    pub expected_version: &'static str,
    pub ok: bool,
    pub skills: Vec<SkillCheckItem>,
}

#[derive(Debug, Clone, Serialize)]
/// Status for one skill file or the generated skills manifest.
pub struct SkillCheckItem {
    pub name: &'static str,
    pub path: String,
    pub status: &'static str,
    pub message: String,
}

/// List bundled skills without including their full markdown content.
pub fn list() -> Vec<Skill> {
    vec![
        Skill {
            name: "hyacinthus-shared",
            description: "Shared 风信子家教中心 Hyacinthus CLI rules for authentication, output, risk, and capability discovery.",
            path: "skills/hyacinthus-shared/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: None,
        },
        Skill {
            name: "hyacinthus-requirements",
            description: "Requirement parsing and import workflow rules for Agent operators.",
            path: "skills/hyacinthus-requirements/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: None,
        },
        Skill {
            name: "hyacinthus-agent-runtime",
            description: "Agent runtime handoff rules for 风信子家教中心 Hyacinthus CLI link and QR authorization.",
            path: "skills/hyacinthus-agent-runtime/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: None,
        },
    ]
}

/// Export all bundled skills and a version manifest to a target directory.
pub fn export_to(dir: &Path) -> CliResult<SkillExportSummary> {
    fs::create_dir_all(dir).map_err(|err| {
        CliError::validation(format!(
            "failed to create skills directory {}: {err}",
            dir.display()
        ))
    })?;

    let mut exported = Vec::new();
    for skill in full_skills() {
        let skill_dir = dir.join(skill.name);
        fs::create_dir_all(&skill_dir).map_err(|err| {
            CliError::validation(format!(
                "failed to create skill directory {}: {err}",
                skill_dir.display()
            ))
        })?;
        let path = skill_dir.join("SKILL.md");
        let content = skill
            .content
            .ok_or_else(|| CliError::internal(format!("skill content missing: {}", skill.name)))?;
        fs::write(&path, content).map_err(|err| {
            CliError::validation(format!("failed to write skill {}: {err}", path.display()))
        })?;
        exported.push(SkillExportItem {
            name: skill.name,
            path: display_path(&path),
            bytes: content.len(),
        });
    }

    let manifest_path = dir.join(".hyacinthus-skills.json");
    let manifest = serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "skills": exported.iter().map(|item| item.name).collect::<Vec<_>>()
    });
    let text = serde_json::to_string_pretty(&manifest)
        .map_err(|err| CliError::internal(format!("failed to serialize skills manifest: {err}")))?;
    fs::write(&manifest_path, text).map_err(|err| {
        CliError::validation(format!(
            "failed to write skills manifest {}: {err}",
            manifest_path.display()
        ))
    })?;

    Ok(SkillExportSummary {
        dir: display_path(dir),
        version: env!("CARGO_PKG_VERSION"),
        exported,
        manifest_path: display_path(&manifest_path),
    })
}

/// Check whether a target directory contains current bundled skill files.
pub fn check_dir(dir: &Path) -> SkillCheckSummary {
    let mut skills = Vec::new();
    for skill in full_skills() {
        let path = dir.join(skill.name).join("SKILL.md");
        let Some(expected) = skill.content else {
            skills.push(SkillCheckItem {
                name: skill.name,
                path: display_path(&path),
                status: "fail",
                message: "bundled skill content is missing".to_string(),
            });
            continue;
        };
        let (status, message) = check_skill_file(&path, expected);
        skills.push(SkillCheckItem {
            name: skill.name,
            path: display_path(&path),
            status,
            message,
        });
    }
    let manifest_path = dir.join(".hyacinthus-skills.json");
    let (manifest_status, manifest_message) = check_manifest(&manifest_path);
    skills.push(SkillCheckItem {
        name: "manifest",
        path: display_path(&manifest_path),
        status: manifest_status,
        message: manifest_message,
    });
    let ok = skills.iter().all(|item| item.status == "pass");
    SkillCheckSummary {
        dir: display_path(dir),
        expected_version: env!("CARGO_PKG_VERSION"),
        ok,
        skills,
    }
}

/// Return one bundled skill with full markdown content.
pub fn show(name: &str) -> CliResult<Skill> {
    match name {
        "hyacinthus-shared" => Ok(Skill {
            name: "hyacinthus-shared",
            description: "Shared 风信子家教中心 Hyacinthus CLI rules for authentication, output, risk, and capability discovery.",
            path: "skills/hyacinthus-shared/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: Some(SHARED_SKILL),
        }),
        "hyacinthus-requirements" => Ok(Skill {
            name: "hyacinthus-requirements",
            description: "Requirement parsing and import workflow rules for Agent operators.",
            path: "skills/hyacinthus-requirements/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: Some(REQUIREMENTS_SKILL),
        }),
        "hyacinthus-agent-runtime" => Ok(Skill {
            name: "hyacinthus-agent-runtime",
            description: "Agent runtime handoff rules for 风信子家教中心 Hyacinthus CLI link and QR authorization.",
            path: "skills/hyacinthus-agent-runtime/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: Some(AGENT_RUNTIME_SKILL),
        }),
        _ => Err(CliError::validation(format!("unknown skill: {name}"))),
    }
}

/// Return all bundled skills with content included.
fn full_skills() -> Vec<Skill> {
    vec![
        Skill {
            name: "hyacinthus-shared",
            description: "Shared 风信子家教中心 Hyacinthus CLI rules for authentication, output, risk, and capability discovery.",
            path: "skills/hyacinthus-shared/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: Some(SHARED_SKILL),
        },
        Skill {
            name: "hyacinthus-requirements",
            description: "Requirement parsing and import workflow rules for Agent operators.",
            path: "skills/hyacinthus-requirements/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: Some(REQUIREMENTS_SKILL),
        },
        Skill {
            name: "hyacinthus-agent-runtime",
            description: "Agent runtime handoff rules for 风信子家教中心 Hyacinthus CLI link and QR authorization.",
            path: "skills/hyacinthus-agent-runtime/SKILL.md",
            version: env!("CARGO_PKG_VERSION"),
            content: Some(AGENT_RUNTIME_SKILL),
        },
    ]
}

/// Compare one installed skill file with the embedded version.
fn check_skill_file(path: &Path, expected: &str) -> (&'static str, String) {
    match fs::read_to_string(path) {
        Ok(content) if content == expected => ("pass", "current".to_string()),
        Ok(_) => ("fail", "content differs from bundled skill".to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            ("fail", "skill file is missing".to_string())
        }
        Err(err) => ("fail", format!("failed to read skill file: {err}")),
    }
}

/// Validate the exported skills manifest version and included skill names.
fn check_manifest(path: &Path) -> (&'static str, String) {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return ("fail", "skills manifest is missing".to_string());
        }
        Err(err) => return ("fail", format!("failed to read skills manifest: {err}")),
    };
    let value = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(value) => value,
        Err(err) => return ("fail", format!("invalid skills manifest JSON: {err}")),
    };
    if value.get("version").and_then(serde_json::Value::as_str) != Some(env!("CARGO_PKG_VERSION")) {
        return ("fail", "skills manifest version is stale".to_string());
    }
    let Some(skills) = value.get("skills").and_then(serde_json::Value::as_array) else {
        return (
            "fail",
            "skills manifest must include skills array".to_string(),
        );
    };
    for skill in full_skills() {
        if !skills.iter().any(|item| item.as_str() == Some(skill.name)) {
            return ("fail", format!("skills manifest is missing {}", skill.name));
        }
    }
    ("pass", "current".to_string())
}

/// Convert paths to displayable strings for JSON output.
fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
