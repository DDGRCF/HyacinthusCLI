// 改动说明：完整空结果后继续检索、看帮助或缺参数都拒绝，保留投影及基础设施验证。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyEmptySearch, cleanupSteps, safeChildOutput, captureChild, prepareSecrets, verifyLocalSopImages } from './sop-lifecycle.mjs';

/** Build a synthetic successful empty CLI search without any live service. */
function search(keyword, scope = 'active', overrides = {}) {
  return { id: keyword, action: 'requirements search', writes: false, exitCode: 0, argv: [],
    result: { ok: true, data: { keyword, scope, total: 0, has_more: false, items: [], ...overrides } } };
}
const conditions = { keywords: ['数学', '初一'] };
test('empty search accepts full data or a real saved result and rejects insufficient projections',()=>{
 const actual=search('数学');
 const projected={...actual,argv:['--jq','.data'],result:actual.result.data};
 assert.equal(verifyEmptySearch([projected],conditions).returned,0);
 const saved={...actual,argv:['--jq','.data.total'],result:0,resultSource:'cli-output-file',outputData:actual.result.data};
 assert.equal(verifyEmptySearch([saved],conditions).returned,0);
 for(const event of [{...projected,exitCode:1},{...projected,argv:[]},{...actual,argv:['--jq','.data.items'],result:[]},{...actual,argv:['--jq','.data.total'],result:0}])assert.throws(()=>verifyEmptySearch([event],conditions),/No actual successful query/);
});

test('database health waits for TCP after the temporary initialization socket', async () => {
  const compose = await readFile(new URL('./compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /pg_isready -h 127\.0\.0\.1 -U postgres -d hyacinthus_test/);
});

test('a complete empty result rejects further keyword queries', () => {
  assert.throws(() => verifyEmptySearch([search('数学'), search('初一')], conditions), /continued CLI calls/);
});
test('help after a complete empty result still violates task termination', () => {
  const help = {action:'requirements search',argv:['requirements','search','--help'],exitCode:0};
  assert.throws(() => verifyEmptySearch([search('数学'), help], conditions), /continued CLI calls/);
});
test('a failed extra invocation after a complete empty result is not ignored', () => {
  const missing = {action:'requirements search',argv:['requirements','search','--scope','active'],exitCode:2,result:{ok:false}};
  assert.throws(() => verifyEmptySearch([search('数学'), missing], conditions), /continued CLI calls/);
});
test('grade alone is exhaustive for a required condition', () => {
  const actual = verifyEmptySearch([search('初一')], conditions);
  assert.equal(actual.keyword, '初一'); assert.equal(actual.extraCliCallsAfterEmpty, 0);
  assert.equal(actual.emptyResultEndsTask, true);
});
test('an unrelated or concatenated keyword cannot prove no matching requirements', () => {
  for (const keyword of ['物理', '初一数学']) assert.throws(() => verifyEmptySearch([search(keyword)], conditions), /requested condition/);
});
test('expanded scope, contradictory counts, pages or writes fail closed', () => {
  for (const events of [[search('数学', 'all')], [search('数学', 'active', { has_more: true })],
    [search('数学', 'active', { items: [{}] })], [search('数学'), { writes: true }],
    [search('数学'), { denied: true }], []]) assert.throws(() => verifyEmptySearch(events, conditions));
});
test('cleanup continues after revocation, absent-Pi stop and boundary verification errors', async () => {
  const attempted = [];
  const results = await cleanupSteps(['revoke', 'stop-pi', 'integrity', 'delete-model', 'remove-backend', 'remove-worker', 'clean-map-env', 'verify-boundary'].map(name => ({ name, run: async () => {
    attempted.push(name); if (['revoke', 'stop-pi', 'verify-boundary'].includes(name)) throw new Error(name); return { done: true };
  } })));
  assert.equal(attempted.length, 8); assert.equal(results.filter(result => result.status === 'failed').length, 3);
  for (const name of ['delete-model', 'remove-backend', 'remove-worker', 'clean-map-env']) assert.equal(results.find(result => result.name === name).status, 'passed');
});
test('missing isolation evidence remains failed even when temporary files are removed', async () => {
  const results = await cleanupSteps([{ name: 'delete-model', run: async () => ({ deleted: true }) },
    { name: 'verify-boundary', run: async () => assert.fail('Missing actual Pi container mount evidence') }]);
  assert.ok(results.some(result => result.status === 'failed')); assert.equal(results[0].status, 'passed');
});
test('preparation captures nonzero exit with stdout and stderr, redacting split credential chunks', async () => {
  const code = "process.stdout.write('reset complete\\nAPI_KEY=synthetic-');setTimeout(()=>{process.stdout.write('private-value\\n');process.stderr.write('school source missing\\n');process.exitCode=7;},5)";
  const result = await captureChild(process.execPath, ['-e', code], { maxOutputBytes: 4096 });
  assert.equal(result.exitCode, 7); assert.match(result.stdout, /reset complete/);
  assert.match(result.stderr, /school source missing/); assert.ok(!result.stdout.includes('synthetic-'));
});
test('spawn errors and bounded stream truncation are observable', async () => {
  const missing = await captureChild('/definitely-missing-sop-child', [], { maxOutputBytes: 128 });
  assert.ok(missing.spawnError); assert.notEqual(missing.exitCode, 0);
  const large = await captureChild(process.execPath, ['-e', "process.stdout.write('x'.repeat(512))"], { maxOutputBytes: 128 });
  assert.equal(large.stdout.length, 128); assert.equal(large.truncated.stdout, true);
});
test('redaction keeps diagnostics while stripping JSON, env, Bearer and DSN values', () => {
  const source = 'unknown school alias\\n{\"key\":\"synthetic-secret\"}\\nHYACINTHUS_E2E_ADMIN_PASSWORD=synthetic-password\\nAuthorization: Bearer synthetic-token\\npostgres://postgres:synthetic-password@db:5432/test'.replaceAll('\\n', '\n');
  const result = safeChildOutput(source); assert.match(result, /unknown school alias/);
  for (const value of ['synthetic-secret', 'synthetic-password', 'synthetic-token']) assert.ok(!result.includes(value));
});
test('preparation redaction reads only three task files and includes newly generated private values', async () => {
  const files = { 'mimo-auth.json': JSON.stringify({ 'xiaomi-token-plan-cn': { key: 'synthetic-model' } }),
    'backend.env': 'HYACINTHUS_SECURITY__JWT_SECRET=synthetic-jwt\nMAP_ALLOWED=synthetic-map\nUNRELATED=ignore\n',
    'driver.env': 'HYACINTHUS_E2E_ADMIN_PASSWORD=synthetic-admin\n' };
  const reads = [];
  const values = await prepareSecrets('/synthetic/task/private', ['MAP_ALLOWED'], async file => {
    reads.push(file); return files[file.split('/').at(-1)];
  });
  assert.equal(reads.length, 3); assert.ok(reads.every(file => file.startsWith('/synthetic/task/private/')));
  assert.deepEqual(values.sort(), ['synthetic-admin', 'synthetic-jwt', 'synthetic-map', 'synthetic-model']);
});
test('missing preparation files are safe, while unreadable copies prohibit publication', async () => {
  assert.deepEqual(await prepareSecrets('/synthetic/task/private', [], async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }), []);
  await assert.rejects(prepareSecrets('/synthetic/task/private', [], async () => { throw new Error('private error text'); }), /redaction inputs unavailable/);
});
test('preparation log sanitization removes original authorization links and user codes', () => {
  const result = safeChildOutput('用户代码： ABCD-EF12\nhttps://example.test/admin/agent-auth/authorize?user_code=ABCD-EF12');
  assert.ok(!result.includes('ABCD-EF12')); assert.ok(!result.includes('https://example.test'));
});
test('image preflight takes versions from Compose and inspects only two distinct local images', async () => {
  const backend = 'hyacinthus-skills-e2e-backend:synthetic-future-tag';
  const pi = 'hyacinthus-skills-e2e-pi:synthetic-other-tag';
  const seen = [];
  const actual = await verifyLocalSopImages(`redis:synthetic\n${backend}\n${backend}\n${pi}\n`, async reference => {
    seen.push(reference); return `sha256:${(reference === backend ? 'a' : 'b').repeat(64)}\n`;
  });
  assert.deepEqual(seen, [backend, pi]); assert.equal(actual.length, 2); assert.notEqual(actual[0].id, actual[1].id);
  assert.deepEqual(actual.map(image => image.reference), [backend, pi]);
});
test('missing either local image refuses preparation and hides injected private error text', async () => {
  const names = ['hyacinthus-skills-e2e-backend:test', 'hyacinthus-skills-e2e-pi:test'];
  for (const missing of names) await assert.rejects(verifyLocalSopImages(names.join('\n'), async reference => {
    if (reference === missing) throw new Error('synthetic-private-value');
    return `sha256:${(reference.includes('backend') ? 'a' : 'b').repeat(64)}`;
  }), error => error.message.includes(missing) && error.message.includes('SOP image build') && !error.message.includes('synthetic-private-value'));
});
test('absent or conflicting Compose image selections fail before any inspect', async () => {
  const backend = 'hyacinthus-skills-e2e-backend:test'; const pi = 'hyacinthus-skills-e2e-pi:test';
  for (const names of ['', backend, pi, `${backend}\n${pi}\nhyacinthus-skills-e2e-pi:other`]) {
    let called = false;
    await assert.rejects(verifyLocalSopImages(names, async () => { called = true; })); assert.equal(called, false);
  }
});
test('invalid or identical image IDs are rejected', async () => {
  const names = 'hyacinthus-skills-e2e-backend:test\nhyacinthus-skills-e2e-pi:test';
  for (const id of ['', 'not-an-image-id', `sha256:${'a'.repeat(64)}`]) await assert.rejects(verifyLocalSopImages(names, async () => id));
});

test('selected restore refreshes proxy after API/Worker without reset or Pi recreation', async () => {
  const { restoreSelectedServices } = await import('./sop-lifecycle.mjs');
  const calls = []; const prefix = ['compose', '--env-file', '/synthetic/compose.env', '-p', 'synthetic-sop', '-f', '/synthetic/compose.yml'];
  await restoreSelectedServices(async argv => { calls.push(argv); }, prefix);
  assert.deepEqual(calls, [[...prefix, 'up', '-d', 'backend', 'worker'],
    [...prefix, 'up', '-d', '--no-deps', '--force-recreate', 'front-admin']]);
  assert.ok(calls.every(argv => !argv.includes('reset') && !argv.includes('down') && !argv.includes('pi')));
  assert.deepEqual(prefix, ['compose', '--env-file', '/synthetic/compose.env', '-p', 'synthetic-sop', '-f', '/synthetic/compose.yml']);
});
test('selected backend restoration failure blocks proxy work and propagates the real failure', async () => {
  const { restoreSelectedServices } = await import('./sop-lifecycle.mjs');
  const calls = []; const failure = new Error('synthetic backend restoration failure');
  await assert.rejects(restoreSelectedServices(async argv => { calls.push(argv); throw failure; }, ['compose']), error => error === failure);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], ['compose', 'up', '-d', 'backend', 'worker']);
});
