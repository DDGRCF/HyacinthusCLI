# Hyacinthus CLI

Agent-oriented CLI for 风信子家教中心 backend operations. The CLI is designed for OpenClaw, Codex, Claude Code, and internal operators that need a stable, structured, auditable command surface.

## Principles

- The backend is the source of truth for permissions, validation, business rules, idempotency, and audit logs.
- The CLI communicates over HTTP and never connects directly to the database, Redis, MinIO, or message queues.
- Default output is JSON envelope format for AI Agent parsing.
- Mutating commands support dry-run where possible and require `--yes` for real execution.
- Write and high-risk capabilities use a structured confirmation protocol with exit code `10`.

## Quick Start

```bash
cargo build

./target/debug/hyacinthus auth status
./target/debug/hyacinthus config set-token --profile local --token "$HYACINTHUS_AGENT_TOKEN"
./target/debug/hyacinthus doctor --offline
./target/debug/hyacinthus capability list
```

Install from a GitHub release:

```bash
curl -fsSL https://raw.githubusercontent.com/DDGRCF/HyacinthusCLI/main/scripts/install.sh | bash
```

Install from the private GitHub release through the npm wrapper:

```bash
GITHUB_TOKEN=github_pat_xxx npx @ddgrcf/hyacinthus-cli install
npx @ddgrcf/hyacinthus-cli skills install --target hermes
npx @ddgrcf/hyacinthus-cli skills install --target nullclaw --dir ~/.nullclaw/skills
```

The npm wrapper does not contain the Rust binary. It uses `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to read the private `DDGRCF/HyacinthusCLI` release assets, download the matching archive, verify the `.sha256` checksum, and install `hyacinthus` into `~/.local/bin` by default. Alpine environments are detected as `x86_64-unknown-linux-musl`; other Linux x86_64 environments use `x86_64-unknown-linux-gnu`.

The wrapper package lives in `npm/hyacinthus-cli` and can be published privately with `npm publish --access restricted`. Private npm access only controls the wrapper download; GitHub release access is still checked separately by GitHub.

## Core Commands

```bash
hyacinthus auth status
hyacinthus admin status
hyacinthus claw status
hyacinthus claw skills list
hyacinthus auth status
hyacinthus auth login --scope requirements:read --wait
hyacinthus auth grant --scope admin:read
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
hyacinthus skills show hyacinthus-requirements
hyacinthus skills export --dir ./.tmp/agent-skills
hyacinthus skills check --dir ./.tmp/agent-skills
hyacinthus requirements options
hyacinthus requirements search --keyword 高一数学
hyacinthus requirements parse --file input.txt
hyacinthus requirements catalog create-missing --file parsed.json --dry-run
hyacinthus requirements catalog create-missing --file parsed.json --yes
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --yes
hyacinthus requirements import --file confirmed.json --idempotency-key cli-demo --yes
```

## Environment Variables

The CLI defaults to the production API at `https://www.fxzjjzx.cn`. Set `HYACINTHUS_BASE_URL` or run `hyacinthus config set-profile ... --base-url ...` only for development or staging environments.

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
hyacinthus requirements search --keyword "高一数学" --scope active -q '.data.total'
hyacinthus requirements parse --text "高一数学" --dry-run -q '.data.request.body'
hyacinthus requirements parse --text "高一数学" --dry-run --force-ai
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
hyacinthus config set-profile dev --base-url http://localhost:8000 --raw-api-enabled
```

Raw API paths must start with `/api/v1/`.

Interactive Agent authorization is supported for hermes, Claw, and other automation clients:

```bash
hyacinthus auth login --scope requirements:parse
hyacinthus auth login --scope requirements:read
hyacinthus auth login --scope requirements:parse --wait
hyacinthus auth wait --session-id sess_abc123
hyacinthus auth grant --scope "requirements:parse requirements:write" --wait
```

`auth login` creates a backend authorization session and prints `session_id`, `authorize_url`, `qr_code_text`, `user_code`, and `required_scopes`. Agents should send the URL or QR text to the user, then use `auth wait --session-id <session_id>` after the user approves that exact link. With `--wait`, the CLI creates a new session and polls it until approval, which is useful only when the user can approve that newly created session during the same command run. If approval times out or the backend returns a terminal non-`pending` status, the command exits non-zero with a structured auth error envelope.

The CLI automatically binds each profile to a stable Agent identity. Supported `client_type` values are `hermes`, `codex`, `claude`, `picoclaw`, `nullclaw`, and `hyacinthus-cli`. Single-Agent setups can rely on default homes like `~/.hermes`; multi-instance setups should set a distinct `HYACINTHUS_PROFILE` or Agent home for each instance.

Commands that return backend data can write the successful `data` payload to a file:

```bash
hyacinthus capability run requirements.options --output options.json
hyacinthus requirements parse --text "高一数学" --output parsed.json
hyacinthus requirements import --data @confirmed.json --yes --output import-result.json
HYACINTHUS_RAW_API=1 hyacinthus api GET /api/v1/agent/capabilities --output capabilities.json
```

Known token scopes can be declared for local precheck:

```bash
HYACINTHUS_AGENT_SCOPES=requirements:read hyacinthus requirements search --keyword 高一数学
HYACINTHUS_AGENT_SCOPES=requirements:parse,requirements:write hyacinthus requirements import --dry-run --data @rows.json
hyacinthus config set-profile dev --base-url http://localhost:8000 --scopes requirements:read,requirements:parse,requirements:write
hyacinthus auth scopes --domain requirements
hyacinthus auth check --scope "requirements:read requirements:parse requirements:write"
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
