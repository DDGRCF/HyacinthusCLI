// 改动说明：文件队列补齐非阻塞特殊文件检查、目录 inode 校验及超预算错误响应；Pi 只能写请求。
import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, readdir, open, realpath, lstat, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { POLICY } from './policy.mjs';

/** Derive the two fixed transport directories without accepting peer-controlled paths. */
export function queuePaths(root) {
  return { requests: path.join(root, 'requests'), responses: path.join(root, 'responses') };
}

/** Read only a bounded regular, non-symlink, non-hardlinked protocol message. */
async function readMessage(file, limit) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new Error('Invalid or oversized queue message');
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new Error('Queue message exceeded its byte budget');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
}

/** Atomically publish one bounded message using an exclusive temporary file. */
async function publish(directory, id, message, limit) {
  const content = JSON.stringify(message);
  if (Buffer.byteLength(content) > limit) throw new Error('Queue message exceeded its byte budget');
  const temporary = path.join(directory, `${id}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(directory, `${id}.json`));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Start serialized host-side processing; callers never receive host credentials or evidence paths. */
export async function createFileQueue(root, handler, onInvalid = () => {}) {
  const { requests, responses } = queuePaths(root);
  for (const directory of [root, requests, responses]) await mkdir(directory, { recursive: true, mode: 0o700 });
  const directories = [root, requests, responses];
  const expectedPaths = await Promise.all(directories.map(directory => realpath(directory)));
  const identities = await Promise.all(directories.map(directory => lstat(directory)));
  const seen = new Set();
  let stopped = false;
  let timer;
  let cycle = Promise.resolve();
  const validName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

  /** Fail closed if any transport directory is replaced or aliased outside its original mount. */
  async function checkPaths() {
    const actual = await Promise.all([root, requests, responses].map(directory => realpath(directory)));
    const current = await Promise.all(directories.map(directory => lstat(directory)));
    if (actual.some((directory, index) => directory !== expectedPaths[index])
        || current.some((stat, index) => !stat.isDirectory() || stat.dev !== identities[index].dev || stat.ino !== identities[index].ino)) {
      throw new Error('Queue directories were replaced');
    }
  }

  /** Drain a bounded batch and retain immutable per-request responses until cleanup. */
  async function poll() {
    await checkPaths();
    const files = await readdir(requests);
    if (files.length > POLICY.maxCliCalls) throw new Error('Queue exceeded its pending request budget');
    for (const filename of files) {
      if (stopped || filename.endsWith('.tmp')) continue;
      if (!validName.test(filename)) throw new Error('Invalid queue request filename');
      const id = filename.slice(0, -5);
      if (seen.has(id) || seen.size >= POLICY.maxCliCalls) throw new Error('Duplicate request or exhausted queue budget');
      seen.add(id);
      const source = path.join(requests, filename);
      let result;
      try {
        const submitted = await readMessage(source, POLICY.maxOutputBytes);
        if (submitted.id !== id) throw new Error('Queue request identity mismatch');
        result = await handler(submitted);
      } catch (error) {
        onInvalid(error);
        result = { stdout: '', stderr: 'Invalid guarded CLI queue request', exitCode: 2 };
      }
      await checkPaths();
      try { await publish(responses, id, { ...result, id }, POLICY.ipcResponseBytes); }
      catch (error) {
        onInvalid(error);
        await publish(responses, id, { id, stdout: '', stderr: 'Guarded CLI response exceeded its serialized byte budget', exitCode: 2 }, POLICY.ipcResponseBytes);
      }
      await unlink(source);
    }
  }

  /** Schedule non-overlapping polling without leaving an active timer after shutdown. */
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      cycle = poll().catch(error => { stopped = true; onInvalid(error); }).finally(schedule);
    }, POLICY.ipcPollMs);
  }
  schedule();
  return {
    /** Stop accepting requests, drain the current handler and erase raw transient responses. */
    async close() {
      stopped = true;
      clearTimeout(timer);
      await cycle;
      await checkPaths();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Submit one CLI request and wait for its correlated, bounded host-owned response. */
export async function requestFileQueue(root, argv, cwd, timeoutMs = POLICY.ipcTimeoutMs) {
  const { requests, responses } = queuePaths(root);
  const id = randomUUID();
  await publish(requests, id, { id, argv, cwd }, POLICY.maxOutputBytes);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await readMessage(path.join(responses, `${id}.json`), POLICY.ipcResponseBytes);
      if (result.id !== id || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
          || !Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255) {
        throw new Error('Invalid guarded CLI response');
      }
      return result;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, POLICY.ipcPollMs));
  }
  throw new Error('Guarded CLI file queue timed out');
}
