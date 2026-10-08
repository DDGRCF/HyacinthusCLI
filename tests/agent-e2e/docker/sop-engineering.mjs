// 改动说明：在共同Pi容器内检查安装、升级和真正禁止网络的离线读取，独立于模型业务用例。
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createContainerBroker } from './container-broker.mjs';
import { SOP_POLICY as P, NETWORK_DENY_EXEC } from './sop-policy.mjs';
/** Exercise the real guarded CLI from a nested directory without requesting a model or a write. */
export async function guardedDirectoryCheck(control){
 const nested=path.join(control.workspace,'tasks','nested');await mkdir(nested,{recursive:true});
 const raw='编号：NESTED-DIRECTORY\n年级：初一\n科目：数学\n';await writeFile(path.join(nested,'input.txt'),raw);
 const broker=await createContainerBroker({...control,ipc:path.join(control.workspace,'.sop-ipc')});
 const command=promisify(execFile);
 try{
 const response=await command('docker',['exec','--workdir',`${control.cwd}/tasks/nested`,'-e',`HYACINTHUS_AGENT_E2E_IPC=${control.cwd}/.sop-ipc`,P.container,'hyacinthus','requirements','parse','--file','input.txt','--dry-run','--output','preview.json','--jq','.data.request.method'],{encoding:'utf8',timeout:30_000});
 const saved=JSON.parse(await readFile(path.join(nested,'preview.json'),'utf8'));
 assert.equal(saved.request.body.raw_text,raw);assert.equal(broker.events.length,1);assert.equal(broker.events[0].writes,false);assert.equal(broker.events[0].cwd,`${control.cwd}/tasks/nested`);
 return {sameContainer:P.container,nestedRelativeInput:true,nestedRelativeOutput:true,actualRequestMethod:saved.request.method,stdoutProjected:response.stdout.trim(),writes:0};
 }finally{await broker.close();}
}
/** Run an argument-vector command as root inside the same acceptance container. */
export function rootCommand(args){return execFileSync('docker',['exec','--user','root',P.container,...args],{encoding:'utf8',timeout:90_000,maxBuffer:8*1024*1024});}
/** Execute a bounded engineering program using Python without reading host credentials. */
function python(source){return JSON.parse(rootCommand(['python3','-c',source]));}
/** Verify three real installer export paths and compare the formal Agent installation byte for byte. */
export function installCheck(){return python(`
import os,json,subprocess,hashlib,pathlib
base=pathlib.Path('/root/sop-engineering');base.mkdir(exist_ok=True)
bin='${P.binary}'
def cli(*args):return json.loads(subprocess.check_output([bin,'--no-notice',*args]))
manifest=json.loads(pathlib.Path('/home/node/.pi/agent/skills/.hyacinthus-skills.json').read_text())
assert len(manifest['skills'])==2 and len(manifest['files'])==13
records=[]
for mode in ['auto','target','relative']:
 home=base/mode;home.mkdir(exist_ok=True);agent=home/'.pi/agent';agent.mkdir(parents=True,exist_ok=True)
 env=dict(os.environ,HOME=str(home),PI_CODING_AGENT_DIR=str(agent))
 source="const i=require('/opt/hyacinthus-installer/bin/hyacinthus-cli.js');i.installBundledSkills(process.argv[1],i.installSkillDestinations(JSON.parse(process.argv[2])));"
 args={} if mode=='auto' else {'skills-target':'pi'} if mode=='target' else {'skills-dir':'relative-skills'}
 subprocess.check_output(['node','-e',source,bin,json.dumps(args)],env=env,cwd=str(home))
 dest=home/'relative-skills' if mode=='relative' else agent/'skills'
 check=cli('skills','check','--dir',str(dest));assert check['data']['ok']
 for file in manifest['files']:assert (dest/file).read_bytes()==(pathlib.Path('/home/node/.pi/agent/skills')/file).read_bytes()
 records.append({'mode':mode,'files':len(manifest['files']),'check':check['data']['ok']})
roots=cli('skills','list')['data'];refs=cli('skills','list','hyacinthus-cli/references')['data']['entries'];assert len(roots)==2 and len(refs)==11
cap=cli('capability','list')['data']
print(json.dumps({'installerPaths':records,'formalSkills':cli('skills','check','--dir','/home/node/.pi/agent/skills')['data'],'roots':roots,'references':refs,'capabilities':cap,'releaseDownloadTested':False}))
`);}
/** Model an owned legacy manifest, preserve user files, and prove both corruption cases fail check. */
export function upgradeCheck(){return python(`
import os,json,subprocess,pathlib,hashlib,shutil
root=pathlib.Path('/root/sop-engineering/upgrade');root.mkdir(parents=True,exist_ok=True)
def cli(*a):return json.loads(subprocess.check_output(['${P.binary}','--no-notice',*a]))
(root/'hyacinthus-runtime').mkdir(exist_ok=True);(root/'hyacinthus-runtime/SKILL.md').write_text('legacy owned skill')
(root/'hyacinthus-runtime/custom.txt').write_text('keep this')
(root/'user-created').mkdir(exist_ok=True);(root/'user-created/SKILL.md').write_text('custom skill')
(root/'.hyacinthus-skills.json').write_text(json.dumps({'version':'old-fixture','skills':['hyacinthus-runtime'],'files':['hyacinthus-runtime/SKILL.md']}))
cli('skills','export','--dir',str(root));assert not (root/'hyacinthus-runtime/SKILL.md').exists()
assert (root/'hyacinthus-runtime/custom.txt').read_text()=='keep this' and (root/'user-created/SKILL.md').read_text()=='custom skill'
checks={}
for mode in ['missing','modified']:
 dest=root.parent/mode;shutil.copytree(root,dest,dirs_exist_ok=True);ref=dest/'hyacinthus-cli/references/auth.md'
 ref.unlink() if mode=='missing' else ref.write_text('broken')
 result=cli('skills','check','--dir',str(dest));assert result['data']['ok']==False;checks[mode]=result['data']
print(json.dumps({'ownedRetiredRemoved':True,'userFilesPreserved':True,'damageChecks':checks}))
`);}
/** Install a syscall filter blocking sockets/connects before exec; no network namespace or extra container is needed. */
export function offlineCheck(){return python(`
import os,json,subprocess,pathlib
root=pathlib.Path('/root/sop-engineering/offline');root.mkdir(parents=True,exist_ok=True)
bin='${P.binary}'
filter_code='''${NETWORK_DENY_EXEC}'''
normal=dict(os.environ,HYACINTHUS_CONFIG_DIR=str(root),HYACINTHUS_BASE_URL='http://127.0.0.1:9')
checks=[]
for mode in ['no-token','network-denied','bad-config']:
 if mode=='bad-config':(root/'config.json').write_text('{broken')
 prefix=['python3','-c',filter_code] if mode=='network-denied' else []
 listed=json.loads(subprocess.check_output(prefix+[bin,'--no-notice','skills','list'],env=normal));assert listed['ok'] and len(listed['data'])==2
 paths=['hyacinthus-cli','tutoring-job-mail-upload']+[x['path'] for x in json.loads(subprocess.check_output(prefix+[bin,'--no-notice','skills','list','hyacinthus-cli/references'],env=normal))['data']['entries']]
 for file in paths:assert subprocess.check_output(prefix+[bin,'--no-notice','skills','read',file],env=normal)
 checks.append({'mode':mode,'readFiles':len(paths),'socketsDenied':mode=='network-denied'})
invalid=[]
for file in ['hyacinthus-cli/references/absent.md','hyacinthus-cli/../../etc/passwd']:
 r=subprocess.run([bin,'--no-notice','skills','read',file],capture_output=True);assert r.returncode!=0;invalid.append({'path':file,'exitCode':r.returncode})
print(json.dumps({'checks':checks,'invalidPaths':invalid}))
`);}
