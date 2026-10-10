<!-- 改动说明：记录统一 CLI Skills 发现、当前格式二规范交付、安装联动和独立 Pi 验收，并保留此前运行链路调整。 -->
# Changelog

## Unreleased

- Consolidate shared/runtime/requirements into a discoverable `hyacinthus-cli` entry with 11 relative task guides; retain the independent mail workflow.
- Add frontmatter-backed metadata, directory listing and raw/JSON `skills read`; export/check all references and reconcile only previously registered retired entries.
- Install and verify bundled Skills alongside npm and Shell binary installation, with explicit targets/directories and opt-out.
- Guide authentication errors through original authorization links and wait only after user approval; preserve the configured environment during network failures.
- Save full parse/import dry-run data with `--output` even when stdout is reduced with `--jq`; constrain teacher occupation to backend canonical enums and retain experience as description text.
- Add independent Docker API/Worker/PostGIS/Redis/MinIO/Pi acceptance using MiMo Token Plan, natural user tasks, actual browser authorization and independent business readback.
- Replace the bundled Format 2 field rules with the current local canonical specification; keep online-address composition in one source and preserve backend geolocation validation.
- Align the import contract and offline acceptance checks so explicit learner gender is stored in `requester_gender`, independently of requester role, and is not duplicated in description.

- Remove managed runtime guard/probe and status/skill business commands, capabilities, tests, and fixtures.
- Retain Hermes, Codex, Claude Code, and direct CLI authorization, requirement imports, and generic local skill export/install; do not restore Claw/PicoClaw hosting.
- Add Pi authorization with a stable `pi-agent` default profile, process/config-directory detection ahead of inherited Agent homes, explicit profile precedence, and unchanged credential binding checks.
- Add npm skill target `pi` using `~/.pi/agent/skills` or `PI_CODING_AGENT_DIR/skills` without starting Pi or reading its credentials.
- Remove NullClaw client/skill targets and `NULLCLAW_HOME` detection; reject explicit legacy client types and unsupported targets even with `--dir`, without converting them to Pi.
- Add Pi profile/token lifecycle and token-boundary contracts plus npm package skill-target/path coverage.

## 0.1.15

- Reject page-all for capabilities without continuation-token support and validate supported paginated results per page.
- Validate education dates, enums, integer bounds and closed nested profile fields before HTTP requests.
- Apply the documented priority-rule match page-size limit locally.
- Accept a null idempotency key in successful generic batch-import responses.

## 0.1.14

- Preserve decimal compensation strings without floating-point conversion and align condition arrays with the backend.
- Map real parser drafts into closed import requests, excluding review diagnostics and preserving optional fields.
- Enforce closed object schemas, bounds and RFC 3339 dates locally so dry-run detects rejected payloads.
- Explain HTTP 413 failures, retain proxy status, and classify revoked grants as authentication errors.

## 0.1.13

- Normalize requirement extension deadlines to RFC 3339; business times without an offset use +08:00 and invalid dates fail locally.

## 0.1.12

- Persist Agent identity before authorization so a separate auth wait process can resume a new profile.
- Harden authorization polling, token revocation, and credential storage.
- Align bundled Agent capabilities, skills, schema validation, and requirement import lifecycle with backend contracts.
- Add explicit lenient requirement parsing and preserve request IDs through parse requests.

## 0.1.10

- Clarified that release binaries default to the production API at `https://www.fxzjjzx.cn`.
- Marked `localhost` base URL examples as development/staging-only configuration.

## 0.1.9

- Added `hyacinthus requirements extend <requirement_code>` for extending one requirement deadline by business code.
- Added optional `--expires-at` to set a future deadline manually; omitting it uses the backend default extension window.
- Added the `requirements.extend` capability schema and contract coverage for dry-run, confirmation, schema lookup, and backend POST behavior.

## 0.1.7

- Fixed `requirements import` so it can consume `requirements parse -o` data-only output directly.
- Normalized parse-row import payloads by converting numeric compensation strings to JSON numbers and `time_slots: null` to `[]`.
- Added contract coverage for parse-output-to-import dry-run behavior.

## 0.1.6

- Added Agent CLI commands for requirement priority-rule management.
- Added bundled capability definitions for priority-rule list, write, preview, match, refresh, import, and export flows.
- Added contract tests for priority-rule list, confirmation, dry-run, and import behavior.

## 0.1.5

- Fixed runtime profile resolution so temporary Agent environment identity no longer forces default config writes.
- Preserved Agent HOME-derived profile persistence for stable authorization identity.
- Added a contract test for `requirements parse --dry-run` in configless Agent environments.

## 0.1.4

- Updated the bundled requirements import capability schema for current demand fields.
- Added shared Agent rules for requester gender and teacher gender, education, school, and qualification requirements.
- Refreshed requirements import dry-run contract snapshots for the new `description`-required payload.

## 0.1.0

- Initial Agent-oriented Hyacinthus CLI.
- Added profile/auth/doctor/capability/schema/raw API commands.
- Added admin and requirements shortcuts.
- Added structured JSON envelopes, output formats, jq-style dot paths, pagination, notices, content-safety alerts, and scope prechecks.
- Added bundled Agent Skills export/check workflow.
