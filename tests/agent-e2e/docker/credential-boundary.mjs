// 改动说明：SOP宿主凭据目录强制只读，单次来源生成MiMo快照，公开证据只保存哈希与挂载边界。
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha } from './sop-policy.mjs';

export const SELECTED_PROVIDER = 'xiaomi-token-plan-cn';
const BOUNDARY_ENV = 'HYACINTHUS_SOP_CREDENTIAL_BOUNDARY';
const AUTH_DESTINATION = '/home/node/.pi/agent/auth.json';

/** Sort object keys so unrelated JSON formatting does not change a provider hash. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

/** Parse credentials without including malformed private contents in an exception. */
function parseCredentials(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString()); } catch { throw new Error('Credential JSON is invalid'); }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Credential JSON must be an object');
  return value;
}

/** Return only the whole-file and canonical per-provider hashes. */
export function credentialHashes(bytes) {
  const auth = parseCredentials(bytes);
  return { wholeFileHash: sha(bytes), providerHashes: Object.fromEntries(Object.keys(auth).sort().map(name => [name, sha(JSON.stringify(canonical(auth[name])))])) };
}

/** Require a private snapshot containing only the selected API-key provider. */
export function selectedCredential(bytes) {
  const auth = parseCredentials(bytes);
  assert.deepEqual(Object.keys(auth), [SELECTED_PROVIDER], 'Snapshot must contain only the selected provider');
  const provider = auth[SELECTED_PROVIDER];
  assert.ok(provider?.type === 'api_key' && typeof provider.key === 'string' && provider.key.length, 'The selected MiMo API key is unavailable');
  return provider;
}

/** Read the host source once and derive both the baseline and the one-provider private copy. */
export async function captureCredentialSource(hostPath, snapshotPath) {
  const bytes = await readFile(hostPath);
  const auth = parseCredentials(bytes);
  const snapshot = Buffer.from(JSON.stringify({ [SELECTED_PROVIDER]: auth[SELECTED_PROVIDER] }));
  selectedCredential(snapshot);
  const baseline = { ...credentialHashes(bytes), snapshotHash: sha(snapshot), selectedProvider: SELECTED_PROVIDER };
  await mkdir(path.dirname(snapshotPath), { recursive: true, mode: 0o700 });
  await writeFile(snapshotPath, snapshot, { mode: 0o600 });
  await chmod(snapshotPath, 0o600);
  return baseline;
}

/** Compare endpoint hashes; whole-file and other-provider changes remain observations. */
export function compareCredentialIntegrity(baseline, hostBytes, snapshotBytes) {
  const after = credentialHashes(hostBytes);
  const changedProviders = [...new Set([...Object.keys(baseline.providerHashes), ...Object.keys(after.providerHashes)])].sort().filter(name => baseline.providerHashes[name] !== after.providerHashes[name]);
  return {
    selectedProvider: SELECTED_PROVIDER,
    selectedProviderUnchanged: typeof baseline.providerHashes[SELECTED_PROVIDER] === 'string' && baseline.providerHashes[SELECTED_PROVIDER] === after.providerHashes[SELECTED_PROVIDER],
    snapshotUnchanged: baseline.snapshotHash === sha(snapshotBytes),
    snapshot: { before: baseline.snapshotHash, after: sha(snapshotBytes) },
    hostObservation: { before: baseline.wholeFileHash, after: after.wholeFileHash, wholeFileUnchanged: baseline.wholeFileHash === after.wholeFileHash, beforeProviders: baseline.providerHashes, afterProviders: after.providerHashes, changedProviders },
  };
}

/** Collect failure evidence as well as success before cleanup removes the private snapshot. */
export async function inspectCredentialIntegrity(baseline, hostPath, snapshotPath) {
  const reads = await Promise.allSettled([readFile(hostPath), readFile(snapshotPath)]);
  if (!baseline || reads.some(item => item.status !== 'fulfilled')) return { selectedProvider: SELECTED_PROVIDER, selectedProviderUnchanged: false, snapshotUnchanged: false, verificationError: 'Credential baseline or final files unavailable' };
  try { return compareCredentialIntegrity(baseline, reads[0].value, reads[1].value); }
  catch { return { selectedProvider: SELECTED_PROVIDER, selectedProviderUnchanged: false, snapshotUnchanged: false, verificationError: 'Final credential verification failed' }; }
}

/** Protect both the configured directory and any symlink target of its credential file. */
export async function credentialDirectories(hostPath) {
  return [...new Set([await realpath(path.dirname(hostPath)), path.dirname(await realpath(hostPath))])];
}

/** Check the actual filesystem flags in this process namespace without opening credentials. */
export function readOnlyBoundary(directories) {
  const flags = JSON.parse(execFileSync('/usr/bin/python3', ['-c', 'import os,sys,json;print(json.dumps([bool(os.statvfs(p).f_flag & os.ST_RDONLY) for p in sys.argv[1:]]))', ...directories], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(flags.length, directories.length, 'Missing credential mount proof');
  assert.ok(flags.every(Boolean), 'Host credential directories must be read-only in this task');
  return { type: 'bwrap-mount-namespace', directories: directories.map(directory => ({ directory, readOnly: true })) };
}

/** Build the single host task namespace while keeping Docker and network access available. */
export function boundaryArguments(directories, command, argv) {
  return ['--die-with-parent', '--bind', '/', '/', '--dev-bind', '/dev', '/dev', ...directories.flatMap(directory => ['--ro-bind', directory, directory]), '--proc', '/proc', '--setenv', BOUNDARY_ENV, '1', command, ...argv];
}

/** Re-enter the SOP or standalone preparation inside a verified read-only host boundary. */
export async function enterCredentialBoundary(hostPath, scriptPath) {
  const directories = await credentialDirectories(hostPath);
  if (process.env[BOUNDARY_ENV] === '1') return readOnlyBoundary(directories);
  const child = spawn('bwrap', boundaryArguments(directories, process.execPath, [scriptPath, ...process.argv.slice(2)]), { stdio: 'inherit' });
  const forward = signal => () => child.kill(signal);
  const interrupt = forward('SIGINT'), terminate = forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  const code = await new Promise((resolve, reject) => { child.once('error', () => reject(new Error('bwrap credential boundary could not start'))); child.once('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143))); });
  process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  process.exit(code);
}

/** Identify overlapping paths, including a mount of a credential directory's ancestor. */
function overlaps(left, right) {
  const inside = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
  return inside(left, right) || inside(right, left);
}

/** Require the actual Pi bind to be the private RO copy and keep original credentials out of all task containers. */
export function verifyCredentialMounts(containers, piName, snapshotPath, hostDirectories) {
  const pi = containers.find(container => container.Name === `/${piName}` || container.Name === piName);
  assert.ok(pi, 'Missing actual Pi container mount evidence');
  const mount = pi.Mounts.find(item => item.Destination === AUTH_DESTINATION);
  assert.ok(mount?.Type === 'bind' && mount.RW === false && path.resolve(mount.Source) === path.resolve(snapshotPath), 'Pi credentials must bind the private snapshot read-only');
  assert.ok(containers.every(container => container.Mounts.every(item => !item.Source || !hostDirectories.some(directory => overlaps(path.resolve(item.Source), directory)))), 'A task container exposes original host credentials');
  return { container: piName, source: mount.Source, destination: mount.Destination, readOnly: true, originalCredentialMounted: false, checkedContainers: containers.length };
}

/** Fail closed when any required proof or selected-provider integrity check is absent. */
export function requireCredentialIntegrity(integrity, hostBoundary, containerBoundary) {
  assert.ok(hostBoundary?.directories?.length && hostBoundary.directories.every(item => item.readOnly === true), 'Missing read-only host credential boundary');
  assert.ok(containerBoundary?.readOnly === true && containerBoundary.originalCredentialMounted === false, 'Missing read-only container credential boundary');
  assert.equal(integrity.selectedProviderUnchanged, true, 'Selected host provider changed during the SOP');
  assert.equal(integrity.snapshotUnchanged, true, 'Private model credential snapshot changed during the SOP');
}
