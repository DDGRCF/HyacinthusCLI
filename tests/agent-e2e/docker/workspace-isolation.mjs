// 改动说明：模型执行期间限制兄弟任务文件访问，完成轮次后恢复宿主归档所需权限。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SOP_POLICY as P } from './sop-policy.mjs';
const exec = promisify(execFile);
export const ISOLATE_SCRIPT = `import json,os,stat,sys
root=os.path.realpath(sys.argv[1]);current=os.path.realpath(sys.argv[2]);records=[]
assert current.startswith(root+os.sep) and os.path.isdir(current)
def lock(p):
 s=os.lstat(p);records.append([p,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode)])
 os.chown(p,0,0,follow_symlinks=False)
 if not stat.S_ISLNK(s.st_mode):os.chmod(p,0o700 if stat.S_ISDIR(s.st_mode) else 0o600)
def visit(parent):
 for entry in os.scandir(parent):
  p=entry.path
  if p==current:continue
  if current.startswith(p+os.sep):
   assert entry.is_dir(follow_symlinks=False);visit(p)
  else:lock(p)
try:visit(root)
except BaseException:
 for p,uid,gid,mode in reversed(records):
  os.chown(p,uid,gid,follow_symlinks=False)
  if not os.path.islink(p):os.chmod(p,mode)
 raise
print(json.dumps(records))`;
export const RESTORE_SCRIPT = `import json,os,sys
for p,uid,gid,mode in reversed(json.loads(sys.argv[1])):
 os.chown(p,uid,gid,follow_symlinks=False)
 if not os.path.islink(p):os.chmod(p,mode)`;
/** Restrict other tasks for one tool-active turn, returning an idempotent permission restore. */
export async function isolateWorkspace(cwd) {
  const args = ['exec', '--user', 'root', P.container, 'python3', '-c'];
  const { stdout } = await exec('docker', [...args, ISOLATE_SCRIPT, '/workspace', cwd]);
  const records = JSON.parse(stdout);
  let restored = false;
  return async () => {
    if (restored) return;
    await exec('docker', [...args, RESTORE_SCRIPT, JSON.stringify(records)]);
    restored = true;
  };
}
