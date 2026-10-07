// 改动说明：对齐 skills read 与相对任务目录验收，保留最小授权和批准边界，脱敏设备密钥及明文授权码。
import path from 'node:path';

/** One explicit, configurable budget set for the real-agent acceptance suite. */
export const POLICY = Object.freeze({
  rows: 30,
  maxTurns: 7,
  maxCliCalls: 128,
  turnTimeoutMs: 1_800_000,
  cliTimeoutMs: 150_000,
  readinessTimeoutMs: 10_000,
  browserTimeoutMs: 20_000,
  scenarioTimeoutMs: 4_800_000,
  readbackTimeoutMs: 120_000,
  testTimeoutMs: 4_860_000,
  cleanupTimeoutMs: 30_000,
  sandboxProbeTimeoutMs: 20_000,
  sandboxNetworkTimeoutMs: 1_000,
  maxOutputBytes: 4 * 1024 * 1024,
  ipcDirectory: '.hyacinthus-ipc',
  ipcPollMs: 25,
  ipcResponseBytes: 8 * 1024 * 1024,
  ipcTimeoutMs: 160_000,
  modelCatalogTimeoutMs: 10_000,
});

/** Accept a loopback origin only; never accept remote URLs or URL credentials. */
export function loopbackOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Agent E2E requires a plain loopback HTTP origin');
  }
  return url.origin;
}

/** Resolve the reproducible test target and existing administrator inputs without reading business env files. */
export function settings(env = process.env) {
  return {
    api: loopbackOrigin(env.HYACINTHUS_AGENT_E2E_API_URL || 'http://127.0.0.1:8001'),
    admin: loopbackOrigin(env.HYACINTHUS_AGENT_E2E_ADMIN_URL || 'http://127.0.0.1:5667'),
    adminUsername: env.HYACINTHUS_E2E_ADMIN_USERNAME || 'rust-debug@hyacinthus.local',
    adminPassword: env.HYACINTHUS_E2E_ADMIN_PASSWORD,
    piBinary: env.HYACINTHUS_AGENT_E2E_PI_BINARY || 'pi',
    provider: env.HYACINTHUS_AGENT_E2E_PI_PROVIDER || 'xiaomi-token-plan-cn',
    model: env.HYACINTHUS_AGENT_E2E_PI_MODEL || 'mimo-v2.6-pro',
    piHome: env.PI_CODING_AGENT_DIR || path.join(env.HOME || '', '.pi/agent'),
    cliBinary: env.HYACINTHUS_E2E_CLI_BINARY || path.resolve(import.meta.dirname, '../../../target/debug/hyacinthus'),
    browserBinary: env.HYACINTHUS_AGENT_E2E_CHROME_BINARY,
  };
}

/** Map the Skill's isolated /tmp files into the mounted scratch directory; reject every other absolute path. */
export function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.split(/[\\/]/).includes('..') || value.includes('\\')) {
    throw new Error('CLI file paths must stay relative to the test workspace or inside isolated /tmp');
  }
  if (value.startsWith('/tmp/')) return `.tmp/${value.slice('/tmp/'.length)}`;
  if (path.isAbsolute(value)) throw new Error('CLI file paths must stay relative to the test workspace or inside isolated /tmp');
  return value;
}

/** Canonicalize harmless global options and the CLI's output-file alias before policy inspection. */
export function normalizeArgv(argv) {
  const result = [];
  const globals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-notice' || arg === '--verbose' || arg === '--format=json') continue;
    if (arg === '--format' && argv[index + 1] === 'json') { index += 1; continue; }
    if (arg === '--request-id') { globals.push(arg, argv[++index]); continue; }
    if (arg.startsWith('--request-id=')) { globals.push(arg); continue; }
    if (arg === '-o') { result.push('--output', argv[++index]); continue; }
    if (arg.startsWith('-o') && !arg.startsWith('--')) { result.push('--output', arg.slice(2).replace(/^=/, '')); continue; }
    result.push(arg);
  }
  const mapped = [...result, ...globals];
  const flags = ['--file', '--output', '--dir', '--pending-state'];
  for (let index = 0; index < mapped.length; index += 1) {
    if (flags.includes(mapped[index])) { mapped[index + 1] = relativeFile(mapped[index + 1]); index += 1; }
    else if (flags.some(flag => mapped[index].startsWith(`${flag}=`))) {
      const equal = mapped[index].indexOf('=');
      mapped[index] = `${mapped[index].slice(0, equal + 1)}${relativeFile(mapped[index].slice(equal + 1))}`;
    } else if (mapped[index] === '--data' && mapped[index + 1]?.startsWith('@')) {
      index += 1;
      mapped[index] = `@${relativeFile(mapped[index].slice(1))}`;
    } else if (mapped[index].startsWith('--data=@')) mapped[index] = `--data=@${relativeFile(mapped[index].slice('--data=@'.length))}`;
  }
  return mapped;
}

/** Read one CLI long-option value without changing payload contents. */
export function option(argv, flag) {
  const inline = argv.find(arg => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/** Enumerate every filesystem-bearing CLI argument, including pending-state and @file aliases. */
export function fileArguments(argv) {
  const files = [];
  for (const flag of ['--file', '--output', '--dir', '--pending-state']) {
    const value = option(argv, flag);
    if (value !== undefined) files.push(value);
  }
  const data = option(argv, '--data');
  if (data?.startsWith('@')) files.push(data.slice(1));
  return files;
}

/** Inspect allowed real CLI calls and deny writes before an explicit simulated-user approval. */
export function inspectCall(submitted, approval) {
  const argv = normalizeArgv(submitted);
  const blocked = ['--base-url', '--profile', '--format', '--jq', '-q', '--token', '--instance-id'];
  if (argv.some(arg => blocked.some(flag => arg === flag || arg.startsWith(`${flag}=`)))) {
    throw new Error('Agent may not override the guarded backend/profile/output protocol');
  }
  for (const file of fileArguments(argv)) relativeFile(file);
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 1 && argv[0] === '--version') {
    return { action: 'help', writes: false };
  }
  const allowed = new Set([
    'auth status', 'auth login', 'auth wait', 'auth token',
    'requirements options', 'requirements parse', 'requirements parse-job', 'requirements import', 'requirements search',
    'capability schema', 'capability list', 'skills list', 'skills read',
  ]);
  const action = argv[0] === 'doctor' || argv[0] === 'schema' ? argv[0] : argv.slice(0, 2).join(' ');
  if (!allowed.has(action) && !['doctor', 'schema'].includes(action)) {
    throw new Error(`CLI action is outside the batch acceptance scope: ${action}`);
  }
  if (action === 'requirements parse-job' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(argv[2] || '')) throw new Error('Only a concrete parse-job recovery identifier is permitted');
  if (action === 'auth token' && argv[2] !== 'status') throw new Error('Only token status is permitted');
  if (action === 'auth login' && argv.includes('--wait')) throw new Error('Share one authorization link before waiting');
  if (action === 'auth login') {
    const scopes = argv.find(arg => arg.startsWith('--scope='))?.slice('--scope='.length)
      || argv[argv.indexOf('--scope') + 1];
    if (!argv.some(arg => arg === '--scope' || arg.startsWith('--scope=')) || !scopes) {
      throw new Error('Authorization must request explicit minimal scopes');
    }
    if (scopes.split(/[\s,]+/).some(scope => !['requirements:read', 'requirements:write', 'requirements:parse'].includes(scope))) {
      throw new Error('This scenario does not approve catalog/user/admin scopes');
    }
  }
  const writes = action === 'requirements import' && !argv.includes('--dry-run');
  if (writes && (!approval.writeApproved || !argv.includes('--yes'))) {
    throw new Error('Import requires a displayed preview and explicit user batch approval');
  }
  return { action, writes };
}

/** Remove credential values and authorization handoff links from persisted observations. */
export function redact(value) {
  if (typeof value === 'string') {
    return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer <redacted>')
      .replace(/"(key|api_key|apiKey|client_secret|token|access_token|refresh_token|device_code|device_secret|password|authorization|qr_code_text|authorize_url|user_code)"\s*:\s*"(?:\\.|[^"\\])*"/gi, '"$1":"<redacted>"')
      .replace(/((?:用户代码|用户码|授权码|user[ _-]*code)[：:\s*`]*)([A-Z0-9]{4}-[A-Z0-9]{4})/gi, '$1<redacted>')
      .replace(/https?:\/\/[^\s"<>]+\/admin\/agent-auth\/authorize[^\s"<>]*/g, '<authorization-link>');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /^(key|api_key|apiKey|client_secret|token|access_token|refresh_token|device_code|device_secret|password|authorization|qr_code_text|authorize_url|user_code)$/i.test(key)
      ? '<redacted>' : redact(item),
  ]));
  return value;
}

/** Remove exact known private values even when tools echo them as ordinary text. */
export function redactWithSecrets(value,secrets){
  if(typeof value==='string')return redact(secrets.filter(s=>typeof s==='string'&&s.length).reduce((text,secret)=>text.replaceAll(secret,'<redacted>'),value));
  if(Array.isArray(value))return value.map(item=>redactWithSecrets(item,secrets));
  if(value&&typeof value==='object')return redact(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redactWithSecrets(item,secrets)])));
  return value;
}
