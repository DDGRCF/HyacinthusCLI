// 改动说明：共享容器中按用例创建正常Pi会话，复用真实浏览器授权和文件队列批准记录。
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
import { chromium } from 'playwright';
import { sharedAuthorization } from '../lib/reply.mjs';
import { redactWithSecrets } from '../lib/policy.mjs';
import { SOP_POLICY as P, confirmationRequested } from './sop-policy.mjs';
import { createContainerBroker } from './container-broker.mjs';
/** Open the Agent's exact authorization URL in the deployed admin UI, retaining credentials only in memory. */
export function browserApprover(password) {
 let browser,context;
 return {async approve(url,evidence){
 assert.equal(new URL(url).origin,P.admin);browser||=await chromium.launch({headless:true,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false});context||=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(20_000);
 try{await page.goto(url,{waitUntil:'networkidle'});
 if(await page.getByTestId('admin-login-username').count()){
 await page.getByTestId('admin-login-username').fill('rust-e2e-admin@hyacinthus.local');await page.getByTestId('admin-login-password').fill(password);
 const [login]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/admin/auth/sessions/password'&&r.request().method()==='POST'),page.getByTestId('authentication-submit').click()]);assert.equal(login.status(),200);
 await page.waitForURL(v=>!`${v.pathname}${v.hash}`.includes('/admin/login'));await page.goto(url,{waitUntil:'networkidle'});}
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/approve')&&r.request().method()==='POST'),page.getByRole('button',{name:'批准授权',exact:true}).click()]);assert.equal(response.status(),200);
 // Capture after navigation to the ordinary admin home: approval URL/user code must not enter screenshots.
 await page.goto(`${P.admin}/#/admin`,{waitUntil:'networkidle'});await page.screenshot({path:path.join(evidence,'authorization.png')});
 }finally{await page.close();}},async close(){await browser?.close();}};
}
/** Start a fresh SDK session using the shared installed Skills and a host-selected workspace/profile. */
export async function openPi(control,approver,{secrets=[]}={}){
 const safe=value=>redactWithSecrets(value,secrets);
 await mkdir(control.workspace,{recursive:true});await mkdir(control.evidence,{recursive:true});
 const broker=await createContainerBroker(control);const tools=[],conversation=[],approvals=[],authLinks=new Set();
 let waiting,readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const child=spawn('docker',['exec','-i','--workdir',control.cwd,'-e',`PI_WORKSPACE=${control.cwd}`,'-e',`HYACINTHUS_PROFILE=${control.profile}`,'-e',`HYACINTHUS_AGENT_E2E_IPC=${control.cwd}/.sop-ipc`,P.container,'node','/opt/acceptance/pi-runner.mjs'],{stdio:['pipe','pipe','pipe']});
 let userTurns=0;
 const lines=readline.createInterface({input:child.stdout});
 lines.on('line',line=>{try{const event=JSON.parse(line);appendFileSync(path.join(control.evidence,'pi-events.ndjson'),JSON.stringify(safe(event))+'\n');if(event.event==='ready')readyResolve(event);else if(event.event==='tool')tools.push(event);else if(['reply','failure'].includes(event.event))waiting?.resolve(event);}catch(e){waiting?.reject(e);}});
 child.stderr.on('data',data=>{void writeFile(path.join(control.evidence,'pi-stderr.log'),safe(String(data)),{flag:'a'});});
 child.on('exit',code=>{const e=new Error(`Pi exited ${code}`);readyReject(e);waiting?.reject(e);});
 const timer=setTimeout(()=>readyReject(new Error('Pi readiness timeout')),30_000);let discovery;
 try{discovery=await ready;}finally{clearTimeout(timer);}
 await writeFile(path.join(control.evidence,'session.json'),JSON.stringify(discovery,null,2));
 /** Exchange one actual user turn and persist only redacted observations. */
 async function turn(prompt){
 if(++userTurns>P.maxTurns)throw new Error('Session user-turn budget exceeded');
 const start=broker.events.length;const reply=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{waiting=undefined;reject(new Error('Pi turn budget exceeded'));},P.turnMs);waiting={resolve:r=>{clearTimeout(timeout);waiting=undefined;resolve(r);},reject:e=>{clearTimeout(timeout);waiting=undefined;reject(e);}};child.stdin.write(`${JSON.stringify({prompt})}\n`);});
 conversation.push({prompt,...reply});await writeFile(path.join(control.evidence,'conversation.json'),JSON.stringify(safe(conversation),null,2));await writeFile(path.join(control.evidence,'tools.json'),JSON.stringify(safe(tools),null,2));
 if(reply.event==='failure'||reply.error||reply.stopReason==='error')throw new Error(reply.error||'Pi model failure');return {reply,events:broker.events.slice(start)};
 }
 /** Perform only authorization handoffs; return once the Agent ends a real business turn. */
 async function task(prompt){let next=prompt;for(let round=0;round<P.maxTurns;round++){
 const {reply,events}=await turn(next);let handoff;
 for(const e of events.toReversed()){const h=e.result?.ok?e.result.data:e.result?.error?.detail;if(h?.authorize_url){handoff=h;break;}}
 if(!handoff)return reply;
 assert.ok(sharedAuthorization(reply,handoff.authorize_url),'Agent did not share the original authorization URL');assert.ok((handoff.required_scopes||[]).every(s=>control.scopes.includes(s)),'Unrelated authorization scope');assert.ok(!authLinks.has(handoff.authorize_url),'Repeated completed authorization handoff');
 await approver.approve(handoff.authorize_url,control.evidence);authLinks.add(handoff.authorize_url);next=approvals.length?'已通过原始链接批准CLI访问权限。此前已确认的业务预览仍有效，请严格按已批准的原内容继续。':'已通过原始链接批准CLI访问权限。业务写入需要另外确认；请继续完成预览，等待我的业务确认。';
 }throw new Error('User turn budget exceeded');}
 /** Approve the latest actual preview after caller has verified source fields and pre-write state. */
 async function approve(prompt){const preview=broker.events.findLast(e=>e.preview&&!e.writes&&e.exitCode===0);assert.ok(preview,'No full actual dry-run preview');confirmationRequested(conversation.at(-1),preview.preview.request.body.confirmed_rows?.length);assert.ok(!broker.events.some(e=>e.writes),'A write preceded user approval');broker.approve(preview);approvals.push({at:new Date().toISOString(),sessionId:discovery.sessionId,fingerprint:preview.fingerprint,input:preview.input,preview:preview.preview,prompt});await writeFile(path.join(control.evidence,'approval.json'),JSON.stringify(safe(approvals),null,2));return task(prompt);}
 return {control,broker,tools,conversation,discovery,task,turn,approve,
 /** Drain queue and stop this SDK process without stopping the shared container. */
 cancel(){child.kill('SIGTERM');},
 async close(){if(child.stdin.writable)child.stdin.end(`${JSON.stringify({close:true})}\n`);await broker.close();child.kill('SIGTERM');}};
}
