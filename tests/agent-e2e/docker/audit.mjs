// 改动说明：补查成功查询的真实工具返回、规则正则及容器内完整 Skills，记录本轮镜像与测试库标记。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createAdminRequirementReader } from './admin-readback.mjs';

const repo = path.resolve(import.meta.dirname, '../../../..');
const artifacts = path.join(repo, '.tmp/e2e/skills-alignment');
const file = path.join(artifacts, 'docker-acceptance.json');
const report = JSON.parse(await readFile(file, 'utf8'));
const password = (await readFile(path.join(artifacts, 'private/driver.env'), 'utf8')).trim().slice('HYACINTHUS_E2E_ADMIN_PASSWORD='.length);
const adminRead = createAdminRequirementReader({ api: 'http://127.0.0.1:18012', admin: 'http://127.0.0.1:18013', password });
assert.equal(report.status, 'passed');
assert.equal(report.cases.filter(entry => entry.status === 'passed').length, 6);
const starts = new Map();
const searches = [];
for (const tool of report.tools) {
  const detail = tool.detail;
  if (detail?.type === 'tool_execution_start') starts.set(detail.toolCallId, detail.args?.command);
  if (detail?.type !== 'tool_execution_end') continue;
  const command = starts.get(detail.toolCallId);
  if (!/requirements\s+search/.test(command || '')) continue;
  for (const block of detail.result?.content || []) {
    try {
      const value = JSON.parse(block.text);
      if (value.ok && value.meta?.command === 'requirements search') searches.push({ command, data: value.data });
    } catch { /* Help text and shell summaries are not successful JSON business results. */ }
  }
}
const query = searches.find(entry => entry.data.keyword === '数学' && entry.data.scope === 'active');
assert.ok(query, 'No actual successful subject query appears in the Pi tool results');
Object.assign(report.cases.find(entry => entry.name === '无登录状态下查询需求并完成真实授权').evidence,
  { actualQueryKeyword: query.data.keyword, actualQueryScope: query.data.scope, actualQueryReturned: query.data.total });
const rule = report.cases.find(entry => entry.name === '优先级规则指南、预览和创建').evidence;
assert.equal(rule.pattern, `^${report.runId}-`);
const task = path.dirname(path.join(artifacts, 'workspace', report.finalReportPath));
const manifest = JSON.parse(await readFile(path.join(task, 'mail_manifest.json'), 'utf8'));
const labels = ['编号', '年级', '科目', '需求方角色', '需求方性别', '需求方学历', '要求的性别', '要求的学历',
  '要求的学校', '学校的资质', '要求的资格', '薪酬', '时间', '地址', '要求', '备注'];
const normalized = (await Promise.all(manifest.normalized_files.map(name => readFile(path.join(task, name), 'utf8')))).join('\n');
const records = normalized.trim().split(/\n\s*\n/).filter(Boolean);
assert.equal(records.length, 30);
for (const record of records) {
  assert.deepEqual(record.split('\n').map(line => line.split(/[：:]/)[0]), labels);
}
const parsed = JSON.parse(await readFile(path.join(task, 'parsed.json'), 'utf8'));
if (parsed.rows.some(row => row.errors?.length || row.needs_confirmation)) {
  const errors = await readFile(path.join(task, 'errors.csv'), 'utf8');
  assert.match(errors, /^run_id,stage,status,error_code,source_error_code,reason,retryable,next_action,message_id,job_code,/);
  assert.match(errors, /GEO_GEOCODE_FAILED/);
}
for (let index = 1; index <= 30; index += 1) {
  const code = `${report.runId}-${String(index).padStart(3, '0')}`;
  const queryResult = JSON.parse(execFileSync('docker', ['exec', 'hyacinthus-skills-acceptance-pi-1', 'hyacinthus',
    '--no-notice', 'requirements', 'search', '--keyword', code, '--scope', 'all'], { encoding: 'utf8', timeout: 30_000 }));
  assert.equal(queryResult.ok, true);
  const summary = queryResult.data.items.find(entry => entry.requirement_code === code);
  assert.ok(summary);
  const item = await adminRead(summary.id);
  assert.equal(item.condition.requester_role, 'parent');
  assert.equal(item.ext.priority, 5, 'The created rule did not apply to the matching requirement');
  assert.equal(item.compensation.billing_period, 'hourly');
  assert.equal(Number(item.compensation.amount_max), 99 + index);
  assert.match(`${item.description || ''} ${JSON.stringify(item.condition)}`, /家教经验|有经验/,
    'Teacher experience was lost from business fields');
  assert.equal(item.location, null, 'The source provided no geographic point for these online requirements');
}
const check = JSON.parse(execFileSync('docker', ['exec', 'hyacinthus-skills-acceptance-pi-1', 'hyacinthus', '--no-notice',
  'skills', 'check', '--dir', '/home/node/.pi/agent/skills'], { encoding: 'utf8', timeout: 30_000 }));
assert.equal(check.ok, true);
assert.equal(check.data.ok, true);
const ready = await fetch('http://127.0.0.1:18012/health/ready');
assert.equal(ready.status, 200);
assert.equal(ready.headers.get('x-hyacinthus-test-database'), 'hyacinthus_test');
const images = {};
for (const service of ['pi', 'backend', 'worker', 'front-admin']) {
  images[service] = execFileSync('docker', ['inspect', '--format', '{{.Image}}', `hyacinthus-skills-acceptance-${service}-1`],
    { encoding: 'utf8', timeout: 30_000 }).trim();
}
report.audit = { checkedAt: new Date().toISOString(), actualQuery: query, anchoredPriorityPattern: true,
  normalizedRowsWithAll16Labels: 30, actualParseIssuesLogged: true,
  parentRoleAndExperienceAndNoInventedCoordinatesRows: 30,
  matchedPriorityRuleRows: 30,
  installedSkillsCheck: check.data, testDatabaseMarker: 'hyacinthus_test', images };
await writeFile(file, JSON.stringify(report, null, 2));
console.log('Actual Pi search, anchored rule, complete installed Skills and independent database marker: passed.');
