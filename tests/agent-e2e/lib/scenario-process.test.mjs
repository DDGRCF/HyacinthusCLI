// 改动说明：离线验证 Pi SDK 原生进程不继承加载钩子，以及真实非零退出和取消；不调用模型/API。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runScenarioProcess, cancelScenarioProcess } from './scenario-process.mjs';

/** Create an isolated native process entry for a protocol test, not a successful real-Agent substitute. */
async function fixture(t, code) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'entry.mjs');
  await writeFile(file, code);
  return file;
}

test('native Pi SDK import is unaffected by inherited NODE_OPTIONS loader hooks', async t => {
  const module = new URL('./pi.mjs', import.meta.url).href;
  const entry = await fixture(t, `import { loadPiSdk } from ${JSON.stringify(module)};const sdk=await loadPiSdk();console.log('PI_SCENARIO_RESULT '+JSON.stringify({sdk:typeof sdk.createAgentSession,nodeOptions:process.env.NODE_OPTIONS}));`);
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--import=data:text/javascript,throw%20new%20Error(%22UNWANTED_LOADER%22)';
  try {
    const result = await runScenarioProcess(entry, { forward: false });
    assert.deepEqual(result, { sdk: 'function', nodeOptions: '' });
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
  }
});

test('a native nonzero exit never becomes an accepted result', async t => {
  const entry = await fixture(t, "console.log('PI_SCENARIO_RESULT {\"ok\":true}');process.exitCode=3;");
  await assert.rejects(runScenarioProcess(entry, { forward: false }), /exited 3/);
});

test('outer cancellation stops and waits for the actual child', async t => {
  const entry = await fixture(t, 'setInterval(()=>{},1000);');
  const outcome = assert.rejects(runScenarioProcess(entry, { forward: false }), /cancelled/);
  await cancelScenarioProcess();
  await outcome;
});
