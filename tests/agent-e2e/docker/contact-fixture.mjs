// 改动说明：以独立工程样本验证20列及用户/管理员联系角色，实际调用同容器CLI、API和Worker。
import assert from 'node:assert/strict';
import { containerCLI } from './container-broker.mjs';
import { NORMALIZED_LABELS } from '../lib/verify.mjs';
import { GEO_FIXTURE } from './geo-fixture.mjs';

/** Parse a separate synthetic role fixture without supplying this payload to the model or importing a requirement. */
export async function contactFieldProbe(control,runId,{invoke=containerCLI}={}){
 const values={'编号':`${runId}-CONTACT-PROBE`,'年级':'初一','科目':'数学','需求方角色':'家长','需求方性别':'男','需求方学历':'','要求的性别':'女','要求的学历':'本科','要求的学校':'','学校的资质':'','授课方式':'online','要求的资格':'有家教经验','薪酬':'100元/小时','时间':'每周1次，周六14:00-16:00，每次2小时','地址':GEO_FIXTURE.address,'要求':'','备注':'仅线上一对一','用户联系方式':'13800138001','管理员电话':'13800138000','管理员微信':'wxid_sop_admin'};
 const text=NORMALIZED_LABELS.map(label=>`${label}：${values[label]}`).join('\n');
 const response=await invoke(control,['requirements','parse','--text',text]);
 assert.equal(response.exitCode,0,'20-field role probe CLI failed');const result=JSON.parse(response.stdout);
 assert.equal(result.ok,true);assert.equal(result.data.rows.length,1);const row=result.data.rows[0];
 assert.deepEqual(row.errors,[]);assert.equal(row.parsed.preferred_mode,'online');
 assert.equal(row.parsed.ext.user_contact_phone,'13800138001');assert.equal(row.parsed.ext.admin_contact_phone,'13800138000');assert.equal(row.parsed.ext.admin_contact_wechat,'wxid_sop_admin');
 assert.ok(!row.parsed.ext.remark.includes('1380013800'),'Contacts were moved into remarks');
 return {actor:'test-controller',type:'real-CLI-API-Worker-engineering',modelReceivedProbe:false,businessWrites:0,inputFields:NORMALIZED_LABELS.length,rolesSeparated:true,result};
}
