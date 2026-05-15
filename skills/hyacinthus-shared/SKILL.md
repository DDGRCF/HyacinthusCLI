---
name: hyacinthus-shared
version: 0.1.0
description: "风信子家教中心 Hyacinthus CLI shared rules: configuration, auth, doctor, capability schema, output envelopes, dry-run, and high-risk confirmation handling."
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus --help"
---

# 风信子家教中心 Hyacinthus CLI Shared Rules

Use this skill whenever an Agent needs to operate 风信子家教中心 through `hyacinthus`.

## First Step

Before business operations, run:

```bash
hyacinthus doctor
```

If `doctor` reports failed checks, do not continue with business commands. Report the failed check and its hint to the user.

## Configuration

```bash
hyacinthus config set-profile local --base-url http://localhost:8000 --default-instance-id 1
hyacinthus auth status
```

Do not ask the user to paste raw tokens. If `auth status` reports `token_present: false`, use the authorization link/QR flow from the Agent-specific skill.

Never print tokens or secrets. `config show` redacts token fields.

## Authorization Link Flow

When `auth status` reports `token_present: false`, or a command returns `AUTH_REQUIRED`, create an authorization session for the required scopes:

```bash
hyacinthus auth login --scope "<required scopes>"
```

Forward these fields to the user:

- `session_id`
- `authorize_url`
- `qr_code_text`
- `user_code`
- `required_scopes`
- `expires_at`

After the user says they approved the authorization, wait on the same session:

```bash
hyacinthus auth wait --session-id "<session_id>"
```

Retry the original command only after `token_saved` is true.

Do not run `hyacinthus auth login --scope ... --wait` after sending an authorization link to the user. That creates a new authorization session and cannot observe approval for the link already sent.

## Agent Identity

`hyacinthus` binds authorization to a profile. Each profile automatically gets a stable `client_instance_id`, a display name, and one supported `client_type`.

Supported client types and defaults:

| Agent | Default home | Default profile | client_type | Multi-instance rule |
| --- | --- | --- | --- | --- |
| Hermes | `~/.hermes` | `hermes-default` | `hermes` | Use distinct `HERMES_HOME` or `HYACINTHUS_PROFILE` |
| Codex | `~/.codex` | `codex-default` | `codex` | Use distinct `CODEX_HOME` or `HYACINTHUS_PROFILE` |
| Claude Code | `~/.claude` | `claude-default` | `claude` | Use distinct `CLAUDE_HOME` or `HYACINTHUS_PROFILE` |
| PicoClaw | `~/.picoclaw` | `picoclaw-default` | `picoclaw` | Use distinct `PICOCLAW_HOME` or `HYACINTHUS_PROFILE` |
| NullClaw | `~/.nullclaw` | `nullclaw-default` | `nullclaw` | Use distinct `NULLCLAW_HOME` or `HYACINTHUS_PROFILE` |
| Terminal CLI | `$HOME` | `local` | `hyacinthus-cli` | Use explicit `--profile` for separation |

Single-agent setups usually do not need manual identity variables. For multi-agent setups, the Agent home and `HYACINTHUS_PROFILE` must point to the same logical instance.

## Capability Discovery

Use schema before calling unfamiliar capabilities:

```bash
hyacinthus capability list
hyacinthus schema requirements.batch_parse
hyacinthus capability schema requirements.batch_import
```

## Output Protocol

Default output is JSON:

- `ok: true` means success.
- `ok: false` means structured failure.
- Read `error.type`, `error.code`, `error.hint`, and `error.retryable`.

Exit codes:

- `0`: success
- `1`: API/business error
- `2`: validation error
- `3`: auth/permission error
- `4`: network error
- `5`: internal error
- `6`: content safety block
- `10`: confirmation required

## High-Risk Confirmation

When a command exits `10` with `error.type == "confirmation_required"`:

1. Show the user `error.risk.action` and the important parameters.
2. Ask for explicit approval.
3. If approved, retry the original argv with `--yes` appended.
4. If rejected, stop.

Never automatically append `--yes`.

## Dry Run

For mutating commands, prefer:

```bash
hyacinthus <command> --dry-run
```

Dry-run output redacts sensitive fields and does not write data.
