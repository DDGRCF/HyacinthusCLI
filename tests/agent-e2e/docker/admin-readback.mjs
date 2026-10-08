// 改动说明：宿主独立管理员读取完整详情；遇到会话过期只重新登录并重试一次，不把凭据交给Pi。
import assert from 'node:assert/strict';
/** Return a host-only requirement reader with account/rule snapshots for unauthenticated dry-run cases. */
export function createAdminRequirementReader({api,admin,password}){
 let credentials;let authenticationCount=0;
 /** Establish one administrator session using the API's exact browser transport checks. */
 async function authenticate(){credentials||=(async()=>{const r=await fetch(`${api}/api/v1/admin/auth/sessions/password`,{method:'POST',headers:{'Content-Type':'application/json',Origin:admin,'Sec-Fetch-Site':'same-site'},body:JSON.stringify({username:'rust-e2e-admin@hyacinthus.local',password}),signal:AbortSignal.timeout(30_000)});assert.equal(r.status,200,'Independent test administrator login failed');const json=await r.json();assert.equal(json.code,0);assert.ok(json.data.access_token);authenticationCount++;return json.data;})();return credentials;}
 /** Read actual admin data without persisting the transport token. */
 async function read(route){
 /** Retry only this readonly request once after a rejected administrator session. */
 const request=auth=>fetch(`${api}/api/v1/admin${route}`,{headers:{Authorization:`Bearer ${auth.access_token}`,Origin:admin,'Sec-Fetch-Site':'same-site'},signal:AbortSignal.timeout(30_000)});
 let response=await request(await authenticate());if(response.status===401){credentials=undefined;response=await request(await authenticate());}
 assert.equal(response.status,200,`Independent detail read failed: ${route}`);const json=await response.json();assert.equal(json.code,0);return json.data;}
 /** Read full requirement fields by a positively identified persisted ID. */
 async function requirement(id){assert.ok(Number.isSafeInteger(id)&&id>0);const data=await read(`/requirements/${id}`);assert.equal(data.id,id);return data;}
 /** Snapshot the authenticated test account without requiring a Pi business grant. */
 requirement.currentUser=async()=>{const auth=await authenticate();const data=await read(`/users/${auth.principal.user_id}`);assert.equal(data.id,auth.principal.user_id);return data;};
 /** Snapshot rule state before business approval without adding Agent permissions. */
 requirement.rules=()=>read('/requirements/priority-rules/list');
 /** Expose only authentication counts for expiry evidence, never transport credentials. */
 requirement.authenticationCount=()=>authenticationCount;
 return requirement;
}
