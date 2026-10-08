// 改动说明：纯Node验证历史回归归档不被新全局日志替换，缺终止证据不通过，Nextest统计准确。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_REGRESSION_SOURCES, regressionEvidence, summarizeRegressionLog } from './sop-regressions.mjs';

/** Allocates disposable local fixtures without opening any real report archive or global log. */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hyacinthus-regression-archive-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, output: path.join(root, 'run'), source: path.join(root, 'global.log') };
}

/** Computes a byte fingerprint to detect changes to either the index or its archived evidence. */
async function digest(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

const logA = 'running 1 test\ntest a ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n';
const logB = 'running 2 tests\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s\n';

test('first capture freezes A; rendering with changed global B preserves index, log and hashes', async t => {
  const { output, source } = await fixture(t);
  await writeFile(source, logA);
  const options = { sources: [['Injected Rust', source, 'rust']] };
  const first = await regressionEvidence(output, options);
  assert.equal(first[0].state, '1通过，0失败');
  const index = path.join(output, 'regressions/index.json');
  const archived = path.join(output, first[0].path);
  const before = [await digest(index), await digest(archived)];
  assert.equal(first[0].sha256, before[1]);
  await writeFile(source, logB);
  assert.deepEqual(await regressionEvidence(output, options), first);
  assert.equal(await readFile(archived, 'utf8'), logA);
  assert.deepEqual([await digest(index), await digest(archived)], before);
});

test('an existing historical index and its bytes are returned without adding current sources', async t => {
  const { output, source } = await fixture(t);
  await mkdir(path.join(output, 'regressions'), { recursive: true });
  const index = path.join(output, 'regressions/index.json');
  const archived = path.join(output, 'regressions/old.log');
  const legacy = [{ name: 'Historical', state: '原记录', path: 'regressions/old.log' }];
  const originalIndex = JSON.stringify(legacy, null, 4) + '\n';
  await writeFile(index, originalIndex);
  await writeFile(archived, logA);
  await writeFile(source, logB);
  assert.deepEqual(await regressionEvidence(output, { sources: [['New', source, 'rust']] }), legacy);
  assert.equal(await readFile(index, 'utf8'), originalIndex);
  assert.equal(await readFile(archived, 'utf8'), logA);
});

test('missing terminal observations remain incomplete, including a partly finished Rust suite', () => {
  for (const [text, kind] of [
    ['running 2 tests\ntest one ... ok\n', 'rust'],
    [logA + 'running 2 tests\n', 'rust'],
    ['ℹ tests 1\nℹ pass 1\nℹ fail 0\n', 'node'],
    ['Checking example\n', 'clippy'],
    ['Summary [ 74.514s] 757 tests run: 757 passed, 2 skipped\nDoc-tests example\nrunning 0 tests\n', 'backend-check'],
  ]) {
    assert.equal(summarizeRegressionLog(text, kind).completed, false, kind);
    assert.match(summarizeRegressionLog(text, kind).state, /^没有完整结束证据/, kind);
  }
});

test('completed backend log archives exact Nextest 757 passed and 2 skipped rather than counting doc-tests', async t => {
  const { output, source } = await fixture(t);
  await writeFile(source, 'Summary [ 74.514s] 757 tests run: 757 passed, 2 skipped\nDoc-tests hyacinthus_backend\nrunning 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n');
  const [entry] = await regressionEvidence(output, { sources: [['Backend', source, 'backend-check']] });
  assert.deepEqual(entry.counts, { passed: 757, failed: 0, skipped: 2 });
  assert.equal(entry.completed, true);
  assert.equal(entry.state, 'Nextest 757通过，0失败，2跳过');
  assert.ok(DEFAULT_REGRESSION_SOURCES.some(([, file, kind]) => file === '/tmp/hyacinthus-school-backend-check.log' && kind === 'backend-check'));
});

test('terminated backend failure retains 754 passed, 3 failed and 2 skipped', () => {
  const observed = summarizeRegressionLog('Summary [ 73.254s] 757 tests run: 754 passed, 3 failed, 2 skipped\nerror: test run failed\n', 'backend-check');
  assert.deepEqual(observed.counts, { passed: 754, failed: 3, skipped: 2 });
  assert.equal(observed.completed, true);
  assert.equal(observed.state, 'Nextest 754通过，3失败，2跳过');
});
