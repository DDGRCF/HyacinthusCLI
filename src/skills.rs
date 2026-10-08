// 改动说明：内嵌统一 CLI 入口与逐层引用，元信息读取自正文，导出和检查覆盖全部文件并清理已登记的退役入口。
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config;
use crate::output::{CliError, CliResult};

/// One trusted, version-bound file embedded in the binary.
struct SkillFile {
    name: &'static str,
    path: &'static str,
    content: &'static str,
}

/// Published skills and their reference files; only SKILL.md files are discovery entries.
const FILES: &[SkillFile] = &[
    SkillFile {
        name: "hyacinthus-cli",
        path: "SKILL.md",
        content: include_str!("../skills/hyacinthus-cli/SKILL.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/auth.md",
        content: include_str!("../skills/hyacinthus-cli/references/auth.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/batch-and-geo.md",
        content: include_str!("../skills/hyacinthus-cli/references/batch-and-geo.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/capability-map.md",
        content: include_str!("../skills/hyacinthus-cli/references/capability-map.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/catalog.md",
        content: include_str!("../skills/hyacinthus-cli/references/catalog.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/output-risk.md",
        content: include_str!("../skills/hyacinthus-cli/references/output-risk.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/priority-rules.md",
        content: include_str!("../skills/hyacinthus-cli/references/priority-rules.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/requirements-format.md",
        content: include_str!("../skills/hyacinthus-cli/references/requirements-format.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/requirements-import.md",
        content: include_str!("../skills/hyacinthus-cli/references/requirements-import.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/requirements-query.md",
        content: include_str!("../skills/hyacinthus-cli/references/requirements-query.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/shared.md",
        content: include_str!("../skills/hyacinthus-cli/references/shared.md"),
    },
    SkillFile {
        name: "hyacinthus-cli",
        path: "references/user-admin.md",
        content: include_str!("../skills/hyacinthus-cli/references/user-admin.md"),
    },
    SkillFile {
        name: "tutoring-job-mail-upload",
        path: "SKILL.md",
        content: include_str!("../skills/tutoring-job-mail-upload/SKILL.md"),
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Discovery information parsed from the skill's own YAML frontmatter.
pub struct Skill {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub metadata: Value,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Serialize)]
/// One directory entry whose path can be passed directly to skills read.
pub struct SkillEntry {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize)]
/// A single embedded Markdown file returned by JSON reads.
pub struct SkillRead {
    pub name: &'static str,
    pub path: &'static str,
    pub content: &'static str,
}

#[derive(Debug, Serialize)]
/// Summary returned after exporting and reconciling the owned skill files.
pub struct SkillExportSummary {
    pub dir: String,
    pub version: &'static str,
    pub exported: Vec<SkillExportItem>,
    pub removed: Vec<String>,
    pub manifest_path: String,
}

#[derive(Debug, Serialize)]
/// One exported discovery entry, with the count of all included files.
pub struct SkillExportItem {
    pub name: String,
    pub path: String,
    pub bytes: usize,
    pub files: usize,
}

#[derive(Debug, Serialize)]
/// Result of comparing the installed tree with every embedded file.
pub struct SkillCheckSummary {
    pub dir: String,
    pub expected_version: &'static str,
    pub ok: bool,
    pub skills: Vec<SkillCheckItem>,
}

#[derive(Debug, Serialize)]
/// Check result for one embedded file or the ownership manifest.
pub struct SkillCheckItem {
    pub name: String,
    pub path: String,
    pub status: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
/// Ownership information used to reconcile only CLI-installed files.
struct InstalledManifest {
    version: String,
    skills: Vec<String>,
    #[serde(default)]
    files: Vec<String>,
}

/// Read entry metadata from the authoritative Markdown frontmatter.
fn describe(file: &SkillFile) -> CliResult<Skill> {
    let frontmatter = file
        .content
        .strip_prefix("---\n")
        .and_then(|text| text.split_once("\n---\n").map(|(yaml, _)| yaml))
        .ok_or_else(|| CliError::internal(format!("missing skill frontmatter: {}", file.name)))?;
    let mut skill: Skill = serde_yaml::from_str(frontmatter)
        .map_err(|err| CliError::internal(format!("invalid skill frontmatter: {err}")))?;
    if skill.name != file.name || skill.description.trim().is_empty() {
        return Err(CliError::internal(format!(
            "invalid discovery metadata: {}",
            file.name
        )));
    }
    skill.version = env!("CARGO_PKG_VERSION").to_string();
    skill.path = format!("skills/{}/SKILL.md", file.name);
    Ok(skill)
}

/// List just the discoverable roots without reading config, auth or the network.
pub fn list() -> CliResult<Vec<Skill>> {
    FILES
        .iter()
        .filter(|file| file.path == "SKILL.md")
        .map(describe)
        .collect()
}

/// Reject ambiguous or escaping paths before consulting the embedded file table.
fn validate_path(value: &str) -> CliResult<()> {
    if value.is_empty()
        || value.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        return Err(CliError::validation(
            "skill paths must be relative, without empty, '.' or '..' components",
        ));
    }
    Ok(())
}

/// Resolve name/path or name plus path against the actual discovery roots.
fn target<'a>(value: &'a str, path: Option<&'a str>) -> CliResult<(&'a str, &'a str)> {
    let (name, inline) = value.split_once('/').unwrap_or((value, ""));
    validate_path(name)?;
    if !FILES
        .iter()
        .any(|file| file.name == name && file.path == "SKILL.md")
    {
        return Err(CliError::validation(format!(
            "unknown skill: {name}; run hyacinthus skills list"
        )));
    }
    if path.is_some() && !inline.is_empty() {
        return Err(CliError::validation(
            "use name/path or name plus path, not both",
        ));
    }
    let relative = path.unwrap_or(inline);
    if !relative.is_empty() {
        validate_path(relative)?;
    }
    if path == Some("") || value.ends_with('/') {
        return Err(CliError::validation(
            "skill file or directory path cannot be empty",
        ));
    }
    Ok((name, relative))
}

/// Read one embedded entry or reference with no filesystem fallback.
pub fn read(value: &str, path: Option<&str>) -> CliResult<SkillRead> {
    let (name, relative) = target(value, path)?;
    let relative = if relative.is_empty() {
        "SKILL.md"
    } else {
        relative
    };
    let file = FILES
        .iter()
        .find(|file| file.name == name && file.path == relative)
        .ok_or_else(|| {
            CliError::validation(format!(
                "unknown skill file: {name}/{relative}; run hyacinthus skills list {name}"
            ))
        })?;
    Ok(SkillRead {
        name: file.name,
        path: file.path,
        content: file.content,
    })
}

/// List a single embedded directory layer, including reference directories.
pub fn list_path(value: &str) -> CliResult<Vec<SkillEntry>> {
    let (name, relative) = target(value, None)?;
    let prefix = if relative.is_empty() {
        String::new()
    } else {
        format!("{relative}/")
    };
    let mut entries = BTreeMap::new();
    for file in FILES.iter().filter(|file| file.name == name) {
        if let Some(rest) = file.path.strip_prefix(&prefix) {
            let (part, is_dir) = rest
                .split_once('/')
                .map_or((rest, false), |(part, _)| (part, true));
            entries.insert(format!("{name}/{prefix}{part}"), is_dir);
        }
    }
    if entries.is_empty() {
        return Err(CliError::validation(format!(
            "unknown skill directory: {value}"
        )));
    }
    Ok(entries
        .into_iter()
        .map(|(path, is_dir)| SkillEntry { path, is_dir })
        .collect())
}

/// Build the exact current ownership manifest from the embedded files.
fn installed_manifest() -> CliResult<InstalledManifest> {
    Ok(InstalledManifest {
        version: env!("CARGO_PKG_VERSION").to_string(),
        skills: list()?.into_iter().map(|skill| skill.name).collect(),
        files: FILES
            .iter()
            .map(|file| format!("{}/{}", file.name, file.path))
            .collect(),
    })
}

/// Reject symbolic links beneath the destination so exports never overwrite linked resources.
fn ensure_regular_destination(root: &Path, relative: &str) -> CliResult<()> {
    validate_path(relative)?;
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(CliError::validation(format!(
                    "refusing linked skill destination: {}",
                    path.display()
                )))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(CliError::validation(format!(
                    "cannot inspect skill destination: {error}"
                )))
            }
        }
    }
    Ok(())
}

/// Export all files and remove only retired entrypoints previously registered by this installer.
pub fn export_to(dir: &Path) -> CliResult<SkillExportSummary> {
    let manifest = installed_manifest()?;
    let manifest_path = dir.join(".hyacinthus-skills.json");
    let previous = if manifest_path.exists() {
        Some(
            serde_json::from_str::<InstalledManifest>(&config::read_input_file(&manifest_path)?)
                .map_err(|err| {
                    CliError::validation(format!("invalid installed skills manifest: {err}"))
                })?,
        )
    } else {
        None
    };
    let mut retired = Vec::new();
    if let Some(previous) = previous {
        for name in previous.skills {
            validate_path(&name)?;
            if name.contains('/') {
                return Err(CliError::validation("invalid installed skill name"));
            }
            if !manifest.skills.contains(&name) {
                let relative = format!("{name}/SKILL.md");
                ensure_regular_destination(dir, &relative)?;
                retired.push(relative);
            }
        }
    }
    for relative in &manifest.files {
        ensure_regular_destination(dir, relative)?;
    }
    ensure_regular_destination(dir, ".hyacinthus-skills.json")?;
    fs::create_dir_all(dir)
        .map_err(|err| CliError::validation(format!("cannot create skills directory: {err}")))?;
    for file in FILES {
        let path = dir.join(file.name).join(file.path);
        fs::create_dir_all(path.parent().expect("embedded file parent"))
            .and_then(|_| fs::write(&path, file.content))
            .map_err(|err| {
                CliError::validation(format!("cannot export {}: {err}", path.display()))
            })?;
    }
    let mut removed = Vec::new();
    for relative in retired {
        let path = dir.join(&relative);
        if path.exists() {
            fs::remove_file(&path).map_err(|err| {
                CliError::validation(format!("cannot remove retired entry: {err}"))
            })?;
            removed.push(relative);
        }
    }
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|err| {
            CliError::internal(format!("cannot serialize skills manifest: {err}"))
        })?,
    )
    .map_err(|err| CliError::validation(format!("cannot write skills manifest: {err}")))?;
    let exported = list()?
        .into_iter()
        .map(|skill| {
            let files: Vec<_> = FILES
                .iter()
                .filter(|file| file.name == skill.name)
                .collect();
            SkillExportItem {
                path: dir.join(&skill.name).join("SKILL.md").display().to_string(),
                name: skill.name,
                bytes: files.iter().map(|file| file.content.len()).sum(),
                files: files.len(),
            }
        })
        .collect();
    Ok(SkillExportSummary {
        dir: dir.display().to_string(),
        version: env!("CARGO_PKG_VERSION"),
        exported,
        removed,
        manifest_path: manifest_path.display().to_string(),
    })
}

/// Compare every installed reference and exact discovery manifest with the binary.
pub fn check_dir(dir: &Path) -> CliResult<SkillCheckSummary> {
    let manifest = installed_manifest()?;
    let mut skills = Vec::new();
    for file in FILES {
        let relative = format!("{}/{}", file.name, file.path);
        let path = dir.join(&relative);
        let result = ensure_regular_destination(dir, &relative)
            .and_then(|_| config::read_input_file(&path))
            .and_then(|text| {
                if text == file.content {
                    Ok(())
                } else {
                    Err(CliError::validation("content differs from bundled file"))
                }
            });
        skills.push(SkillCheckItem {
            name: file.name.to_string(),
            path: path.display().to_string(),
            status: if result.is_ok() { "pass" } else { "fail" },
            message: result
                .err()
                .map_or("current".to_string(), |err| err.message),
        });
    }
    let manifest_path = dir.join(".hyacinthus-skills.json");
    let result = ensure_regular_destination(dir, ".hyacinthus-skills.json")
        .and_then(|_| config::read_input_file(&manifest_path))
        .and_then(|text| {
            serde_json::from_str::<InstalledManifest>(&text)
                .map_err(|err| CliError::validation(err.to_string()))
        })
        .and_then(|saved| {
            if saved.version == manifest.version
                && saved.skills == manifest.skills
                && saved.files == manifest.files
            {
                Ok(())
            } else {
                Err(CliError::validation(
                    "installed version or file inventory differs from the binary",
                ))
            }
        });
    skills.push(SkillCheckItem {
        name: "manifest".to_string(),
        path: manifest_path.display().to_string(),
        status: if result.is_ok() { "pass" } else { "fail" },
        message: result
            .err()
            .map_or("current".to_string(), |err| err.message),
    });
    Ok(SkillCheckSummary {
        dir: dir.display().to_string(),
        expected_version: env!("CARGO_PKG_VERSION"),
        ok: skills.iter().all(|item| item.status == "pass"),
        skills,
    })
}
