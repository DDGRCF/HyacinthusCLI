// 改动说明：生成独立测试环境与单一 MiMo 临时凭据，通过受保护 Rust 脚本初始化专用 Docker 测试库。
import { readFile, writeFile, mkdir, copyFile, chmod, readdir, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { mapEnvironment, probeMap } from './geo-fixture.mjs';

const repo = path.resolve(import.meta.dirname, '../../../..');
const artifacts = path.join(repo, '.tmp/e2e/skills-alignment');
const privateDir = path.join(artifacts, 'private');
const workspace = path.join(artifacts, 'workspace');
const project = 'hyacinthus-skills-acceptance';
const compose = path.join(import.meta.dirname, 'compose.yml');
const envFile = path.join(artifacts, 'compose.env');

/** Run only the uniquely named Docker acceptance project, with no secret values in arguments. */
function docker(args) {
  execFileSync('docker', ['compose', '--env-file', envFile, '-p', project, '-f', compose, ...args], { stdio: 'inherit', cwd: repo });
}

/** Write local test credentials with owner-only access. */
async function secretFile(name, value) {
  const file = path.join(privateDir, name);
  await writeFile(file, value, { mode: 0o600 });
  await chmod(file, 0o600);
}

try { const lock=JSON.parse(await readFile(path.join(artifacts,'sop.lock'),'utf8'));if(lock.pid!==process.ppid)throw new Error('Another SOP owner holds this environment; initialization refused'); } catch(error) {if(error.code!=='ENOENT')throw error;}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await mkdir(workspace, { recursive: true });
// Fail before modifying any Docker state if the explicitly selected provider is unavailable.
const hostAgent = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent');
const auth = JSON.parse(await readFile(path.join(hostAgent, 'auth.json'), 'utf8'));
const provider = auth['xiaomi-token-plan-cn'];
if (provider?.type !== 'api_key' || !provider.key) throw new Error('The local MiMo Token Plan CN API key is unavailable');
const mapConfig=await mapEnvironment(repo);await probeMap(mapConfig);
await secretFile('mimo-auth.json', JSON.stringify({ 'xiaomi-token-plan-cn': provider }));
const password = randomBytes(24).toString('hex');
const temporary = () => randomBytes(32).toString('base64url');
const config = {
  ...mapConfig,
  APP_ENV: 'test', HYACINTHUS_DATABASE__URL: 'postgres://postgres:isolated-test-only@db:5432/hyacinthus_test',
  HYACINTHUS_OBSERVABILITY__LOG_FILTER: 'info',
  HYACINTHUS_SERVER__HOST: '0.0.0.0', HYACINTHUS_SERVER__PORT: '8000', HYACINTHUS_SERVER__REQUEST_TIMEOUT_SECONDS: '60',
  HYACINTHUS_REDIS__ENABLED: 'true', HYACINTHUS_REDIS__URL: 'redis://redis:6379', HYACINTHUS_REDIS__NAMESPACE: 'skills_alignment',
  HYACINTHUS_REDIS__REQUIRED_FOR_READINESS: 'true', HYACINTHUS_SECURITY__JWT_SECRET: temporary(),
  HYACINTHUS_SECURITY__REQUIREMENT_CURSOR_ACTIVE_KEY: temporary(), HYACINTHUS_SECURITY__SNAPSHOT_PAGINATION__ACTIVE_KEY: temporary(),
  HYACINTHUS_ADMIN_PLATFORM__SETTINGS_ENCRYPTION_KEY: temporary(), HYACINTHUS_SECURITY__AGENT_AUTHORIZE_BASE_URL: 'http://127.0.0.1:18013',
  HYACINTHUS_SECURITY__AGENT_AUTHORIZE_ROUTER_MODE: 'hash', HYACINTHUS_E2E_ADMIN_PASSWORD: password,
  HYACINTHUS_CORS__ALLOWED_ORIGINS: 'http://127.0.0.1:18013',
  HYACINTHUS_STORAGE__ENABLED: 'true', HYACINTHUS_STORAGE__ENDPOINT_URL: 'http://object-store:9000',
  HYACINTHUS_STORAGE__PUBLIC_BASE_URL: 'http://object-store:9000/hyacinthus-assets',
  HYACINTHUS_STORAGE__ACCESS_KEY_ID: 'skills-test-storage', HYACINTHUS_STORAGE__SECRET_ACCESS_KEY: 'isolated-storage-only',
};
await secretFile('backend.env', Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
await secretFile('driver.env', `HYACINTHUS_E2E_ADMIN_PASSWORD=${password}\n`);
await secretFile('pi.env', 'HYACINTHUS_BASE_URL=http://backend:8000\nHYACINTHUS_PROFILE=pi-skills-acceptance\nHYACINTHUS_CONFIG_DIR=/home/node/.config/hyacinthus\nHYACINTHUS_CLI_LATEST_VERSION=0.1.15\n');
await copyFile(path.join(repo, 'backend/scripts/run.sh'), path.join(privateDir, 'run.sh'));
await chmod(path.join(privateDir, 'run.sh'), 0o755);
await writeFile(envFile, `SKILLS_E2E_PRIVATE_DIR=${privateDir}\nSKILLS_E2E_WORKSPACE=${workspace}\n`, { mode: 0o600 });
// Stop only this acceptance project's processes before resetting its own named volume database.
docker(['down']);
// Keep prior evidence outside the Agent mount so every complete run starts with an empty workspace.
if ((await readdir(workspace)).length) {
  const history = path.join(artifacts, 'workspace-history');
  await mkdir(history, { recursive: true });
  await rename(workspace, path.join(history, String(Date.now())));
  await mkdir(workspace);
}
docker(['up', '-d', 'db', 'redis']);
const guarded = ['run', '--rm', '-v', `${privateDir}/run.sh:/app/scripts/run.sh:ro,z`, '-e', 'HYACINTHUS_ADMIN_BINARY=/app/admin', '--entrypoint', '/bin/bash', 'backend', '/app/scripts/run.sh', 'admin'];
docker([...guarded, 'reset', '--database', 'test', '--confirm', 'hyacinthus_test']);
docker([...guarded, 'seed', '--database', 'test', '--set', 'e2e', '--confirm', 'hyacinthus_test']);
docker(['up', '-d', 'backend', 'worker', 'front-admin', 'pi']);
let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch('http://127.0.0.1:18012/health/ready');
    const logs = execFileSync('docker', ['logs', `${project}-worker-1`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (response.status === 200 && response.headers.get('x-hyacinthus-test-database') === 'hyacinthus_test'
      && logs.includes('worker runtime started')) { ready = true; break; }
  } catch { /* Continue only within the bounded isolated-stack startup deadline. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) throw new Error('The real API/test-database marker and Worker startup did not become ready');
console.log('Independent test stack ready. Credentials were not printed. Continuing the standardized SOP.');
