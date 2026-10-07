// 改动说明：用真实 CLI 归档验证 Shell 安装器的自动发现、相对目录和跳过，下载仅替换为本地夹具。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const cli = path.resolve(import.meta.dirname, '../../../target/debug/hyacinthus');
const installer = path.resolve(import.meta.dirname, '../../../scripts/install.sh');

/** Install the real current binary using a local archive transport and a clean disposable Agent home. */
function scenario(extraEnv, verify) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hyacinthus-shell-install-'));
  try {
    const bins = path.join(root, 'bin');
    const payload = path.join(root, 'payload');
    const home = path.join(root, 'home');
    for (const dir of [bins, payload, home]) mkdirSync(dir);
    mkdirSync(path.join(home, '.pi/agent'), { recursive: true });
    copyFileSync(cli, path.join(payload, 'hyacinthus'));
    const archive = path.join(root, 'hyacinthus-cli-x86_64-unknown-linux-gnu.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', payload, 'hyacinthus']);
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
    writeFileSync(path.join(bins, 'curl'), '#!/bin/sh\ncase "$2" in *.sha256) cp "$SHELL_FIXTURE_ARCHIVE.sha256" "$4";; *) cp "$SHELL_FIXTURE_ARCHIVE" "$4";; esac\n', { mode: 0o755 });
    execFileSync('bash', [installer], { cwd: root, encoding: 'utf8', env: {
      PATH: `${bins}:${process.env.PATH}`, HOME: home, HYACINTHUS_CLI_INSTALL_DIR: path.join(root, 'installed'),
      HYACINTHUS_CLI_TARGET: 'x86_64-unknown-linux-gnu', SHELL_FIXTURE_ARCHIVE: archive,
      HYACINTHUS_CONFIG_DIR: path.join(root, 'config'), HYACINTHUS_CLI_LATEST_VERSION: '0.1.15',
      ...extraEnv,
    } });
    verify(root, home);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('Shell install discovers Pi and exports the complete verified Skill tree', () => {
  scenario({}, (_root, home) => {
    assert.ok(existsSync(path.join(home, '.pi/agent/skills/hyacinthus-cli/references/auth.md')));
    assert.ok(existsSync(path.join(home, '.pi/agent/skills/tutoring-job-mail-upload/SKILL.md')));
  });
});

test('Shell install honors an explicit relative Skills directory', () => {
  scenario({ HYACINTHUS_CLI_SKILLS_DIR: 'project-skills' }, (root, home) => {
    assert.ok(existsSync(path.join(root, 'project-skills/hyacinthus-cli/references/auth.md')));
    assert.equal(existsSync(path.join(home, '.pi/agent/skills')), false);
  });
});

test('Shell install can explicitly skip Skills', () => {
  scenario({ HYACINTHUS_CLI_SKIP_SKILLS: '1' }, (root, home) => {
    assert.ok(existsSync(path.join(root, 'installed/hyacinthus')));
    assert.equal(existsSync(path.join(home, '.pi/agent/skills')), false);
  });
});
