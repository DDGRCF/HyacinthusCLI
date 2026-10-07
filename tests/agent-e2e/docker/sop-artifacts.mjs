// 改动说明：将Agent的业务任务文件脱敏归档到对应证据目录，不复制凭据或临时IPC队列。
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../lib/policy.mjs';
import { sha } from './sop-policy.mjs';
/** Archive only regular business files under tasks, preserving their relative paths and original hashes. */
export async function archiveTaskArtifacts(workspace,evidence){const root=path.join(workspace,'tasks'),entries=[];
 async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){await visit(file);continue;}if(!entry.isFile()||!/(?:\.json|\.csv|\.md|\.txt)$/.test(entry.name)||/auth|token|credential|secret/i.test(entry.name))continue;const info=await stat(file);if(info.size>4*1024*1024)continue;const bytes=await readFile(file),relative=path.relative(root,file),target=path.join(evidence,'artifacts',relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,redact(bytes.toString('utf8')));entries.push({path:`artifacts/${relative}`,originalSha256:sha(bytes),bytes:bytes.length});}}
 try{await visit(root);}catch(e){if(e.code!=='ENOENT')throw e;}await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,'artifacts.json'),JSON.stringify(entries,null,2));return entries;
}
