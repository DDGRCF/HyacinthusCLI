<!-- 改动说明：安装 CLI 联动可发现的版本一致 Skills，支持自动发现、显式目标和完整引用检查。 -->
# @ddgrcf/hyacinthus-cli

Private npm wrapper for installing the Hyacinthus CLI from private GitHub Releases.

The npm package does not contain the Rust binary. It uses `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to download release assets from `DDGRCF/HyacinthusCLI`.

```bash
GITHUB_TOKEN=github_pat_xxx npx @ddgrcf/hyacinthus-cli install --skills-target pi
npx @ddgrcf/hyacinthus-cli skills install --target hermes
npx @ddgrcf/hyacinthus-cli skills install --target pi
PI_CODING_AGENT_DIR=./pi-worker npx @ddgrcf/hyacinthus-cli skills install --target pi
npx @ddgrcf/hyacinthus-cli skills install --dir ./agent-skills
```

Supported skill targets are `hermes`, `codex`, `claude`, and `pi`. Pi's default destination is `~/.pi/agent/skills`; a non-empty, trimmed `PI_CODING_AGENT_DIR` changes it to `<PI_CODING_AGENT_DIR>/skills`, matching the Rust CLI's Pi config directory rule. Pi process markers are not required for installation. The wrapper only calls `hyacinthus skills export/check`: it does not execute Pi or read Pi credentials.

An explicit `--dir` takes precedence and also supports generic destinations without a target; if `--target` is supplied it must be supported even with `--dir`. `nullclaw` is rejected, and `NULLCLAW_HOME` is not used. Claw/PicoClaw hosting is not provided. The Rust CLI preserves `hyacinthus-cli` as the direct-terminal authorization identity and supports `pi` for Pi Agent authorization.

Bundled exports also include `tutoring-job-mail-upload`, the saved-mail → 16-field text → authorized, reviewed batch-import workflow. The wrapper exports the skills embedded in the installed Rust binary; use a release containing this skill, not a separate copy under `~/Tests`.

The token must be able to read the private `DDGRCF/HyacinthusCLI` repository.

After installation, use the installed `hyacinthus` binary directly:

```bash
hyacinthus requirements extend KKH347 --yes
hyacinthus requirements extend KKH347 --expires-at 2027-07-10T12:00:00 --yes
```

Installed release binaries default to the production API at `https://www.fxzjjzx.cn`; normal production use does not need `--base-url`. Set `HYACINTHUS_BASE_URL` or a profile `--base-url` only when intentionally targeting development or staging.

The extension command requires `requirements:write`. Without `--expires-at`, it uses the backend default requirement extension window.

Publish this wrapper from this directory:

```bash
npm publish --access restricted
```

If the npm package is private, configure npm auth before using `npx`. That npm auth only installs this wrapper package; the GitHub release download still requires `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token`.

`install` defaults to installing both discoverable entrypoints and all references into detected Agent homes. `--skills-target hermes|codex|claude|pi` selects one destination, `--skills-dir <dir>` selects a generic directory, and `--skip-skills` installs only the binary. These options are mutually exclusive. Existing `skills install --target ...` updates Skills from the already installed binary. Every install verifies the exported content and checks the inner `data.ok` result, not just the process exit code. Start a new Agent session after updating Skills.
