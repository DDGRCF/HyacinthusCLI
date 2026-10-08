// 改动说明：验证实际 Pi 默认工具、空根隔离及 /tmp 挂载顺序；不调用模型或数据库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPiSdk } from './pi.mjs';
import { sandboxTools, piSandboxArgs } from './pi-sandbox.mjs';
import { POLICY } from './policy.mjs';

test('installed Pi SDK provides the actual default tools and session factory', async () => {
  const sdk = await loadPiSdk();
  assert.equal(typeof sdk.createAgentSession, 'function');
  assert.equal(typeof sdk.ModelRuntime.create, 'function');
  const state = { workspace: '/tmp/test-workspace', agentDir: '/tmp/pi-agent', bins: '/tmp/test-bin', home: '/tmp/test-home',
    scratch: '/tmp/test-workspace/.tmp', ipc: `/tmp/test-workspace/${POLICY.ipcDirectory}` };
  const definitions = sandboxTools(sdk, state);
  assert.deepEqual(definitions.map(tool => tool.name).sort(), ['bash', 'edit', 'read', 'write']);
  assert.ok(definitions.every(tool => typeof tool.execute === 'function'));
});

test('Pi tools use a cleared environment and isolated mount/network/pid namespaces', () => {
  const state = { workspace: '/tmp/test-workspace', agentDir: '/tmp/pi-agent', bins: '/tmp/test-bin', home: '/tmp/test-home',
    scratch: '/tmp/test-workspace/.tmp', ipc: `/tmp/test-workspace/${POLICY.ipcDirectory}` };
  const args = piSandboxArgs(state, ['/bin/sh', '-c', 'pwd']);
  assert.ok(args.includes('--clearenv'));
  assert.ok(args.includes('--unshare-all'));
  assert.ok(args.includes('--die-with-parent'));
  assert.ok(!args.includes(process.env.HOME));
  assert.ok(!args.includes(process.env.HYACINTHUS_E2E_ADMIN_PASSWORD || 'NO_PASSWORD_SENTINEL'));
  const mounts = args.filter((value, index) => ['--bind', '--ro-bind'].includes(args[index - 1]));
  assert.ok(!mounts.includes('/'));
  const tmpMount = args.indexOf(state.scratch);
  const workspaceMount = args.indexOf(state.workspace);
  assert.ok(tmpMount < workspaceMount, '/tmp must be mounted before restoring a workspace located under /tmp');
  assert.deepEqual(args.slice(-4), ['--', '/bin/sh', '-c', 'pwd']);
});
