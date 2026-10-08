// 改动说明：执行当前离线回归和真实 Pi 用例，合并实测时长/阻塞证据为中文 HTML，不把离线通过当成导入通过。
import path from 'node:path';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { savedMailCases } from './scenario.mjs';
import { writeHtmlReport } from './html-report.mjs';
import { POLICY, redact } from './policy.mjs';

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'reports');

/** Collect exact TAP test statuses and per-case durations, including every unexecuted test. */
export function tapCases(output) {
  const cases = [];
  let current;
  for (const line of output.split('\n')) {
    const start = line.match(/^(not ok|ok) \d+ - (.+)$/);
    if (start) {
      current = { id: `offline-${cases.length + 1}`, name: start[2].replace(/ # (SKIP|TODO).*/, ''),
        status: / # (SKIP|TODO)/.test(line) ? 'not_run' : start[1] === 'ok' ? 'passed' : 'failed',
        evidence: ['当前 Node 离线回归；未访问模型、测试 API 或邮箱。'] };
      cases.push(current);
    } else if (current) {
      const duration = line.match(/^\s+duration_ms:\s*([\d.]+)/);
      const message = line.match(/^\s+error:\s*(.*)/);
      if (duration) current.durationMs = Number(duration[1]);
      if (message) current.reason = redact(message[1]);
    }
  }
  return cases;
}

/** Run a bounded test command and retain actual exit code/time without exposing host environment values. */
async function command(binary, argv, timeout) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  try {
    const value = await execute(binary, argv, { cwd: root, timeout, maxBuffer: POLICY.maxOutputBytes, encoding: 'utf8', killSignal: 'SIGTERM' });
    return { code: 0, stdout: value.stdout, stderr: value.stderr, startedAt, durationMs: performance.now() - start };
  } catch (error) {
    return { code: Number.isInteger(error.code) ? error.code : 1, stdout: error.stdout || '',
      stderr: redact(error.stderr || error.message), startedAt, durationMs: performance.now() - start };
  }
}

/** Produce one complete report and refuse database/model execution after any offline failure. */
async function main() {
  const start = performance.now();
  const report = { runId: `PI-SUITE-${randomUUID().slice(0, 8)}`, agent: 'pi', model: '未选择', startedAt: new Date().toISOString(),
    status: 'blocked', cases: [], stages: [], blockers: [], evidence: [], notes: [
      '全部使用 Pi，不运行 Codex。离线协议回归不是实际岗位导入。',
      '保存的合成邮件、30 条岗位；复用现有 hyacinthus_test，不 reset/seed，不连接真实邮箱。',
      '“未运行”不算通过；表中用时均来自当前执行，未记录用时不会估算。',
    ] };
  await mkdir(destination, { recursive: true });
  const files = (await readdir(import.meta.dirname)).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(import.meta.dirname, name));
  const unit = await command(process.execPath, ['--test', '--test-reporter=tap', ...files], POLICY.cleanupTimeoutMs * 4);
  await writeFile(path.join(destination, 'offline.tap.txt'), redact(unit.stdout + unit.stderr), { mode: 0o600 });
  report.cases.push(...tapCases(unit.stdout));
  report.stages.push({ name: '离线协议、回归和实际 Pi SDK 接口', status: unit.code === 0 ? 'passed' : 'failed', durationMs: unit.durationMs,
    detail: `退出码 ${unit.code}；没有调用模型或测试服务。` });
  if (unit.code !== 0) {
    report.status = 'failed';
    report.blockers.push({ stage: '离线回归', reason: '离线测试失败；实际授权与导入没有启动。', nextAction: '查看 reports/offline.tap.txt 第一项失败并修复。' });
    report.cases.push(...savedMailCases());
  } else {
    const scenario = await command(process.execPath, ['lib/run.mjs'], POLICY.scenarioTimeoutMs + POLICY.cleanupTimeoutMs * 3);
    await writeFile(path.join(destination, 'scenario.log.txt'), redact(scenario.stdout + scenario.stderr), { mode: 0o600 });
    let actual;
    try {
      actual = JSON.parse(await readFile(path.join(destination, 'latest.json'), 'utf8'));
      if (actual.agent !== 'pi' || Date.parse(actual.startedAt) < Date.parse(scenario.startedAt)) throw new Error('Stale report');
    } catch {
      actual = { cases: savedMailCases(), status: 'blocked', blockers: [{ stage: 'Pi 场景启动',
        reason: redact(scenario.stderr.slice(-3000) || '本次没有产生完整场景报告，不能沿用旧结果。'),
        nextAction: '查看 reports/scenario.log.txt 的实际启动错误。' }] };
    }
    report.model = actual.model || report.model;
    report.status = scenario.code === 0 && actual.status === 'passed' ? 'passed' : actual.status === 'blocked' ? 'blocked' : 'failed';
    report.cases.push(...actual.cases.map(item => ({ ...item, id: `pi-${item.id}` })));
    report.stages.push({ name: '真实 Pi 默认 Skills / 授权 / 批量邮件场景', status: report.status, durationMs: scenario.durationMs,
      detail: `真实 e2e 进程退出码 ${scenario.code}；成功条件以独立断言为准。` });
    report.stages.push(...(actual.stages || []));
    report.blockers.push(...(actual.blockers || []));
    report.evidence.push(...(actual.evidence || []));
  }
  report.durationMs = performance.now() - start;
  report.endedAt = new Date().toISOString();
  await writeFile(path.join(destination, 'suite.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  const file = path.join(destination, 'latest.html');
  await writeHtmlReport(file, report);
  console.log(JSON.stringify({ status: report.status, durationMs: report.durationMs, cases: report.cases.length, html: file }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main().catch(error => {
  console.error(redact(error.message));
  process.exitCode = 1;
});
