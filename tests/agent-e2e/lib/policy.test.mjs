// 改动说明：验证 Pi 端点与批准边界，并覆盖设备密钥和自然语言授权码的脱敏。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectCall, normalizeArgv, relativeFile, loopbackOrigin, redact, POLICY } from './policy.mjs';
import { preflight } from './preflight.mjs';

const noApproval = { writeApproved: false };

test('only plain loopback HTTP origins are accepted', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:8001'), 'http://127.0.0.1:8001');
  for (const url of ['https://www.fxzjjzx.cn', 'http://user:secret@localhost:8001', 'http://localhost:8001/api', 'http://localhost:8001?x=1']) {
    assert.throws(() => loopbackOrigin(url));
  }
});

test('files remain in the workspace including its isolated tmp mount', () => {
  assert.equal(relativeFile('outputs/report.json'), 'outputs/report.json');
  assert.equal(relativeFile('/tmp/data.json'), '.tmp/data.json');
  assert.deepEqual(normalizeArgv(['requirements', 'parse', '--file=/tmp/data.txt', '-o', '/tmp/output.json']), ['requirements', 'parse', '--file=.tmp/data.txt', '--output', '.tmp/output.json']);
  for (const value of ['/etc/data.json', '/tmp/../data.json', '../data.json', 'outputs/../../data.json', '..\\data.json', '']) {
    assert.throws(() => relativeFile(value));
  }
});

test('real import is denied before approval; preview is permitted', () => {
  assert.throws(() => inspectCall(['requirements', 'import', '--file', 'batch.json', '--yes'], noApproval));
  assert.equal(inspectCall(['requirements', 'import', '--file', 'batch.json', '--dry-run'], noApproval).writes, false);
  assert.equal(inspectCall(['requirements', 'import', '--file', 'batch.json', '--yes'], { writeApproved: true }).writes, true);
});

test('Agent cannot change backend/profile or bypass the domain CLI', () => {
  for (const argv of [
    ['--base-url=https://www.fxzjjzx.cn', 'requirements', 'import'],
    ['requirements', 'search', '--profile', 'production'],
    ['requirements', 'catalog', 'create-missing', '--subject', 'test', '--yes'],
    ['capability', 'run', 'requirements.batch_import', '--yes'],
    ['config', 'set-profile', 'production'],
    ['auth', 'token', 'revoke'],
  ]) assert.throws(() => inspectCall(argv, { writeApproved: true }));
});

test('CLI file arguments reject both separate and equal syntax escapes', () => {
  for (const argv of [
    ['requirements', 'parse', '--file=/etc/input.txt'],
    ['requirements', 'parse', '--file', '../input.txt'],
    ['requirements', 'import', '--data', '@../input.json', '--dry-run'],
    ['requirements', 'import', '--data=@/etc/input.json', '--dry-run'],
    ['requirements', 'parse', '-o', '/etc/output.json'],
    ['requirements', 'parse', '-o/etc/output.json'],
    ['auth', 'login', '--pending-state', '/etc/pending.json'],
  ]) assert.throws(() => inspectCall(argv, noApproval));
});

test('harmless global options preserve the domain action', () => {
  assert.equal(inspectCall(['--no-notice', '--verbose', 'doctor'], noApproval).action, 'doctor');
});

test('authorization requests minimal explicit scopes and shares before waiting', () => {
  assert.equal(inspectCall(['auth', 'login', '--scope', 'requirements:read requirements:parse requirements:write'], noApproval).action, 'auth login');
  assert.throws(() => inspectCall(['auth', 'login'], noApproval));
  assert.throws(() => inspectCall(['auth', 'login', '--scope=admin:read'], noApproval));
  assert.throws(() => inspectCall(['auth', 'login', '--scope', 'requirements:parse', '--wait'], noApproval));
});

test('persisted reports remove tokens and authorization links', () => {
  const result = redact({ token: 'private', data: { token_present: true, authorize_url: 'http://localhost:5667/admin/agent-auth/authorize?session_id=private' }, note: 'Bearer secret' });
  assert.equal(result.token, '<redacted>');
  assert.equal(result.data.token_present, true);
  assert.equal(result.data.authorize_url, '<redacted>');
  assert.equal(result.note, 'Bearer <redacted>');
  assert.equal(redact('**用户代码：** ABCD-1234'), '**用户代码：** <redacted>');
  assert.equal(redact({ device_secret: 'private' }).device_secret, '<redacted>');
});

test('readiness without an explicit test database marker fails before auth', async () => {
  let requests = 0;
  const fakeFetch = async () => { requests += 1; return new Response('{}', { status: 200 }); };
  await assert.rejects(preflight({ api: 'http://127.0.0.1:8000' }, fakeFetch), /hyacinthus_test/);
  assert.equal(requests, 1);
});

test('readiness error or business marker is never accepted', async () => {
  for (const [status, database] of [[503, 'hyacinthus_test'], [200, 'hyacinthus']]) {
    await assert.rejects(preflight({ api: 'http://127.0.0.1:8001' }, async () => new Response('{}', { status, headers: { 'x-hyacinthus-test-database': database } })), /hyacinthus_test/);
  }
});

test('verified existing test services pass without reset or seeding', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-e2e-policy-'));
  try {
    await writeFile(path.join(dir, 'auth.json'), '{}');
    const requests = [];
    const config = { api: 'http://127.0.0.1:8001', admin: 'http://127.0.0.1:5667', adminPassword: 'test-only', cliBinary: process.execPath, piHome: dir };
    const result = await preflight(config, async url => {
      requests.push(url);
      return new Response('{}', { status: 200, headers: { 'x-hyacinthus-test-database': 'hyacinthus_test' } });
    });
    assert.equal(result.reset, false);
    assert.deepEqual(requests, ['http://127.0.0.1:8001/health/ready', 'http://127.0.0.1:5667/admin/login']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saved-mail fixture contains a complete synthetic batch', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/saved-mail.json', import.meta.url), 'utf8'));
  assert.equal(fixture.row_count, POLICY.rows);
  assert.equal(fixture.fixture_kind, 'synthetic_saved_mail');
  assert.ok(fixture.template.includes('{{CODE}}'));
  assert.ok(fixture.template.includes('{{AMOUNT}}'));
});

test('human user code labels are redacted with spaces and varied case',()=>{assert.equal(redact('user code: ABCD-1234; User Code **EFGH-5678**'),'user code: <redacted>; User Code **<redacted>**');});
