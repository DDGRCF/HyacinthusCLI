// 改动说明：先挂载隔离 /tmp 再恢复工作区与只读资源，避免 /tmp 工作区被遮蔽；Pi 默认工具继续断网隔离。
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { POLICY } from './policy.mjs';
import { queuePaths } from './file-queue.mjs';

/** Locate a program without invoking a shell or loading user startup files. */
export function executable(name, searchPath = process.env.PATH) {
  const candidate = path.isAbsolute(name) ? name : (searchPath || '').split(path.delimiter)
    .map(directory => path.join(directory, name)).find(file => existsSync(file));
  if (!candidate) throw new Error(`Required executable is unavailable: ${name}`);
  return realpathSync(candidate);
}

/** Construct an empty-root mount namespace; no host credentials or business configuration are mounted. */
export function piSandboxArgs(state, command) {
  const { workspace, agentDir, bins, home, scratch, ipc } = state;
  const args = ['--die-with-parent', '--new-session', '--unshare-all', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
    '--bind', scratch, '/tmp', '--bind', workspace, workspace, '--ro-bind', agentDir, agentDir,
    '--ro-bind', home, home, '--ro-bind', bins, bins];
  const nodeRoot = path.resolve(process.execPath, '../..');
  if (!nodeRoot.startsWith('/usr/')) args.push('--ro-bind', nodeRoot, nodeRoot);
  for (const file of ['cli-proxy.mjs', 'file-queue.mjs', 'policy.mjs']) {
    const absolute = path.join(import.meta.dirname, file);
    args.push('--ro-bind', absolute, absolute);
  }
  if (existsSync(ipc)) args.push('--ro-bind', ipc, ipc, '--bind', queuePaths(ipc).requests, queuePaths(ipc).requests);
  for (const [key, value] of Object.entries({ PATH: `${bins}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home,
    LANG: 'C.UTF-8', AI_AGENT: 'pi', PI_CODING_AGENT_DIR: agentDir, HYACINTHUS_AGENT_E2E_IPC: ipc })) {
    args.push('--setenv', key, value);
  }
  return [...args, '--chdir', workspace, '--', ...command];
}

/** Execute one sandbox tool process with bounded output and whole-process-group cancellation. */
export function sandboxExecute(state, command, { input, signal, timeoutMs = POLICY.cliTimeoutMs, onData } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(executable('bwrap'), piSandboxArgs(state, command), { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const stdout = [];
    const stderr = [];
    let size = 0;
    let failure;
    /** Stop all descendants, not only the wrapper shell, after abort or budget exhaustion. */
    function stop(error) {
      failure ||= error;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (cause) { if (cause.code !== 'ESRCH') failure ||= cause; }
    }
    const abort = () => stop(new Error('Pi sandbox tool aborted'));
    const timer = setTimeout(() => stop(new Error('Pi sandbox tool timed out')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    /** Collect bounded binary data and stream shell output when requested by the built-in tool. */
    function collect(target, data) {
      size += data.length;
      if (size > POLICY.maxOutputBytes) { stop(new Error('Pi sandbox output exceeded its byte budget')); return; }
      target.push(data);
      onData?.(data);
    }
    child.stdout.on('data', data => collect(stdout, data));
    child.stderr.on('data', data => collect(stderr, data));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
    child.once('error', error => { failure ||= error; });
    child.once('close', (code, terminationSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code ?? (terminationSignal ? 137 : 1) });
    });
    child.stdin.end(input);
  });
}

/** Use Pi's genuine built-in read/bash/edit/write definitions while replacing only their IO operations. */
export function sandboxTools(sdk, state) {
  /** Run a filesystem operation inside the same OS sandbox as shell commands. */
  async function fsOperation(operation, file, content) {
    if (content !== undefined && Buffer.byteLength(content) > POLICY.maxOutputBytes) throw new Error('Pi file content exceeded its byte budget');
    const script = `const fs=require('node:fs');const [op,p]=process.argv.slice(1);if(op==='read'){const f=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(f);if(!s.isFile()||s.size>${POLICY.maxOutputBytes})throw Error('Invalid or oversized file');process.stdout.write(fs.readFileSync(f));}finally{fs.closeSync(f)}}else if(op==='write'){fs.writeFileSync(p,fs.readFileSync(0))}else if(op==='mkdir'){fs.mkdirSync(p,{recursive:true})}else{fs.accessSync(p,op==='edit-access'?fs.constants.R_OK|fs.constants.W_OK:fs.constants.R_OK)}`;
    const result = await sandboxExecute(state, [process.execPath, '-e', script, operation, file], { input: content });
    if (result.exitCode) throw new Error(result.stderr.toString() || `Sandbox filesystem operation exited ${result.exitCode}`);
    return result.stdout;
  }
  const readFile = file => fsOperation('read', file);
  const access = file => fsOperation('access', file);
  const writeFile = (file, content) => fsOperation('write', file, content);
  return [
    sdk.createReadToolDefinition(state.workspace, { operations: { readFile, access }, autoResizeImages: false }),
    sdk.createWriteToolDefinition(state.workspace, { operations: { writeFile, mkdir: directory => fsOperation('mkdir', directory) } }),
    sdk.createEditToolDefinition(state.workspace, { operations: { readFile, writeFile, access: file => fsOperation('edit-access', file) } }),
    sdk.createBashToolDefinition(state.workspace, { exposeSessionEnvironment: false, operations: {
      async exec(command, _cwd, options) {
        const result = await sandboxExecute(state, ['/bin/sh', '-c', command], { signal: options.signal,
          timeoutMs: Math.min((options.timeout || POLICY.cliTimeoutMs / 1000) * 1000, POLICY.cliTimeoutMs), onData: options.onData });
        return { exitCode: result.exitCode };
      },
    } }),
  ];
}
