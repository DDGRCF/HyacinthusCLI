// 改动说明：回归命令help不申请授权，以及只读学校目录白名单不开放其他目录或写路由。
import test from 'node:test';
import assert from 'node:assert/strict';
import { callKind } from './sop-policy.mjs';

test('auth login help never requires scopes while actual login keeps scope and wait guards', () => {
  for (const flag of ['--help', '-h']) {
    assert.deepEqual(callKind(['auth', 'login', flag], []), { action: 'auth login', writes: false });
    assert.equal(callKind(['requirements', 'import', flag], []).writes, false);
  }
  assert.throws(() => callKind(['auth', 'login'], []), /exceeds/);
  assert.throws(() => callKind(['auth', 'login', '--scope', 'admin:read'], ['requirements:read']), /exceeds/);
  assert.throws(() => callKind(['auth', 'login', '--scope', 'requirements:read', '--wait'], ['requirements:read']), /link before waiting/);
  assert.equal(callKind(['auth', 'login', '--scope', 'requirements:read'], ['requirements:read']).writes, false);
});

test('only schools is permitted as a readonly requirements catalog command', () => {
  assert.deepEqual(callKind(['requirements', 'catalog', 'schools', '--keyword', 'Synthetic'], ['requirements:read']), { action: 'requirements catalog schools', writes: false });
  for (const command of ['subjects', 'sync', 'add', 'delete']) assert.throws(() => callKind(['requirements', 'catalog', command], ['requirements:read']), /Unrequested CLI action/);
  assert.throws(() => callKind(['capability', 'run', 'requirements.catalog_write'], ['requirements:read']), /Unrequested CLI action/);
});
