// 改动说明：全 Pi 验收持有后端集成锁；前置门禁在场景内执行，失败也生成 HTML；不启动服务或改库。
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

/** Run one child and propagate its terminal exit without printing inherited credentials. */
function child(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(command, args, { stdio: 'inherit', env });
    processHandle.on('error', reject);
    processHandle.on('close', code => resolve(code ?? 1));
  });
}

/** Hold the same lock as backend/scripts/run.sh for the whole model/UI/import acceptance. */
async function main() {
  const cliRoot = path.resolve(import.meta.dirname, '../../..');
  const parent = path.dirname(cliRoot);
  const lockRoot = existsSync(path.join(parent, 'backend/scripts/run.sh')) ? parent : cliRoot;
  const lock = path.join(lockRoot, '.tmp/locks/backend-integration.lock');
  if (!process.argv.includes('--locked')) {
    await mkdir(path.dirname(lock), { recursive: true });
    return await child('flock', ['--exclusive', '--nonblock', lock, process.execPath, import.meta.filename, '--locked']);
  }
  const e2e = path.resolve(import.meta.dirname, '../node_modules/e2e/dist/cli/bin.js');
  return await child(process.execPath, [e2e, 'run', '--no-cache'], { ...process.env, E2E_TELEMETRY_DISABLED: '1' });
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
