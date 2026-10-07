// 改动说明：复用既有隔离 Docker API/UI 和私密管理员凭据运行 Pi 验收；不初始化数据库、不输出密码。
import path from 'node:path';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { loopbackOrigin, POLICY } from './policy.mjs';

/** Load only administrator inputs from an owner-private regular file, never sourcing shell commands. */
async function privateAdministrator(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > POLICY.maxOutputBytes
        || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('Administrator env must be an owner-private regular file');
    const text = await handle.readFile('utf8');
    const result = {};
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const match = line.match(/^(?:export\s+)?(HYACINTHUS_E2E_ADMIN_PASSWORD|HYACINTHUS_E2E_ADMIN_USERNAME)=(.*)$/);
      if (!match) throw new Error('Unexpected administrator env entry');
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      result[match[1]] = value;
    }
    if (!result.HYACINTHUS_E2E_ADMIN_PASSWORD) throw new Error('Existing private administrator password is absent');
    return result;
  } finally { await handle.close(); }
}

/** Run the unchanged acceptance suite against explicitly selected, marker-verified existing services. */
async function main() {
  const [api, admin, credentials] = process.argv.slice(2);
  if (!api || !admin || !credentials) throw new Error('Usage: node lib/run-existing.mjs <test-api-origin> <test-admin-origin> <private-admin-env>');
  const inputs = await privateAdministrator(path.resolve(credentials));
  const env = { ...process.env, ...inputs, HYACINTHUS_AGENT_E2E_API_URL: loopbackOrigin(api),
    HYACINTHUS_AGENT_E2E_ADMIN_URL: loopbackOrigin(admin),
    HYACINTHUS_E2E_ADMIN_USERNAME: inputs.HYACINTHUS_E2E_ADMIN_USERNAME || process.env.HYACINTHUS_E2E_ADMIN_USERNAME || 'rust-e2e-admin@hyacinthus.local' };
  const child = spawn(process.execPath, [path.join(import.meta.dirname, 'report-suite.mjs')], { env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (status, signal) => resolve(signal ? 1 : status ?? 1)); });
  process.exitCode = code;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
