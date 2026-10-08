// 改动说明：离线回归文件队列 FIFO、目录替换、JSON 转义预算和串行化；不连接模型/API/数据库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rename, readFile, writeFile, rm } from 'node:fs/promises';
import { createFileQueue, requestFileQueue } from './file-queue.mjs';

/** Await a single bounded protocol response from an independently submitted invalid request. */
async function responseAt(file) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('No correlated protocol response');
}

test('FIFO requests are rejected without blocking queue shutdown', { timeout: 3000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-queue-fifo-'));
  let calls = 0;
  const queue = await createFileQueue(root, async () => { calls += 1; return { stdout: '', stderr: '', exitCode: 0 }; });
  try {
    const id = randomUUID();
    execFileSync('mkfifo', [path.join(root, 'requests', `${id}.json`)]);
    const result = await responseAt(path.join(root, 'responses', `${id}.json`));
    assert.equal(result.exitCode, 2);
    assert.equal(calls, 0);
  } finally { await queue.close(); }
});

test('replaced directories are not recursively removed by close', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'pi-queue-replaced-'));
  const root = path.join(parent, 'queue');
  const queue = await createFileQueue(root, async () => ({}));
  try {
    await rename(root, path.join(parent, 'original'));
    await mkdir(path.join(root, 'requests'), { recursive: true });
    await mkdir(path.join(root, 'responses'));
    await writeFile(path.join(root, 'keep.txt'), 'UNRELATED');
    await assert.rejects(queue.close(), /replaced/);
    assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'UNRELATED');
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('oversized serialized output receives a correlated error instead of a timeout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-queue-output-'));
  const queue = await createFileQueue(root, async () => ({ stdout: '\u0000'.repeat(4 * 1024 * 1024), stderr: '', exitCode: 0 }));
  try {
    const result = await requestFileQueue(root, ['probe'], root, 3000);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /serialized byte budget/);
  } finally { await queue.close(); }
});

test('concurrent clients remain serialized and receive their own exact outputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-queue-concurrent-'));
  let active = 0, peak = 0;
  const queue = await createFileQueue(root, async request => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    return { stdout: request.argv[0], stderr: 'diagnostic', exitCode: 7 };
  });
  try {
    const results = await Promise.all(['one', 'two', 'three'].map(value => requestFileQueue(root, [value], root, 2000)));
    assert.equal(peak, 1);
    assert.deepEqual(results.map(item => item.stdout), ['one', 'two', 'three']);
    assert.ok(results.every(item => item.stderr === 'diagnostic' && item.exitCode === 7));
  } finally { await queue.close(); }
});
