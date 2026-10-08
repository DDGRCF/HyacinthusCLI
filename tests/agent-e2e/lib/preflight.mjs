// 改动说明：Pi 授权和写入前验证既有测试服务；模型凭据由宿主 SDK 使用，不复制；不 reset/seed。
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { settings, POLICY } from './policy.mjs';

/** Verify the backend's explicit test-database marker and the existing authorization UI. */
export async function preflight(config, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${config.api}/health/ready`, { redirect: 'error', signal: AbortSignal.timeout(POLICY.readinessTimeoutMs) });
  } catch {
    throw new Error(`Existing isolated API is unavailable at ${config.api}; no reset, authorization or writes were started`);
  }
  if (!response.ok || response.headers.get('x-hyacinthus-test-database') !== 'hyacinthus_test') {
    throw new Error('Refusing Agent E2E: readiness must explicitly identify hyacinthus_test; no authorization or writes were started');
  }
  if (!config.adminPassword) throw new Error('Existing test administrator password is required: HYACINTHUS_E2E_ADMIN_PASSWORD');
  let admin;
  try {
    admin = await fetcher(`${config.admin}/admin/login`, { redirect: 'error', signal: AbortSignal.timeout(POLICY.readinessTimeoutMs) });
  } catch {
    throw new Error(`Existing isolated authorization UI is unavailable at ${config.admin}`);
  }
  if (!admin.ok) throw new Error('Existing test authorization UI is not ready');
  await access(config.cliBinary);
  await access(path.join(config.piHome, 'auth.json'));
  return { database: 'hyacinthus_test', api: config.api, admin: config.admin, reset: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  preflight(settings()).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
