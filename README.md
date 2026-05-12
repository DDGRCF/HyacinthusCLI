# Hyacinthus CLI

Agent-oriented CLI for Fengxinzi Tutoring Center backend operations. The CLI is designed for OpenClaw, Codex, Claude Code, and internal operators that need a stable, structured, auditable command surface.

## Principles

- The backend is the source of truth for permissions, validation, business rules, idempotency, and audit logs.
- The CLI communicates over HTTP and never connects directly to the database, Redis, MinIO, or message queues.
- Default output is JSON envelope format for AI Agent parsing.
- Mutating commands support dry-run where possible and require `--yes` for real execution.
- Write and high-risk capabilities use a structured confirmation protocol with exit code `10`.

## Quick Start

```bash
cargo build

./target/debug/hyacinthus config set-profile local --base-url http://localhost:8000 --default-instance-id 1
./target/debug/hyacinthus config set-token --profile local --token "$HYACINTHUS_AGENT_TOKEN"
./target/debug/hyacinthus doctor --offline
./target/debug/hyacinthus capability list
```

Install from a GitHub release:

```bash
curl -fsSL https://raw.githubusercontent.com/DDGRCF/HyacinthusCLI/main/scripts/install.sh | bash
```

## Core Commands

```bash
hyacinthus config set-profile local --base-url http://localhost:8000 --default-instance-id 1
hyacinthus admin status
hyacinthus claw status
hyacinthus claw skills list
hyacinthus auth status
hyacinthus auth login --scope requirements:parse --wait
hyacinthus auth grant --scope admin:read
hyacinthus auth scopes
hyacinthus auth check --scope requirements:parse
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
hyacinthus skills show hyacinthus-requirements
hyacinthus skills export --dir ./.tmp/agent-skills
hyacinthus skills check --dir ./.tmp/agent-skills
hyacinthus requirements options
hyacinthus requirements parse --file input.txt --instance-id 1
hyacinthus requirements import --file confirmed.json --instance-id 1 --idempotency-key cli-demo --yes
```

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
hyacinthus requirements parse --text "高一数学" --instance-id 1 --dry-run -q '.data.request.body'
hyacinthus requirements parse --text "高一数学" --instance-id 1 --dry-run --force-ai
hyacinthus --request-id trace-123 requirements parse --text "高一数学" --instance-id 1 --dry-run
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
hyacinthus config set-profile dev --base-url http://localhost:8000 --raw-api-enabled
```

Raw API paths must start with `/api/v1/`.

Interactive Agent authorization is supported for hermes-agent, Claw, and other automation clients:

```bash
HYACINTHUS_CLIENT_INSTANCE_ID=hermes-wechat-a HYACINTHUS_CLIENT_DISPLAY_NAME="Hermes WeChat A" HYACINTHUS_CLIENT_TYPE=hermes-agent hyacinthus auth login --scope requirements:parse
HYACINTHUS_CLIENT_INSTANCE_ID=hermes-wechat-a HYACINTHUS_CLIENT_DISPLAY_NAME="Hermes WeChat A" HYACINTHUS_CLIENT_TYPE=hermes-agent hyacinthus auth login --scope requirements:parse --wait
hyacinthus auth grant --scope "requirements:parse requirements:write" --wait
```

`auth login` creates a backend authorization session and prints `authorize_url`, `qr_code_text`, `user_code`, and `required_scopes`. Agents should send the URL or QR text to the user. With `--wait`, the CLI polls until approval and saves the issued Agent token plus scopes into the selected profile. If approval times out or the backend returns a terminal non-`pending` status, the command exits non-zero with a structured auth error envelope.

Commands that return backend data can write the successful `data` payload to a file:

```bash
hyacinthus capability run requirements.options --output options.json
hyacinthus requirements parse --text "高一数学" --instance-id 1 --output parsed.json
hyacinthus requirements import --data @confirmed.json --instance-id 1 --yes --output import-result.json
HYACINTHUS_RAW_API=1 hyacinthus api GET /api/v1/agent/capabilities --output capabilities.json
```

Known token scopes can be declared for local precheck:

```bash
HYACINTHUS_AGENT_SCOPES=requirements:parse,requirements:write hyacinthus requirements import --dry-run --data @rows.json
hyacinthus config set-profile dev --base-url http://localhost:8000 --scopes requirements:parse,requirements:write
hyacinthus auth scopes --domain requirements
hyacinthus auth check --scope "requirements:parse requirements:write"
```

`config set-profile` is incremental for existing profiles: unspecified fields keep their current values. `auth logout` clears both the saved token and saved local scopes for the selected profile.

## Agent Skills

Bundled skills are part of the CLI contract and can be inspected without network access:

```bash
hyacinthus skills list
hyacinthus skills show hyacinthus-shared
hyacinthus skills show hyacinthus-requirements
hyacinthus skills export --dir ~/.codex/skills
hyacinthus skills check --dir ~/.codex/skills
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

Update and skills notices are non-blocking and can be suppressed:

```bash
hyacinthus --no-notice capability list
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

The release workflow builds Linux/macOS x86_64 and arm64 archives, publishes `.tar.gz` assets, and uploads SHA256 checksum files.

Local packaging:

```bash
cargo build --locked --release --target x86_64-unknown-linux-gnu
scripts/package.sh x86_64-unknown-linux-gnu
```
