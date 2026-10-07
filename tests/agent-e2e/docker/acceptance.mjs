// 改动说明：独立 Docker 中用自然语言驱动真实 MiMo/Pi，浏览器批准授权，独立回读业务结果并保存脱敏证据。
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { redact } from '../lib/policy.mjs';
import { sharedAuthorization } from '../lib/reply.mjs';
import { createAdminRequirementReader } from './admin-readback.mjs';

const POLICY = Object.freeze({ api: 'http://127.0.0.1:18012', admin: 'http://127.0.0.1:18013', project: 'hyacinthus-skills-acceptance', maxTurns: 8, turnMs: 620_000, rows: 30 });
const repo = path.resolve(import.meta.dirname, '../../../..');
const artifacts = path.join(repo, '.tmp/e2e/skills-alignment');
const workspace = path.join(artifacts, 'workspace');
const privateDir = path.join(artifacts, 'private');
const compose = path.join(import.meta.dirname, 'compose.yml');
const composeEnv = { ...process.env, SKILLS_E2E_PRIVATE_DIR: privateDir, SKILLS_E2E_WORKSPACE: workspace };
const container = `${POLICY.project}-pi-1`;
const runId = `SKILLE2E${Date.now()}`;
const report = { runId, startedAt: new Date().toISOString(), model: 'xiaomi-token-plan-cn/mimo-v2.6-pro', cases: [], conversations: [], tools: [], failures: [], assumptions: ['保存的合成邮件样本，不连接真实邮箱；真实 API/Worker/数据库；授权由真实浏览器完成。'] };
const password = (await readFile(path.join(privateDir, 'driver.env'), 'utf8')).trim().slice('HYACINTHUS_E2E_ADMIN_PASSWORD='.length);
const adminRead = createAdminRequirementReader({ api: POLICY.api, admin: POLICY.admin, password });
let agent;
let browser;
let context;
let sessionReady;
let replyWaiter;
const ready = new Promise((resolve, reject) => { sessionReady = { resolve, reject }; });
const approvedSessions = new Set();
const taskScopes = Object.freeze({
  '无登录状态下查询需求并完成真实授权': ['requirements:read'],
  '个人资料指南、预览和修改': ['users:read', 'users:write'],
  '优先级规则指南、预览和创建': ['requirements:priority_rules'],
  '邮件 Skill 自行整理30条并真实导入': ['requirements:read', 'requirements:parse', 'requirements:write'],
  '同封邮件重放不重复创建': ['requirements:read', 'requirements:write'],
});

/** Execute only independent readback commands with the token acquired by Pi itself. */
function cliRead(args) {
  const output = execFileSync('docker', ['exec', container, 'hyacinthus', '--no-notice', '--format', 'json', ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  return result.data;
}

/** Approve the Agent's unmodified authorization URL using the actual deployed administrator page. */
async function approve(url) {
  const link = new URL(url);
  assert.equal(link.origin, POLICY.admin);
  // Canonical links identify authorization with user_code, not session_id; the full original URL is unique.
  const session = link.href;
  if (approvedSessions.has(session)) return;
  browser ||= await chromium.launch({ headless: true });
  context ||= await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByTestId('admin-login-username').or(page.getByRole('button', { name: '批准授权', exact: true })).first().waitFor();
    if (await page.getByTestId('admin-login-username').count()) {
      await page.getByTestId('admin-login-username').fill('rust-e2e-admin@hyacinthus.local');
      await page.getByTestId('admin-login-password').fill(password);
      const [login] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/auth/sessions/password' && r.request().method() === 'POST'),
        page.getByTestId('authentication-submit').click(),
      ]);
      assert.equal(login.status(), 200);
      await page.waitForURL(value => !`${value.pathname}${value.hash}`.includes('/admin/login'));
      await page.goto(url, { waitUntil: 'networkidle' });
    }
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/approve') && r.request().method() === 'POST'),
      page.getByRole('button', { name: '批准授权', exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);
    approvedSessions.add(session);
    await page.screenshot({ path: path.join(artifacts, `authorization-${approvedSessions.size}.png`), fullPage: true });
    console.log(`Approved the Agent's original authorization session ${approvedSessions.size}.`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'authorization-failure.png'), fullPage: true });
    throw error;
  } finally { await page.close(); }
}

/** Send an actual user turn to the same Pi session and collect host-owned tool evidence. */
async function turn(prompt) {
  const start = report.tools.length;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { replyWaiter = undefined; reject(new Error('Pi turn timed out')); }, POLICY.turnMs);
    replyWaiter = { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } };
  });
  agent.stdin.write(`${JSON.stringify({ prompt })}\n`);
  const reply = await response;
  report.conversations.push({ prompt, ...redact(reply) });
  if (reply.error || reply.event === 'failure' || reply.stopReason === 'error') throw new Error(reply.error || 'Pi model error');
  return { reply, tools: report.tools.slice(start) };
}

/** Extract authorization links from actual CLI results without giving the Agent command instructions. */
function authorization(tools) {
  for (const tool of tools.toReversed()) {
    const content = tool.detail?.result?.content || [];
    for (const block of content) {
      const match = block.text?.match(/"authorize_url"\s*:\s*"([^"\n]+)"/);
      if (match) {
        const scopes = block.text.match(/"required_scopes"\s*:\s*(\[[^\]]*\])/);
        assert.ok(scopes, 'Authorization did not declare required_scopes');
        return { url: JSON.parse(`"${match[1]}"`), scopes: JSON.parse(scopes[1]) };
      }
    }
  }
  return undefined;
}

/** Complete one natural-language task, responding only with user authorization or batch approval. */
async function perform(name, prompt, verify, approval) {
  const started = performance.now();
  const caseStart = report.tools.length;
  let next = prompt;
  try {
    for (let round = 0; round < POLICY.maxTurns; round += 1) {
      const { reply, tools } = await turn(next);
      const handoff = authorization(tools);
      if (handoff) {
        assert.ok(handoff.scopes.every(scope => taskScopes[name]?.includes(scope)), `Pi requested scopes unrelated to the user task: ${handoff.scopes.join(', ')}`);
        assert.ok(sharedAuthorization(reply, handoff.url), 'Pi did not share the original authorization link with the user');
        await approve(handoff.url);
        next = '我已通过你刚才提供的原始链接批准授权，请继续完成刚才的任务。';
        continue;
      }
      if (approval && /确认|批准|是否/.test(reply.text)) {
        assert.ok(tools.some(tool => tool.detail?.type === 'tool_execution_start' && tool.detail.toolName === 'bash'
          && /--dry-run/.test(tool.detail.args.command)), 'Pi requested approval without executing an actual preview');
        assert.ok(!report.tools.slice(caseStart).some(tool => tool.detail?.type === 'tool_execution_start' && tool.detail.toolName === 'bash'
          && /--yes/.test(tool.detail.args.command) && !/--dry-run/.test(tool.detail.args.command)), 'Pi executed a write before requested user approval');
        next = approval; approval = undefined; continue;
      }
      if (approval) throw new Error(`Pi did not present the requested preview: ${reply.text}`);
      const outcome = await verify(reply, report.tools.slice(caseStart));
      if (outcome) {
        report.cases.push({ name, status: 'passed', durationMs: performance.now() - started, evidence: outcome });
        console.log(`${name}: passed (${Math.round((performance.now() - started) / 1000)}s)`);
        return;
      }
      throw new Error(`Pi did not complete the expected task: ${reply.text}`);
    }
    throw new Error('Pi exceeded the user-turn budget');
  } catch (error) {
    report.cases.push({ name, status: 'failed', durationMs: performance.now() - started, error: redact(error.message) });
    throw error;
  }
}

/** Find an Agent-created task artifact regardless of which relative task directory it selected. */
async function findFile(name, root = workspace) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const result = await findFile(name, path.join(root, entry.name));
      if (result) return result;
    } else if (entry.isFile() && entry.name === name) {
      const file = path.join(root, entry.name);
      const result = JSON.parse(await readFile(file, 'utf8'));
      if (result.source_message_id === `${runId}-mail` || name === 'mail_manifest.json' && result.message_id === `${runId}-mail`) return file;
    }
  }
  return undefined;
}

try {
  const response = await fetch(`${POLICY.api}/health/ready`);
  assert.equal(response.headers.get('x-hyacinthus-test-database'), 'hyacinthus_test');
  assert.equal(response.status, 200);
  await mkdir(workspace, { recursive: true });
  const codes = Array.from({ length: POLICY.rows }, (_, i) => `${runId}-${String(i + 1).padStart(3, '0')}`);
  const mail = `已保存的合成邮件样本\nmessage_id: ${runId}-mail\n发件人: fixture@example.invalid\n主题: 线上初一数学家教岗位\n发送时间: 2026-10-06T09:00:00+08:00\n整组说明：全部为线上一对一，岗位类型 tutoring，授课方式 online，管理员联系电话 13800138000。不创建任何科目或年级目录。\n\n${codes.map((code, i) => `编号：${code}\n年级科目：初一，数学\n学员情况：家长发布，学生为男生\n每周次数：1次（周六）\n每次时长：2小时（14:00-16:00）\n对老师的要求：女老师，本科，有家教经验\n薪酬：${100 + i}元/小时\n地址：线上授课，无线下地点\n备注：仅线上一对一`).join('\n\n')}`;
  await writeFile(path.join(workspace, 'saved_mail.txt'), mail);
  agent = spawn('docker', ['exec', '-i', container, 'node', '/opt/acceptance/pi-runner.mjs'], { stdio: ['pipe', 'pipe', 'pipe'], env: composeEnv });
  const reader = readline.createInterface({ input: agent.stdout });
  reader.on('line', line => {
    try {
      const event = JSON.parse(line);
      appendFileSync(path.join(artifacts, 'pi-events-redacted.jsonl'), `${JSON.stringify({ runId, ...redact(event) })}\n`);
      if (event.event === 'ready') { report.discovery = event; report.model = event.model; sessionReady.resolve(event); }
      else if (event.event === 'tool') report.tools.push(event);
      else if (['reply', 'failure'].includes(event.event)) replyWaiter?.resolve(event);
    } catch { report.failures.push(redact(line)); }
  });
  agent.stderr.on('data', chunk => { report.failures.push(redact(String(chunk))); });
  agent.on('exit', code => { const error = new Error(`Pi container session exited (${code})`); sessionReady.reject(error); replyWaiter?.reject(error); });
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Pi readiness timed out')), 30_000))]);
  assert.deepEqual(report.discovery.skills.map(skill => skill.name).sort(), ['hyacinthus-cli', 'tutoring-job-mail-upload'].sort());
  await perform('自然语言发现整个 CLI', '风信子家教中心能帮我管理哪些事情？', async (reply, tools) => {
    const reads = tools.filter(tool => tool.detail?.type === 'tool_execution_start' && tool.detail.toolName === 'read');
    assert.ok(reads.some(tool => String(tool.detail.args.path).endsWith('/hyacinthus-cli/SKILL.md')), 'Pi did not read the normally discovered CLI entry');
    assert.match(reply.text, /需求|岗位/);
    return { discovered: report.discovery.skills.map(skill => skill.name), entryRead: true };
  });
  await perform('无登录状态下查询需求并完成真实授权', '帮我查一下当前有效的初一数学家教需求。', async (reply, tools) => {
    const commands = tools.filter(tool => tool.detail?.type === 'tool_execution_start' && tool.detail.toolName === 'bash').map(tool => tool.detail.args.command);
    if (!commands.some(command => /requirements\s+search/.test(command))) return false;
    const result = cliRead(['requirements', 'search', '--keyword', '初一数学']);
    return { querySucceeded: true, returned: result.total, authorizationSessions: approvedSessions.size };
  });
  await perform('个人资料指南、预览和修改', '请把我在风信子的显示名称改成 Skills验收老师，先给我看预览。', async () => {
    const user = cliRead(['user', 'me']);
    return user.display_name === 'Skills验收老师' ? { actualDisplayName: user.display_name } : false;
  }, '我确认将显示名称改成 Skills验收老师，请执行这次修改。');
  await perform('优先级规则指南、预览和创建', `请添加一个匹配 ${runId}- 开头编号的优先级规则，优先级是5，描述是独立Skills验收。先给我看预览。`, async () => {
    const result = cliRead(['requirements', 'priority-rules', 'list']);
    assert.ok(Array.isArray(result));
    const rule = result.find(item => item.description === '独立Skills验收' && item.pattern.includes(runId));
    if (rule) assert.equal(rule.priority, 5);
    return rule ? { ruleId: rule.id, pattern: rule.pattern, priority: rule.priority } : false;
  }, '我批准刚才预览的那一条优先级规则，请创建。');
  await perform('邮件 Skill 自行整理30条并真实导入', '帮我上传当前目录 saved_mail.txt 这封已保存邮件里的全部家教岗位。这是指定的邮件原文，不连接真实邮箱。', async () => {
    const file = await findFile('final_report.json');
    if (!file) return false;
    const result = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(result.created, POLICY.rows);
    assert.equal(result.updated, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.pending, 0);
    assert.deepEqual(result.rows.map(row => row.requirement_code).sort(), [...codes].sort());
    assert.ok(result.rows.every(row => row.status === 'imported'));
    const manifestFile = await findFile('mail_manifest.json');
    assert.ok(manifestFile);
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    assert.ok(!path.isAbsolute(manifest.raw_file) && !manifest.raw_file.split('/').includes('..'));
    const raw = await readFile(path.join(path.dirname(manifestFile), manifest.raw_file));
    assert.equal(raw.toString('utf8'), mail);
    assert.equal(createHash('sha256').update(raw).digest('hex'), manifest.source_sha256);
    report.finalReportSha256 = createHash('sha256').update(await readFile(file)).digest('hex');
    report.finalReportPath = path.relative(workspace, file);
    const ids = [];
    for (const [i, code] of codes.entries()) {
      const data = cliRead(['requirements', 'search', '--keyword', code, '--scope', 'all']);
      const matches = data.items.filter(item => item.requirement_code === code);
      assert.equal(matches.length, 1);
      const item = await adminRead(matches[0].id);
      assert.equal(item.requirement_code, code);
      assert.equal(Number(item.compensation.amount_min), 100 + i);
      assert.equal(item.preferred_mode, 'online');
      assert.equal(item.requirement_type, 'tutoring');
      assert.equal(item.ext.admin_contact_phone, '13800138000');
      assert.ok(item.subject_names.includes('数学'));
      assert.ok(item.grade_names.includes('初一'));
      assert.equal(item.condition.requester_gender, 'male');
      assert.equal(item.condition.required_gender, 'female');
      assert.ok(item.condition.required_education_levels.includes('bachelor'));
      assert.equal(item.weekly_frequency_min, 1);
      assert.equal(item.weekly_frequency_max, 1);
      assert.equal(item.session_duration_minutes_min, 120);
      assert.equal(item.session_duration_minutes_max, 120);
      assert.ok(item.time_slots.some(slot => slot.weekday === 6 && slot.start_minute === 840 && slot.end_minute === 960));
      (report.independentReadback ||= []).push(item);
      ids.push(item.id);
    }
    report.createdIds = ids;
    return { independentReadbackRows: ids.length, created: result.created, failed: result.failed, sourceBytesPreserved: true,
      contactAndModeAndScheduleVerified: true, readbackTransport: 'Agent CLI identity query + independent administrator detail API',
      reportPath: path.relative(workspace, file) };
  }, '我确认上传刚才预览的全部30条岗位，请执行这一批导入。');
  await perform('同封邮件重放不重复创建', '再处理一下刚才这封邮件，把岗位上传到风信子；已经上传过的不要重复创建。', async () => {
    const file = await findFile('replay_report.json');
    if (!file) return false;
    const result = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(result.already_imported, true);
    assert.equal(result.new_created, 0);
    assert.equal(createHash('sha256').update(await readFile(path.join(workspace, report.finalReportPath))).digest('hex'), report.finalReportSha256);
    const ids = codes.map(code => cliRead(['requirements', 'search', '--keyword', code, '--scope', 'all']).items.filter(item => item.requirement_code === code)).map(items => { assert.equal(items.length, 1); return items[0].id; });
    assert.deepEqual(ids, report.createdIds);
    return { newCreated: result.new_created, preservedIds: ids.length, originalReportPreserved: true };
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = redact(error.message).replaceAll(password, '<redacted>');
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  if (agent?.stdin.writable) agent.stdin.end(`${JSON.stringify({ close: true })}\n`);
  await browser?.close();
  report.endedAt = new Date().toISOString();
  report.durationMs = Date.parse(report.endedAt) - Date.parse(report.startedAt);
  await writeFile(path.join(artifacts, 'docker-acceptance.json'), JSON.stringify(redact(report), null, 2));
}
