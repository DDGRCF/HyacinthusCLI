// 改动说明：验证速度档案仅包含计数、计时与用量，缺失证据保持未知。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { collectSopSpeed } from './sop-speed.mjs';
test('speed archive excludes source text and arguments and keeps missing metrics null', async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'sop-speed-'));
 try {
  const dir=path.join(root,'cases','D4');await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'pi-events.ndjson'),JSON.stringify({event:'reply',text:'private-fixture',elapsedMs:100})+'\n');
  await writeFile(path.join(dir,'cli-events.json'),JSON.stringify([{action:'requirements search',argv:['private-fixture'],durationMs:3,exitCode:0}]));
  const result=await collectSopSpeed(root);const record=result.sessions[0];
  assert.equal(record.wallMs,100);assert.equal(record.modelResponseMs,null);assert.equal(record.inputTokens,null);
  assert.equal(record.cliCalls,1);assert.match(record.kind,/复用邮件/);
  assert.ok(!(await readFile(path.join(root,'speed.json'),'utf8')).includes('private-fixture'));
 } finally { await rm(root,{recursive:true,force:true}); }
});
