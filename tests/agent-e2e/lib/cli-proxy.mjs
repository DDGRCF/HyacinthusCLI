#!/usr/bin/env node
// 改动说明：沙箱内 CLI 客户端改用文件队列，保留真实 stdout/stderr/退出码；不需要 socket 或网络权限。
import { requestFileQueue } from './file-queue.mjs';

/** Forward the real CLI arguments over file IPC without exposing the host approval or credential state. */
async function main() {
  const root = process.env.HYACINTHUS_AGENT_E2E_IPC;
  if (!root) throw new Error('Guarded CLI file queue is missing');
  const result = await requestFileQueue(root, process.argv.slice(2), process.cwd());
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
