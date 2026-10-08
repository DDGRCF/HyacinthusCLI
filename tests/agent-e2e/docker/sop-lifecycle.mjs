// 改动说明：selected恢复后刷新Nginx代理，预检本地SOP镜像，按条件验证空结果，独立清理并捕获脱敏准备输出。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const GENERATED_SECRET_KEYS = ['HYACINTHUS_SECURITY__JWT_SECRET', 'HYACINTHUS_SECURITY__REQUIREMENT_CURSOR_ACTIVE_KEY',
  'HYACINTHUS_SECURITY__SNAPSHOT_PAGINATION__ACTIVE_KEY', 'HYACINTHUS_ADMIN_PLATFORM__SETTINGS_ENCRYPTION_KEY',
  'HYACINTHUS_E2E_ADMIN_PASSWORD', 'HYACINTHUS_STORAGE__ACCESS_KEY_ID', 'HYACINTHUS_STORAGE__SECRET_ACCESS_KEY'];

/** Inspect the Compose-selected local backend and Pi images before any Docker mutation. */
export async function verifyLocalSopImages(composeImages, inspect) {
  const names = [...new Set(composeImages.split(/\r?\n/).map(name => name.trim()).filter(Boolean))];
  const selected = ['hyacinthus-skills-e2e-backend', 'hyacinthus-skills-e2e-pi'].map(repository => {
    const matches = names.filter(name => name.startsWith(`${repository}:`) || name.startsWith(`${repository}@`));
    assert.equal(matches.length, 1, `Compose must select one ${repository} image; follow the SOP image build steps`);
    return matches[0];
  });
  const images = [];
  for (const reference of selected) {
    let id;
    try { id = String(await inspect(reference)).trim(); }
    catch { throw new Error(`Local SOP image missing or unavailable: ${reference}; follow the SOP image build steps`); }
    assert.match(id, /^sha256:[0-9a-f]{64}$/, `Missing local image ID for ${reference}; follow the SOP image build steps`);
    images.push({ reference, id });
  }
  assert.notEqual(images[0].id, images[1].id, 'Backend and Pi must use distinct SOP images; follow the SOP image build steps');
  return images;
}

/** Collect only this task's existing private copies; never re-read the host credential source. */
export async function prepareSecrets(privateDir, mapSecretKeys, read = readFile) {
  const values = [];
  for (const name of ['mimo-auth.json', 'backend.env', 'driver.env']) {
    let text;
    try { text = await read(path.join(privateDir, name), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw new Error('Preparation log redaction inputs unavailable'); }
    if (name === 'mimo-auth.json') {
      let auth; try { auth = JSON.parse(text); } catch { throw new Error('Private model snapshot is invalid'); }
      if (typeof auth?.['xiaomi-token-plan-cn']?.key !== 'string') throw new Error('Private model snapshot is invalid');
      values.push(auth['xiaomi-token-plan-cn'].key);
    } else for (const line of text.split(/\r?\n/)) {
      const equal = line.indexOf('='); if (equal < 0) continue;
      const key = line.slice(0, equal).trim();
      if (![...GENERATED_SECRET_KEYS, ...mapSecretKeys].includes(key)) continue;
      values.push(line.slice(equal + 1).trim().replace(/^(["'])(.*)\1$/, '$2'));
    }
  }
  return [...new Set(values.filter(Boolean))];
}

/** Select exhaustive empty evidence for one requested condition, and count later CLI work. */
export function verifyEmptySearch(events, { keywords, scope = 'active' }) {
  assert.ok(Array.isArray(keywords) && keywords.length, 'Missing requested search conditions');
  const searches = events.filter(event => event.action === 'requirements search' && event.result?.ok);
  assert.ok(searches.length, 'No actual successful query');
  assert.ok(searches.every(event => event.result.data.scope === scope), 'Query expanded the requested scope');
  const index = events.findIndex(event => event.action === 'requirements search' && event.result?.ok
    && event.result.data.scope === scope && keywords.includes(event.result.data.keyword)
    && event.result.data.total === 0 && event.result.data.has_more === false
    && Array.isArray(event.result.data.items) && event.result.data.items.length === 0);
  assert.ok(index >= 0, 'No exhaustive empty query for a requested condition');
  assert.ok(!events.some(event => event.denied || event.writes), 'Query attempted a denied action or business write');
  const query = events[index];
  return { queryEventId: query.id, keyword: query.result.data.keyword, scope,
    returned: 0, emptyResultEndsTask: index === events.length - 1,
    extraCliCallsAfterEmpty: events.length - index - 1,
    extraActionsAfterEmpty: events.slice(index + 1).map(event => event.action) };
}

/** Continue cleanup after any failure, preserving all step results for the final gate. */
export async function cleanupSteps(steps, sanitize = safeChildOutput) {
  const results = [];
  for (const { name, run } of steps) {
    try { results.push({ name, status: 'passed', detail: await run() }); }
    catch (error) { results.push({ name, status: 'failed', error: sanitize(String(error.message)) }); }
  }
  return results;
}

/** Strip credential-bearing log lines and URL credentials before any public persistence. */
export function safeChildOutput(text) {
  return String(text).replace(/Bearer\s+[^\s"']+/gi, 'Bearer <redacted>')
    .replace(/https?:\/\/[^\s"<>]+\/admin\/agent-auth\/authorize[^\s"<>]*/g, '<authorization-link>')
    .replace(/((?:用户代码|用户码|授权码|user[ _-]*code)[：:\s*`]*)([A-Z0-9]{4}-[A-Z0-9]{4})/gi, '$1<redacted>')
    .replace(/(https?:\/\/|postgres(?:ql)?:\/\/)([^\s/@]+)@/gi, '$1<redacted>@')
    .split('\n').map(line => /(?:[\w-]*(?:password|secret|token|api[_-]?key|authorization|credential|user[_-]?code|qr_code_text)[\w-]*|"key")\s*["']?\s*[:=]/i.test(line)
      ? '<redacted credential-bearing log line>' : line)
    .join('\n');
}

/** Capture complete bounded streams, then redact; never persist unredacted chunks. */
export async function captureChild(command, argv, { sanitize = safeChildOutput, maxOutputBytes }) {
  assert.ok(Number.isSafeInteger(maxOutputBytes) && maxOutputBytes > 0, 'Missing child output bound');
  return new Promise(resolve => {
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: [], stderr: [] }; const sizes = { stdout: 0, stderr: 0 };
    const truncated = { stdout: false, stderr: false }; let spawnError;
    for (const name of ['stdout', 'stderr']) child[name].on('data', chunk => {
      const remaining = Math.max(0, maxOutputBytes - sizes[name]);
      output[name].push(chunk.subarray(0, remaining)); sizes[name] += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) truncated[name] = true;
    });
    child.once('error', error => { spawnError = sanitize(error.message); });
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal, spawnError, truncated,
      stdout: sanitize(Buffer.concat(output.stdout).toString()),
      stderr: sanitize(Buffer.concat(output.stderr).toString()) }));
  });
}

/** Restore API/Worker first, then refresh the retained Nginx container's static backend DNS. */
export async function restoreSelectedServices(runDocker, composeArgs) {
  await runDocker([...composeArgs, 'up', '-d', 'backend', 'worker']);
  await runDocker([...composeArgs, 'up', '-d', '--no-deps', '--force-recreate', 'front-admin']);
}
