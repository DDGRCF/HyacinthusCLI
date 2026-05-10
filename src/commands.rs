use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;

use clap::CommandFactory;
use clap_complete::{generate, Shell};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::cli::{
    AdminSubcommand, AuthSubcommand, CapabilitySubcommand, ClawSkillsSubcommand, ClawSubcommand,
    Cli, Command, ConfigSubcommand, RequirementsImportArgs, RequirementsParseArgs,
    RequirementsSubcommand,
};
use crate::client::ApiClient;
use crate::config::{self, Profile};
use crate::manifest;
use crate::output::{self, CliError, CliResult};
use crate::pagination;
use crate::query;
use crate::schema_validate;
use crate::security;
use crate::skills;

pub fn run(cli: Cli) -> i32 {
    if let Command::Completion(args) = &cli.command {
        if let Err(err) = completion_command(&args.shell) {
            return output::print_error(
                &err,
                json!({ "profile": cli.profile }),
                crate::cli::OutputFormat::Json,
                false,
            );
        }
        return 0;
    }
    let format = match config::resolve_output_format(cli.profile.as_deref(), cli.format) {
        Ok(format) => format,
        Err(err) => {
            return output::print_error(
                &err,
                json!({ "profile": cli.profile }),
                crate::cli::OutputFormat::Json,
                !cli.no_notice,
            )
        }
    };
    match dispatch(&cli) {
        Ok((data, meta)) => {
            output::print_success(data, meta, format, cli.jq.as_deref(), !cli.no_notice)
        }
        Err(err) => output::print_error(
            &err,
            json!({ "profile": cli.profile }),
            format,
            !cli.no_notice,
        ),
    }
}

fn dispatch(cli: &Cli) -> CliResult<(Value, Value)> {
    match &cli.command {
        Command::Admin(command) => admin_command(cli, &command.command),
        Command::Claw(command) => claw_command(cli, &command.command),
        Command::Config(command) => config_command(cli, &command.command),
        Command::Auth(command) => auth_command(cli, &command.command),
        Command::Doctor(args) => doctor_command(cli, args.offline, args.strict),
        Command::Capability(command) => capability_command(cli, &command.command),
        Command::Api(args) => api_command(cli, args),
        Command::Schema(args) => schema_command(args.path.as_deref()),
        Command::Requirements(command) => match &command.command {
            RequirementsSubcommand::Options => requirements_options(cli),
            RequirementsSubcommand::Parse(args) => requirements_parse(cli, args),
            RequirementsSubcommand::Import(args) => requirements_import(cli, args),
        },
        Command::Skills(command) => skills_command(&command.command),
        Command::Completion(_) => unreachable!("completion is handled before envelope output"),
    }
}

fn admin_command(cli: &Cli, command: &AdminSubcommand) -> CliResult<(Value, Value)> {
    match command {
        AdminSubcommand::Status => {
            let ctx = config::resolve_context(
                cli.profile.as_deref(),
                cli.base_url.as_deref(),
                cli.instance_id,
                cli.request_id.as_deref(),
            )?;
            let capability = manifest::find_capability("admin.status")?;
            manifest::ensure_supported(&capability)?;
            ensure_scopes(&ctx, &capability.required_scopes)?;
            let data = ApiClient::new(ctx)?.get(&capability.path)?;
            validate_response_payload(&capability, &data)?;
            Ok((
                data,
                json!({ "command": "admin status", "capability": "admin.status" }),
            ))
        }
    }
}

fn claw_command(cli: &Cli, command: &ClawSubcommand) -> CliResult<(Value, Value)> {
    match command {
        ClawSubcommand::Status => {
            let ctx = config::resolve_context(
                cli.profile.as_deref(),
                cli.base_url.as_deref(),
                cli.instance_id,
                cli.request_id.as_deref(),
            )?;
            let capability = manifest::find_capability("claw.status")?;
            manifest::ensure_supported(&capability)?;
            ensure_scopes(&ctx, &capability.required_scopes)?;
            let data = ApiClient::new(ctx)?.get(&capability.path)?;
            validate_response_payload(&capability, &data)?;
            Ok((
                data,
                json!({ "command": "claw status", "capability": "claw.status" }),
            ))
        }
        ClawSubcommand::Skills(command) => match &command.command {
            ClawSkillsSubcommand::List(args) => claw_skills_list(cli, args.source.as_deref()),
        },
    }
}

fn claw_skills_list(cli: &Cli, source: Option<&str>) -> CliResult<(Value, Value)> {
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        cli.instance_id,
        cli.request_id.as_deref(),
    )?;
    let capability = manifest::find_capability("claw.skills_list")?;
    manifest::ensure_supported(&capability)?;
    ensure_scopes(&ctx, &capability.required_scopes)?;
    let params = source.map(|source| json!({ "source": source }));
    let path = query::append_json_params(&capability.path, params.as_ref())?;
    let data = ApiClient::new(ctx)?.get(&path)?;
    validate_response_payload(&capability, &data)?;
    Ok((
        data,
        json!({ "command": "claw skills list", "capability": "claw.skills_list" }),
    ))
}

fn skills_command(command: &crate::cli::SkillsSubcommand) -> CliResult<(Value, Value)> {
    match command {
        crate::cli::SkillsSubcommand::List => Ok((
            serialize_value(skills::list())?,
            json!({ "command": "skills list" }),
        )),
        crate::cli::SkillsSubcommand::Show(args) => Ok((
            serialize_value(skills::show(&args.name)?)?,
            json!({ "command": "skills show", "skill": args.name }),
        )),
        crate::cli::SkillsSubcommand::Export(args) => Ok((
            serialize_value(skills::export_to(std::path::Path::new(&args.dir))?)?,
            json!({ "command": "skills export" }),
        )),
        crate::cli::SkillsSubcommand::Check(args) => Ok((
            serialize_value(skills::check_dir(std::path::Path::new(&args.dir)))?,
            json!({ "command": "skills check" }),
        )),
    }
}

fn config_command(cli: &Cli, command: &ConfigSubcommand) -> CliResult<(Value, Value)> {
    let mut config = config::load_config()?;
    match command {
        ConfigSubcommand::SetProfile(args) => {
            let base_url = config::normalize_base_url(&args.base_url)?;
            let profile = Profile {
                name: args.name.clone(),
                base_url,
                default_instance_id: args.default_instance_id,
                default_format: args
                    .default_format
                    .or(cli.format)
                    .unwrap_or(crate::cli::OutputFormat::Json),
                token: config
                    .profiles
                    .get(&args.name)
                    .and_then(|profile| profile.token.clone()),
                scopes: args
                    .scopes
                    .as_deref()
                    .map(config::parse_scope_list)
                    .or_else(|| {
                        config
                            .profiles
                            .get(&args.name)
                            .map(|profile| profile.scopes.clone())
                    })
                    .unwrap_or_default(),
                raw_api_enabled: args.raw_api_enabled,
            };
            config.profiles.insert(args.name.clone(), profile);
            if config.active_profile.is_none() {
                config.active_profile = Some(args.name.clone());
            }
            config::save_config(&config)?;
            Ok((
                json!({ "profile": args.name }),
                json!({ "command": "config set-profile" }),
            ))
        }
        ConfigSubcommand::Use(args) => {
            if !config.profiles.contains_key(&args.name) {
                return Err(CliError::validation(format!(
                    "unknown profile: {}",
                    args.name
                )));
            }
            config.active_profile = Some(args.name.clone());
            config::save_config(&config)?;
            Ok((
                json!({ "active_profile": args.name }),
                json!({ "command": "config use" }),
            ))
        }
        ConfigSubcommand::Show(args) => {
            let name = args
                .profile
                .clone()
                .or_else(|| cli.profile.clone())
                .or(config.active_profile.clone())
                .ok_or_else(|| CliError::validation("no profile selected"))?;
            let mut value = serde_json::to_value(
                config
                    .profiles
                    .get(&name)
                    .ok_or_else(|| CliError::validation(format!("unknown profile: {name}")))?,
            )
            .map_err(|err| CliError::internal(format!("failed to serialize profile: {err}")))?;
            security::redact_value(&mut value);
            Ok((value, json!({ "command": "config show" })))
        }
        ConfigSubcommand::List => {
            let profiles = config
                .profiles
                .keys()
                .map(|name| json!({ "name": name, "active": config.active_profile.as_deref() == Some(name.as_str()) }))
                .collect::<Vec<_>>();
            Ok((
                json!({ "profiles": profiles }),
                json!({ "command": "config list" }),
            ))
        }
        ConfigSubcommand::Remove(args) => {
            config.profiles.remove(&args.name);
            if config.active_profile.as_deref() == Some(&args.name) {
                config.active_profile = None;
            }
            config::save_config(&config)?;
            Ok((
                json!({ "removed": args.name }),
                json!({ "command": "config remove" }),
            ))
        }
        ConfigSubcommand::SetToken(args) => {
            let profile_name = args
                .profile
                .clone()
                .or_else(|| cli.profile.clone())
                .or(config.active_profile.clone())
                .ok_or_else(|| CliError::validation("no profile selected"))?;
            let token = if args.token_stdin {
                config::read_token_from_stdin()?
            } else {
                args.token
                    .clone()
                    .ok_or_else(|| CliError::validation("--token or --token-stdin is required"))?
            };
            let profile = config
                .profiles
                .get_mut(&profile_name)
                .ok_or_else(|| CliError::validation(format!("unknown profile: {profile_name}")))?;
            profile.token = Some(token);
            config::save_config(&config)?;
            Ok((
                json!({ "profile": profile_name, "token_present": true }),
                json!({ "command": "config set-token" }),
            ))
        }
    }
}

fn auth_command(cli: &Cli, command: &AuthSubcommand) -> CliResult<(Value, Value)> {
    match command {
        AuthSubcommand::Status => {
            let ctx = config::resolve_auth_status_context(
                cli.profile.as_deref(),
                cli.base_url.as_deref(),
                cli.instance_id,
                cli.request_id.as_deref(),
            )?;
            Ok((
                json!({
                    "profile": ctx.profile_name,
                    "base_url": ctx.base_url,
                    "base_url_configured": ctx.base_url.is_some(),
                    "token_present": ctx.token_present,
                    "token_source": ctx.token_source,
                    "scope_count": ctx.scopes.as_ref().map(Vec::len),
                    "default_instance_id": ctx.instance_id,
                    "request_id": ctx.request_id,
                    "raw_api_enabled": ctx.raw_api_enabled
                }),
                json!({ "command": "auth status" }),
            ))
        }
        AuthSubcommand::Check(args) => {
            if let Some(scope) = args.scope.as_deref() {
                return auth_scope_check(cli, scope);
            }
            let ctx = config::resolve_context(
                cli.profile.as_deref(),
                cli.base_url.as_deref(),
                cli.instance_id,
                cli.request_id.as_deref(),
            )?;
            ApiClient::new(ctx)?.get("/api/v1/agent/capabilities")?;
            Ok((
                json!({ "authenticated": true }),
                json!({ "command": "auth check" }),
            ))
        }
        AuthSubcommand::Scopes(args) => {
            let manifest = manifest::load_embedded()?;
            let mut scopes: BTreeMap<String, Value> = BTreeMap::new();
            for capability in manifest.capabilities {
                if args
                    .domain
                    .as_deref()
                    .is_some_and(|domain| capability.domain != domain)
                {
                    continue;
                }
                for scope in capability.required_scopes {
                    let entry = scopes.entry(scope.clone()).or_insert_with(|| {
                        json!({
                            "scope": scope,
                            "domains": [],
                            "capabilities": []
                        })
                    });
                    push_unique_string(&mut entry["domains"], &capability.domain);
                    push_unique_string(&mut entry["capabilities"], &capability.id);
                }
            }
            Ok((
                json!({
                    "domain": args.domain,
                    "scopes": scopes.into_values().collect::<Vec<_>>()
                }),
                json!({ "command": "auth scopes" }),
            ))
        }
        AuthSubcommand::Logout => {
            let mut config = config::load_config()?;
            let profile_name = cli
                .profile
                .clone()
                .or(config.active_profile.clone())
                .ok_or_else(|| CliError::validation("no profile selected"))?;
            if let Some(profile) = config.profiles.get_mut(&profile_name) {
                profile.token = None;
            }
            config::save_config(&config)?;
            Ok((
                json!({ "profile": profile_name, "token_present": false }),
                json!({ "command": "auth logout" }),
            ))
        }
    }
}

fn auth_scope_check(cli: &Cli, scope: &str) -> CliResult<(Value, Value)> {
    let required = config::parse_scope_list(scope);
    if required.is_empty() {
        return Err(CliError::validation("--scope must not be empty"));
    }
    let ctx = config::resolve_scope_context(cli.profile.as_deref())?;
    let Some(available) = &ctx.scopes else {
        return Err(CliError::validation(
            "local agent scopes are not configured; set HYACINTHUS_AGENT_SCOPES or profile scopes",
        ));
    };
    let missing = required
        .iter()
        .filter(|scope| !available.iter().any(|item| item == *scope))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(CliError::missing_scope(missing, required));
    }
    Ok((
        json!({
            "ok": true,
            "profile": ctx.profile_name,
            "checked_scopes": required,
            "available_scope_count": available.len()
        }),
        json!({ "command": "auth check", "mode": "scope" }),
    ))
}

fn ensure_raw_api_path(path: &str) -> CliResult<()> {
    if path.starts_with("/api/v1/") {
        return Ok(());
    }
    Err(CliError::validation(
        "raw API path must start with /api/v1/",
    ))
}

fn api_command(cli: &Cli, args: &crate::cli::ApiArgs) -> CliResult<(Value, Value)> {
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        cli.instance_id,
        cli.request_id.as_deref(),
    )?;
    if !ctx.raw_api_enabled {
        return Err(CliError::validation(
            "raw API is disabled; enable profile raw_api_enabled or set HYACINTHUS_RAW_API=1",
        ));
    }
    let method = args.method.to_ascii_uppercase();
    let body = if let Some(data) = &args.data {
        Some(read_json_arg(data)?)
    } else {
        None
    };
    let params = if let Some(params) = &args.params {
        Some(read_json_arg(params)?)
    } else {
        None
    };
    if args.pagination.page_all && method != "GET" {
        return Err(CliError::validation("--page-all is only supported for GET"));
    }
    ensure_raw_api_path(&args.path)?;
    let path = query::append_json_params(&args.path, params.as_ref())?;
    if args.dry_run {
        let pagination = pagination::dry_run(&args.path, params, &args.pagination)?;
        return Ok((
            dry_run_payload(
                &method,
                &path,
                body.unwrap_or(json!({})),
                Some(pagination),
                ctx.request_id.as_deref(),
            ),
            json!({ "command": "api", "raw_api": true }),
        ));
    }
    if method != "GET" && !args.yes {
        return Err(CliError::confirmation_required(
            format!("raw api {method} {}", args.path),
            "write",
        ));
    }
    let client = ApiClient::new(ctx)?;
    let data = if args.pagination.page_all {
        pagination::get_all(&client, &args.path, params, &args.pagination)?
    } else {
        client.raw(&method, &path, body)?
    };
    write_output_if_needed(&data, args.output.as_deref())?;
    Ok((data, json!({ "command": "api", "raw_api": true })))
}

fn doctor_command(cli: &Cli, offline: bool, strict: bool) -> CliResult<(Value, Value)> {
    let mut checks = Vec::new();
    checks.push(
        json!({ "name": "cli_version", "status": "pass", "message": env!("CARGO_PKG_VERSION") }),
    );
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        cli.instance_id,
        cli.request_id.as_deref(),
    );
    match ctx {
        Ok(ctx) => {
            checks.push(
                json!({ "name": "config_resolved", "status": "pass", "message": ctx.profile_name }),
            );
            checks.push(json!({
                "name": "token_present",
                "status": if ctx.token.is_some() { "pass" } else { "fail" },
                "message": if ctx.token.is_some() { "token configured" } else { "token missing" }
            }));
            match manifest::load_embedded() {
                Ok(manifest) => {
                    let compatibility = manifest::compatibility_summary(&manifest);
                    let issues = manifest::validate_manifest(&manifest);
                    checks.push(json!({
                        "name": "embedded_manifest_compatibility",
                        "status": if compatibility.get("ok").and_then(Value::as_bool) == Some(true) { "pass" } else { "fail" },
                        "message": compatibility
                    }));
                    checks.push(json!({
                        "name": "embedded_manifest_integrity",
                        "status": if issues.is_empty() { "pass" } else { "fail" },
                        "message": {
                            "issue_count": issues.len(),
                            "issues": issues
                        }
                    }));
                }
                Err(err) => checks.push(json!({
                    "name": "embedded_manifest_compatibility",
                    "status": "fail",
                    "message": err.message
                })),
            }
            if !offline {
                match ApiClient::new(ctx).and_then(|client| client.get("/api/v1/agent/capabilities")) {
                    Ok(_) => checks.push(json!({ "name": "capability_endpoint", "status": "pass", "message": "reachable" })),
                    Err(err) => checks.push(json!({ "name": "capability_endpoint", "status": "fail", "message": err.message })),
                }
            } else {
                checks.push(json!({ "name": "capability_endpoint", "status": "skip", "message": "offline" }));
            }
        }
        Err(err) => checks
            .push(json!({ "name": "config_resolved", "status": "fail", "message": err.message })),
    }
    if strict && checks.iter().any(|check| check["status"] == "fail") {
        return Err(CliError::validation_with_detail(
            "doctor checks failed",
            json!({ "checks": checks }),
        ));
    }
    Ok((json!({ "checks": checks }), json!({ "command": "doctor" })))
}

fn capability_command(cli: &Cli, command: &CapabilitySubcommand) -> CliResult<(Value, Value)> {
    match command {
        CapabilitySubcommand::List(args) => {
            if args.remote {
                let ctx = config::resolve_context(
                    cli.profile.as_deref(),
                    cli.base_url.as_deref(),
                    cli.instance_id,
                    cli.request_id.as_deref(),
                )?;
                let data = ApiClient::new(ctx)?.get("/api/v1/agent/capabilities")?;
                return Ok((
                    data,
                    json!({ "command": "capability list", "source": "remote" }),
                ));
            }
            let manifest = manifest::load_embedded()?;
            Ok((
                serialize_value(manifest)?,
                json!({ "command": "capability list", "source": "embedded" }),
            ))
        }
        CapabilitySubcommand::Schema(args) => {
            if args.remote {
                let ctx = config::resolve_context(
                    cli.profile.as_deref(),
                    cli.base_url.as_deref(),
                    cli.instance_id,
                    cli.request_id.as_deref(),
                )?;
                let data =
                    ApiClient::new(ctx)?.get(&format!("/api/v1/agent/capabilities/{}", args.id))?;
                return Ok((
                    data,
                    json!({ "command": "capability schema", "source": "remote" }),
                ));
            }
            let capability = manifest::find_capability(&args.id)?;
            manifest::ensure_supported(&capability)?;
            Ok((
                serialize_value(capability)?,
                json!({ "command": "capability schema", "source": "embedded" }),
            ))
        }
        CapabilitySubcommand::Verify(args) => capability_verify(cli, args.remote, args.strict),
        CapabilitySubcommand::Diff(args) => capability_diff(cli, args.remote, args.strict),
        CapabilitySubcommand::Run(args) => capability_run(cli, args),
    }
}

fn capability_verify(cli: &Cli, remote: bool, strict: bool) -> CliResult<(Value, Value)> {
    let (manifest, source) = if remote {
        let ctx = config::resolve_context(
            cli.profile.as_deref(),
            cli.base_url.as_deref(),
            cli.instance_id,
            cli.request_id.as_deref(),
        )?;
        let data = ApiClient::new(ctx)?.get("/api/v1/agent/capabilities")?;
        let manifest =
            serde_json::from_value::<manifest::CapabilityManifest>(data).map_err(|err| {
                CliError::api(
                    format!("invalid remote capability manifest: {err}"),
                    None,
                    None,
                )
            })?;
        (manifest, "remote")
    } else {
        (manifest::load_embedded()?, "embedded")
    };
    let issues = manifest::validate_manifest(&manifest);
    let result = json!({
        "ok": issues.is_empty(),
        "version": manifest.version,
        "backend_min_version": manifest.backend_min_version,
        "capability_count": manifest.capabilities.len(),
        "issue_count": issues.len(),
        "issues": issues
    });
    if strict && result["ok"] == false {
        return Err(CliError::validation_with_detail(
            "capability manifest verification failed",
            result,
        ));
    }
    Ok((
        result,
        json!({ "command": "capability verify", "source": source }),
    ))
}

fn capability_diff(cli: &Cli, remote: bool, strict: bool) -> CliResult<(Value, Value)> {
    if !remote {
        return Err(CliError::validation(
            "capability diff currently requires --remote",
        ));
    }
    let embedded = manifest::load_embedded()?;
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        cli.instance_id,
        cli.request_id.as_deref(),
    )?;
    let data = ApiClient::new(ctx)?.get("/api/v1/agent/capabilities")?;
    let remote_manifest =
        serde_json::from_value::<manifest::CapabilityManifest>(data).map_err(|err| {
            CliError::api(
                format!("invalid remote capability manifest: {err}"),
                None,
                None,
            )
        })?;
    let diff = diff_manifests(&embedded, &remote_manifest);
    if strict && diff["ok"] == false {
        return Err(CliError::validation_with_detail(
            "capability manifest drift detected",
            diff,
        ));
    }
    Ok((
        diff,
        json!({ "command": "capability diff", "source": "remote" }),
    ))
}

fn diff_manifests(
    embedded: &manifest::CapabilityManifest,
    remote: &manifest::CapabilityManifest,
) -> Value {
    let embedded_by_id = embedded
        .capabilities
        .iter()
        .map(|capability| (capability.id.as_str(), capability))
        .collect::<BTreeMap<_, _>>();
    let remote_by_id = remote
        .capabilities
        .iter()
        .map(|capability| (capability.id.as_str(), capability))
        .collect::<BTreeMap<_, _>>();
    let embedded_ids = embedded_by_id.keys().copied().collect::<BTreeSet<_>>();
    let remote_ids = remote_by_id.keys().copied().collect::<BTreeSet<_>>();
    let added = remote_ids
        .difference(&embedded_ids)
        .map(|id| json!({ "id": id }))
        .collect::<Vec<_>>();
    let removed = embedded_ids
        .difference(&remote_ids)
        .map(|id| json!({ "id": id }))
        .collect::<Vec<_>>();
    let mut changed = Vec::new();
    for id in embedded_ids.intersection(&remote_ids) {
        let embedded = embedded_by_id[id];
        let remote = remote_by_id[id];
        let fields = changed_capability_fields(embedded, remote);
        if !fields.is_empty() {
            changed.push(json!({ "id": id, "fields": fields }));
        }
    }
    json!({
        "ok": added.is_empty() && removed.is_empty() && changed.is_empty(),
        "embedded_version": embedded.version,
        "remote_version": remote.version,
        "added": added,
        "removed": removed,
        "changed": changed,
        "summary": {
            "added": added.len(),
            "removed": removed.len(),
            "changed": changed.len()
        }
    })
}

fn changed_capability_fields(
    embedded: &manifest::Capability,
    remote: &manifest::Capability,
) -> Vec<String> {
    let mut fields = Vec::new();
    if embedded.method != remote.method {
        fields.push("method".to_string());
    }
    if embedded.path != remote.path {
        fields.push("path".to_string());
    }
    if embedded.required_scopes != remote.required_scopes {
        fields.push("required_scopes".to_string());
    }
    if embedded.risk_level != remote.risk_level {
        fields.push("risk_level".to_string());
    }
    if embedded.request_schema != remote.request_schema {
        fields.push("request_schema".to_string());
    }
    if embedded.response_schema != remote.response_schema {
        fields.push("response_schema".to_string());
    }
    fields
}

fn capability_run(cli: &Cli, args: &crate::cli::CapabilityRunArgs) -> CliResult<(Value, Value)> {
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        cli.instance_id,
        cli.request_id.as_deref(),
    )?;
    let capability = if args.remote {
        let data =
            ApiClient::new(ctx.clone())?.get(&format!("/api/v1/agent/capabilities/{}", args.id))?;
        serde_json::from_value::<manifest::Capability>(data).map_err(|err| {
            CliError::api(
                format!("invalid remote capability schema: {err}"),
                None,
                None,
            )
        })?
    } else {
        manifest::find_capability(&args.id)?
    };
    manifest::ensure_supported(&capability)?;
    ensure_scopes(&ctx, &capability.required_scopes)?;
    let body = if let Some(data) = &args.data {
        read_json_arg(data)?
    } else {
        json!({})
    };
    let params = if let Some(params) = &args.params {
        Some(read_json_arg(params)?)
    } else {
        None
    };
    validate_capability_run_request(&capability, &body, params.as_ref())?;
    if args.pagination.page_all && capability.method != "GET" {
        return Err(CliError::validation("--page-all is only supported for GET"));
    }
    let path = query::append_json_params(&capability.path, params.as_ref())?;
    if args.dry_run {
        let pagination = pagination::dry_run(&capability.path, params, &args.pagination)?;
        return Ok((
            dry_run_payload(
                &capability.method,
                &path,
                body,
                Some(pagination),
                ctx.request_id.as_deref(),
            ),
            json!({ "command": "capability run", "capability": args.id }),
        ));
    }
    ensure_execution_confirmed(args.yes, &capability)?;
    let client = ApiClient::new(ctx)?;
    let data = match capability.method.as_str() {
        "GET" => {
            if args.pagination.page_all {
                pagination::get_all(&client, &capability.path, params, &args.pagination)?
            } else {
                client.get(&path)?
            }
        }
        "POST" => client.post(&path, body)?,
        method => {
            return Err(CliError::validation(format!(
                "unsupported capability method: {method}"
            )))
        }
    };
    validate_response_payload(&capability, &data)?;
    write_output_if_needed(&data, args.output.as_deref())?;
    Ok((
        data,
        json!({
            "command": "capability run",
            "capability": args.id,
            "source": if args.remote { "remote" } else { "embedded" }
        }),
    ))
}

fn schema_command(path: Option<&str>) -> CliResult<(Value, Value)> {
    if let Some(path) = path {
        let capability = manifest::find_capability(path)?;
        Ok((serialize_value(capability)?, json!({ "command": "schema" })))
    } else {
        let manifest = manifest::load_embedded()?;
        let ids = manifest
            .capabilities
            .into_iter()
            .map(|capability| capability.id)
            .collect::<Vec<_>>();
        Ok((
            json!({ "capabilities": ids }),
            json!({ "command": "schema" }),
        ))
    }
}

fn requirements_options(cli: &Cli) -> CliResult<(Value, Value)> {
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        cli.instance_id,
        cli.request_id.as_deref(),
    )?;
    let capability = manifest::find_capability("requirements.options")?;
    manifest::ensure_supported(&capability)?;
    ensure_scopes(&ctx, &capability.required_scopes)?;
    let data = ApiClient::new(ctx)?.get(&capability.path)?;
    validate_response_payload(&capability, &data)?;
    Ok((
        data,
        json!({ "command": "requirements options", "capability": "requirements.options" }),
    ))
}

fn requirements_parse(cli: &Cli, args: &RequirementsParseArgs) -> CliResult<(Value, Value)> {
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        args.instance_id.or(cli.instance_id),
        cli.request_id.as_deref(),
    )?;
    let payload = build_parse_payload(ctx.instance_id, args)?;
    let capability = manifest::find_capability("requirements.batch_parse")?;
    manifest::ensure_supported(&capability)?;
    ensure_scopes(&ctx, &capability.required_scopes)?;
    validate_request_payload(&capability, &payload)?;
    if args.dry_run {
        return Ok((
            dry_run_payload(
                "POST",
                "/api/v1/agent/requirements/batch-parse",
                payload,
                None,
                ctx.request_id.as_deref(),
            ),
            json!({ "command": "requirements parse" }),
        ));
    }
    let data = ApiClient::new(ctx)?.post("/api/v1/agent/requirements/batch-parse", payload)?;
    validate_response_payload(&capability, &data)?;
    write_output_if_needed(&data, args.output.as_deref())?;
    Ok((
        data,
        json!({ "command": "requirements parse", "capability": "requirements.batch_parse" }),
    ))
}

fn requirements_import(cli: &Cli, args: &RequirementsImportArgs) -> CliResult<(Value, Value)> {
    let ctx = config::resolve_context(
        cli.profile.as_deref(),
        cli.base_url.as_deref(),
        args.instance_id.or(cli.instance_id),
        cli.request_id.as_deref(),
    )?;
    let mut payload = build_import_payload(ctx.instance_id, args)?;
    let capability = manifest::find_capability("requirements.batch_import")?;
    manifest::ensure_supported(&capability)?;
    ensure_scopes(&ctx, &capability.required_scopes)?;
    if payload
        .get("idempotency_key")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        payload["idempotency_key"] = json!(format!("cli-{}", Uuid::new_v4()));
    }
    validate_request_payload(&capability, &payload)?;
    if args.dry_run {
        return Ok((
            dry_run_payload(
                "POST",
                "/api/v1/agent/requirements/batch-import",
                payload,
                None,
                ctx.request_id.as_deref(),
            ),
            json!({ "command": "requirements import" }),
        ));
    }
    ensure_execution_confirmed(args.yes, &capability)?;
    let idempotency_key = payload
        .get("idempotency_key")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| CliError::internal("idempotency_key missing after payload build"))?;
    let data = ApiClient::new(ctx)?.post("/api/v1/agent/requirements/batch-import", payload)?;
    validate_response_payload(&capability, &data)?;
    write_output_if_needed(&data, args.output.as_deref())?;
    Ok((
        data,
        json!({
            "command": "requirements import",
            "capability": "requirements.batch_import",
            "idempotency_key": idempotency_key
        }),
    ))
}

fn completion_command(shell: &str) -> CliResult<()> {
    let shell = shell
        .parse::<Shell>()
        .map_err(|_| CliError::validation("unsupported shell"))?;
    let mut cmd = crate::cli::Cli::command();
    generate(shell, &mut cmd, "hyacinthus", &mut io::stdout());
    Ok(())
}

fn build_parse_payload(instance_id: Option<i64>, args: &RequirementsParseArgs) -> CliResult<Value> {
    let source_count = [&args.file, &args.data, &args.text]
        .iter()
        .filter(|value| value.is_some())
        .count();
    if source_count != 1 {
        return Err(CliError::validation(
            "exactly one of --file, --data, or --text is required",
        ));
    }
    if let Some(data) = &args.data {
        let mut payload = read_json_arg(data)?;
        if payload.get("instance_id").is_none() {
            payload["instance_id"] = json!(required_instance_id(instance_id)?);
        }
        return Ok(payload);
    }
    let raw_text = if let Some(file) = &args.file {
        read_text_arg(file)?
    } else if let Some(text) = &args.text {
        text.clone()
    } else {
        return Err(CliError::validation(
            "exactly one of --file, --data, or --text is required",
        ));
    };
    if raw_text.trim().is_empty() {
        return Err(CliError::validation("raw_text is empty"));
    }
    Ok(json!({
        "instance_id": required_instance_id(instance_id)?,
        "raw_text": raw_text,
        "preset_contact_phone": args.preset_contact_phone,
        "preset_contact_wechat": args.preset_contact_wechat,
        "preset_city": args.preset_city,
        "subject_group_aliases_json": args.subject_group_aliases_json,
        "priority_rules_json": args.priority_rules_json,
        "force_ai": if args.no_force_ai { false } else { args.force_ai },
        "enable_ai_fallback": if args.no_enable_ai_fallback { false } else { args.enable_ai_fallback },
        "skip_geocode": args.skip_geocode
    }))
}

fn build_import_payload(
    instance_id: Option<i64>,
    args: &RequirementsImportArgs,
) -> CliResult<Value> {
    let source_count = [&args.file, &args.data]
        .iter()
        .filter(|value| value.is_some())
        .count();
    if source_count != 1 {
        return Err(CliError::validation(
            "exactly one of --file or --data is required",
        ));
    }
    let raw = if let Some(file) = &args.file {
        if file == "-" {
            read_json_arg("-")?
        } else {
            read_json_arg(&format!("@{file}"))?
        }
    } else if let Some(data) = args.data.as_ref() {
        read_json_arg(data)?
    } else {
        return Err(CliError::validation(
            "exactly one of --file or --data is required",
        ));
    };
    let mut payload = if raw.get("confirmed_rows").is_some() {
        raw
    } else if raw.is_array() {
        json!({ "confirmed_rows": raw })
    } else if raw.pointer("/data/rows").is_some() {
        let rows = raw
            .pointer("/data/rows")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CliError::validation("parse output envelope must contain data.rows array")
            })?;
        let blocked = rows
            .iter()
            .filter(|row| row.get("needs_confirmation").and_then(Value::as_bool) == Some(true))
            .count();
        if blocked > 0 && !args.yes {
            return Err(CliError::confirmation_required(
                "requirements import contains rows needing confirmation",
                "write",
            ));
        }
        let confirmed = rows
            .iter()
            .filter(|row| {
                row.get("can_auto_commit").and_then(Value::as_bool) == Some(true)
                    || (args.yes
                        && row.get("needs_confirmation").and_then(Value::as_bool) == Some(true))
            })
            .map(|row| {
                row.get("parsed").cloned().ok_or_else(|| {
                    CliError::validation("parse output row is missing parsed payload")
                })
            })
            .collect::<CliResult<Vec<_>>>()?;
        json!({ "confirmed_rows": confirmed })
    } else {
        return Err(CliError::validation(
            "import input must be a payload, rows array, or parse output envelope",
        ));
    };
    if payload.get("instance_id").is_none() {
        payload["instance_id"] = json!(required_instance_id(instance_id)?);
    }
    if payload.get("idempotency_key").is_none() {
        payload["idempotency_key"] =
            json!(args.idempotency_key.clone().unwrap_or_else(String::new));
    }
    let row_count = payload
        .get("confirmed_rows")
        .and_then(Value::as_array)
        .ok_or_else(|| CliError::validation("confirmed_rows must be an array"))?
        .len();
    if row_count == 0 {
        return Err(CliError::validation("confirmed_rows is empty"));
    }
    Ok(payload)
}

fn serialize_value<T: serde::Serialize>(value: T) -> CliResult<Value> {
    serde_json::to_value(value)
        .map_err(|err| CliError::internal(format!("failed to serialize command output: {err}")))
}

fn ensure_scopes(ctx: &crate::config::RuntimeContext, required: &[String]) -> CliResult<()> {
    let Some(available) = &ctx.scopes else {
        return Ok(());
    };
    let missing = required
        .iter()
        .filter(|scope| !available.iter().any(|item| item == *scope))
        .cloned()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(CliError::missing_scope(missing, required.to_vec()))
    }
}

fn validate_request_payload(
    capability: &crate::manifest::Capability,
    payload: &Value,
) -> CliResult<()> {
    let errors = schema_validate::validate(&capability.request_schema, payload);
    if errors.is_empty() {
        return Ok(());
    }
    Err(CliError::validation(format!(
        "request payload does not match {} schema: {}",
        capability.id,
        errors.join("; ")
    )))
}

fn validate_capability_run_request(
    capability: &crate::manifest::Capability,
    body: &Value,
    params: Option<&Value>,
) -> CliResult<()> {
    if capability.method == "GET" {
        return validate_request_payload(
            capability,
            params.unwrap_or(&Value::Object(Default::default())),
        );
    }
    validate_request_payload(capability, body)
}

fn validate_response_payload(
    capability: &crate::manifest::Capability,
    payload: &Value,
) -> CliResult<()> {
    let errors = schema_validate::validate(&capability.response_schema, payload);
    if errors.is_empty() {
        return Ok(());
    }
    Err(CliError::api(
        format!(
            "backend response does not match {} schema: {}",
            capability.id,
            errors.join("; ")
        ),
        Some("RESPONSE_SCHEMA_MISMATCH".to_string()),
        Some(payload.clone()),
    ))
}

fn ensure_execution_confirmed(
    yes: bool,
    capability: &crate::manifest::Capability,
) -> CliResult<()> {
    if yes || capability.risk_level == "read" {
        return Ok(());
    }
    Err(CliError::confirmation_required(
        capability.command.clone(),
        capability.risk_level.clone(),
    ))
}

fn push_unique_string(value: &mut Value, item: &str) {
    if let Some(items) = value.as_array_mut() {
        if !items.iter().any(|existing| existing.as_str() == Some(item)) {
            items.push(json!(item));
        }
    }
}

fn dry_run_payload(
    method: &str,
    path: &str,
    mut body: Value,
    pagination: Option<Value>,
    request_id: Option<&str>,
) -> Value {
    security::redact_value(&mut body);
    let mut value =
        json!({ "dry_run": true, "request": { "method": method, "path": path, "body": body } });
    if let Some(request_id) = request_id {
        value["request"]["headers"] = json!({ "x-request-id": request_id });
    }
    if let Some(pagination) = pagination {
        value["pagination"] = pagination;
    }
    value
}

fn required_instance_id(instance_id: Option<i64>) -> CliResult<i64> {
    instance_id.ok_or_else(|| CliError::validation("instance_id is required"))
}

fn read_json_arg(input: &str) -> CliResult<Value> {
    let text = if input == "-" {
        config::read_stdin_string()?
    } else if let Some(path) = input.strip_prefix('@') {
        fs::read_to_string(path)
            .map_err(|err| CliError::validation(format!("failed to read {path}: {err}")))?
    } else {
        input.to_string()
    };
    serde_json::from_str(&text)
        .map_err(|err| CliError::validation(format!("invalid JSON input: {err}")))
}

fn read_text_arg(input: &str) -> CliResult<String> {
    if input == "-" {
        config::read_stdin_string()
    } else {
        fs::read_to_string(input)
            .map_err(|err| CliError::validation(format!("failed to read {input}: {err}")))
    }
}

fn write_output_if_needed(data: &Value, output: Option<&str>) -> CliResult<()> {
    if let Some(path) = output {
        let text = serde_json::to_string_pretty(data)
            .map_err(|err| CliError::internal(format!("failed to serialize output: {err}")))?;
        fs::write(path, text)
            .map_err(|err| CliError::validation(format!("failed to write {path}: {err}")))?;
    }
    Ok(())
}
