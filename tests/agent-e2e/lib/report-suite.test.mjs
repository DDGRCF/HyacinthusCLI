// 改动说明：回归离线 TAP 报告的真实状态、用时和未运行标记；不启动场景或模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapCases } from './report-suite.mjs';

test('TAP report retains passed failed skipped and actual zero duration', () => {
  const cases = tapCases(`TAP version 13
# Subtest: good
ok 1 - good
  ---
  duration_ms: 0
  ...
not ok 2 - bad
  ---
  duration_ms: 1.25
  error: 'actual assertion failure'
  ...
ok 3 - future # SKIP
# duration_ms 150
`);
  assert.deepEqual(cases.map(item => item.status), ['passed', 'failed', 'not_run']);
  assert.equal(cases[0].durationMs, 0);
  assert.equal(cases[1].durationMs, 1.25);
  assert.equal(cases[2].durationMs, undefined);
  assert.match(cases[1].reason, /actual assertion failure/);
});
