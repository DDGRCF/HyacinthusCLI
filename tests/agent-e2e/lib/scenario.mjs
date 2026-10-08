// 改动说明：授权分享检查覆盖本轮全部 assistant 文本，避免误判；无已发放 token 时不虚构远端撤销失败。
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink, realpath, rm, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { chromium } from 'playwright';
import { POLICY, settings, redact, relativeFile } from './policy.mjs';
import { preflight } from './preflight.mjs';
import { createPiAgent } from './pi.mjs';
import { verifyTrace, verifyRows, verifyReport, verifyNormalized, deniedAttempts } from './verify.mjs';
import { createBroker } from './broker.mjs';
import { probeSandbox } from './sandbox-probe.mjs';
import { writeHtmlReport } from './html-report.mjs';
import { protectAuthorizationContext } from './browser-policy.mjs';
import { sharedAuthorization } from './reply.mjs';

const execute = promisify(execFile);
let activeCancellation;

/** Cancel the active scenario and wait for its independent credential/evidence cleanup. */
export async function cancelActiveScenario() { if (activeCancellation) await activeCancellation(); }

/** Read the host-owned append-only ledger of actual CLI requests. */
async function observations(file) {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

/** Locate a unique report in the Agent's relative task directory without accepting symlinks. */
async function taskArtifact(state, name, root = path.join(state.workspace, 'tasks')) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      try { found.push(await taskArtifact(state, name, path.join(root, entry.name))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else if (entry.isFile() && entry.name === name) found.push(path.relative(state.workspace, path.join(root, entry.name)));
  }
  if (!found.length) throw Object.assign(new Error(`Missing task artifact: ${name}`), { code: 'ENOENT' });
  assert.equal(found.length, 1, `Ambiguous task artifact: ${name}`);
  return found[0];
}

/** Resolve retained Agent artifacts inside the workspace with strict byte and file checks. */
async function readWorkspace(state, name) {
  const file = await realpath(path.resolve(state.workspace, relativeFile(name)));
  assert.ok(file.startsWith(`${state.workspace}${path.sep}`), 'Agent artifact escapes the workspace');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= POLICY.maxOutputBytes, 'Agent artifact exceeds its file/byte policy');
    const buffer = Buffer.alloc(POLICY.maxOutputBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    assert.ok(bytesRead <= POLICY.maxOutputBytes, 'Agent artifact grew beyond its byte policy');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

/** Install actual bundled Skills in Pi's ordinary global Skill directory without copying login credentials. */
async function prepare(config, namespace, artifactDir) {
  const workspace = path.join(artifactDir, 'workspace');
  const configDir = path.join(artifactDir, 'cli-profile');
  const agentDir = path.join(artifactDir, 'pi-agent');
  const home = path.join(artifactDir, 'home');
  const bins = path.join(artifactDir, 'bin');
  const scratch = path.join(workspace, '.tmp');
  const snapshots = path.join(artifactDir, 'snapshots');
  for (const directory of [workspace, configDir, agentDir, home, bins, scratch, snapshots]) await mkdir(directory, { recursive: true, mode: 0o700 });
  const exported = JSON.parse(execFileSync(config.cliBinary, ['--no-notice', 'skills', 'export', '--dir', path.join(agentDir, 'skills')], {
    env: { PATH: process.env.PATH, HOME: home, HYACINTHUS_CONFIG_DIR: configDir },
    timeout: POLICY.cleanupTimeoutMs, encoding: 'utf8', maxBuffer: POLICY.maxOutputBytes,
  }));
  assert.equal(exported.ok, true);
  const names = exported.data.exported.map(file => file.name);
  assert.deepEqual([...names].sort(), ['hyacinthus-cli', 'tutoring-job-mail-upload'].sort());
  for (const name of names) assert.equal(await readFile(path.join(agentDir, 'skills', name, 'SKILL.md'), 'utf8'),
    await readFile(path.resolve(import.meta.dirname, '../../../skills', name, 'SKILL.md'), 'utf8'), `Stale bundled skill: ${name}`);
  const fixture = JSON.parse(await readFile(new URL('../fixtures/saved-mail.json', import.meta.url), 'utf8'));
  assert.equal(fixture.row_count, POLICY.rows);
  const expected = Array.from({ length: fixture.row_count }, (_, index) => ({ code: `${namespace}-${String(index + 1).padStart(3, '0')}`, amount: 100 + index }));
  const messageId = `${fixture.message_id}-${namespace}`;
  const mail = `已保存邮件样本（合成测试数据，不连接真实邮箱）\nthread_id: ${fixture.thread_id}-${namespace}\nmessage_id: ${messageId}\n主题：${fixture.subject}\n发送者：${fixture.sender}\n收到时间：${fixture.received_at}\n整组说明：全部为线上一对一岗位，岗位类型 tutoring、授课方式 online；管理员联系电话 ${fixture.defaults.contact_phone}。不创建任何科目或年级目录。\n\n${expected.map(row => fixture.template.replace('{{CODE}}', row.code).replace('{{AMOUNT}}', String(row.amount))).join('\n\n')}`;
  await writeFile(path.join(workspace, 'saved_mail.txt'), mail, { mode: 0o600 });
  const ipc = path.join(workspace, POLICY.ipcDirectory);
  const control = { cliBinary: config.cliBinary, api: config.api, profile: `pi-e2e-${namespace.toLowerCase()}`,
    workspace, configDir, snapshots, home, ipc, expectedCodes: expected.map(row => row.code),
    eventsFile: path.join(artifactDir, 'cli-events.jsonl'), handoffFile: path.join(artifactDir, 'auth-handoff.json') };
  await writeFile(control.eventsFile, '', { mode: 0o600 });
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(path.join(bins, 'hyacinthus'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.resolve(import.meta.dirname, 'cli-proxy.mjs'))} "$@"\n`, { mode: 0o700 });
  // Transport/environment facts only: no Skill selection, workflow script or artifact schema is injected in AGENTS.md.
  await writeFile(path.join(workspace, 'AGENTS.md'), `# 测试工作区\n\n正式 hyacinthus 命令已指向隔离测试服务 ${config.api}。使用 PATH 上的 hyacinthus，不覆盖 URL/profile、不安装 CLI、不直接调用 HTTP/数据库。该文件队列验收从业务命令的原始 JSON stdout 留证据，不支持用 --jq/-q/--format 改变 stdout；大结果用 --output 保存，再自行读取完整文件并汇总。授权和写入批准通过最终回复交给用户，用户在下一轮回应。没有连接真实邮箱。/tmp 是本任务隔离的临时目录。\n`, { mode: 0o600 });
  return { namespace, artifactDir, workspace, agentDir, bins, home, scratch, ipc, configDir, expected, messageId, control,
    adminUsername: config.adminUsername, adminPassword: config.adminPassword, adminToken: null,
    sourceSha256: createHash('sha256').update(mail).digest('hex') };
}

/** Reach login, approval, or retryable session-unavailable; click 重试恢复 while cold-start refresh fails. */
async function settleAuthorizationPage(page) {
  const username = page.getByTestId('admin-login-username');
  const approve = page.getByRole('button', { name: '批准授权', exact: true });
  const retry = page.getByRole('button', { name: '重试恢复', exact: true });
  for (let attempt = 0; attempt < 6; attempt++) {
    await username.or(approve).or(retry).first().waitFor();
    if (await retry.count()) { await retry.first().click(); await page.waitForTimeout(1200); continue; }
    return { username: await username.count() > 0 };
  }
  throw new Error('Admin authorization page stayed on session-unavailable after 重试恢复 attempts');
}

/** Approve only Pi's original device-authorization link through the existing test administrator UI. */
async function approveAuthorization(config, handoff) {
  const url = new URL(handoff.authorize_url);
  assert.equal(url.origin, config.admin);
  assert.ok(`${url.pathname}${url.hash}`.includes('/admin/agent-auth/authorize'));
  const browser = await chromium.launch({ headless: true, ...(config.browserBinary ? { executablePath: config.browserBinary } : {}) });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
    await protectAuthorizationContext(context, config);
    const page = await context.newPage();
    page.setDefaultTimeout(POLICY.browserTimeoutMs);
    await page.goto(handoff.authorize_url);
    const first = await settleAuthorizationPage(page);
    if (first.username) {
      await page.getByTestId('admin-login-username').fill(config.adminUsername);
      await page.getByTestId('admin-login-password').fill(config.adminPassword);
      const login = page.waitForResponse(item => new URL(item.url()).pathname === '/api/v1/admin/auth/sessions/password' && item.request().method() === 'POST');
      await page.getByTestId('authentication-submit').click();
      assert.equal((await login).status(), 200);
      await page.waitForURL(value => !`${value.pathname}${value.hash}`.includes('/admin/login'));
      await page.goto(handoff.authorize_url);
      await settleAuthorizationPage(page);
    }
    const response = page.waitForResponse(item => new URL(item.url()).pathname.endsWith('/approve') && item.request().method() === 'POST');
    await page.getByRole('button', { name: '批准授权', exact: true }).click();
    assert.equal((await response).status(), 200);
  } catch (error) {
    throw new Error(redact(error.message).replaceAll(config.adminPassword, '[REDACTED]'));
  } finally { await browser.close(); }
}

/** Open one harness-owned admin session for independent field readback; revoked during cleanup. */
async function adminToken(state, signal) {
  if (state.adminToken) return state.adminToken;
  const response = await fetch(`${state.control.api}/api/v1/admin/auth/native/sessions/password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: state.adminUsername, password: state.adminPassword }), signal });
  assert.equal(response.ok, true, `Admin readback login HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.code, 0, `Admin readback login rejected: ${redact(body.message || '')}`);
  assert.ok(typeof body.data?.access_token === 'string', 'Admin readback login returned no access token');
  state.adminToken = body.data.access_token;
  return state.adminToken;
}

/** Read every source code through the admin by-code endpoint; Agent search never proves field persistence. */
async function readBack(state, signal) {
  const token = await adminToken(state, signal);
  const items = [];
  for (const row of state.expected) {
    signal.throwIfAborted();
    const response = await fetch(`${state.control.api}/api/v1/admin/requirements/by-code/${encodeURIComponent(row.code)}`,
      { headers: { authorization: `Bearer ${token}` }, signal });
    assert.equal(response.ok, true, `Admin readback HTTP ${response.status} for ${row.code}`);
    const body = await response.json();
    assert.equal(body.code, 0, `Admin readback rejected for ${row.code}: ${redact(body.message || '')}`);
    assert.ok(body.data, `Persisted code must exist exactly once: ${row.code}`);
    items.push(body.data);
  }
  return items;
}

/** Declare the complete acceptance cases so failed prerequisites cannot silently hide unexecuted work. */
export function savedMailCases() {
  return ['正常安装 CLI 与邮件两个 Skills', '真实 OS 沙箱与文件队列', 'Pi 默认发现 Skills 与会话', '既有测试库与授权 UI 门禁',
    '一句自然语言触发邮件任务', 'Pi 原始授权会话与用户批准', '30 条整理解析及批次预览', '用户批准后整批导入与独立回读', '同一邮件重放不重复创建', '凭据清理与证据发布']
    .map((name, index) => ({ id: String(index), name, status: 'not_run' }));
}

/** Run the same normally installed Pi session from a one-sentence user request through replay and HTML evidence. */
export async function runSavedMailScenario() {
  const started = performance.now();
  const namespace = `PIMAIL${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  const artifactDir = path.resolve(import.meta.dirname, `../../../.tmp/agent-e2e/${namespace}`);
  const report = { runId: namespace, agent: 'pi', model: '未选择', startedAt: new Date().toISOString(), status: 'blocked',
    cases: savedMailCases(), stages: [], blockers: [],
    notes: ['合成的已保存邮件样本，不连接真实邮箱；复用既有 hyacinthus_test，不 reset/seed。',
      '默认 Skill 发现，首轮用户只说“帮我上传一下邮件里的家教岗位。”；授权/批次批准由明确的用户模拟器完成。',
      '协议探针通过不代表真实岗位已导入。'], evidence: [] };
  let config;
  let state, broker, agent, failure, target, result, current = '0';
  let brokerStarted = false;
  const evidence = [], turns = [];
  const abort = new AbortController();
  let finished;
  const finishedPromise = new Promise(resolve => { finished = resolve; });
  activeCancellation = async () => { abort.abort(); await finishedPromise; };
  const timer = setTimeout(() => abort.abort(), POLICY.scenarioTimeoutMs);
  /** Record actual wall time for a bounded case; a failure never becomes a synthetic pass. */
  async function measured(id, action) {
    current = id;
    const record = report.cases[Number(id)];
    const start = performance.now();
    try { const value = await action(); record.status = 'passed'; return value; }
    catch (error) { record.status = 'failed'; record.reason = redact(error.message); throw error; }
    finally { record.durationMs = (record.durationMs || 0) + performance.now() - start; }
  }
  /** Enforce one total deadline across browser, CLI and model calls. */
  function budget() { abort.signal.throwIfAborted(); const left = POLICY.scenarioTimeoutMs - (performance.now() - started); assert.ok(left > 0); return left; }
  try {
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    console.log(`Pi 验收产物：${artifactDir}`);
    state = await measured('0', () => { config = settings(); return prepare(config, namespace, artifactDir); });
    state.deadline = Date.now() + budget();
    report.evidence.push(`正式 CLI export 已与源码逐字比对，两个入口及其全部引用文件 安装至 ${state.agentDir}/skills。`);
    await measured('1', () => probeSandbox(state));
    agent = await measured('2', () => createPiAgent(config, state, evidence));
    report.model = agent.model;
    report.evidence.push(`实际 Pi session ${agent.sessionId}；默认 Skill loader 发现：${agent.skills.join('、')}。`);
    target = await measured('3', () => preflight(config));
    broker = await createBroker(state.control, budget);
    brokerStarted = true;
    let next = '帮我上传一下邮件里的家教岗位。';
    let mailSupplied = false, authApproved = false, writeApproved = false;
    for (let turn = 0; turn < POLICY.maxTurns; turn += 1) {
      const stage = !authApproved ? '4' : writeApproved ? '7' : '6';
      const response = await measured(stage, () => agent.turn(next, Math.min(POLICY.turnTimeoutMs, budget()), abort.signal));
      turns.push({ turn: turn + 1, prompt: redact(next), reply: redact(response.finalMessage), assistantMessages: redact(response.assistantMessages) });
      const events = await observations(state.control.eventsFile);
      const denied = deniedAttempts(events);
      assert.equal(denied.write.length, 0, 'Pi attempted an unapproved write action');
      for (const probe of denied.denied.filter(event => !denied.write.includes(event))) {
        report.notes.push(`门禁已阻止的非写探测（未执行任何变更）：${redact((probe.argv || []).join(' '))} — ${redact(probe.reason || '')}`);
      }
      if (!authApproved) {
        let handoff;
        try { handoff = JSON.parse(await readFile(state.control.handoffFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (handoff) {
          assert.ok(sharedAuthorization(response, handoff.authorize_url), 'Pi must share its original authorization link in an assistant message');
          assert.equal(events.filter(event => event.action === 'auth login' && event.exitCode === 0).length, 1);
          const failedLogins = events.filter(event => event.action === 'auth login' && event.exitCode !== 0);
          assert.ok(failedLogins.every(event => !event.denied), 'Denied login attempts cannot precede authorization');
          if (failedLogins.length) report.notes.push(`Pi 在唯一一次成功登录前有 ${failedLogins.length} 次被拒/失败的登录尝试（用法试错或可重试传输错误），门禁与事件账本均已留痕，未创建多余 session。`);
          await measured('5', () => approveAuthorization(config, handoff));
          authApproved = true;
          next = '我已通过你刚才提供的原始链接批准授权，请继续。要上传的邮件保存在当前目录 saved_mail.txt，不连接真实邮箱。';
          mailSupplied = true;
          continue;
        }
        if (!mailSupplied) { next = '要上传的邮件已经保存在当前目录 saved_mail.txt。请处理这封邮件，不连接真实邮箱。'; mailSupplied = true; continue; }
        throw new Error(`Pi stopped before authorization: ${redact(response.finalMessage)}`);
      }
      if (!writeApproved) {
        current = '6';
        const preview = events.findLast(event => event.action === 'requirements import' && !event.writes && event.exitCode === 0 && event.result?.ok);
        assert.ok(preview, 'Pi did not produce a successful dry-run');
        assert.deepEqual([...preview.input.codes].sort(), state.expected.map(row => row.code).sort());
        assert.match(response.finalMessage, /确认|批准|是否/);
        assert.match(response.finalMessage, new RegExp(String(POLICY.rows)));
        assert.doesNotMatch(response.finalMessage, /无法导入|不能导入|不要导入|不能批准|请勿批准/);
        broker.approve(preview.input.fingerprint);
        writeApproved = true;
        next = '我确认上传刚才预览的这 30 条岗位，请执行这一批导入。';
        continue;
      }
      const counts = verifyTrace(events, state.expected.map(row => row.code));
      const manifestPath = await taskArtifact(state, 'mail_manifest.json');
      const manifest = JSON.parse(await readWorkspace(state, manifestPath));
      // Manifest file paths are relative to the task record, while CLI paths remain workspace-relative.
      const artifactPath = value => {
        const relative = relativeFile(value);
        return path.posix.join(path.posix.dirname(manifestPath), relative);
      };
      assert.equal(manifest.message_id, state.messageId);
      assert.equal(manifest.source_sha256, state.sourceSha256);
      assert.ok(manifest.run_id);
      assert.equal(createHash('sha256').update(await readWorkspace(state, artifactPath(manifest.raw_file))).digest('hex'), state.sourceSha256);
      const parse = events.findLast(event => event.action === 'requirements parse' && event.exitCode === 0 && event.result?.ok && event.result.data.rows.length === POLICY.rows);
      assert.ok(parse?.normalizedInput?.file && manifest.normalized_files.map(artifactPath).includes(relativeFile(parse.normalizedInput.file)));
      verifyNormalized(await readFile(path.join(state.control.snapshots, parse.normalizedInput.snapshot), 'utf8'), state.expected);
      assert.ok(manifest.upload_result_files.length > 0);
      for (const file of manifest.upload_result_files) {
        const saved = JSON.parse(await readWorkspace(state, artifactPath(file)));
        assert.equal((saved.ok === true ? saved.data : saved).idempotency_key, events.find(event => event.writes && event.result?.ok).input.idempotency_key);
      }
      const items = await measured('7', async () => { const rows = await readBack(state, abort.signal); verifyRows(rows, state.expected); return rows; });
      const finalReportPath = await taskArtifact(state, 'final_report.json');
      const firstReport = await readWorkspace(state, finalReportPath);
      verifyReport(JSON.parse(firstReport), state.expected.map(row => row.code), counts, state.messageId);
      assert.ok(evidence.some(event => event.type === 'tool_execution_start' && event.toolName === 'read' && String(event.args?.path).endsWith('/tutoring-job-mail-upload/SKILL.md')), 'Pi did not actually read the discovered mail Skill');
      await measured('8', async () => {
        const replay = await agent.turn('再帮我上传一下刚才这封邮件里的家教岗位，不重复创建。', Math.min(POLICY.turnTimeoutMs, budget()), abort.signal);
        turns.push({ prompt: 'same-mail replay', reply: redact(replay.finalMessage) });
        const saved = JSON.parse(await readWorkspace(state, await taskArtifact(state, 'replay_report.json')));
        assert.equal(saved.source_message_id, state.messageId); assert.equal(saved.already_imported, true); assert.equal(saved.new_created, 0); assert.equal(saved.failed, 0);
        assert.equal(await readWorkspace(state, finalReportPath), firstReport);
        const after = await readBack(state, abort.signal); verifyRows(after, state.expected);
        assert.deepEqual(after.map(item => item.id), items.map(item => item.id));
        verifyTrace(await observations(state.control.eventsFile), state.expected.map(row => row.code));
      });
      result = { ok: true, agent: 'pi', target, namespace, rows: items.length, counts, model: agent.model, replayPreservedIds: true };
      break;
    }
    if (!result) throw new Error('Pi did not finish within its turn budget');
    report.status = 'passed';
  } catch (error) {
    failure = error;
    report.status = Number(current) <= 3 || error.code === 'PI_MODEL_UNAVAILABLE' ? 'blocked' : 'failed';
    report.cases[Number(current)].status = report.status;
    report.cases[Number(current)].reason = redact(error.message);
    const nextAction = current === '3'
      ? `运行 curl -i ${config.api}/health/ready，确认隔离 API 存活且返回 hyacinthus_test 标记；管理员密码只通过私密环境提供。`
      : current === '2' || error.code === 'PI_MODEL_UNAVAILABLE'
        ? '打开宿主 pi，确认现有默认模型及登录可用，再运行 npm run test:report；不自动换模型。'
        : '按该阶段的实际错误修复后重跑 npm run test:report；不跳过门禁、不换库、不模拟成功。';
    report.blockers.push({ stage: report.cases[Number(current)].name, reason: redact(error.message), nextAction });
  } finally {
    clearTimeout(timer);
    abort.abort();
    const cleanupErrors = [];
    const cleanupStart = performance.now();
    for (const resource of [agent, broker]) try { await resource?.close(); } catch (error) { cleanupErrors.push(redact(error.message)); }
    if (brokerStarted) {
      try {
        const options = { env: { PATH: process.env.PATH, HOME: state.home, HYACINTHUS_CONFIG_DIR: state.control.configDir },
          timeout: POLICY.cleanupTimeoutMs, maxBuffer: POLICY.maxOutputBytes, encoding: 'utf8' };
        const status = await execute(config.cliBinary, ['--base-url', config.api, '--profile', state.control.profile, '--no-notice', 'auth', 'status'], options);
        const credentials = JSON.parse(status.stdout);
        assert.equal(credentials.ok, true);
        assert.equal(typeof credentials.data.token_present, 'boolean');
        if (credentials.data.token_present) {
          const logout = await execute(config.cliBinary, ['--base-url', config.api, '--profile', state.control.profile, '--no-notice', 'auth', 'logout'], options);
          assert.equal(JSON.parse(logout.stdout).ok, true);
        } else report.notes.push('CLI status 确认本次未发放 token：不调用不存在 token 的远端撤销；删除本地 profile 与待授权信息，未批准 session 由后端 TTL 过期。');
      } catch (error) { cleanupErrors.push(redact(String(error.stdout || error.message))); }
    }
    if (state) {
      try { await unlink(state.control.handoffFile); } catch (error) { if (error.code !== 'ENOENT') cleanupErrors.push(redact(error.message)); }
      if (state.adminToken) {
        try {
          const response = await fetch(`${state.control.api}/api/v1/admin/auth/native/sessions/current`,
            { method: 'DELETE', headers: { authorization: `Bearer ${state.adminToken}` } });
          const body = await response.json();
          assert.equal(response.ok && body.code === 0, true, `Readback admin session revoke failed: HTTP ${response.status} code ${body.code}`);
          state.adminToken = null;
        } catch (error) { cleanupErrors.push(redact(error.message)); }
      }
      try { await rm(state.configDir, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(redact(error.message)); }
    }
    for (const [file, data] of [['pi-events.jsonl', evidence.map(event => JSON.stringify(event)).join('\n')], ['conversation.json', JSON.stringify(turns, null, 2)]]) {
      try { await writeFile(path.join(artifactDir, file), data, { mode: 0o600 }); } catch (error) { cleanupErrors.push(redact(error.message)); }
    }
    report.cases[9] = { ...report.cases[9], status: cleanupErrors.length ? 'failed' : 'passed', durationMs: performance.now() - cleanupStart,
      reason: cleanupErrors.length ? cleanupErrors.join('; ') : '无模型凭据复制；撤销本次 CLI 授权（如有）、删除回读管理员 session 与临时 CLI profile、原始授权交接及队列响应。' };
    if (cleanupErrors.length) {
      report.status = 'failed'; failure ||= new Error('Pi scenario cleanup failed');
      report.blockers.push({ stage: report.cases[9].name, reason: cleanupErrors.join('; '), nextAction: '先核对临时 profile 已删除且本次授权已撤销；清理失败不算验收成功。' });
    }
    report.endedAt = new Date().toISOString(); report.durationMs = performance.now() - started;
    report.stages = report.cases.filter(item => item.status !== 'not_run').map(item => ({ name: item.name, status: item.status, durationMs: item.durationMs, detail: item.reason }));
    try {
      await writeFile(path.join(artifactDir, 'result.json'), JSON.stringify({ ...report, result, cleanupErrors }, null, 2), { mode: 0o600 });
      await writeHtmlReport(path.join(artifactDir, 'report.html'), report);
      await writeHtmlReport(path.resolve(import.meta.dirname, '../reports/latest.html'), report);
      await writeFile(path.resolve(import.meta.dirname, '../reports/latest.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
      console.log(`HTML 测试报告：${path.join(artifactDir, 'report.html')}`);
    } catch (error) { failure ||= error; }
    activeCancellation = undefined;
    finished();
  }
  if (failure) throw failure;
  return result;
}
