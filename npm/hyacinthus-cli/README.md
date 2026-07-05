# @ddgrcf/hyacinthus-cli

Private npm wrapper for installing the Hyacinthus CLI from private GitHub Releases.

The npm package does not contain the Rust binary. It uses `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to download release assets from `DDGRCF/HyacinthusCLI`.

```bash
GITHUB_TOKEN=github_pat_xxx npx @ddgrcf/hyacinthus-cli install
npx @ddgrcf/hyacinthus-cli skills install --target hermes
npx @ddgrcf/hyacinthus-cli skills install --target picoclaw --dir /data/picoclaw/workspaces/1/skills
```

The token must be able to read the private `DDGRCF/HyacinthusCLI` repository.

After installation, use the installed `hyacinthus` binary directly:

```bash
hyacinthus requirements extend KKH347 --yes
hyacinthus requirements extend KKH347 --expires-at 2026-07-10T12:00:00 --yes
```

The extension command requires `requirements:write`. Without `--expires-at`, it uses the backend default requirement extension window.

Publish this wrapper from this directory:

```bash
npm publish --access restricted
```

If the npm package is private, configure npm auth before using `npx`. That npm auth only installs this wrapper package; the GitHub release download still requires `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token`.
