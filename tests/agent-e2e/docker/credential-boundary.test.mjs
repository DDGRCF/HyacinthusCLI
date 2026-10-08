// 改动说明：用合成凭据验证真实bwrap只读边界、单provider快照、容器RO挂载及不降级的E2门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SELECTED_PROVIDER as provider, boundaryArguments, captureCredentialSource, compareCredentialIntegrity, credentialDirectories, credentialHashes, inspectCredentialIntegrity, requireCredentialIntegrity, selectedCredential, verifyCredentialMounts } from './credential-boundary.mjs';

const source = { [provider]: { type: 'api_key', key: 'synthetic-mimo-key' }, other: { type: 'oauth', refresh: 'synthetic-refresh' } };
const bytes = value => Buffer.from(JSON.stringify(value));
const hostBoundary = { directories: [{ directory: '/synthetic/auth', readOnly: true }] };
const containerBoundary = { readOnly: true, originalCredentialMounted: false };

test('single source produces only the selected provider and public hashes contain no credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sop-credential-'));
  try {
    const host = path.join(root, 'host.json'), snapshot = path.join(root, 'private/mimo-auth.json');
    await writeFile(host, bytes(source));
    const baseline = await captureCredentialSource(host, snapshot);
    assert.deepEqual(JSON.parse(await readFile(snapshot)), { [provider]: source[provider] });
    assert.deepEqual(selectedCredential(await readFile(snapshot)), source[provider]);
    assert.doesNotMatch(JSON.stringify(baseline), /synthetic-mimo-key|synthetic-refresh/);
    assert.equal(baseline.wholeFileHash, credentialHashes(bytes(source)).wholeFileHash);
    await writeFile(host, bytes({ ...source, [provider]: { ...source[provider], key: 'new-synthetic-key' } }));
    const integrity = await inspectCredentialIntegrity(baseline, host, snapshot);
    assert.equal(integrity.snapshotUnchanged, true);
    assert.equal(integrity.selectedProviderUnchanged, false);
    assert.throws(() => requireCredentialIntegrity(integrity, hostBoundary, containerBoundary), /Selected host provider changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('other-provider rotation and JSON formatting are observations, selected source and snapshot remain hard gates', () => {
  const original = bytes(source), snapshot = bytes({ [provider]: source[provider] });
  const baseline = { ...credentialHashes(original), snapshotHash: credentialHashes(snapshot).wholeFileHash };
  const changedOther = bytes({ other: { ...source.other, refresh: 'rotated-synthetic-refresh' }, [provider]: { key: source[provider].key, type: 'api_key' } });
  const observed = compareCredentialIntegrity(baseline, changedOther, snapshot);
  requireCredentialIntegrity(observed, hostBoundary, containerBoundary);
  assert.equal(observed.hostObservation.wholeFileUnchanged, false);
  assert.deepEqual(observed.hostObservation.changedProviders, ['other']);
  const formatted = compareCredentialIntegrity(baseline, Buffer.from(JSON.stringify(source, null, 2)), snapshot);
  assert.deepEqual(formatted.hostObservation.changedProviders, []);
  assert.equal(formatted.selectedProviderUnchanged, true);
  assert.throws(() => requireCredentialIntegrity(compareCredentialIntegrity(baseline, original, bytes({ [provider]: { ...source[provider], key: 'changed' } })), hostBoundary, containerBoundary), /snapshot changed/);
  assert.throws(() => requireCredentialIntegrity(compareCredentialIntegrity(baseline, bytes({ other: source.other }), snapshot), hostBoundary, containerBoundary), /Selected host provider changed/);
  for (const [host, container] of [[undefined, containerBoundary], [hostBoundary, undefined], [{ directories: [] }, containerBoundary], [hostBoundary, { readOnly: false, originalCredentialMounted: false }]]) assert.throws(() => requireCredentialIntegrity(observed, host, container));
});

test('missing files and invalid private JSON fail without disclosing their contents', async () => {
  const integrity = await inspectCredentialIntegrity(undefined, '/nonexistent-sop-auth', '/nonexistent-sop-copy');
  assert.equal(integrity.selectedProviderUnchanged, false);
  assert.throws(() => requireCredentialIntegrity(integrity, hostBoundary, containerBoundary));
  assert.throws(() => credentialHashes(Buffer.from('synthetic-secret-invalid-json')), error => !error.message.includes('synthetic-secret'));
  assert.throws(() => selectedCredential(bytes(source)), /only the selected/);
});

test('actual container evidence rejects writable copies, wrong sources and original credential mounts', () => {
  const snapshot = '/synthetic/private/mimo-auth.json', original = '/synthetic/original';
  const good = { Name: '/pi', Mounts: [{ Type: 'bind', Source: snapshot, Destination: '/home/node/.pi/agent/auth.json', RW: false }] };
  assert.equal(verifyCredentialMounts([good], 'pi', snapshot, [original]).readOnly, true);
  for (const change of [{ RW: true }, { Source: '/synthetic/wrong-copy.json' }, { Type: 'volume' }]) assert.throws(() => verifyCredentialMounts([{ ...good, Mounts: [{ ...good.Mounts[0], ...change }] }], 'pi', snapshot, [original]));
  for (const source of [original, `${original}/auth.json`, '/synthetic']) assert.throws(() => verifyCredentialMounts([good, { Name: '/other', Mounts: [{ Source: source, Destination: '/exposed', RW: false }] }], 'pi', snapshot, [original]), /exposes original/);
  assert.throws(() => verifyCredentialMounts([], 'pi', snapshot, [original]), /Missing actual/);
});

test('real bwrap rejects write, rename and unlink through both configured and symlink credential paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sop-credential-boundary-'));
  try {
    const configured = path.join(root, 'configured'), target = path.join(root, 'target');
    await mkdir(configured); await mkdir(target);
    const original = path.join(target, 'auth.json'), alias = path.join(configured, 'auth.json');
    await writeFile(original, bytes(source)); await symlink(original, alias);
    const directories = await credentialDirectories(alias);
    assert.deepEqual(directories, [configured, target]);
    const moduleURL = new URL('./credential-boundary.mjs', import.meta.url).href;
    const code = `import fs from 'node:fs';import {readOnlyBoundary} from ${JSON.stringify(moduleURL)};const proof=readOnlyBoundary(${JSON.stringify(directories)});const errors=[];for(const file of ${JSON.stringify([original, alias])}){for(const operation of [()=>fs.writeFileSync(file,'changed'),()=>fs.renameSync(file,file+'.moved'),()=>fs.unlinkSync(file)]){try{operation();throw new Error('credential write allowed');}catch(error){if(error.code!=='EROFS')throw error;errors.push(error.code);}}}console.log(JSON.stringify({proof,errors}));`;
    const result = JSON.parse(execFileSync('bwrap', boundaryArguments(directories, process.execPath, ['--input-type=module', '-e', code]), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.equal(result.errors.length, 6);
    assert.ok(result.proof.directories.every(item => item.readOnly));
    assert.deepEqual(JSON.parse(await readFile(original)), source);
    // The boundary belongs to this task; an unrelated host process retains its own writable mount.
    await writeFile(original, bytes(source));
    const spoof = `import {enterCredentialBoundary} from ${JSON.stringify(moduleURL)};try{await enterCredentialBoundary(${JSON.stringify(alias)},'/unused');process.exit(2);}catch(error){if(!error.message.includes('read-only'))throw error;}`;
    execFileSync(process.execPath, ['--input-type=module', '-e', spoof], { env: { ...process.env, HYACINTHUS_SOP_CREDENTIAL_BOUNDARY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
