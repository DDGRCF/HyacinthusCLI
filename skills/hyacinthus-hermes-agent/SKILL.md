---
name: hyacinthus-hermes-agent
description: Use the Fengxinzi Tutoring Center Hyacinthus CLI from Hermes Agent, including link/QR authorization handoff.
---

# Fengxinzi Tutoring Center Hyacinthus CLI for Hermes Agent

Use this skill when Hermes Agent needs to operate Fengxinzi Tutoring Center through the `hyacinthus` CLI.

## Authorization

1. Prefer an existing configured profile dedicated to this Hermes instance:

```bash
hyacinthus --profile <instance-profile> auth status
```

Each Hermes instance must use its own `hyacinthus` profile plus instance identity:

- `HYACINTHUS_PROFILE`
- `HYACINTHUS_CLIENT_INSTANCE_ID`
- `HYACINTHUS_CLIENT_DISPLAY_NAME`
- `HYACINTHUS_CLIENT_TYPE=hermes-agent`

2. If the profile has no token or the requested command returns `AUTH_REQUIRED`, forward these fields to the user:

- `authorize_url`
- `qr_code_text`
- `user_code`
- `required_scopes`
- `expires_at`

3. Ask the user to open the URL or scan the QR text and approve the request.

4. Poll and save credentials:

```bash
hyacinthus --profile <instance-profile> auth login --scope "<required scopes>" --wait
```

5. Retry the original command only after `token_saved` is true.

Never reuse the same `hyacinthus` profile across different Hermes instances.

## Scope Rules

- Requirements parsing needs `requirements:parse`.
- Requirements import needs `requirements:write`.
- Claw status and skills need `claw:read`.
- Admin status needs `admin:read`.

Do not ask the user to paste raw tokens. Use the authorization URL/QR handoff.

## Output Rules

The Fengxinzi Tutoring Center Hyacinthus CLI returns JSON envelopes by default. Inspect:

- `ok`
- `data`
- `error.type`
- `error.code`
- `error.detail`
- `meta.command`

For `AUTH_REQUIRED`, the useful handoff fields are under `error.detail`.
