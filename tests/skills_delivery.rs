// 改动说明：核对随包退出码、邮件缺来源顺序及主Skill能力示例、预览和schema交付。
use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};

/// Execute the installed command surface without credentials or update-network side effects.
fn run(args: &[&str]) -> std::process::Output {
    let config = tempfile::tempdir().unwrap();
    Command::new(env!("CARGO_BIN_EXE_hyacinthus"))
        .arg("--no-notice")
        .args(args)
        .env_clear()
        .env("HYACINTHUS_CLIENT_INSTANCE_ID", "skills-test")
        .env("HYACINTHUS_CLIENT_DISPLAY_NAME", "Skills test")
        .env("HYACINTHUS_CLIENT_TYPE", "hyacinthus-cli")
        .env("HYACINTHUS_CONFIG_DIR", config.path())
        .output()
        .unwrap()
}

/// Decode a successful JSON command for independent contract assertions.
fn data(args: &[&str]) -> Value {
    let output = run(args);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], true);
    value["data"].clone()
}

/// Export the exact binary's complete skill tree to a disposable directory.
fn export(dir: &Path) {
    data(&["skills", "export", "--dir", dir.to_str().unwrap()]);
}

/// The bundled exit-code table must contain exactly the implemented CLI outcomes.
#[test]
fn bundled_exit_code_table_matches_implemented_constants() {
    let reference = String::from_utf8(
        run(&[
            "skills",
            "read",
            "hyacinthus-cli",
            "references/output-risk.md",
        ])
        .stdout,
    )
    .unwrap();
    let documented: std::collections::BTreeSet<i32> = reference
        .lines()
        .filter_map(|line| line.strip_prefix("| "))
        .filter_map(|line| line.split_once('|').map(|(code, _)| code.trim()))
        .flat_map(|codes| codes.split('/'))
        .filter_map(|code| code.trim().parse().ok())
        .collect();
    let mut implemented: std::collections::BTreeSet<i32> = include_str!("../src/output.rs")
        .lines()
        .filter(|line| line.starts_with("pub const EXIT_"))
        .map(|line| {
            line.split_once(" = ")
                .unwrap()
                .1
                .trim_end_matches(';')
                .parse()
                .unwrap()
        })
        .collect();
    implemented.insert(0);
    assert_eq!(documented, implemented);
}

/// Reduced stdout must not prevent the complete parse/import preview from being saved.
#[test]
fn mail_workflow_previews_save_full_data_when_stdout_is_reduced() {
    let dir = tempfile::tempdir().unwrap();
    for (command, args) in [
        ("parse", vec!["--text", "初一数学，线上授课"]),
        (
            "import",
            vec![
                "--data",
                r#"{"confirmed_rows":[{"description":"online review","preferred_mode":"online","ext":{"priority":5,"admin_contact_phone":"13800138000"}}],"idempotency_key":"preview-file"}"#,
            ],
        ),
    ] {
        let preview = dir.path().join(format!("{command}.json"));
        let mut argv = vec!["requirements", command];
        argv.extend(args);
        argv.extend([
            "--dry-run",
            "--output",
            preview.to_str().unwrap(),
            "--jq",
            ".meta",
        ]);
        let output = run(&argv);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let stdout: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(stdout["command"], format!("requirements {command}"));
        assert!(stdout.get("request").is_none());
        let saved: Value = serde_json::from_slice(&fs::read(preview).unwrap()).unwrap();
        assert_eq!(saved["dry_run"], true);
        assert!(saved["request"]["body"].is_object());
        if command == "import" {
            assert_eq!(
                saved["request"]["body"]["confirmed_rows"][0]["ext"]["priority"],
                5
            );
            assert_eq!(
                saved["request"]["body"]["confirmed_rows"][0]["preferred_mode"],
                "online"
            );
        }
    }
}

/// Priority-rule previews save their full request even when stdout only returns metadata.
#[test]
fn priority_rule_preview_saves_full_data_when_stdout_is_reduced() {
    let dir = tempfile::tempdir().unwrap();
    let preview = dir.path().join("rule-preview.json");
    let output = run(&[
        "requirements",
        "priority-rules",
        "add",
        "--pattern",
        "^SOP123\\-",
        "--priority",
        "5",
        "--dry-run",
        "--output",
        preview.to_str().unwrap(),
        "--jq",
        ".meta",
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let stdout: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(stdout["command"], "requirements priority-rules add");
    assert!(stdout.get("request").is_none());
    let saved: Value = serde_json::from_slice(&fs::read(preview).unwrap()).unwrap();
    assert_eq!(saved["dry_run"], true);
    assert_eq!(saved["request"]["body"]["pattern"], "^SOP123\\-");
    assert_eq!(saved["request"]["body"]["priority"], 5);
}

/// Mail uses the general guide as the single source of the ordered twenty-one fields.
#[test]
fn mail_and_general_guides_share_the_current_twenty_one_fields() {
    let labels = [
        "编号",
        "年级",
        "科目",
        "需求方角色",
        "需求方性别",
        "需求方学历",
        "要求的性别",
        "要求的学历",
        "要求的学校",
        "学校的资质",
        "授课方式",
        "要求的资格",
        "薪酬",
        "时间",
        "地址",
        "要求",
        "备注",
        "用户电话",
        "用户微信",
        "管理员电话",
        "管理员微信",
    ];
    let mail =
        String::from_utf8(run(&["skills", "read", "tutoring-job-mail-upload"]).stdout).unwrap();
    assert!(mail
        .contains("没有原文且没有可用邮件工具时，只询问来源并结束本轮；取得来源后再申请 CLI 授权"));
    let field_reference = "../hyacinthus-cli/references/requirements-format.md";
    assert!(mail.contains(field_reference));
    let dir = tempfile::tempdir().unwrap();
    export(dir.path());
    let exported_reference = dir
        .path()
        .join("tutoring-job-mail-upload")
        .join(field_reference);
    assert!(exported_reference.is_file());
    assert!(!mail.contains("16字段"));
    let general = String::from_utf8(
        run(&[
            "skills",
            "read",
            "hyacinthus-cli",
            "references/requirements-format.md",
        ])
        .stdout,
    )
    .unwrap();
    let fields: Vec<&str> = general
        .lines()
        .filter_map(|line| {
            let columns: Vec<&str> = line.split('|').collect();
            columns.get(1)?.trim().parse::<usize>().ok()?;
            Some(columns.get(2)?.trim().trim_matches('`'))
        })
        .collect();
    assert_eq!(fields, labels);
    assert!(general.contains("原文明确线上时填线上/`online`"));
    assert!(general.contains("其他情况（包括未说明）默认填线下/`offline`"));
    assert!(general.contains("未说明授课方式不询问、不阻断上传"));
    assert_eq!(fs::read_to_string(exported_reference).unwrap(), general);
    let example = general
        .split_once("```text\n")
        .unwrap()
        .1
        .split_once("\n```")
        .unwrap()
        .0;
    let example_fields: Vec<&str> = example
        .lines()
        .filter_map(|line| line.split_once('：').map(|(label, _)| label))
        .collect();
    assert_eq!(example_fields, labels);
}

/// Every reference read equals the bytes exported for an Agent's normal loader.
#[test]
fn all_reference_reads_and_exports_match() {
    let dir = tempfile::tempdir().unwrap();
    export(dir.path());
    let roots = data(&["skills", "list"]);
    assert_eq!(roots.as_array().unwrap().len(), 2);
    for root in roots.as_array().unwrap() {
        let name = root["name"].as_str().unwrap();
        let content = fs::read_to_string(dir.path().join(name).join("SKILL.md")).unwrap();
        let frontmatter = content
            .strip_prefix("---\n")
            .unwrap()
            .split_once("\n---\n")
            .unwrap()
            .0;
        let parsed: Value = serde_yaml::from_str(frontmatter).unwrap();
        assert_eq!(root["description"], parsed["description"]);
        assert_eq!(root["metadata"], parsed["metadata"]);
        assert_eq!(run(&["skills", "read", name]).stdout, content.as_bytes());
    }
    let files = data(&["skills", "list", "hyacinthus-cli/references"]);
    for entry in files["entries"].as_array().unwrap() {
        assert_eq!(entry["is_dir"], false);
        let path = entry["path"].as_str().unwrap();
        assert_eq!(
            run(&["skills", "read", path]).stdout,
            fs::read(dir.path().join(path)).unwrap()
        );
    }
    assert_eq!(
        data(&["skills", "check", "--dir", dir.path().to_str().unwrap()])["ok"],
        true
    );
}

/// Discovery documents the backend occupation enum while preview preserves fields for backend judgment.
#[test]
fn import_schema_documents_occupation_without_local_business_validation() {
    let schema = data(&["schema", "requirements.batch_import"]);
    assert_eq!(
        schema["request_schema"]["properties"]["confirmed_rows"]["items"]["properties"]
            ["condition"]["properties"]["required_occupation"]["enum"],
        json!(["part_time_teacher", "full_time_teacher", "any", null])
    );
    let preview = run(&[
        "requirements",
        "import",
        "--data",
        r#"{"confirmed_rows":[{"description":"有家教经验","condition":{"required_occupation":"有家教经验"}}],"idempotency_key":"occupation-review"}"#,
        "--dry-run",
    ]);
    assert_eq!(preview.status.code(), Some(0));
    let value: Value = serde_json::from_slice(&preview.stdout).unwrap();
    assert_eq!(
        value["data"]["request"]["body"]["confirmed_rows"][0]["condition"]["required_occupation"],
        "有家教经验"
    );
    let valid = run(&[
        "requirements",
        "import",
        "--data",
        r#"{"confirmed_rows":[{"description":"有家教经验","condition":{"required_occupation":null}}],"idempotency_key":"occupation-review"}"#,
        "--dry-run",
    ]);
    assert!(
        valid.status.success(),
        "{}",
        String::from_utf8_lossy(&valid.stdout)
    );
}

/// A damaged reference is detected even if the installed SKILL.md entry remains untouched.
#[test]
fn modified_or_missing_references_fail_check() {
    let dir = tempfile::tempdir().unwrap();
    export(dir.path());
    let reference = dir.path().join("hyacinthus-cli/references/auth.md");
    fs::write(&reference, "changed guide").unwrap();
    assert_eq!(
        data(&["skills", "check", "--dir", dir.path().to_str().unwrap()])["ok"],
        false
    );
    fs::remove_file(reference).unwrap();
    assert_eq!(
        data(&["skills", "check", "--dir", dir.path().to_str().unwrap()])["ok"],
        false
    );
}

/// Reconciliation removes only recorded retired entry files and preserves other Skills and custom files.
#[test]
fn export_reconciles_owned_retired_entries() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["hyacinthus-shared", "unrelated"] {
        fs::create_dir_all(dir.path().join(name)).unwrap();
        fs::write(dir.path().join(name).join("SKILL.md"), "old skill").unwrap();
    }
    fs::write(dir.path().join("hyacinthus-shared/custom.md"), "user note").unwrap();
    fs::write(
        dir.path().join(".hyacinthus-skills.json"),
        json!({"version":"0.1.14", "skills":["hyacinthus-shared"]}).to_string(),
    )
    .unwrap();
    export(dir.path());
    assert!(!dir.path().join("hyacinthus-shared/SKILL.md").exists());
    assert!(dir.path().join("hyacinthus-shared/custom.md").exists());
    assert!(dir.path().join("unrelated/SKILL.md").exists());
}

/// Recovery docs can be read when the user's profile cannot even be parsed.
#[test]
fn discovery_works_with_broken_profile() {
    let config = tempfile::tempdir().unwrap();
    fs::write(config.path().join("config.json"), "invalid profile").unwrap();
    for args in [
        vec!["skills", "list"],
        vec![
            "skills",
            "read",
            "hyacinthus-cli/references/auth.md",
            "--json",
        ],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_hyacinthus"))
            .args(args)
            .env_clear()
            .env("HYACINTHUS_CONFIG_DIR", config.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

/// Readers reject escaping and ambiguous paths instead of looking on the host filesystem.
#[test]
fn readers_reject_invalid_paths() {
    for path in [
        "../outside",
        "/etc/passwd",
        "references/../../outside",
        "references\\outside",
        "references//auth.md",
        "references/./auth.md",
        "references/",
    ] {
        assert_eq!(
            run(&["skills", "read", "hyacinthus-cli", path])
                .status
                .code(),
            Some(2),
            "accepted {path}"
        );
    }
    assert_eq!(
        run(&[
            "skills",
            "read",
            "hyacinthus-cli/references/auth.md",
            "references/shared.md"
        ])
        .status
        .code(),
        Some(2)
    );
    assert_eq!(run(&["skills", "read", "unknown"]).status.code(), Some(2));
}

/// Each shipped capability is routed to a maintained guide, including generic-run capabilities.
#[test]
fn navigation_covers_current_capabilities() {
    let manifest = data(&["capability", "list"]);
    let map = data(&[
        "skills",
        "read",
        "hyacinthus-cli/references/capability-map.md",
        "--json",
    ]);
    let text = map["content"].as_str().unwrap();
    for capability in manifest["capabilities"].as_array().unwrap() {
        let id = capability["id"].as_str().unwrap();
        assert!(
            text.contains(&format!("`{id}`")),
            "unrouted capability: {id}"
        );
    }
}

/// A symlinked reference cannot overwrite resources outside the intended skill tree.
#[cfg(unix)]
#[test]
fn export_refuses_linked_references() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("hyacinthus-cli")).unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("hyacinthus-cli/references"))
        .unwrap();
    assert_eq!(
        run(&["skills", "export", "--dir", dir.path().to_str().unwrap()])
            .status
            .code(),
        Some(2)
    );
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

/// An explicit read --json overrides global table formatting so consumers always get the promised envelope.
#[test]
fn explicit_read_json_overrides_table_format() {
    let content = data(&[
        "--format",
        "table",
        "skills",
        "read",
        "hyacinthus-cli",
        "--json",
    ]);
    assert_eq!(content["name"], "hyacinthus-cli");
    assert!(content["content"].as_str().unwrap().starts_with("---\n"));
}

/// Execute the bundled compact example and require every capability ID from the full list.
#[test]
fn main_skill_compact_capability_example_returns_every_registered_id() {
    let source = run(&["skills", "read", "hyacinthus-cli"]);
    assert!(
        source.status.success(),
        "{}",
        String::from_utf8_lossy(&source.stdout)
    );
    let skill = String::from_utf8(source.stdout).unwrap();
    let example = skill
        .lines()
        .find(|line| {
            line.starts_with("hyacinthus --no-notice --jq '") && line.ends_with("' capability list")
        })
        .expect("compact capability example");
    let expression = example
        .strip_prefix("hyacinthus --no-notice --jq '")
        .unwrap()
        .strip_suffix("' capability list")
        .unwrap();
    let compact = run(&["--format", "json", "--jq", expression, "capability", "list"]);
    assert!(
        compact.status.success(),
        "{}",
        String::from_utf8_lossy(&compact.stdout)
    );
    let projected: Value = serde_json::from_slice(&compact.stdout).unwrap();
    let full = data(&["--format", "json", "capability", "list"]);
    let mut actual: Vec<&str> = projected
        .as_array()
        .expect("compact ID array")
        .iter()
        .map(|id| id.as_str().expect("string ID"))
        .collect();
    let mut expected: Vec<&str> = full["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|capability| capability["id"].as_str().unwrap())
        .collect();
    assert!(!expected.is_empty());
    actual.sort_unstable();
    expected.sort_unstable();
    assert_eq!(actual, expected);
}
