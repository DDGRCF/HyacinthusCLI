// 改动说明：独立核对Pi轨迹、统一21字段与学生性别字段归属、联系角色、批准、落库及真实汇报。
import assert from 'node:assert/strict';
/** The ordered published mail normalization contract shared by TXT and CSV checks. */
export const NORMALIZED_LABELS=['编号','年级','科目','需求方角色','需求方性别','需求方学历','要求的性别','要求的学历','要求的学校','学校的资质','授课方式','要求的资格','薪酬','时间','地址','要求','备注','用户电话','用户微信','管理员电话','管理员微信'];

/** Split denied events: blocked write paths are violations; blocked read/auth probes only need visibility. */
export function deniedAttempts(events) {
  const denied = events.filter(event => event.denied);
  const write = denied.filter(event => {
    const argv = event.argv || [];
    const first = argv.find(arg => !arg.startsWith('-'));
    if (['auth', 'capability', 'schema', 'doctor', 'help'].includes(first)) return false;
    return /(import|write|publish|upload|create|delete|update|upsert)/i.test(argv.join(' '));
  });
  return { denied, write };
}

/** Require the complete authorization, parser-worker, approved import and Agent-owned readback path. */
export function verifyTrace(events, expectedCodes) {
  assert.ok(events.length > 0, 'Pi must actually invoke the CLI');
  assert.equal(deniedAttempts(events).write.length, 0, 'Agent attempted an unapproved write operation');
  for (const event of events) {
    assert.ok(Number.isInteger(event.exitCode), 'Missing actual CLI exit code');
    if (event.result?.ok) assert.equal(event.exitCode, 0, `Success envelope with failed exit: ${event.action}`);
    if (event.action === 'doctor' && event.result?.ok) {
      assert.ok(event.result.data.checks.length > 0 && event.result.data.checks.every(check => check.status !== 'fail'), 'Agent continued after a failed doctor check');
    }
    if (event.writes) assert.ok(event.exitCode === 0 && event.result?.ok && event.result.data.failed === 0, 'A real import/replay failure was not recovered or reported correctly');
  }
  for (const action of ['auth status', 'auth login', 'auth wait', 'doctor', 'requirements parse']) {
    assert.ok(events.some(event => event.action === action && event.exitCode === 0 && event.result?.ok), `Missing real successful call: ${action}`);
  }
  const firstWrite = events.findIndex(event => event.writes);
  for (let index = Math.max(firstWrite, 0); index < events.length; index += 1) {
    const event = events[index];
    if (event.exitCode !== 0 && !event.denied) assert.ok(events.slice(index + 1).some(later => later.action === event.action && later.exitCode === 0
      && later.result?.ok && JSON.stringify(later.argv) === JSON.stringify(event.argv)), 'An actual post-import failure was hidden in the final report');
  }
  const sessions = events.filter(event => event.action === 'auth login' && event.result?.ok);
  assert.equal(sessions.length, 1, 'Authorization must preserve the original session');
  const parses = events.filter(event => event.action === 'requirements parse' && event.result?.ok);
  const parsedCodes = new Set(parses.flatMap(event => event.result.data.rows.map(row => row.parsed?.requirement_code)));
  assert.deepEqual([...parsedCodes].sort(), [...expectedCodes].sort(), 'Every source row must reach the real parser');
  const preview = events.filter(event => event.action === 'requirements import' && !event.writes && event.result?.ok);
  assert.ok(preview.some(event => event.input?.rowCount === expectedCodes.length), 'Missing full-batch successful dry-run');
  const writes = events.filter(event => event.writes);
  assert.ok(writes.length > 0, 'No real import took place');
  assert.equal(writes[0].input.rowCount, expectedCodes.length, 'This scenario requires a full batch, not one demonstration row');
  assert.deepEqual([...writes[0].input.codes].sort(), [...expectedCodes].sort());
  assert.equal(writes[0].result.data.created, expectedCodes.length);
  assert.equal(writes[0].result.data.updated, 0);
  assert.equal(writes[0].result.data.failed, 0);
  assert.ok(writes.every(event => typeof event.input.idempotency_key === 'string' && event.input.idempotency_key.trim()
    && event.input.idempotency_key === event.result.data.idempotency_key), 'Missing or mismatched import key');
  const reads = events.filter(event => event.action === 'requirements search' && event.exitCode === 0 && event.result?.ok);
  const readCodes = new Set(reads.flatMap(event => event.result.data.items.map(item => item.requirement_code)));
  assert.ok(expectedCodes.every(code => readCodes.has(code)), 'Agent must itself read back every imported source row');
  assert.equal(new Set(writes.map(event => event.result.data.idempotency_key)).size, 1, 'Same-source recovery/replay must preserve the original stable key');
  return { created: writes[0].result.data.created, updated: writes[0].result.data.updated, failed: writes[0].result.data.failed };
}

/** Validate every persisted row against source expectations, not the Agent's generated payload. */
export function verifyRows(items, expected) {
  assert.equal(items.length, expected.length);
  assert.equal(new Set(items.map(item => item.id)).size, expected.length);
  for (const row of expected) {
    const matches = items.filter(item => item.requirement_code === row.code);
    assert.equal(matches.length, 1, `Missing/duplicate persisted code: ${row.code}`);
    const item = matches[0];
    assert.equal(item.requirement_type, 'tutoring', row.code);
    assert.equal(item.preferred_mode, 'online', row.code);
    assert.ok(item.subject_names.includes('数学'), `Wrong subject: ${row.code}`);
    assert.ok(item.grade_names.includes('初一'), `Wrong grade: ${row.code}`);
    assert.equal(Number(item.compensation.amount_min), row.amount, `Wrong compensation: ${row.code}`);
    assert.equal(item.ext.admin_contact_phone, '13800138000', `Contact not saved: ${row.code}`);
    for (const field of ['user_contact_phone', 'user_contact_wechat', 'admin_contact_wechat']) {
      assert.equal(item.ext[field] ?? null, null, `Invented contact: ${row.code}/${field}`);
    }
    assert.equal(item.condition.requester_gender, 'male', `Student gender missing from requester field: ${row.code}`);
    assert.doesNotMatch(item.description, /男生|学生.{0,6}男/, `Student gender duplicated in description: ${row.code}`);
    assert.equal(item.condition.required_gender, 'female', `Teacher gender mixed up: ${row.code}`);
    assert.ok(item.condition.required_education_levels.includes('bachelor'), `Teacher education lost: ${row.code}`);
    assert.ok(item.description.trim(), `Missing description: ${row.code}`);
    assert.equal(item.weekly_frequency_min, 1, `Wrong frequency: ${row.code}`);
    assert.equal(item.session_duration_minutes_min, 120, `Wrong duration: ${row.code}`);
    assert.ok(item.time_slots.some(slot => slot.weekday === 6 && slot.start_minute === 840 && slot.end_minute === 960), `Wrong time slot: ${row.code}`);
  }
}

/** Require the Agent's report to agree with actual results and source codes. */
export function verifyReport(report, expectedCodes, counts, messageId) {
  assert.equal(report.source_message_id, messageId);
  assert.equal(report.created, counts.created);
  assert.equal(report.updated, counts.updated);
  assert.equal(report.failed, counts.failed);
  assert.equal(report.pending, 0);
  assert.deepEqual(report.rows.map(row => row.requirement_code).sort(), [...expectedCodes].sort());
  assert.ok(report.rows.every(row => row.status === 'imported'));
}

/** Verify a structured positive confirmation request against the single latest actual preview. */
export function verifyApproval(request, preview, expectedCodes, messageId, reply) {
  assert.equal(request.kind, 'batch_import');
  assert.equal(request.source_message_id, messageId);
  assert.equal(request.ready_for_import, true);
  assert.equal(request.row_count, expectedCodes.length);
  assert.equal(request.failed_rows, 0);
  assert.equal(request.pending_rows, 0);
  assert.ok(preview?.result?.ok && preview.exitCode === 0 && !preview.writes);
  assert.deepEqual([...preview.input.codes].sort(), [...expectedCodes].sort());
  assert.equal(request.payload_file, preview.input.file);
  assert.ok(typeof request.idempotency_key === 'string' && request.idempotency_key.trim());
  assert.equal(request.idempotency_key, preview.input.idempotency_key);
  assert.match(reply, /确认|批准|是否/);
  assert.match(reply, new RegExp(String(expectedCodes.length)));
  assert.doesNotMatch(reply, /确认失败|无法导入|不能导入|不要导入|不能批准|请勿批准/);
}

/** Check the current 21-label contract, source fields and separation of user/admin contacts. */
export function verifyNormalized(text, expected) {
  const labels = NORMALIZED_LABELS;
  const rows = [];
  let current;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim())) {
    const match = /^\s*([^：:]+)[：:]\s*(.*)$/.exec(line);
    assert.ok(match, 'Unexpected normalized text line');
    const key = match[1].trim();
    if (key === '编号') { current = {}; rows.push(current); }
    assert.ok(current, 'A normalized row must begin with its code');
    assert.equal(key, labels[Object.keys(current).length], 'Normalized fields were reordered, added or dropped');
    current[key] = match[2].trim();
  }
  assert.equal(rows.length, expected.length);
  rows.forEach((row, index) => {
    assert.deepEqual(Object.keys(row), labels);
    assert.equal(row['编号'], expected[index].code);
    assert.match(row['年级'], /初一|七年级/);
    assert.match(row['科目'], /数学/);
    assert.match(row['需求方角色'], /家长/);
    assert.match(row['需求方性别'], /男/);
    assert.doesNotMatch(`${row['要求']} ${row['备注']}`, /男生|学生.{0,6}男/);
    assert.equal(row['需求方学历'], '');
    assert.match(row['要求的性别'], /女/);
    assert.match(row['要求的学历'], /本科/);
    assert.equal(row['要求的学校'], '');
    assert.equal(row['学校的资质'], '');
    assert.match(row['授课方式'], /^(online|线上)$/);
    assert.equal(row['要求的资格'], '');
    assert.match(row['要求'], /家教经验|有经验/);
    assert.match(row['薪酬'], new RegExp(`\\b${expected[index].amount}\\b`));
    assert.match(row['薪酬'], /小时/);
    assert.match(row['时间'], /周六|星期六/);
    assert.match(row['时间'], /14[:：]00/);
    assert.match(row['时间'], /16[:：]00/);
    assert.match(`${row['时间']} ${row['要求']} ${row['备注']}`, /一对一/);
    assert.equal(row['用户电话'], '');
    assert.equal(row['用户微信'], '');
    assert.equal(row['管理员电话'], '13800138000');
    assert.equal(row['管理员微信'], '');
    assert.ok(!row['备注'].includes('13800138000'),'Administrator contact was duplicated in remarks');
  });
}
