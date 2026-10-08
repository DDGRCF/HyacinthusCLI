// 改动说明：验证完整 Skills 导出/检查、安装联动目标与自定义目录，不启动 Agent。
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageDir = path.resolve(__dirname, "..");
const wrapper = path.join(packageDir, "bin", "hyacinthus-cli.js");
const unixOnly = { skip: process.platform === "win32" };

/** Run the actual packaged wrapper against a recording fake binary in an isolated home. */
function installSkills(args, env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hyacinthus-wrapper-"));
  const home = path.join(root, "home");
  const installDir = path.join(root, "bin");
  const calls = path.join(root, "calls.txt");
  const piCalls = path.join(root, "pi-calls.txt");
  fs.mkdirSync(home);
  fs.mkdirSync(installDir);
  fs.writeFileSync(
    path.join(installDir, "hyacinthus"),
    '#!/bin/sh\nprintf \'%s\\n\' "$@" >> "$HYACINTHUS_WRAPPER_CALLS"\nprintf \'{"ok":true,"data":{"ok":true}}\\n\'\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(installDir, "pi"),
    '#!/bin/sh\nprintf \'started\\n\' >> "$PI_WRAPPER_CALLS"\nexit 99\n',
    { mode: 0o755 },
  );
  const agentDir = path.join(home, ".pi", "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "auth.json"), "unreadable-as-json-secret");
  try {
    const result = childProcess.spawnSync(
      process.execPath,
      [wrapper, "skills", "install", ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          HOME: home,
          PATH: `${installDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
          HYACINTHUS_CLI_INSTALL_DIR: installDir,
          HYACINTHUS_WRAPPER_CALLS: calls,
          PI_WRAPPER_CALLS: piCalls,
          ...env,
        },
      },
    );
    assert.ifError(result.error);
    assert.equal(fs.existsSync(piCalls), false, "must not execute Pi");
    assert.equal(`${result.stdout}${result.stderr}`.includes("unreadable-as-json-secret"), false);
    return {
      ...result,
      root,
      home,
      calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [],
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Verify export/check receive the same resolved skills directory. */
function assertSkillCommands(result, expectedDir) {
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    "--no-notice", "skills", "export", "--dir", expectedDir,
    "--no-notice", "skills", "check", "--dir", expectedDir,
  ]);
}

test("published package includes the wrapper serving the Pi target", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
  assert.equal(manifest.bin["hyacinthus-cli"], "bin/hyacinthus-cli.js");
  assert.ok(manifest.files.includes("bin"));
  assert.ok(manifest.files.includes("README.md"));
  assert.ok(fs.existsSync(wrapper));
});

test("Pi defaults to ~/.pi/agent/skills without process markers", unixOnly, () => {
  const result = installSkills(["--target", "pi"], { CODEX_HOME: "/stale-codex" });
  assertSkillCommands(result, path.join(result.home, ".pi", "agent", "skills"));
});

test("Pi honors a trimmed PI_CODING_AGENT_DIR override", unixOnly, () => {
  const result = installSkills(["--target", "pi"], { PI_CODING_AGENT_DIR: " ./pi-worker " });
  assertSkillCommands(result, "pi-worker/skills");
});

test("blank Pi home override uses the default home", unixOnly, () => {
  const result = installSkills(["--target", "pi"], { PI_CODING_AGENT_DIR: "   " });
  assertSkillCommands(result, path.join(result.home, ".pi", "agent", "skills"));
});

test("explicit --dir wins for Pi and generic skill installation", unixOnly, () => {
  for (const args of [
    ["--target", "pi", "--dir", "custom-skills"],
    ["--dir", "custom-skills"],
  ]) {
    const result = installSkills(args, { PI_CODING_AGENT_DIR: "./ignored-agent" });
    assertSkillCommands(result, path.join(result.root, "custom-skills"));
  }
});

test("NullClaw is rejected before invoking any binary even with --dir", unixOnly, () => {
  for (const args of [
    ["--target", "nullclaw"],
    ["--target", "nullclaw", "--dir", "custom-skills"],
    ["--target", "picoclaw", "--dir", "custom-skills"],
    ["--target", "claw", "--dir", "custom-skills"],
  ]) {
    const result = installSkills(args, { NULLCLAW_HOME: "/stale-nullclaw" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported skills target/);
    assert.match(result.stderr, /supported targets: hermes, codex, claude, pi/);
    assert.deepEqual(result.calls, []);
  }
});

test("existing skill targets keep their package destinations", unixOnly, () => {
  for (const target of ["hermes", "codex", "claude"]) {
    const result = installSkills(["--target", target]);
    assertSkillCommands(result, path.join(result.home, `.${target}`, "skills"));
  }
});

/** Query the actual install target resolver in a fresh process with isolated Agent homes. */
function resolveInstallTargets(args, homes = [], env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyacinthus-detection-'));
  for (const name of homes) fs.mkdirSync(path.join(root, name), { recursive: true });
  try {
    const result = childProcess.spawnSync(process.execPath, ['-e',
      'const wrapper=require(process.argv[1]);console.log(JSON.stringify(wrapper.installSkillDestinations(JSON.parse(process.argv[2]))));', wrapper, JSON.stringify(args)],
      { cwd: root, encoding: 'utf8', env: { HOME: root, PATH: process.env.PATH, ...env } });
    return { ...result, root, paths: result.status === 0 ? JSON.parse(result.stdout) : [] };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('normal install discovers existing Agent homes and exports to each once', () => {
  const r = resolveInstallTargets({}, ['.pi/agent', '.codex']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.paths.sort(), [path.join(r.root, '.codex/skills'), path.join(r.root, '.pi/agent/skills')].sort());
});

test('explicit install target, custom directory and binary-only mode resolve independently', () => {
  const pi = resolveInstallTargets({ 'skills-target': 'pi' });
  assert.deepEqual(pi.paths, [path.join(pi.root, '.pi/agent/skills')]);
  const custom = resolveInstallTargets({ 'skills-dir': 'custom' }, ['.codex']);
  assert.deepEqual(custom.paths, [path.join(custom.root, 'custom')]);
  assert.deepEqual(resolveInstallTargets({ 'skip-skills': true }, ['.codex']).paths, []);
  assert.deepEqual(resolveInstallTargets({}).paths, []);
});

test('invalid install skill target or conflicting choices fail before release download', () => {
  for (const args of [{ 'skills-target': 'nullclaw' }, { 'skills-target': 'pi', 'skip-skills': true }, { 'skills-dir': true }]) {
    assert.notEqual(resolveInstallTargets(args).status, 0);
  }
});
