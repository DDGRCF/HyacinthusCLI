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

## Instance Identity

Use the current Hyacinthus CLI profile default instance. Do not add `--instance-id`
unless the user explicitly provides an instance ID or `hyacinthus auth status`
shows `default_instance_id` is missing.

## Pre-Parse Normalization

Before parse, normalize toward:

```text
编号 / 年级 / 性别 / 科目 / 次数 / 时间 / 薪酬 / 地址 / 要求 / 备注
```

Rules:

- Classify by meaning, not label.
- `地址`: only locatable place; move noise/nearby notes to `备注`.
- Student gender -> `性别`; teacher gender -> `要求`.
- `次数`: frequency + duration; `时间`: weekday/date/window.
- Preserve useful order-code city/channel prefixes; strip emoji/ads.
- `备注`: 暑假单, 回收单, 线上单 context, near-campus notes, class format.

Review if address is only city/district, fields are mixed, jobs are merged, or subject/grade/address is unclear.

## Parse Workflow

1. Run `hyacinthus doctor` unless this session already verified the environment.
2. Parse raw text:

```bash
hyacinthus requirements parse --file input.txt
```

or:

```bash
hyacinthus requirements parse --text "高一数学，瓯海区，周末上课"
```

3. Inspect:

- `data.summary.auto_commit_ready`
- `data.summary.needs_confirmation`
- `data.rows[].can_auto_commit`
- `data.rows[].needs_confirmation`
- `data.rows[].confirmation_reasons`

Rows with `needs_confirmation: true` must not be imported automatically.

## Warning Handling

Use `confirmation_reasons` as review actions; inspect `warnings` when collecting unmapped catalog names:

- `errors` present: mark row unusable until fixed.
- `ADDRESS_DETAIL_MISSING`: ask for a locatable address.
- `SUBJECTS_EMPTY_FOR_TUTORING`: ask for subject; keep blocked until subject/catalog strategy is resolved.
- `GRADE_EMPTY_FOR_TUTORING`: ask for grade or confirm catalog gap.
- `*_UNMAPPED:*`: ask before creating catalog entries.
- `TIME_SLOTS_PARSE_FAILED`: keep original time text; require review.
- `LOW_CONFIDENCE` / `DESCRIPTION_REQUIRED`: require manual review.
- `REQUIREMENT_CODE_EMPTY`: flag for review; fill code if business requires it.
- `MULTIPLE_REQUIREMENT_CODES_FOUND`: split rows or confirm one code.
- `CONTACT_PHONE_INVALID`: fix contact value.

When summarizing review items, show concise `confirmation_reasons` first, not full JSON.

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

For raw copied demand text or a dataset file, prefer the atomic raw import command so the CLI, not the Agent, filters rows:

```bash
hyacinthus requirements import-raw --file input.txt --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --dry-run --output outputs/import_raw_dry_run.json -q .data.parse_summary
hyacinthus requirements import-raw --file input.txt --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --yes --output outputs/import_raw_execute.json -q .data.parse_summary
```

`import-raw` parses first, imports only rows with `can_auto_commit: true` and `needs_confirmation: false`, and reports skipped rows with confirmation reasons. For datasets, write the full result to `outputs/` and keep stdout to a summary path; do not print large `skipped_rows` JSON unless debugging.

For already parsed or confirmed JSON rows:

1. Use an idempotency key.
2. Dry-run first:

```bash
hyacinthus requirements import --file confirmed.json --idempotency-key cli-demo --dry-run
```

3. Execute:

```bash
hyacinthus requirements import --file confirmed.json --idempotency-key cli-demo --yes
```

Report:

- `created`
- `updated`
- `failed`
- `failed_rows`
- `skipped_rows` for `import-raw`

If `failed > 0`, do not blindly retry the whole batch with a new idempotency key.

## Prohibited

- Do not import rows requiring confirmation.
- Do not create missing subjects or grades without explicit user approval.
- Do not reorder subjects or grades without a complete ordered ID list approved by the user.
- Do not import without an idempotency key unless the CLI generated one and returned it.
- Do not bypass `import-raw`/`parse` confirmation rules for raw text.
- Do not copy example instance IDs such as `1`; use the profile default instance unless explicitly told otherwise.
- Do not invent address, duration, salary, or teacher requirements to fill missing fields.
- Do not use raw API as the normal path.
- Do not print tokens or secrets.
