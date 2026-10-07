// 改动说明：离线验证独立验收会拒绝漏行、提前写入、换键重试和虚假汇报；不代表真实导入通过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTrace, verifyReport, verifyApproval, verifyNormalized, deniedAttempts } from './verify.mjs';

/** Build a protocol observation fixture, not a simulated real-Codex result. */
function trace() {
  const codes = ['TEST-001', 'TEST-002'];
  const successful = action => ({ action, exitCode: 0, result: { ok: true,
    ...(action === 'doctor' ? { data: { checks: [{ name: 'protocol', status: 'pass' }] } } : {}) } });
  return [
    ...['auth status', 'auth login', 'auth wait', 'doctor'].map(successful),
    { action: 'requirements parse', exitCode: 0, result: { ok: true, data: { rows: codes.map(code => ({ parsed: { requirement_code: code } })) } } },
    { action: 'requirements import', exitCode: 0, writes: false, input: { rowCount: 2 }, result: { ok: true } },
    { action: 'requirements import', exitCode: 0, writes: true, input: { rowCount: 2, codes, idempotency_key: 'same-mail' }, result: { ok: true, data: { created: 2, updated: 0, failed: 0, idempotency_key: 'same-mail' } } },
    { action: 'requirements search', exitCode: 0, result: { ok: true, data: { items: codes.map(code => ({ requirement_code: code })) } } },
  ];
}

test('full actual-call trace is required, not a final success message', () => {
  assert.equal(verifyTrace(trace(), ['TEST-001', 'TEST-002']).created, 2);
  assert.throws(() => verifyTrace([], ['TEST-001', 'TEST-002']));
  const missing = trace().filter(item => item.action !== 'requirements parse');
  assert.throws(() => verifyTrace(missing, ['TEST-001', 'TEST-002']), /requirements parse/);
});

test('missing rows and policy violations fail acceptance', () => {
  const missingRow = trace();
  missingRow[4].result.data.rows.pop();
  assert.throws(() => verifyTrace(missingRow, ['TEST-001', 'TEST-002']), /Every source row/);
  assert.throws(() => verifyTrace([...trace(), { denied: true, exitCode: 2, argv: ['requirements', 'import', '--file', 'x'] }], ['TEST-001', 'TEST-002']), /unapproved write/);
});

test('blocked non-write probes are visible but do not replace the write gate', () => {
  const probe = { denied: true, exitCode: 2, argv: ['auth', 'login', '--scope', 'a:b c:d'] };
  assert.equal(verifyTrace([...trace(), probe], ['TEST-001', 'TEST-002']).created, 2);
  const split = deniedAttempts([probe, { denied: true, exitCode: 2, argv: ['requirements', 'import'] }]);
  assert.equal(split.denied.length, 2);
  assert.equal(split.write.length, 1);
});

test('same-mail replay cannot replace the import key', () => {
  const events = trace();
  const changed = structuredClone(events.find(event => event.writes));
  changed.input.idempotency_key = 'different-key';
  changed.result.data.idempotency_key = 'different-key';
  events.push(changed);
  assert.throws(() => verifyTrace(events, ['TEST-001', 'TEST-002']), /stable key/);
});

test('Agent report must match actual counts, source identity and per-row statuses', () => {
  const report = { source_message_id: 'mail', created: 2, updated: 0, failed: 0, pending: 0,
    rows: [{ requirement_code: 'TEST-001', status: 'imported' }, { requirement_code: 'TEST-002', status: 'imported' }] };
  const counts = { created: 2, updated: 0, failed: 0 };
  verifyReport(report, ['TEST-001', 'TEST-002'], counts, 'mail');
  assert.throws(() => verifyReport({ ...report, created: 3 }, ['TEST-001', 'TEST-002'], counts, 'mail'));
  assert.throws(() => verifyReport(report, ['TEST-001', 'TEST-002'], counts, 'other-mail'));
  report.rows[1].status = 'pending';
  assert.throws(() => verifyReport(report, ['TEST-001', 'TEST-002'], counts, 'mail'));
});

test('nonzero success exits and failed replay writes cannot be hidden', () => {
  const events = trace();
  events[4].exitCode = 1;
  assert.throws(() => verifyTrace(events, ['TEST-001', 'TEST-002']), /failed exit/);
  const failedReplay = { action: 'requirements import', writes: true, exitCode: 1, result: { ok: false, error: { code: 'TEST_ERROR' } } };
  assert.throws(() => verifyTrace([...trace(), failedReplay], ['TEST-001', 'TEST-002']), /import\/replay failure/);
});

test('Agent cannot substitute harness-owned readback or an absent stable key', () => {
  assert.throws(() => verifyTrace(trace().filter(event => event.action !== 'requirements search'), ['TEST-001', 'TEST-002']), /itself read back/);
  const events = trace();
  delete events.find(event => event.writes).input.idempotency_key;
  assert.throws(() => verifyTrace(events, ['TEST-001', 'TEST-002']), /import key/);
});

test('structured approval rejects negative intent and binds the sole preview key/file', () => {
  const request = { kind: 'batch_import', source_message_id: 'mail', row_count: 2, failed_rows: 0, pending_rows: 0,
    payload_file: 'confirmed.json', idempotency_key: 'approved-key', ready_for_import: true };
  const preview = { exitCode: 0, result: { ok: true }, input: { file: 'confirmed.json', codes: ['TEST-001', 'TEST-002'], idempotency_key: 'approved-key' } };
  verifyApproval(request, preview, ['TEST-001', 'TEST-002'], 'mail', '本批2条已预览，请批准');
  assert.throws(() => verifyApproval(request, preview, ['TEST-001', 'TEST-002'], 'mail', '本批2条确认失败，不能导入'));
  assert.throws(() => verifyApproval({ ...request, idempotency_key: 'changed-key' }, preview, ['TEST-001', 'TEST-002'], 'mail', '请批准2条'));
});

test('all 20 normalized labels and separate student/teacher and contact roles are required', () => {
  const row = { '编号': 'TEST-001', '年级': '初一', '科目': '数学', '需求方角色': '家长', '需求方性别': '男', '需求方学历': '',
    '要求的性别': '女', '要求的学历': '本科', '要求的学校': '', '学校的资质': '', '授课方式': 'online', '要求的资格': '有家教经验',
    '薪酬': '100元/小时', '时间': '每周1次，周六14:00-16:00，每次2小时', '地址': '线上', '要求': '一对一', '备注': '线上授课', '用户联系方式': '', '管理员电话': '13800138000', '管理员微信': '' };
  const text = Object.entries(row).map(([key, value]) => `${key}：${value}`).join('\n');
  verifyNormalized(text, [{ code: 'TEST-001', amount: 100 }]);
  assert.throws(() => verifyNormalized(text.replace('要求的学历：本科', '要求的学历：'), [{ code: 'TEST-001', amount: 100 }]));
  assert.throws(() => verifyNormalized(text.replace('需求方学历：\n', ''), [{ code: 'TEST-001', amount: 100 }]));
  assert.throws(() => verifyNormalized(text.replace('用户联系方式：\n','用户联系方式：13800138000\n'), [{code:'TEST-001',amount:100}]));
  assert.throws(() => verifyNormalized(text.replace('备注：线上授课','备注：管理员电话13800138000'), [{code:'TEST-001',amount:100}]));
});
