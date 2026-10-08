// 改动说明：Pi 经文件队列调度真实 CLI；执行宿主不可变输入副本，防止批准后替换 payload。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, appendFileSync, realpathSync, existsSync, openSync, fstatSync, closeSync, readSync, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { POLICY, inspectCall, relativeFile, redact, normalizeArgv, fileArguments, option } from './policy.mjs';

import { createFileQueue } from './file-queue.mjs';

const execute = promisify(execFile);

/** Reject symlink escapes as well as lexical workspace path escapes. */
function workspaceFile(name, root) {
  const resolved = path.resolve(root, relativeFile(name));
  const physical = existsSync(resolved) ? realpathSync(resolved) : path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
  if (!physical.startsWith(`${realpathSync(root)}${path.sep}`)) throw new Error('CLI path escapes the workspace');
  return physical;
}

/** Pin a bounded regular descriptor and verify its physical location before reading any bytes. */
function readInput(file, root) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!realpathSync(`/proc/self/fd/${fd}`).startsWith(`${realpathSync(root)}${path.sep}`)) throw new Error('CLI input escaped the workspace during open');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > POLICY.maxOutputBytes) throw new Error('CLI input is not a bounded independent regular file');
    const buffer = Buffer.alloc(POLICY.maxOutputBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const bytes = readSync(fd, buffer, count, buffer.length - count, null);
      if (!bytes) break;
      count += bytes;
    }
    if (count > POLICY.maxOutputBytes) throw new Error('CLI input exceeded its byte budget');
    return buffer.subarray(0, count).toString('utf8');
  } finally { closeSync(fd); }
}

/** Redirect exactly one file-valued CLI argument to an immutable host-owned snapshot. */
function pinArgument(argv, flag, file) {
  const index = argv.indexOf(flag);
  if (index !== -1) argv[index + 1] = file;
  else {
    const inline = argv.findIndex(arg => arg.startsWith(`${flag}=`));
    if (inline === -1) throw new Error('Missing pinned CLI argument');
    argv[inline] = `${flag}=${file}`;
  }
}

/** Execute an observed request against only the host-fixed real test CLI and protected approval state. */
async function runCall(control, submitted, approval, budget, abortSignal) {
  let argv;
  const event = { id: randomUUID(), at: new Date().toISOString(), actor: 'pi', argv: redact(submitted), denied: false };
  const started = performance.now();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    argv = normalizeArgv(submitted);
    const existing = readFileSync(control.eventsFile, 'utf8').trim().split('\n').filter(Boolean);
    if (existing.length >= POLICY.maxCliCalls) throw new Error('Agent exceeded the configured CLI call budget');
    Object.assign(event, inspectCall(argv, approval));
    for (const file of fileArguments(argv)) workspaceFile(file, control.workspace);
    const executeArgv = [...argv];
    if (event.action === 'requirements parse') {
      const file = option(argv, '--file');
      const text = file ? readInput(workspaceFile(file, control.workspace), control.workspace) : option(argv, '--text');
      if (!text) throw new Error('The saved-mail scenario requires a retained normalized input file');
      event.normalizedInput = { file, sha256: createHash('sha256').update(text).digest('hex'), snapshot: `${event.id}-normalized.txt` };
      const pinned = path.join(control.snapshots, event.normalizedInput.snapshot);
      writeFileSync(pinned, text, { flag: 'wx', mode: 0o600 });
      if (file) pinArgument(executeArgv, '--file', pinned);
    }
    if (event.action === 'requirements import') {
      const file = option(argv, '--file');
      const data = option(argv, '--data');
      const input = file ? readInput(workspaceFile(file, control.workspace), control.workspace)
        : data?.startsWith('@') ? readInput(workspaceFile(data.slice(1), control.workspace), control.workspace) : data;
      if (!input) throw new Error('Import must retain an explicit, auditable confirmed payload');
      const parsed = JSON.parse(input);
      const rows = Array.isArray(parsed) ? parsed : parsed.confirmed_rows;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('Import must use confirmed rows, not a parse envelope');
      if (rows.some(row => !control.expectedCodes.includes(row.requirement_code))) throw new Error('Import includes an unapproved requirement code');
      if (new Set(rows.map(row => row.requirement_code)).size !== rows.length) throw new Error('Import repeats a requirement code');
      const key = option(argv, '--idempotency-key') || parsed.idempotency_key;
      if (typeof key !== 'string' || !key.trim()) throw new Error('Batch preview and execution require a stable nonempty idempotency key');
      if (option(argv, '--idempotency-key') && parsed.idempotency_key && key !== parsed.idempotency_key) throw new Error('File and CLI idempotency keys disagree');
      const sha256 = createHash('sha256').update(input).digest('hex');
      const fingerprint = createHash('sha256').update(JSON.stringify({ sha256, key })).digest('hex');
      event.input = { file: file || (data?.startsWith('@') ? data.slice(1) : null), rowCount: rows.length, codes: rows.map(row => row.requirement_code), sha256, idempotency_key: key, fingerprint, snapshot: `${event.id}-input.json` };
      writeFileSync(path.join(control.snapshots, event.input.snapshot), JSON.stringify(redact(parsed), null, 2), { flag: 'wx', mode: 0o600 });
      const pinned = path.join(control.snapshots, `${event.id}-sealed.json`);
      writeFileSync(pinned, input, { flag: 'wx', mode: 0o600 });
      if (file) pinArgument(executeArgv, '--file', pinned);
      else if (data?.startsWith('@')) pinArgument(executeArgv, '--data', `@${pinned}`);
      if (event.writes && !approval.fingerprints.includes(fingerprint)) throw new Error('Executed payload/key differs from the one preview approved by the user');
    }
    try {
      ({ stdout, stderr } = await execute(control.cliBinary, ['--base-url', control.api, '--profile', control.profile, '--no-notice', ...executeArgv], {
        cwd: control.workspace,
        env: { PATH: process.env.PATH, HOME: control.home, HYACINTHUS_CONFIG_DIR: control.configDir,
          HYACINTHUS_CLIENT_TYPE: 'pi', HYACINTHUS_CLIENT_DISPLAY_NAME: 'Pi E2E', HYACINTHUS_CLIENT_INSTANCE_ID: control.profile },
        encoding: 'utf8', timeout: Math.min(POLICY.cliTimeoutMs, budget()), maxBuffer: POLICY.maxOutputBytes, signal: abortSignal,
      }));
    } catch (error) {
      stdout = String(error.stdout || '');
      stderr = String(error.stderr || error.message);
      exitCode = Number.isInteger(error.code) ? error.code : 1;
    }
    event.exitCode = exitCode;
    let result;
    try { result = JSON.parse(stdout); } catch { event.outputText = redact(stdout); }
    if (result) {
      event.result = redact(result);
      const handoff = result.ok ? result.data : result.error?.detail;
      if (handoff?.authorize_url) writeFileSync(control.handoffFile, JSON.stringify(handoff), { mode: 0o600 });
      writeFileSync(path.join(control.snapshots, `${event.id}-output.json`), JSON.stringify(redact(result), null, 2), { mode: 0o600 });
    }
    event.stderr = redact(stderr);
  } catch (error) {
    event.denied = true;
    event.exitCode = 2;
    event.reason = error.message;
    exitCode = 2;
    stdout = JSON.stringify({ ok: false, error: { code: 'AGENT_E2E_POLICY_DENIED', message: error.message } });
  }
  event.durationMs = performance.now() - started;
  appendFileSync(control.eventsFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  return { stdout, stderr, exitCode };
}

/** Start a host file-queue broker; approval and the actual CLI event ledger remain outside the Agent sandbox. */
export async function createBroker(control, budget) {
  let approval = { writeApproved: false, fingerprints: [] };
  const abort = new AbortController();
  const queue = await createFileQueue(control.ipc, async submitted => {
    if (!Array.isArray(submitted.argv) || submitted.argv.some(arg => typeof arg !== 'string') || submitted.cwd !== control.workspace) {
      throw new Error('Invalid CLI broker request');
    }
    return await runCall(control, submitted.argv, approval, budget, abort.signal);
  }, error => {
    appendFileSync(control.eventsFile, `${JSON.stringify({ id: randomUUID(), actor: 'pi', denied: true,
      exitCode: 2, reason: redact(error.message), action: 'broker request' })}\n`, { mode: 0o600 });
  });
  return {
    /** Approve exactly one successful preview fingerprint from outside the Agent sandbox. */
    approve(fingerprint) { approval = { writeApproved: true, fingerprints: [fingerprint] }; },
    /** Abort the real CLI child, drain the file queue and remove unredacted transient responses. */
    async close() { abort.abort(); await queue.close(); },
  };
}
