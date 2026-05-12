---
name: hyacinthus-requirements
version: 0.1.0
description: "Fengxinzi Tutoring Center requirements workflows: parse raw tutoring demand text and import confirmed rows through hyacinthus requirements parse/import."
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus requirements --help"
---

# Fengxinzi Tutoring Center Requirements

Use this skill when the user wants to parse, clean, confirm, or import tutoring demand records into Fengxinzi Tutoring Center.

Read `../hyacinthus-shared/SKILL.md` first for auth, doctor, dry-run, and error handling.

## Parse Workflow

1. Run `hyacinthus doctor` unless this session already verified the environment.
2. Parse raw text:

```bash
hyacinthus requirements parse --file input.txt --instance-id 1
```

or:

```bash
hyacinthus requirements parse --text "高一数学，瓯海区，周末上课" --instance-id 1
```

3. Inspect:

- `data.summary.auto_commit_ready`
- `data.summary.needs_confirmation`
- `data.rows[].can_auto_commit`
- `data.rows[].needs_confirmation`
- `data.rows[].confirmation_reasons`

Rows with `needs_confirmation: true` must not be imported automatically.

## Import Workflow

1. Build a JSON file containing only confirmed rows.
2. Use an idempotency key.
3. Dry-run first:

```bash
hyacinthus requirements import --file confirmed.json --instance-id 1 --idempotency-key cli-demo --dry-run
```

4. Execute:

```bash
hyacinthus requirements import --file confirmed.json --instance-id 1 --idempotency-key cli-demo
```

5. Report:

- `created`
- `updated`
- `failed`
- `failed_rows`

If `failed > 0`, do not blindly retry the whole batch with a new idempotency key.

## Prohibited

- Do not import rows requiring confirmation.
- Do not import without an idempotency key unless the CLI generated one and returned it.
- Do not use raw API as the normal path.
- Do not print tokens or secrets.
