---
name: hyacinthus-requirements
version: 0.1.0
description: "风信子家教中心 requirements workflows: parse raw tutoring demand text, confirm missing subject/grade catalog creation, reorder catalog items, and import confirmed rows through hyacinthus requirements commands."
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus requirements --help"
---

# 风信子家教中心 Requirements

Use this skill when the user wants to parse, clean, confirm, or import tutoring demand records into 风信子家教中心.

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

## Missing Subject/Grade Catalog Workflow

If parsed rows include `SUBJECT_NAME_UNMAPPED:*` or `GRADE_NAME_UNMAPPED:*`, do not create catalog entries automatically. Show the missing names to the user and ask whether these should be added to 风信子家教中心.

Preview the creation request:

```bash
hyacinthus requirements catalog create-missing --file parsed.json --dry-run
```

After explicit approval:

```bash
hyacinthus requirements catalog create-missing --file parsed.json --yes
```

You may also pass explicit names:

```bash
hyacinthus requirements catalog create-missing --subject 科创编程 --grade 小升初 --yes
```

This command requires `catalog:write`.

## Catalog Sort Workflow

Use the catalog sort command only after the user has provided or approved the complete ordered ID list.

```bash
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --dry-run
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --yes
```

For grades:

```bash
hyacinthus requirements catalog reorder --target grades --ids 2,1,3 --yes
```

This command requires `catalog:write`.

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
- Do not create missing subjects or grades without explicit user approval.
- Do not reorder subjects or grades without a complete ordered ID list approved by the user.
- Do not import without an idempotency key unless the CLI generated one and returned it.
- Do not use raw API as the normal path.
- Do not print tokens or secrets.
