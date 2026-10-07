// 改动说明：真实 bubblewrap 预检 Pi 默认工具边界及文件队列，不调用模型、不授权、不写数据库。
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { POLICY } from './policy.mjs';
import { createFileQueue } from './file-queue.mjs';
import { sandboxExecute, piSandboxArgs } from './pi-sandbox.mjs';

/** Prove real write/read/network/IPC boundaries using the same mounts as Pi's four built-in tools. */
export async function probeSandbox(existing) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hyacinthus-pi-sandbox-'));
  const workspace = existing?.workspace || path.join(root, 'workspace');
  const state = existing || { workspace, agentDir: path.join(root, 'pi-agent'), bins: path.join(root, 'bin'),
    home: path.join(root, 'home'), scratch: path.join(workspace, '.tmp'), ipc: path.join(workspace, POLICY.ipcDirectory) };
  const secret = path.join(root, 'protected-secret.txt');
  const marker = `PRIVATE-${randomUUID()}`;
  const responseId = randomUUID();
  let queue, networkServer;
  try {
    networkServer = createServer((_request, response) => response.end(marker));
    await new Promise((resolve, reject) => { networkServer.once('error', reject); networkServer.listen(0, '127.0.0.1', resolve); });
    const port = networkServer.address().port;
    const baseline = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(POLICY.sandboxNetworkTimeoutMs) });
    assert.equal(await baseline.text(), marker);
    for (const directory of [workspace, state.agentDir, state.bins, state.home, state.scratch]) await mkdir(directory, { recursive: true });
    await writeFile(secret, marker, { mode: 0o600 });
    await writeFile(path.join(state.agentDir, 'probe-skill.txt'), 'INSTALLED_SKILL', { mode: 0o600 });
    queue = await createFileQueue(state.ipc, async request => {
      assert.deepEqual(request.argv, ['protocol-probe']);
      assert.equal(request.cwd, workspace);
      return { stdout: 'IPC_OK', stderr: '', exitCode: 0 };
    });
    const script = `const fs=require('node:fs');const net=require('node:net');const assert=require('node:assert/strict');
const [ws,skills,home,secret,marker,ipc,rid,port]=process.argv.slice(1);
fs.writeFileSync(ws+'/probe-write.txt','WORKSPACE_OK');fs.writeFileSync('/tmp/probe-write.txt','TMP_OK');
assert.equal(fs.readFileSync(skills+'/probe-skill.txt','utf8'),'INSTALLED_SKILL');
for(const file of [skills+'/probe-skill.txt',home+'/auth.json',ipc+'/responses/'+rid+'.json']){assert.throws(()=>fs.writeFileSync(file,'FORGED'));}
assert.throws(()=>fs.readFileSync(secret));assert.throws(()=>fs.readFileSync('/home/r/.pi/agent/auth.json'));assert.throws(()=>fs.readFileSync('/home/r/.codex/auth.json'));
assert.throws(()=>fs.renameSync(ipc,ipc+'-replaced'));
assert.ok(!JSON.stringify(process.env).includes(marker));
const socket=net.connect({host:'127.0.0.1',port:Number(port)});const timer=setTimeout(()=>{socket.destroy();console.log('NETWORK_ISOLATED')},${POLICY.sandboxNetworkTimeoutMs});
socket.on('connect',()=>{clearTimeout(timer);process.exitCode=9;socket.destroy()});socket.on('error',()=>{clearTimeout(timer);console.log('NETWORK_ISOLATED')});`;
    const isolated = await sandboxExecute(state, [process.execPath, '-e', script, workspace, state.agentDir, state.home, secret, marker, state.ipc, responseId, String(port)], { timeoutMs: POLICY.sandboxProbeTimeoutMs });
    assert.equal(isolated.exitCode, 0, isolated.stderr.toString());
    assert.match(isolated.stdout.toString(), /NETWORK_ISOLATED/);
    assert.equal(await readFile(path.join(workspace, 'probe-write.txt'), 'utf8'), 'WORKSPACE_OK');
    assert.equal(await readFile(path.join(state.scratch, 'probe-write.txt'), 'utf8'), 'TMP_OK');
    const client = path.resolve(import.meta.dirname, 'cli-proxy.mjs');
    const ipc = await sandboxExecute(state, [process.execPath, client, 'protocol-probe'], { timeoutMs: POLICY.sandboxProbeTimeoutMs });
    assert.equal(ipc.exitCode, 0, ipc.stderr.toString());
    assert.equal(ipc.stdout.toString(), 'IPC_OK');
    // Mount construction must not accidentally introduce host-wide or business-config read access.
    assert.ok(piSandboxArgs(state, ['/usr/bin/true']).includes('--unshare-all'));
    return { ok: true, engine: 'bubblewrap', fileQueue: true, networkIsolated: true, protectedEvidence: true };
  } finally {
    if (networkServer) {
      networkServer.closeAllConnections();
      await new Promise(resolve => networkServer.close(resolve));
    }
    await queue?.close();
    await rm(path.join(state.agentDir, 'probe-skill.txt'), { force: true });
    await rm(path.join(workspace, 'probe-write.txt'), { force: true });
    await rm(path.join(state.scratch, 'probe-write.txt'), { force: true });
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  probeSandbox().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
