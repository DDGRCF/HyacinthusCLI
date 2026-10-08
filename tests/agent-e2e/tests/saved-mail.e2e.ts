// 改动说明：e2e 调度隔离于 tsx 加载器的真实 Pi 原生进程；自然语言启动并独立断言整批导入。
import { test, expect } from 'e2e';
import { runScenarioProcess, cancelScenarioProcess } from '../lib/scenario-process.mjs';
import { POLICY } from '../lib/policy.mjs';

// Even an outer runner timeout must stop the real subprocess and finish credential cleanup.
test.afterEach(async () => { await cancelScenarioProcess(); });

test('Pi discovers installed Skills and completes the natural-language mail upload', {
  tags: ['pi', 'cli', 'batch-import'],
}, async () => {
  const result = await runScenarioProcess();
  expect(result.ok).toBe(true);
  expect(result.rows).toBe(POLICY.rows);
  expect(result.replayPreservedIds).toBe(true);
});
