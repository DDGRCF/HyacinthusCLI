// 改动说明：守护真实CLI及审批，独立保存stdout与裸data输出文件，并按真实来源核对预览和响应丢失。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileQueue } from '../lib/file-queue.mjs';
import { redact } from '../lib/policy.mjs';
import { SOP_POLICY as P, NETWORK_DENY_EXEC, flag, without, sha, requestFingerprint, callKind } from './sop-policy.mjs';
import { cliData } from './cli-evidence.mjs';
const exec=promisify(execFile);
/** Map a container working directory to its physical location within this case only. */
export async function requestControl(control,cwd){
 if(typeof cwd!=='string'||!path.posix.isAbsolute(cwd))throw new Error('Invalid container working directory');
 const relative=path.posix.relative(control.cwd,cwd);
 if(relative==='..'||relative.startsWith('../'))throw new Error('Container working directory escaped the workspace');
 const root=await realpath(control.workspace);
 const physical=await realpath(path.resolve(control.workspace,relative));
 if(physical!==root&&!physical.startsWith(`${root}/`))throw new Error('Container working directory escaped the workspace');
 if(!(await stat(physical)).isDirectory())throw new Error('Container working directory is not a directory');
 return {...control,workspace:physical,workspaceBoundary:root,cwd:path.posix.join(control.cwd,path.relative(root,physical).split(path.sep).join('/'))};
}
/** Invoke the current real binary in the shared container using the host-selected profile. */
export async function containerCLI(control,argv,{preview=false}={}) {
 const args=realArguments(control,argv,{preview});
 const executable=control.networkDenied?['python3','-c',NETWORK_DENY_EXEC,P.binary]:[P.binary];
 try { const r=await exec('docker',['exec','--user','root','--workdir',control.cwd,'-e',`HYACINTHUS_CONFIG_DIR=/root/sop-profiles/${control.profile}`,'-e',`HYACINTHUS_CLIENT_INSTANCE_ID=${control.profile}`,'-e','HYACINTHUS_CLIENT_DISPLAY_NAME=Pi SOP','-e','HYACINTHUS_CLIENT_TYPE=pi',P.container,...executable,...args],{encoding:'utf8',timeout:P.cliMs,maxBuffer:8*1024*1024});return {...r,exitCode:0}; }
 catch(e){return {stdout:String(e.stdout||''),stderr:String(e.stderr||e.message),exitCode:Number.isInteger(e.code)?e.code:1};}
}
/** Add fixed transport arguments once, preserving real output options and explicit profile initialization. */
export function realArguments(control,argv,{preview=false}={}){
 const forwarded=(preview?[...without(argv.filter(a=>a!=='--yes'&&a!=='--dry-run'),['--jq','-q','--format','--output','-o']),'--dry-run']:argv).filter(a=>a!=='--no-notice');
 const target=argv[0]==='config'&&argv[1]==='set-profile'?[]:['--base-url',control.api||'http://backend:8000'];
 return ['--no-notice',...target,'--profile',control.profile,...forwarded];
}

/** Resolve workspace paths by physical location; inputs are pinned before execution. */
async function checkedPath(control,value){
 if(!value||path.isAbsolute(value)||value.split(/[\\/]/).includes('..'))throw new Error('Business files must remain relative to this workspace');
 const file=path.resolve(control.workspace,value);const physical=await realpath(file).catch(async e=>{if(e.code!=='ENOENT')throw e;return path.join(await realpath(path.dirname(file)),path.basename(file));});
 if(!physical.startsWith(`${control.workspaceBoundary||await realpath(control.workspace)}/`))throw new Error('Business file escaped the workspace');return file;
}
/** Bind the immutable actual preview to the subsequent request; exported for protocol regression. */
export function requireApproval(actual,approved){if(!approved.has(actual))throw new Error('No user approval for this exact preview and request key');}
/** Create one guarded transport for an ordinary Pi session, with no operation instructions injected. */
export async function createContainerBroker(control) {
 const ledger=[];const approvals=new Set();let fault;
 const queue=await createFileQueue(control.ipc,async submitted=>{
 const event={id:randomUUID(),at:new Date().toISOString(),caseId:control.caseId,argv:redact(submitted.argv),...(control.networkDenied?{networkSyscallsDenied:true}:{})};
 const started=performance.now();let output;
 try{
 if(!Array.isArray(submitted.argv)||submitted.argv.some(a=>typeof a!=='string'))throw new Error('Invalid container request');
 const execution=await requestControl(control,submitted.cwd);event.cwd=execution.cwd;
 const argv=[...submitted.argv];Object.assign(event,callKind(argv,control.scopes));
 for(const f of ['--file','--output','-o','--pending-state']){const v=flag(argv,f);if(v)await checkedPath(execution,v);}
 let input=flag(argv,'--file');const data=flag(argv,'--data');if(data?.startsWith('@'))input=data.slice(1);
 if(input){const file=await checkedPath(execution,input);const info=await stat(file);if(!info.isFile()||info.nlink!==1||info.size>4*1024*1024)throw new Error('Invalid input file');const bytes=await readFile(file);
 event.input={file:input,sha256:sha(bytes)};
 const sealed=`/root/sop-inputs/${event.id}.input`;
 await exec('docker',['exec','--user','root',P.container,'python3','-c','import os,sys,base64;os.makedirs("/root/sop-inputs",exist_ok=True);open(sys.argv[1],"wb").write(base64.b64decode(sys.argv[2]))',sealed,bytes.toString('base64')],{maxBuffer:1024*1024});
 const f=data?.startsWith('@')?'--data':'--file';const v=data?.startsWith('@')?`@${sealed}`:sealed;const idx=argv.indexOf(f);if(idx>=0)argv[idx+1]=v;else{const idx=argv.findIndex(a=>a.startsWith(`${f}=`));argv[idx]=`${f}=${v}`;}
 }
 if(event.writes){if(!argv.includes('--yes'))throw new Error('Write requires --yes after preview approval');const check=await containerCLI(execution,argv,{preview:true});const json=JSON.parse(check.stdout);if(!json.ok||!json.data?.request)throw new Error('Write request has no valid actual preview');event.fingerprint=requestFingerprint(event.action,json.data.request);requireApproval(event.fingerprint,approvals);}
 output=await containerCLI(execution,argv);event.exitCode=output.exitCode;
 try{event.result=JSON.parse(output.stdout);}catch{event.outputText=output.stdout;}
 const savedOutput=flag(submitted.argv,'--output')||flag(submitted.argv,'-o');if(savedOutput&&output.exitCode===0&&!argv.includes('--help')&&!argv.includes('-h')){const bytes=await readFile(await checkedPath(execution,savedOutput));event.rawStdout=output.stdout;event.outputData=JSON.parse(bytes);event.resultSource='cli-output-file';event.output_sha256=sha(bytes);}
 const resultData=cliData(event);
 if(!event.writes&&argv.includes('--dry-run')){
 if(resultData?.request){event.preview=resultData;event.fingerprint=requestFingerprint(event.action,resultData.request);}
 }
 if(fault&&event.writes&&resultData?.created>0&&resultData.failed===0){event.actualCommitted=true;output={stdout:JSON.stringify({ok:false,error:{code:'UPLOAD_RESULT_UNKNOWN',message:'Controlled response loss after real commit'}}),stderr:'',exitCode:1};event.responseLost=true;const out=flag(submitted.argv,'--output')||flag(submitted.argv,'-o');if(out)await unlink(await checkedPath(execution,out)).catch(e=>{if(e.code!=='ENOENT')throw e;});fault=false;}
 }catch(e){event.denied=true;event.reason=e.message;output={stdout:JSON.stringify({ok:false,error:{code:'SOP_APPROVAL_DENIED',message:e.message}}),stderr:'',exitCode:2};event.exitCode=2;}
 event.deliveryExitCode=output.exitCode;event.durationMs=performance.now()-started;ledger.push(event);await writeFile(path.join(control.evidence,'cli-events.json'),JSON.stringify(redact(ledger),null,2));return output;
 },e=>ledger.push({denied:true,reason:e.message}));
 return {events:ledger,
 /** Grant a single displayed preview from the host; Agent cannot edit this state. */
 approve(event){if(!event.fingerprint||event.writes)throw new Error('Invalid preview approval');approvals.add(event.fingerprint);},
 /** Drop exactly the next successful write response after recording its real result. */
 loseNextResponse(){fault=true;},
 /** Drain and erase raw transient queue responses. */
 async close(){await queue.close();}};
}
