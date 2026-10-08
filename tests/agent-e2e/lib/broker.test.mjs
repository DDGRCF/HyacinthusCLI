// 改动说明：离线验证文件队列与批准绑定，并回归执行读取宿主密封输入，阻止工作区文件替换。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createBroker } from './broker.mjs';

const execute = promisify(execFile);

/** Build a disposable CLI-protocol probe without authentication, network or database access. */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cli-broker-'));
  const workspace = path.join(root, 'workspace');
  const snapshots = path.join(root, 'snapshots');
  for (const dir of [workspace, snapshots]) await mkdir(dir);
  const binary = path.join(root, 'cli-protocol-probe');
  await writeFile(binary, `#!${process.execPath}\nconst args=process.argv.slice(2); const key=args[args.indexOf('--idempotency-key')+1]; console.log(JSON.stringify({ok:true,data:{created:1,updated:0,failed:0,idempotency_key:key}}));`, { mode: 0o700 });
  const eventsFile = path.join(root, 'events.jsonl');
  await writeFile(eventsFile, '');
  const control = { workspace, snapshots, eventsFile, cliBinary: binary, ipc: path.join(workspace, '.hyacinthus-ipc'),
    home: root, api: 'http://127.0.0.1:8001', profile: 'offline-probe', configDir: path.join(root, 'profile'),
    expectedCodes: ['TEST-001'], handoffFile: path.join(root, 'handoff.json') };
  const broker = await createBroker(control, () => 10_000);
  const call = async argv => {
    try {
      return await execute(process.execPath, [path.resolve(import.meta.dirname, 'cli-proxy.mjs'), ...argv], {
        cwd: workspace, env: { PATH: process.env.PATH, HYACINTHUS_AGENT_E2E_IPC: control.ipc }, timeout: 10_000,
      });
    } catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
  };
  const events = async () => (await readFile(eventsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { root, workspace, binary, broker, call, events };
}

test('sandbox-side proxy needs no write access to host evidence/profile paths', async () => {
  const state = await setup();
  try {
    const result = await state.call(['--no-notice', 'doctor']);
    assert.equal(JSON.parse(result.stdout).ok, true);
    const events = await state.events();
    assert.equal(events[0].action, 'doctor');
    assert.equal(events[0].exitCode, 0);
    assert.equal(events[0].denied, false);
  } finally { await state.broker.close(); await rm(state.root, { recursive: true, force: true }); }
});

test('only the exact approved payload AND nonempty key can execute', async () => {
  const state = await setup();
  try {
    await writeFile(path.join(state.workspace, 'confirmed.json'), JSON.stringify([{ requirement_code: 'TEST-001' }]));
    const base = ['requirements', 'import', '--file', 'confirmed.json', '--idempotency-key', 'key-one'];
    const missing = await state.call(['requirements', 'import', '--file', 'confirmed.json', '--dry-run']);
    assert.equal(JSON.parse(missing.stdout).error.code, 'AGENT_E2E_POLICY_DENIED');
    const preview = await state.call([...base, '--dry-run']);
    assert.equal(JSON.parse(preview.stdout).ok, true);
    const event = (await state.events()).at(-1);
    state.broker.approve(event.input.fingerprint);
    const first = await state.call([...base, '--yes']);
    assert.equal(JSON.parse(first.stdout).ok, true);
    const changed = await state.call(['requirements', 'import', '--file', 'confirmed.json', '--idempotency-key', 'key-two', '--yes']);
    assert.equal(JSON.parse(changed.stdout).error.code, 'AGENT_E2E_POLICY_DENIED');
    assert.equal((await state.events()).at(-1).denied, true);
  } finally { await state.broker.close(); await rm(state.root, { recursive: true, force: true }); }
});

test('approved import reads a sealed snapshot even if the workspace payload is replaced', { timeout: 5000 }, async () => {
  const state = await setup();
  const marker = path.join(state.root, 'reading.marker');
  try {
    await writeFile(state.binary, `#!${process.execPath}\nconst fs=require('node:fs');const argv=process.argv.slice(2);const source=argv[argv.indexOf('--file')+1];const key=argv[argv.indexOf('--idempotency-key')+1];fs.writeFileSync(${JSON.stringify(marker)},'ready');setTimeout(()=>{const rows=JSON.parse(fs.readFileSync(source,'utf8'));console.log(JSON.stringify({ok:true,data:{created:1,updated:0,failed:0,idempotency_key:key,actual_code:rows[0].requirement_code}}));},100);`, { mode: 0o700 });
    const payload = path.join(state.workspace, 'confirmed.json');
    await writeFile(payload, JSON.stringify([{ requirement_code: 'TEST-001' }]));
    const argv = ['requirements', 'import', '--file', 'confirmed.json', '--idempotency-key', 'stable-key'];
    await state.call([...argv, '--dry-run']);
    state.broker.approve((await state.events()).at(-1).input.fingerprint);
    await rm(marker);
    const execution = state.call([...argv, '--yes']);
    const deadline = Date.now() + 2000;
    while (true) {
      try { await readFile(marker); break; } catch (error) {
        if (error.code !== 'ENOENT' || Date.now() > deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    await writeFile(payload, JSON.stringify([{ requirement_code: 'UNAPPROVED-REPLACEMENT' }]));
    const result = await execution;
    assert.equal(JSON.parse(result.stdout).data.actual_code, 'TEST-001');
    assert.equal((await state.events()).at(-1).denied, false);
  } finally { await state.broker.close(); await rm(state.root, { recursive: true, force: true }); }
});
