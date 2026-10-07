#!/usr/bin/env node
// 改动说明：安装 CLI 时联动可发现的完整 Skills，支持显式目标、自动发现和跳过；不启动 Agent 或读取其凭据。
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_REPO = "DDGRCF/HyacinthusCLI";
const DEFAULT_INSTALL_DIR = path.join(os.homedir(), ".local", "bin");
const SUPPORTED_SKILL_TARGETS = new Map([
  ["hermes", path.join((process.env.HERMES_HOME || "").trim() || path.join(os.homedir(), ".hermes"), "skills")],
  ["codex", path.join((process.env.CODEX_HOME || "").trim() || path.join(os.homedir(), ".codex"), "skills")],
  ["claude", path.join((process.env.CLAUDE_HOME || "").trim() || path.join(os.homedir(), ".claude"), "skills")],
  ["pi", path.join((process.env.PI_CODING_AGENT_DIR || "").trim() || path.join(os.homedir(), ".pi", "agent"), "skills")],
]);

function printUsage() {
  console.log(`Hyacinthus CLI private installer

Usage:
  hyacinthus-cli install [--version latest|v0.1.0] [--target <triple>] [--install-dir <dir>]
                        [--skills-target hermes|codex|claude|pi | --skills-dir <dir> | --skip-skills]
  hyacinthus-cli skills install --target hermes|codex|claude|pi [--dir <dir>]

Environment:
  GITHUB_TOKEN or GH_TOKEN              GitHub token for private release downloads
  HYACINTHUS_CLI_REPO                  GitHub repo, default ${DEFAULT_REPO}
  HYACINTHUS_CLI_VERSION               Release version, default latest
  HYACINTHUS_CLI_TARGET                Release target triple override
  HYACINTHUS_CLI_INSTALL_DIR           Install dir, default ${DEFAULT_INSTALL_DIR}
  PI_CODING_AGENT_DIR                  Pi config dir, default ~/.pi/agent; skills use its skills/ directory

Install exports/checks bundled Skills for detected Agent homes by default.
Use --skills-target to select one Agent, --skills-dir for a custom directory,
or --skip-skills for a binary-only install. Restart the Agent session after updating Skills.
`);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function getGithubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const token = childProcess.execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token || null;
  } catch (_error) {
    return null;
  }
}

function detectTarget() {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "linux" && arch === "x64") {
    return fs.existsSync("/etc/alpine-release")
      ? "x86_64-unknown-linux-musl"
      : "x86_64-unknown-linux-gnu";
  }
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  fail(`unsupported platform: ${platform}/${arch}`, 2);
}

function requestBuffer(url, token, accept, redirects = 0) {
  return new Promise((resolve, reject) => {
    const options = new URL(url);
    options.headers = {
      "User-Agent": "@ddgrcf/hyacinthus-cli",
      Accept: accept,
    };
    if (options.hostname === "api.github.com") {
      options.headers.Authorization = `Bearer ${token}`;
      options.headers["X-GitHub-Api-Version"] = "2022-11-28";
    }
    https
      .get(options, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (!response.headers.location) {
            reject(new Error(`redirect without location for ${url}`));
            return;
          }
          if (redirects > 5) {
            reject(new Error(`too many redirects for ${url}`));
            return;
          }
          resolve(requestBuffer(response.headers.location, token, accept, redirects + 1));
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode} ${url}\n${body.toString("utf8")}`));
            return;
          }
          resolve(body);
        });
      })
      .on("error", reject);
  });
}

async function requestJson(url, token) {
  const body = await requestBuffer(url, token, "application/vnd.github+json");
  return JSON.parse(body.toString("utf8"));
}

function releaseApiUrl(repo, version) {
  const encodedRepo = repo.split("/").map(encodeURIComponent).join("/");
  if (version === "latest") {
    return `https://api.github.com/repos/${encodedRepo}/releases/latest`;
  }
  return `https://api.github.com/repos/${encodedRepo}/releases/tags/${encodeURIComponent(version)}`;
}

function expectedAssetName(version, target, suffix = "") {
  if (version === "latest") {
    return `hyacinthus-cli-${target}.tar.gz${suffix}`;
  }
  return `hyacinthus-cli-${version.replace(/^v/, "")}-${target}.tar.gz${suffix}`;
}

function findAsset(release, name) {
  const asset = Array.isArray(release.assets)
    ? release.assets.find((candidate) => candidate.name === name)
    : null;
  if (!asset) {
    const names = (release.assets || []).map((candidate) => candidate.name).join(", ");
    fail(`release asset not found: ${name}\navailable assets: ${names || "(none)"}`);
  }
  return asset;
}

async function downloadReleaseAsset(asset, token) {
  return requestBuffer(asset.url, token, "application/octet-stream");
}

function verifySha256(archive, checksumText, archiveName) {
  const expected = checksumText.trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(archive).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(expected)) {
    fail(`invalid checksum file for ${archiveName}`);
  }
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`checksum mismatch for ${archiveName}\nexpected ${expected}\nactual   ${actual}`);
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hyacinthus-cli-"));
}

function extractArchive(archivePath, outDir) {
  childProcess.execFileSync("tar", ["-xzf", archivePath, "-C", outDir], { stdio: "inherit" });
}

function findBinary(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(fullPath);
      if (found) return found;
    }
    if (entry.isFile() && entry.name === "hyacinthus") return fullPath;
  }
  return null;
}

/** Download the verified binary and install its own version-bound Skills. */
async function installCommand(args) {
  const skillDestinations = installSkillDestinations(args);
  const repo = args.repo || process.env.HYACINTHUS_CLI_REPO || DEFAULT_REPO;
  const version = args.version || process.env.HYACINTHUS_CLI_VERSION || "latest";
  const target = args.target || process.env.HYACINTHUS_CLI_TARGET || detectTarget();
  const installDir = path.resolve(args["install-dir"] || process.env.HYACINTHUS_CLI_INSTALL_DIR || DEFAULT_INSTALL_DIR);
  const token = getGithubToken();
  if (!token) {
    fail("GitHub token is required for private HyacinthusCLI release downloads. Set GITHUB_TOKEN, GH_TOKEN, or run `gh auth login`.");
  }

  const archiveName = expectedAssetName(version, target);
  const checksumName = expectedAssetName(version, target, ".sha256");
  const release = await requestJson(releaseApiUrl(repo, version), token);
  const archiveAsset = findAsset(release, archiveName);
  const checksumAsset = findAsset(release, checksumName);
  const archive = await downloadReleaseAsset(archiveAsset, token);
  const checksum = await downloadReleaseAsset(checksumAsset, token);
  verifySha256(archive, checksum.toString("utf8"), archiveName);

  const tmpDir = makeTempDir();
  try {
    const archivePath = path.join(tmpDir, archiveName);
    fs.writeFileSync(archivePath, archive);
    extractArchive(archivePath, tmpDir);
    const binary = findBinary(tmpDir);
    if (!binary) fail("hyacinthus binary not found in archive");
    fs.mkdirSync(installDir, { recursive: true });
    const installed = path.join(installDir, "hyacinthus");
    fs.copyFileSync(binary, installed);
    fs.chmodSync(installed, 0o755);
    childProcess.execFileSync(installed, ["--version"], { stdio: "inherit" });
    console.log(`installed ${installed}`);
    installBundledSkills(installed, skillDestinations);
    return installed;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function resolveHyacinthusBinary(args) {
  const installDir = path.resolve(args["install-dir"] || process.env.HYACINTHUS_CLI_INSTALL_DIR || DEFAULT_INSTALL_DIR);
  const installed = path.join(installDir, "hyacinthus");
  if (fs.existsSync(installed)) return installed;
  const pathCheck = childProcess.spawnSync("hyacinthus", ["--version"], { stdio: "ignore" });
  if (pathCheck.status === 0) return "hyacinthus";
  fail(`hyacinthus binary not found. Run \`hyacinthus-cli install\` first, or pass --install-dir if it is installed outside ${installDir}.`);
}

/** Resolve a supported Agent skill directory or an explicitly supplied generic directory. */
function skillsDir(args) {
  const target = args.target;
  if (target && !SUPPORTED_SKILL_TARGETS.has(target)) {
    fail(`unsupported skills target: ${target}\nsupported targets: ${Array.from(SUPPORTED_SKILL_TARGETS.keys()).join(", ")}`);
  }
  if (args.dir) return path.resolve(args.dir);
  if (!target) fail("skills install requires --target hermes|codex|claude|pi or --dir");
  return SUPPORTED_SKILL_TARGETS.get(target);
}

/** Resolve installation targets before a download or any filesystem mutation. */
function installSkillDestinations(args) {
  const requested = [args["skills-target"], args["skills-dir"], args["skip-skills"]].filter(Boolean);
  if (requested.length > 1) fail("choose only one of --skills-target, --skills-dir or --skip-skills", 2);
  if (args["skip-skills"]) return [];
  if (args["skills-target"]) return [skillsDir({ target: args["skills-target"] })];
  if (args["skills-dir"]) {
    if (typeof args["skills-dir"] !== "string") fail("--skills-dir requires a directory", 2);
    return [path.resolve(args["skills-dir"])];
  }
  const homes = { hermes: "HERMES_HOME", codex: "CODEX_HOME", claude: "CLAUDE_HOME", pi: "PI_CODING_AGENT_DIR" };
  return [...new Set(Array.from(SUPPORTED_SKILL_TARGETS, ([target, dir]) =>
    (process.env[homes[target]] || "").trim() || fs.existsSync(path.dirname(dir)) ? path.resolve(dir) : null).filter(Boolean))];
}

/** Export and verify every entry and reference without running an Agent or reading its login. */
function installBundledSkills(binary, destinations) {
  if (destinations.length === 0) {
    console.log("No Skill destination selected. Run hyacinthus-cli skills install --target <agent> when needed.");
    return;
  }
  for (const outDir of destinations) {
    childProcess.execFileSync(binary, ["--no-notice", "skills", "export", "--dir", outDir], { stdio: "inherit" });
    const checked = childProcess.execFileSync(binary, ["--no-notice", "skills", "check", "--dir", outDir], { encoding: "utf8" });
    const result = JSON.parse(checked);
    if (result.ok !== true || result.data?.ok !== true) throw new Error(`Bundled Skill verification failed for ${outDir}`);
    console.log(`installed and verified Hyacinthus Skills in ${outDir}`);
  }
  console.log("Restart your Agent session to load hyacinthus-cli and tutoring-job-mail-upload.");
}

/** Install bundled Skills from an already installed binary. */
async function skillsInstallCommand(args) {
  const outDir = skillsDir(args);
  const binary = resolveHyacinthusBinary(args);
  installBundledSkills(binary, [outDir]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, subcommand] = args._;
  if (!command || command === "help" || args.help) {
    printUsage();
    return;
  }
  if (command === "install") {
    await installCommand(args);
    return;
  }
  if (command === "skills" && subcommand === "install") {
    await skillsInstallCommand(args);
    return;
  }
  fail(`unknown command: ${args._.join(" ")}`);
}

if (require.main === module) main().catch((error) => fail(error.stack || error.message));
module.exports = { installSkillDestinations, installBundledSkills };
