<!-- 改动说明：同步延期默认期限与匹配状态、导入同键重放、目录诊断和次数时长字段限制。 -->
# Hyacinthus CLI

Agent-oriented CLI for 风信子家教中心 backend operations. The CLI supports Hermes, Codex, Claude Code, Pi, and direct `hyacinthus-cli` authorization identities with a stable, structured, auditable command surface.

## Principles

- The backend is the source of truth for permissions, validation, business rules, idempotency, and audit logs.
- The CLI communicates over HTTP and never connects directly to the database, Redis, MinIO, or message queues.
- For machine parsing, pass `--format json` explicitly; a profile can change the default format.
- Mutating commands support dry-run where possible and require `--yes` for real execution.
- Write and high-risk capabilities use a structured confirmation protocol with exit code `10`.

## Quick Start

```bash
cargo build

./target/debug/hyacinthus auth status
./target/debug/hyacinthus auth login --scope "requirements:parse requirements:write"
./target/debug/hyacinthus doctor --offline
./target/debug/hyacinthus capability list
```

Install from a GitHub release:

```bash
curl -fsSL https://raw.githubusercontent.com/DDGRCF/HyacinthusCLI/main/scripts/install.sh | bash
```

Install from the private GitHub release through the npm wrapper:

```bash
GITHUB_TOKEN=github_pat_xxx npx @ddgrcf/hyacinthus-cli install --skills-target pi
npx @ddgrcf/hyacinthus-cli skills install --target hermes
npx @ddgrcf/hyacinthus-cli skills install --target pi
```

The npm wrapper does not contain the Rust binary. It uses `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to read the private `DDGRCF/HyacinthusCLI` release assets, download the matching archive, verify the `.sha256` checksum, and install `hyacinthus` into `~/.local/bin` by default. Alpine environments are detected as `x86_64-unknown-linux-musl`; other Linux x86_64 environments use `x86_64-unknown-linux-gnu`.

`skills read` emits raw Markdown by default; `--json` or explicit `--format json` returns the normal JSON envelope. `skills list [name/path]` lists one embedded directory level.

Skill installation targets are `hermes`, `codex`, `claude`, and `pi`. Pi installs into `~/.pi/agent/skills` by default, or `<PI_CODING_AGENT_DIR>/skills` when the trimmed override is non-empty. An explicit `--dir` takes precedence, but an unsupported target (including `nullclaw`) is rejected even with `--dir`. Use `skills install --dir <dir>` for a generic destination, or `hyacinthus skills export --dir <dir>` directly. Skill installation never starts Pi or reads its credentials. Agent authorization, requirement imports, and local skill export/check do not require a managed runtime; Claw/PicoClaw hosting remains removed.

Normal `install` also exports and verifies bundled Skills in detected Hermes/Codex/Claude/Pi homes. Select one using `--skills-target <agent>`, a custom directory using `--skills-dir <dir>`, or a binary-only installation using `--skip-skills`. Reload the Agent session after installation. Export/check cover every reference file. A subsequent export removes only retired entry files recorded by the installer manifest, retaining unrelated Skills and custom files.

The wrapper package lives in `npm/hyacinthus-cli` and can be published privately with `npm publish --access restricted`. Private npm access only controls the wrapper download; GitHub release access is still checked separately by GitHub.

## Backend target

Release binaries use the production API by default: `https://www.fxzjjzx.cn`. For local debugging, create a separate profile and authorize against the local backend:

```bash
hyacinthus config set-profile dev --base-url http://localhost:8000
hyacinthus --profile dev auth status
hyacinthus --profile dev auth login --scope requirements:read --wait
hyacinthus --profile dev auth token status
```

`auth status` shows the resolved `base_url`. Use `--profile dev` for local commands; each profile stores its own credentials. If `HYACINTHUS_BASE_URL` is set, it overrides the profile URL.

## Core Commands

```bash
hyacinthus auth status
hyacinthus admin status
hyacinthus auth login --scope requirements:read --wait
hyacinthus auth scopes
hyacinthus auth check --scope requirements:read
hyacinthus doctor
hyacinthus doctor --offline --strict
hyacinthus capability list
hyacinthus capability verify --strict
hyacinthus capability list --remote
hyacinthus capability diff --remote --strict
hyacinthus schema requirements.batch_parse
hyacinthus capability run requirements.options --remote --dry-run
hyacinthus capability run requirements.options --output options.json
hyacinthus api GET /api/v1/agent/capabilities --params '{"limit":10}' --dry-run
HYACINTHUS_RAW_API=1 hyacinthus api GET /api/v1/agent/capabilities --output capabilities.json
hyacinthus skills list
hyacinthus skills read hyacinthus-cli references/requirements-import.md
hyacinthus skills export --dir ./.tmp/agent-skills
hyacinthus skills check --dir ./.tmp/agent-skills
hyacinthus requirements options
hyacinthus requirements search --keyword 高一数学
hyacinthus requirements extend KKH347 --yes
hyacinthus requirements parse --file input.txt
hyacinthus requirements catalog create-missing --subject <missing-subject> --dry-run
hyacinthus requirements catalog create-missing --subject <missing-subject> --yes
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --yes
hyacinthus requirements import --file confirmed.json --idempotency-key cli-demo --yes
```

Batch parsing/import has no row-confidence threshold or `--min-confidence` option. The backend alone decides business validity: `errors` block rows; `warnings` are displayed but never block. `can_auto_commit` and `needs_confirmation` must agree with `errors`; missing or contradictory required verdict fields are protocol errors. `--yes` authorizes a write and never bypasses backend errors. Dry-run previews the payload without promising backend acceptance; submission still returns partial failures and import-raw skip summaries with the caller's stable idempotency key.

Raw requirement parsing maps recognized field names (including supported aliases) into the canonical 21-field text/CSV template. These Chinese labels are input text labels, not import JSON keys: user and administrator contacts belong to `confirmed_rows[].ext`, and teacher occupation belongs to `condition.required_occupation`. Backend table parsing supports CSV/XLSX, but CLI `--file` reads UTF-8 TXT/CSV, not binary XLSX. Columns and labelled text may use any column count or order; absent optional fields remain empty. Unknown and non-identity duplicate fields produce a non-blocking `FIELD_RECOGNITION_NOTICE`; table details are aggregated at the parse result's `field_recognition`, while text details belong to each row. Duplicate identifiers are errors. Required business data is still validated before commit; free-form natural-language input remains supported. Separate reordered labelled records with a blank line.

Default lenient parsing does not emit `SUBJECT_NAME_UNMAPPED:<name>` or `GRADE_NAME_UNMAPPED:<name>`. Compare source names with `requirements options`, then create approved missing names through explicit `--subject` / `--grade`. Catalog `--file` extracts only those named diagnostics; it does not discover missing names from a normal lenient result.

The broader Agent API index is maintained in `docs/requirements/agent-cli/08-agent-api-index.md` in the main repository. For this CLI's current command and capability surface, use `hyacinthus --help` and `hyacinthus capability list`; the backend index may describe a different revision.

`hyacinthus capability list` and `hyacinthus schema <id>` read the manifest embedded in the installed binary. Use `hyacinthus capability list --remote` or `hyacinthus capability schema <id> --remote` to inspect the backend's actual manifest, and `hyacinthus capability diff --remote --strict` to detect drift. The six upload/geocode/identity/preflight capabilities are available through `capability run <id>`, not dedicated requirements shortcut commands.

`requirements parse --dry-run` only previews the request. `requirements import-raw --dry-run` still submits a real parse job and polls it, but does not import requirements. Its `--file` argument reads UTF-8 text (TXT/CSV), not a binary XLSX upload; the current manifest declares no file-upload capabilities.

For review before writing, use `parse` once, save and review `confirmed_rows`, then run `import --dry-run` and `import --yes` against the same file and stable key. Parse does not generate `weekly_frequency_min/max` or `session_duration_minutes_min/max`; fill these four fields in `confirmed_rows` to preserve source frequency and duration. Reusing an import key with a changed payload replays the original receipt without checking the content; use a new key for a different batch or revised payload. Each `import-raw` invocation creates a new parse job; its dry-run `import_summary` is a request preview, not import statistics. Recovery through `parse-job` returns a task object whose `result` contains the parse data.

Map resolution runs during the parse job to produce candidate coordinates, then import/upload_run resolves the submitted address again or reuses an existing requirement's verified location before writing. Client-supplied parse coordinates do not authorize a write. Ordinary import has no geography run handle; report map failures from `failed_rows`, and use upload-run outcomes for the persistent workflow.

Both `batch_extend_v2` and single-row `requirements extend` use the server’s default expiry; supplied `expires_at` is not applied. A requested deadline cannot currently be set through either command. Single-row extension restores `open` and clears matching; batch extension preserves `matched`. See the bundled [batch and geography guide](skills/hyacinthus-cli/references/batch-and-geo.md).

## Environment Variables

```text
HYACINTHUS_CONFIG_DIR
HYACINTHUS_PROFILE
HYACINTHUS_BASE_URL
HYACINTHUS_AGENT_TOKEN
HYACINTHUS_AGENT_SCOPES
HYACINTHUS_REQUEST_ID
HYACINTHUS_INSTANCE_ID
HYACINTHUS_FORMAT
HYACINTHUS_RAW_API
HYACINTHUS_CLI_LATEST_VERSION
HYACINTHUS_SKILLS_TARGET_VERSION
PI_CODING_AGENT_DIR
```

Precedence:

```text
CLI flag > environment variable > active profile > built-in default
```

## Output

Successful commands return:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "command": "capability list"
  }
}
```

Supported formats:

```text
--format json
--format pretty
--format table
--format ndjson
--format csv
```

JSON filtering supports deterministic dot paths and array expansion:

```bash
hyacinthus capability list --jq '.data.capabilities[]'
hyacinthus requirements search --keyword "高一数学" --scope active -q '.data.total'
hyacinthus requirements extend KKH347 --dry-run -q '.data.request.body'
hyacinthus requirements extend KKH347 --yes -q '.data.expires_at'
hyacinthus requirements parse --text "高一数学" --dry-run -q '.data.request.body'
hyacinthus requirements parse --text "高一数学" --dry-run
hyacinthus requirements parse --text "高一数学" --dry-run --strict
hyacinthus --request-id trace-123 requirements parse --text "高一数学" --dry-run
```

Paginated GET calls can be collected generically when the backend returns `has_more` and `next_page_token`:

```bash
HYACINTHUS_RAW_API=1 hyacinthus api GET /api/v1/admin/items --page-all --page-size 50 --page-limit 5
```

Raw API is disabled by default and must be explicitly enabled:

```bash
HYACINTHUS_RAW_API=1 hyacinthus api GET /api/v1/agent/capabilities --dry-run
HYACINTHUS_RAW_API=1 hyacinthus api POST /api/v1/admin/items --data @payload.json --dry-run
HYACINTHUS_RAW_API=1 hyacinthus api POST /api/v1/admin/items --data @payload.json --yes
```

Raw API paths must start with `/api/v1/`.

Interactive Agent authorization is supported for Hermes, Codex, Claude Code, Pi, and direct CLI clients:

```bash
hyacinthus auth login --scope requirements:parse
hyacinthus auth login --scope requirements:read
hyacinthus auth login --scope requirements:parse --wait
hyacinthus auth wait
hyacinthus auth login --scope "requirements:parse requirements:write" --wait
hyacinthus auth token status
hyacinthus auth token revoke
hyacinthus auth logout
```

`auth login` creates a backend authorization session, stores its device-only secret in an atomically written `0600` pending-state file, and prints only `session_id`, the private file path, `authorize_url`, `qr_code_text`, `user_code`, and `required_scopes`. After approval, `auth wait` resumes from that file without placing the secret in argv, process listings, or normal output. An external trusted broker can instead pass the secret through stdin with `auth wait --session-id <session_id> --device-secret-stdin --expected-revision <revision>`. Polling is retryable until the CLI saves the token and acknowledges delivery. If acknowledgement fails after the token is saved, the command reports `authenticated: true` plus `acknowledgement_pending: true`; rerun `auth wait` to finish. Terminal non-`pending` states remove the pending file and exit non-zero.

The CLI automatically binds each profile to a stable Agent identity. Supported `client_type` values are `hermes`, `codex`, `claude`, `pi`, and `hyacinthus-cli`; Pi's display name is `Pi`. Profile selection is `--profile` > non-empty `HYACINTHUS_PROFILE` > Pi process/config directory > other Agent home variables > active profile > `local`. Pi is detected by `AI_AGENT=pi`, `PI_CODING_AGENT=true`, a non-empty `PI_SESSION_ID`, or a non-empty `PI_CODING_AGENT_DIR`; inherited `CODEX_HOME` cannot override Pi detection. Pi defaults to `~/.pi/agent`, producing `pi-agent`; a config directory override produces `pi-<sanitized directory basename>`. Session IDs are detection hints, not identity inputs. Pi SDK users without process markers should set `PI_CODING_AGENT_DIR` or explicitly configure a Pi profile. Multi-instance setups must use distinct profile names or distinct directory basenames.

Profile-name inference matches `pi` only as a whole alphanumeric token (for example `pi-agent` or `worker_pi`), not inside `api-prod`, `spider`, or `pi2`. Explicit saved identity/type and existing token/profile/backend binding checks remain authoritative. `NULLCLAW_HOME` is ignored; saved or explicit `client_type: nullclaw` is unsupported and never converted to Pi.

The first `auth login` persists that identity before sending the authorization request, so a separate `auth wait` process resumes the same session even with a brand-new configuration directory. Use the same profile for both commands. `auth token status` reads the actual server grant; `auth logout` revokes it remotely before removing local credentials.

Commands that return backend data can write the successful `data` payload to a file:

```bash
hyacinthus capability run requirements.options --output options.json
hyacinthus requirements parse --text "高一数学" --output parsed.json
hyacinthus requirements import --data @confirmed.json --idempotency-key reviewed-batch-001 --yes --output import-result.json
hyacinthus requirements extend KKH347 --yes --output extend-result.json
HYACINTHUS_RAW_API=1 hyacinthus api GET /api/v1/agent/capabilities --output capabilities.json
```

Known token scopes can be declared for local precheck:

```bash
HYACINTHUS_AGENT_SCOPES=requirements:read hyacinthus requirements search --keyword 高一数学
HYACINTHUS_AGENT_SCOPES=requirements:parse,requirements:write hyacinthus requirements import --dry-run --data @rows.json --idempotency-key reviewed-rows-001
HYACINTHUS_AGENT_SCOPES=requirements:write hyacinthus requirements extend KKH347 --dry-run
hyacinthus auth scopes --domain requirements
hyacinthus auth check --scope "requirements:read requirements:parse requirements:write"
```

## Requirement Deadline Extension

`requirements extend` updates one requirement by business requirement code. It requires `requirements:write`, supports CLI dry-run, and requires `--yes` for real execution.

```bash
hyacinthus requirements extend KKH347 --dry-run
hyacinthus requirements extend KKH347 --yes
```

The backend refreshes `expires_at` from its configured default validity window, restores `open`, and clears matching and invalidation flags. `--expires-at` is accepted but not applied; batch extension also uses the default window and preserves `matched`. Report the actual returned deadline.

Successful output data:

```json
{
  "requirement_id": 123,
  "requirement_code": "KKH347",
  "expires_at": "2027-07-10T12:00:00+08:00"
}
```

Common backend error codes are `REQUIREMENT_CODE_REQUIRED`, `REQUIREMENT_CODE_NOT_FOUND`, `REQUIREMENT_CODE_DUPLICATED`, and `REQUIREMENT_EXTEND_EXPIRES_AT_INVALID`.

`config set-profile <name>` does not require `--base-url`. Omit it when using the built-in backend: `hyacinthus config set-profile production`. For a new profile, omission saves the built-in default URL; for an existing profile, omission preserves its current URL and matching credentials. Pass `--base-url` only to override the backend origin. Runtime URL environment overrides do not silently replace the saved profile URL.

`config set-profile` is incremental for existing profiles: unspecified fields keep their current values. `auth logout` and `auth token revoke` first revoke `DELETE /api/v1/agent/auth/tokens/current`, then clear the saved token, scopes, and pending state. A network failure keeps local credentials for retry. Use the explicit `auth logout --local-only` escape hatch only when the backend is permanently unavailable.

## Agent Skills

The two discoverable entries are `hyacinthus-cli` and `tutoring-job-mail-upload`. The CLI entry routes to task-specific references; the mail entry loads CLI guidance only when uploading. Entry metadata comes directly from SKILL.md. All files are embedded in the binary and can be read without authentication or profile configuration:

```bash
hyacinthus skills list
hyacinthus skills read hyacinthus-cli
hyacinthus skills read hyacinthus-cli references/requirements-import.md
hyacinthus skills read tutoring-job-mail-upload
hyacinthus skills list hyacinthus-cli/references
hyacinthus skills read hyacinthus-cli/references/auth.md --json
hyacinthus skills export --dir ~/.agents/skills
hyacinthus skills check --dir ~/.agents/skills
```

Errors return:

```json
{
  "ok": false,
  "error": {
    "type": "validation",
    "code": "VALIDATION_FAILED",
    "message": "invalid input",
    "hint": null,
    "detail": null,
    "risk": null,
    "retryable": false
  },
  "meta": {}
}
```

When output contains risky prompt-injection text or terminal control characters, the envelope includes `_content_safety_alert` and removes unsafe control characters before printing.

Update notices are non-blocking. By default, the CLI checks the latest GitHub
release at most once per day and caches the result next to the CLI config.
Skills notices remain controlled by `HYACINTHUS_SKILLS_TARGET_VERSION`.
All notices can be suppressed:

```bash
hyacinthus --no-notice capability list
```

For private or mirrored release sources, set `HYACINTHUS_CLI_REPO` or
`HYACINTHUS_CLI_RELEASE_API_URL`. `HYACINTHUS_CLI_LATEST_VERSION` can still be
used to force a local update notice without making a network request.

## Pi-driven natural-language mail acceptance

The Docker acceptance setup and natural-language MiMo/Pi suite live in `tests/agent-e2e/docker/`. They deploy their own PostGIS database, Redis, API/Worker and authorization UI; normal Pi receives only user requests and approvals. Generated task files use workspace-relative directories.

The saved-mail processing workflow is bundled as `tutoring-job-mail-upload`; its source is now `skills/tutoring-job-mail-upload/SKILL.md`, rather than a standalone directory under `~/Tests`.

[tests/agent-e2e/README.md](tests/agent-e2e/README.md) describes the real-Pi suite. After normal Skill installation, the user's first message is only “帮我上传一下邮件里的家教岗位。” Pi discovers the Skill, initiates authorization, processes every row in a 30-job saved-mail batch, previews and requests approval, imports, reads back and handles the same mail again without duplicates. The default suite runs the installed Pi SDK and real CLI in the same dedicated Docker container; the test runner never generates the Agent's confirmed payload. The current 21-field SOP v4 initializes only that Docker project's guarded `hyacinthus_test` once; selected runs preserve it and rerun dependencies. Current SOP and cleanup are documented in [tests/agent-e2e/SOP.md](tests/agent-e2e/SOP.md); actual results and HTML are archived under `/tmp/hyacinthus-sop-runs/<run_id>/`. The separately labeled host mode remains diagnostic.

```bash
cd tests/agent-e2e
npm ci --ignore-scripts
npm test          # Offline guards only, not an Agent acceptance result.
npm run list
npm run preflight # Requires existing isolated services and test admin credentials.
npm run test:agent
npm run test:report # Current offline regression + actual Pi scenario + HTML report.
```

## Tests

```bash
cargo fmt
cargo check
cargo test
./scripts/check.sh
```

`tests/golden/*.json` are reviewed protocol snapshots for envelopes, dry-run output, doctor checks, and capability schema. `cargo clippy` should be run when the Rust toolchain has the clippy component installed.

## Release

Tag releases with the package version:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds Linux/macOS x86_64 and arm64 archives, includes an Alpine-compatible `x86_64-unknown-linux-musl` archive, publishes `.tar.gz` assets, and uploads SHA256 checksum files.

Nightly builds run daily at 02:00 Asia/Hong_Kong and can also be started manually:

```bash
gh workflow run cli-nightly.yml
gh run list --workflow "CLI Nightly Build" --limit 5
```

Manual runs upload short-lived workflow artifacts by default. To also refresh the moving `nightly` prerelease:

```bash
gh workflow run cli-nightly.yml -f publish_release=true -f release_tag=nightly
```

After the prerelease is published, the npm wrapper can install it by tag:

```bash
HYACINTHUS_CLI_VERSION=nightly npx @ddgrcf/hyacinthus-cli install
```

Local packaging:

```bash
cargo build --locked --release --target x86_64-unknown-linux-gnu
scripts/package.sh x86_64-unknown-linux-gnu
```

Shell 安装器同样向已存在的 Agent 目录自动安装并核对 Skills；`HYACINTHUS_CLI_SKILLS_DIR` 指定相对或绝对目标目录，`HYACINTHUS_CLI_SKIP_SKILLS=1` 跳过。
