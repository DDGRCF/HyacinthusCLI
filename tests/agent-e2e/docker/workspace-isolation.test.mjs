// 改动说明：验证目录隔离脚本只锁兄弟任务，并保留原权限与所有权用于恢复。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ISOLATE_SCRIPT, RESTORE_SCRIPT } from './workspace-isolation.mjs';
test('workspace selection excludes the active tree and restores every changed entry', () => {
  const mock = `import os,json,runpy,stat,sys
class Entry:
 def __init__(self,p):self.path=p
 def is_dir(self,follow_symlinks=False):return True
tree={'/workspace':['/workspace/old','/workspace/current'],'/workspace/current':['/workspace/current/a','/workspace/current/b']}
changes=[]
os.path.realpath=lambda p:p;os.path.isdir=lambda p:True;os.path.islink=lambda p:False
os.scandir=lambda p:[Entry(v) for v in tree[p]]
os.lstat=lambda p:type('S',(),{'st_uid':1000,'st_gid':1000,'st_mode':stat.S_IFDIR|0o755})()
os.chown=lambda *a,**k:changes.append(('owner',*a));os.chmod=lambda *a:changes.append(('mode',*a))
sys.argv=['isolate','/workspace','/workspace/current/a'];exec(${JSON.stringify(ISOLATE_SCRIPT)})
assert len(changes)==4
assert all('/current/a' not in str(c) for c in changes)
sys.argv=['restore',json.dumps([['/workspace/old',1000,1000,493],['/workspace/current/b',1000,1000,493]])];exec(${JSON.stringify(RESTORE_SCRIPT)})
assert changes[-1]==('mode','/workspace/old',493)
`;
  assert.doesNotThrow(() => execFileSync('python3', ['-c', mock], {stdio:'pipe'}));
});
