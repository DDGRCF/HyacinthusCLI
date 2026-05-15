---
name: hyacinthus-agent-runtime
description: Use the 风信子家教中心 Hyacinthus CLI from Agent runtimes, including link/QR authorization handoff.
---

# 风信子家教中心 Hyacinthus CLI for Agent Runtimes

Use this skill when an Agent runtime needs to operate 风信子家教中心 through the `hyacinthus` CLI.

## Authorization

1. Check the current authorization profile. A single Agent instance can use the default inferred profile; multiple instances must set the runtime home environment variable or `HYACINTHUS_PROFILE`.

```bash
hyacinthus auth status
```

Supported Agent client types:

- `hermes`: Hermes Agent
- `codex`: Codex
- `claude`: Claude Code
- `picoclaw`: PicoClaw
- `nullclaw`: NullClaw
- `hyacinthus-cli`: direct terminal CLI

2. If the profile has no token or the requested command returns `AUTH_REQUIRED`, forward these fields to the user:

- `session_id`
- `authorize_url`
- `qr_code_text`
- `user_code`
- `required_scopes`
- `expires_at`

Keep the exact `session_id` from the authorization response. It is required for the follow-up wait command.

3. Ask the user to open the URL or scan the QR text and approve the request.

4. After the user says they approved the authorization, poll the same session and save credentials:

```bash
hyacinthus auth wait --session-id "<session_id>"
```

5. Retry the original command only after `token_saved` is true.

Do not run `hyacinthus auth login --scope ... --wait` after sending an authorization link to the user. That creates a new authorization session and will not observe approval for the link already sent.

For multiple Agent instances, never reuse the same `hyacinthus` profile. Bind each runtime home to a distinct profile:

```bash
HERMES_HOME=/home/r/.hermes-wechat-a HYACINTHUS_PROFILE=hermes-wechat-a hermes gateway run
```

## Scope Rules

- Requirements parsing needs `requirements:parse`.
- Requirements import needs `requirements:write`.
- Claw status and skills need `claw:read`.
- Admin status needs `admin:read`.

Do not ask the user to paste raw tokens. Use the authorization URL/QR handoff.

## Output Rules

The 风信子家教中心 Hyacinthus CLI returns JSON envelopes by default. Inspect:

- `ok`
- `data`
- `error.type`
- `error.code`
- `error.detail`
- `meta.command`

For `AUTH_REQUIRED`, the useful handoff fields are under `error.detail`.
