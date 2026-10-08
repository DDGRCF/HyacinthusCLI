// 改动说明：验证所有元数据去敏及 Pi/离线通过数分区；保留真实耗时和首屏卡点，不触发真实导入。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHtmlReport } from './html-report.mjs';

/** 在独立临时目录生成报告，读取后自动清理测试产物。 */
async function render(t, report) {
  const directory = await mkdtemp(join(tmpdir(), 'html-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'nested', 'reports', 'report.html');
  await writeHtmlReport(file, report);
  return readFile(file, 'utf8');
}

test('自动创建父目录，中文状态区分未运行与阻塞，零耗时不丢失', async (t) => {
  const html = await render(t, {
    runId: '离线示例', agent: 'pi', model: '示例模型', status: 'blocked', durationMs: 0,
    cases: ['passed', 'failed', 'blocked', 'not_run'].map((status, index) => ({ id: index, name: `用例${index}`, status, durationMs: 0 })),
    stages: [{ name: '准备', status: 'passed', durationMs: 0 }], blockers: [],
  });
  for (const label of ['通过', '失败', '阻塞', '未运行']) assert.ok(html.includes(label));
  assert.match(html, /实际总耗时 <strong class="metric">0 毫秒/);
  assert.match(html, /用例总数 4/);
  assert.match(html, /通过 1 · 失败 1 · 阻塞 1 · 未运行 1/);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /max-width:767px/);
});

test('所有动态字段转义 XSS，属性使用封闭状态，不加载资源或脚本', async (t) => {
  const payload = `<img src=x onerror="alert('x')"> & </style><script>x</script>`;
  const html = await render(t, {
    runId: payload, agent: payload, model: payload, startedAt: payload, endedAt: payload, status: payload,
    cases: [{ id: payload, name: payload, status: payload, reason: payload, evidence: [payload] }],
    stages: [{ name: payload, status: payload, detail: payload }],
    blockers: [{ stage: payload, reason: payload, nextAction: payload }], evidence: [payload], notes: [payload],
  });
  assert.ok(!html.includes(payload));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;'));
  assert.ok(html.includes('&lt;/style&gt;&lt;script&gt;x&lt;/script&gt;'));
  assert.doesNotMatch(html, /<script\b|<img\b|<link\b|<iframe\b|\bonerror="/i);
  assert.match(html, /class="status unknown"/);
  assert.match(html, /script-src 'none'/);
});

test('unknown、缺失与非法耗时显示未记录，不由时间戳推算', async (t) => {
  const html = await render(t, {
    status: 'unknown', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z',
    cases: [{ name: '缺失', status: 'unknown' }, { name: '负数', status: 'not_run', durationMs: -1 }, { name: '非数', durationMs: NaN }],
    stages: [{ name: '无限', durationMs: Infinity }],
  });
  assert.match(html, /未知（unknown）/);
  assert.match(html, /实际总耗时 <strong class="metric">未记录/);
  assert.doesNotMatch(html, /60000 毫秒|-1 毫秒|NaN 毫秒|Infinity 毫秒/);
});

test('证据脱敏且长列表完整保留，不修改输入', async (t) => {
  const report = { status: 'failed', cases: Array.from({ length: 40 }, (_, id) => ({ id, name: `完整用例${id}`, status: 'failed', reason: '完整原因'.repeat(100) })), evidence: ['Bearer private-value', 'api_key=secret-value', 'https://user:pass@example.test', '{"password":"private-password"}'] };
  const before = JSON.stringify(report);
  const html = await render(t, report);
  for (const secret of ['private-value', 'secret-value', 'user:pass', 'private-password']) assert.ok(!html.includes(secret));
  assert.match(html, /已脱敏/);
  assert.match(html, /完整用例39/);
  assert.ok(html.includes('完整原因'.repeat(100)));
  assert.equal(JSON.stringify(report), before);
});

test('实际用时转换单位，Pi 流程先显示，首屏给出最先卡点', async t => {
  const html = await render(t, { status: 'blocked', durationMs: 1250,
    cases: [{ id: 'offline-1', name: 'offline-only', status: 'passed', durationMs: 0.25 },
      { id: 'pi-3', name: 'pi-flow-first', status: 'blocked', durationMs: 65_500 }],
    blockers: [{ stage: '隔离 API', reason: '端点不可用', nextAction: '查看 readiness' }] });
  assert.match(html, /1.25 秒/);
  assert.match(html, /1 分 5.5 秒/);
  assert.ok(html.indexOf('pi-flow-first') < html.indexOf('offline-only'));
  assert.ok(html.indexOf('最先卡点：') < html.indexOf('<h2>实际 Pi 流程</h2>'));
  assert.match(html, /查看 readiness/);
  assert.match(html, /Pi 流程用例 1/);
  assert.match(html, /通过 0 · 失败 0 · 阻塞 1 · 未运行 0/);
  assert.match(html, /离线工程回归/);
  assert.match(html, /1 项；通过 1/);
});

test('模型、用例原因和卡点元数据同样去敏', async t => {
  const html = await render(t, { model: 'Bearer model-private', status: 'blocked',
    cases: [{ id: 'pi-3', name: 'api_key=name-private', status: 'blocked', reason: 'password=case-private' }],
    blockers: [{ stage: 'token=stage-private', reason: 'secret=reason-private', nextAction: 'cookie=action-private' }],
    stages: [{ name: 'authorization=phase-private', detail: 'refresh_token=detail-private' }],
  });
  for (const secret of ['model-private', 'name-private', 'case-private', 'stage-private', 'reason-private', 'action-private', 'phase-private', 'detail-private']) {
    assert.ok(!html.includes(secret));
  }
});
