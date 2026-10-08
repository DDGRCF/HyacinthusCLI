// 改动说明：首次冻结回归日志和摘要，重渲染只读既有索引，并采集学校完整后端门禁。
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Identifies the logs captured once for a run; tests can inject their own local files. */
export const DEFAULT_REGRESSION_SOURCES = [
  ['CLI Rust回归', '/tmp/hyacinthus-sop-cli-tests.log', 'rust'],
  ['测试器 Node 回归', '/tmp/hyacinthus-sop-node-tests.log', 'node'],
  ['npm安装器回归', '/tmp/hyacinthus-sop-installer-tests.log', 'node'],
  ['CLI Clippy，job=1', '/tmp/hyacinthus-sop-cli-clippy-job1.log', 'clippy'],
  ['Backend受保护脚本Clippy', '/tmp/hyacinthus-sop-backend-clippy.log', 'clippy'],
  ['Backend学校完整check', '/tmp/hyacinthus-school-backend-check.log', 'backend-check'],
];

/** Interprets terminal observations without promoting a partial log to a completed regression. */
export function summarizeRegressionLog(text, kind) {
  const pending = { state: '没有完整结束证据', completed: false };
  const tail = text.trimEnd().split('\n').at(-1) || '';
  if (kind === 'rust') {
    const matches = [...text.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
    const starts = [...text.matchAll(/^running \d+ tests?$/gm)].length;
    if (!matches.length || starts !== matches.length || !/^test result: (?:ok|FAILED)\./.test(tail)) return pending;
    const passed = matches.reduce((n, m) => n + Number(m[1]), 0);
    const failed = matches.reduce((n, m) => n + Number(m[2]), 0);
    return { state: `${passed}通过，${failed}失败`, completed: true, counts: { passed, failed } };
  }
  if (kind === 'node') {
    const passed = text.match(/^(?:#|ℹ) pass (\d+)$/m);
    const failed = text.match(/^(?:#|ℹ) fail (\d+)$/m);
    if (!passed || !failed || !/^(?:#|ℹ) duration_ms [\d.]+$/.test(tail)) return pending;
    const counts = { passed: Number(passed[1]), failed: Number(failed[1]) };
    return { state: `${counts.passed}通过，${counts.failed}失败`, completed: true, counts };
  }
  if (kind === 'backend-check') {
    const match = [...text.matchAll(/Summary\s+\[[^\]]+\]\s+\d+ tests run:\s*(\d+) passed(?:,\s*(\d+) failed)?(?:,\s*(\d+) skipped)?/g)].at(-1);
    if (!match) return pending;
    const counts = { passed: Number(match[1]), failed: Number(match[2] || 0), skipped: Number(match[3] || 0) };
    const summary = `Nextest ${counts.passed}通过，${counts.failed}失败，${counts.skipped}跳过`;
    const completed = counts.failed > 0
      ? /^error: test run failed$/.test(tail)
      : /Doc-tests /.test(text) && /^test result: ok\./.test(tail);
    return { state: completed ? summary : `${pending.state}（${summary}）`, completed, counts };
  }
  if (kind === 'clippy' && /^\s*Finished .*profile/.test(tail) && !/^error:/m.test(text)) {
    return { state: '已完成，无编译检查错误', completed: true };
  }
  return pending;
}

/** Reuses the run's first archive verbatim; source reads and new writes occur only before its index exists. */
export async function regressionEvidence(output, { sources = DEFAULT_REGRESSION_SOURCES } = {}) {
  const directory = path.join(output, 'regressions');
  const index = path.join(directory, 'index.json');
  try {
    return JSON.parse(await readFile(index, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const entries = [];
  await mkdir(directory, { recursive: true });
  for (const [name, file, kind] of sources) {
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const target = `regressions/${path.basename(file)}`;
    const observation = summarizeRegressionLog(bytes.toString('utf8'), kind);
    // Exclusive creation also prevents an interrupted or competing capture from replacing old bytes.
    await writeFile(path.join(output, target), bytes, { flag: 'wx' });
    entries.push({ name, ...observation, path: target, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(index, JSON.stringify(entries, null, 2), { flag: 'wx' });
  return entries;
}
