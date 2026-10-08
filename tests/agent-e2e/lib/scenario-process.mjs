// 改动说明：e2e 与真实 Pi SDK 使用独立原生进程，避免 tsx 命名空间污染；取消等待凭据/证据清理。
import path from 'node:path';
import { spawn } from 'node:child_process';
import { POLICY } from './policy.mjs';

let active;

/** Run the actual Pi scenario without inheriting e2e's Node module-loader hooks. */
export function runScenarioProcess(entry = path.join(import.meta.dirname, 'scenario-native.mjs'), { forward = true } = {}) {
  if (active) throw new Error('A Pi scenario process is already active');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, NODE_OPTIONS: '' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, failure, escalation;
    let done;
    const finished = new Promise(finish => { done = finish; });
    /** Terminate the whole child process group without masking a failed cleanup as success. */
    function kill(signal) {
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') failure ||= error; }
    }
    /** Request native cleanup first, with a finite forced-termination fallback. */
    function stop(reason) {
      failure ||= reason;
      if (escalation) return;
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), POLICY.cleanupTimeoutMs);
    }
    const timer = setTimeout(() => stop(new Error('Pi scenario process exceeded its deadline')),
      POLICY.scenarioTimeoutMs + POLICY.cleanupTimeoutMs);
    active = { finished, stop };
    /** Preserve actual native stdout/stderr while bounding all retained bytes. */
    function capture(data, stdout) {
      bytes += Buffer.byteLength(data);
      if (bytes > POLICY.maxOutputBytes) { stop(new Error('Pi scenario process output exceeded its byte budget')); return; }
      if (stdout) output += data.toString('utf8');
      if (forward) (stdout ? process.stdout : process.stderr).write(data);
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => capture(data, true));
    child.stderr.on('data', data => capture(data, false));
    child.once('error', error => { failure ||= error; });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(escalation); active = undefined; done();
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(`Native Pi scenario exited ${code ?? signal}; see reports/latest.html`)); return; }
      try {
        const record = output.split('\n').findLast(line => line.startsWith('PI_SCENARIO_RESULT '));
        if (!record) throw new Error('Native Pi scenario returned no independent result');
        resolve(JSON.parse(record.slice('PI_SCENARIO_RESULT '.length)));
      } catch (error) { reject(error); }
    });
  });
}

/** Wait for the active native child to abort, revoke temporary authorization and publish evidence. */
export async function cancelScenarioProcess() {
  if (!active) return;
  const pending = active;
  pending.stop(new Error('Outer e2e test cancelled the Pi scenario'));
  await pending.finished;
}
