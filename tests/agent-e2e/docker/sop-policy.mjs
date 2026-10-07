// 改动说明：同容器验收统一真实CLI路径、预算、用例清单与批准指纹；不实施后端业务准入规则。
import { createHash } from 'node:crypto';
import path from 'node:path';
export const SOP_POLICY = Object.freeze({ project:'hyacinthus-skills-acceptance', container:'hyacinthus-skills-acceptance-pi-1',
  api:'http://127.0.0.1:18012', admin:'http://127.0.0.1:18013', binary:'/opt/real-cli/hyacinthus',
  turnMs:620_000, maxTurns:8, suiteMs:7_200_000, cliMs:150_000, rows:30 });
/** Deny actual CLI socket/connect syscalls while retaining its valid profile and endpoint identity. */
export const NETWORK_DENY_EXEC=`import ctypes,os,sys,socket
lib=ctypes.CDLL('libseccomp.so.2');lib.seccomp_init.argtypes=[ctypes.c_uint32];lib.seccomp_init.restype=ctypes.c_void_p;lib.seccomp_rule_add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint];lib.seccomp_load.argtypes=[ctypes.c_void_p];lib.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]
ctx=lib.seccomp_init(0x7fff0000)
for name in [b'socket',b'connect']:assert lib.seccomp_rule_add(ctx,0x50000|13,lib.seccomp_syscall_resolve_name(name),0)==0
assert ctypes.CDLL(None).prctl(38,1,0,0,0)==0;assert lib.seccomp_load(ctx)==0
try:socket.socket();raise AssertionError('socket not blocked')
except PermissionError:pass
os.execv(sys.argv[1],sys.argv[1:])`;
/** Hash exact evidence bytes without logging them. */
export function sha(value) { return createHash('sha256').update(value).digest('hex'); }
/** Give each full or selected run fresh task folders while preserving a shared folder within that run. */
export function caseWorkspace(root,runId,folder){for(const part of [runId,folder])if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(part))throw new Error('Invalid run or case directory');const workspace=path.join(root,runId,folder);return {workspace,cwd:`/workspace/${runId}/${folder}`,ipc:path.join(workspace,'.sop-ipc')};}
/** Match preview and execution by the actual request body and stable key, rather than mutable filenames. */
export function requestFingerprint(action, request) { return sha(JSON.stringify({action,body:request.body})); }
/** Parse supported flags while preserving every real CLI output option. */
export function flag(argv,key) { const i=argv.indexOf(key); return i>=0 ? argv[i+1] : argv.find(a=>a.startsWith(`${key}=`))?.slice(key.length+1); }
/** Remove only specific flags and their values for an internal full JSON preview. */
export function without(argv, names) { const result=[]; for(let i=0;i<argv.length;i++){if(names.includes(argv[i])){i++;continue;} if(names.some(n=>argv[i].startsWith(`${n}=`)))continue; result.push(argv[i]);} return result; }
/** Identify the permitted semantic command; every alternate raw write route fails closed. */
export function callKind(argv, scopes) {
  const local=without(argv,['--format','--jq','-q','--request-id']);
  const args=local.filter(a=>!['--no-notice','--verbose'].includes(a));
  if(args.some(a=>['--base-url','--profile','--token','--instance-id'].some(f=>a===f||a.startsWith(`${f}=`))))throw new Error('Test instance and profile cannot be overridden');
  const action=args.slice(0,args[0]==='requirements'&&args[1]==='priority-rules'?3:2).join(' ');
  const safe=['config show','config list-profiles','auth status','auth check','auth scopes','auth login','auth wait','auth revoke','auth token','requirements search','requirements options','requirements parse','requirements parse-job','requirements import','requirements priority-rules list','requirements priority-rules add','user me','user update','capability list','capability schema','capability diff','skills list','skills read'];
  if(!args.includes('--help')&&!args.includes('-h')&&!['schema','doctor','help','--version'].includes(args[0])&&!safe.includes(action))throw new Error(`Unrequested CLI action: ${action}`);
  if(action==='auth token'&&args[2]!=='status')throw new Error('Token disclosure is not permitted');
  if(action==='auth login') { const required=(flag(argv,'--scope')||'').split(/[,\s]+/).filter(Boolean); if(!required.length||required.some(s=>!scopes.includes(s)))throw new Error('Authorization exceeds this task scopes'); if(args.includes('--wait'))throw new Error('Share the authorization link before waiting'); }
  const writes=['requirements import','user update','requirements priority-rules add'].includes(action)&&!args.includes('--dry-run')&&!args.includes('--help');
  return {action:args[0]==='doctor'?'doctor':action,writes};
}

/** Require a visible confirmation request from this turn before the host grants a write. */
export function confirmationRequested(reply,rowCount){const text=(reply.assistantMessages||[reply.text]).join('\n');if(!/确认|批准|是否|同意/.test(text))throw new Error('Agent did not request user confirmation');if(rowCount>1&&!text.includes(String(rowCount)))throw new Error('Agent did not show the approved batch count');}
