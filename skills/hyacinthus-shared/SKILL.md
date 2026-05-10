---
name: hyacinthus-shared
version: 0.1.0
description: "Hyacinthus CLI shared rules: configuration, auth, doctor, capability schema, output envelopes, dry-run, and high-risk confirmation handling."
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus --help"
---

# Hyacinthus CLI Shared Rules

Use this skill whenever an Agent needs to operate Hyacinthus through `hyacinthus`.

## First Step

Before business operations, run:

```bash
hyacinthus doctor
```

If `doctor` reports failed checks, do not continue with business commands. Report the failed check and its hint to the user.

## Configuration

```bash
hyacinthus config set-profile local --base-url http://localhost:8000 --default-instance-id 1
hyacinthus config set-token --profile local --token <token>
hyacinthus auth status
```

Never print tokens or secrets. `config show` redacts token fields.

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
