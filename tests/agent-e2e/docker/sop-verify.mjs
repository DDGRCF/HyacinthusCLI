// 改动说明：核对21字段及未提供联系方式、解析优先级在完整预览中的保留及入库字段。
import assert from 'node:assert/strict';
import { NORMALIZED_LABELS } from '../lib/verify.mjs';
import { GEO_FIXTURE } from './geo-fixture.mjs';
/** Accept the two literal hyphen spellings of this exact prefix, rejecting broader patterns. */
export function prefixRuleMatches(rule,runId){return rule.priority===5&&rule.enabled===true&&[ `^${runId}-`, `^${runId}\\-` ].includes(rule.pattern);}
/** Verify replay counts and source identity without treating historical imports as new writes. */
export function verifyReplayReport(report,messageId,rows){assert.equal(report.source_message_id,messageId);assert.equal(report.already_imported,rows);assert.equal(report.new_created,0);assert.equal(report.failed,0);return {alreadyImported:rows,newCreated:0,failed:0};}
/** Read quoted CSV records, including escaped quotes and embedded newlines, without changing values. */
export function csvRecords(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(quoted)quoted=false;else{assert.equal(field,'','Unexpected quote in CSV field');quoted=true;}}else if(!quoted&&c===','){row.push(field);field='';}else if(!quoted&&(c==='\n'||c==='\r')){row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';if(c==='\r'&&text[i+1]==='\n')i++;}else field+=c;}assert.ok(!quoted,'Unclosed CSV quote');if(field||row.length){row.push(field);if(row.some(v=>v.trim()))rows.push(row);}return rows;}
/** Convert a valid twenty-one-column CSV to label text; metadata CSV must fail instead of being silently ignored. */
export function normalizedLabelText(name,text){if(!name.toLowerCase().endsWith('.csv'))return text;const rows=csvRecords(text.replace(/^\uFEFF/,''));assert.deepEqual(rows.shift(),NORMALIZED_LABELS,'Normalized CSV must contain exactly the twenty-one ordered fields');return rows.map(row=>{assert.equal(row.length,NORMALIZED_LABELS.length,'Normalized CSV row width changed');return row.map((v,i)=>`${NORMALIZED_LABELS[i]}：${v.replace(/\r?\n/g,' ')}`).join('\n');}).join('\n\n');}
/** Accept the schema's hour and the backend parser's hourly without accepting other billing units. */
export function isHourlyBilling(value){return value==='hour'||value==='hourly';}
/** Compare every required source field, optionally including persisted identity and applied priority. */
export function sourceRows(rows,expected,{persisted=false,parsedRows=[]}={}){
 assert.equal(rows.length,expected.length);
 for(const e of expected){const matches=rows.filter(r=>r.requirement_code===e.code);assert.equal(matches.length,1,`Missing/duplicate ${e.code}`);const r=matches[0];
 assert.equal(r.requirement_type,'tutoring');assert.equal(r.preferred_mode,'online');assert.equal(r.address_detail,GEO_FIXTURE.address);
 if(persisted){assert.ok(Number.isFinite(r.location?.lng)&&Number.isFinite(r.location?.lat),'Persisted row lacks actual backend location');assert.ok(r.location.lng>119&&r.location.lng<121&&r.location.lat>29&&r.location.lat<31,'Persisted location outside the declared Hangzhou fixture');}
 else if(r.location){const parsed=parsedRows.find(p=>p.requirement_code===e.code);assert.ok(parsed?.location,'Preview coordinates lack actual backend parse evidence');assert.deepEqual(r.location,parsed.location,'Agent changed backend parsed coordinates');}
 if(persisted){assert.ok(r.id>0);assert.deepEqual(r.subject_names,['数学']);assert.deepEqual(r.grade_names,['初一']);assert.equal(r.ext.priority,5);}
 else{assert.equal(r.subject_ids?.length,1);assert.equal(r.grade_ids?.length,1);const parsed=parsedRows.find(p=>p.requirement_code===e.code);if(parsed){assert.equal(parsed.ext?.priority,5,'Backend parser did not apply the test prefix rule');assert.equal(r.ext?.priority,parsed.ext.priority,`Preview dropped parsed priority for ${e.code}`);}}
 assert.equal(r.compensation.currency,'CNY');assert.equal(Number(r.compensation.amount_min),e.amount);assert.equal(Number(r.compensation.amount_max),e.amount);assert.ok(isHourlyBilling(r.compensation.billing_period),'Expected an explicit hourly billing unit');
 assert.equal(r.condition.requester_role,'parent');assert.equal(r.condition.requester_gender??null,null,'Invented parent gender');assert.match(r.description,/男生|学生.{0,6}男/,'Student gender lost');assert.equal(r.condition.required_gender,'female');assert.deepEqual(r.condition.required_education_levels,['bachelor']);assert.equal(r.condition.requester_education_level??null,null);for(const field of ['required_school_names','required_school_tiers','required_school_ids'])assert.deepEqual(r.condition[field]??[],[]);
 assert.equal(r.condition.required_occupation??null,null);assert.match(r.description,/家教经验|有经验/);assert.equal(r.ext.admin_contact_phone,'13800138000');for(const field of ['user_contact_phone','user_contact_wechat','admin_contact_wechat'])assert.equal(r.ext[field]??null,null,`Invented contact: ${e.code}/${field}`);
 assert.equal(r.weekly_frequency_min,1);assert.equal(r.weekly_frequency_max,1);assert.equal(r.session_duration_minutes_min,120);assert.equal(r.session_duration_minutes_max,120);
 assert.ok(r.time_slots.some(s=>s.weekday===6&&s.start_minute===840&&s.end_minute===960));}
 if(persisted)assert.equal(new Set(rows.map(r=>r.id)).size,expected.length);
 return {rows:expected.length,allSourceFieldsMatched:true,persisted};
}
/** Verify that a selected run kept the exact product and persisted identities from a successful full run. */
export function verifyRunReuse(previous,current,originalRows,currentRows,expected){
 assert.equal(previous.kind,'full');assert.equal(previous.status,'passed');
 const fields=['container_id','image_id','cli_hash','skills_hash'];
 for(const field of fields)assert.equal(current[field],previous.fingerprint[field],`Selected run changed ${field}`);
 assert.equal(currentRows.length,originalRows.length);assert.equal(originalRows.length,30);
 for(let i=0;i<originalRows.length;i++)for(const field of ['id','requirement_code','created_at'])assert.deepEqual(currentRows[i][field],originalRows[i][field],`Selected run changed persisted ${field}`);
 sourceRows(currentRows,expected,{persisted:true});
 return {sourceRunId:previous.runId,sameContainer:true,sameImage:true,sameCLI:true,sameSkills:true,preservedRows:30,preservedIdsAndCreationTimes:true,allSourceFieldsMatched:true,checkedFingerprints:fields};
}
/** Generate a reproducible source; only its run prefix varies between independent complete runs. */
export function mailFixture(runId){const expected=Array.from({length:30},(_,i)=>({code:`${runId}-${String(i+1).padStart(3,'0')}`,amount:100+i}));
 const mail=`已保存的合成邮件样本\nmessage_id: ${runId}-mail\n发件人: fixture@example.invalid\n主题: 线上初一数学家教岗位\n发送时间: 2026-10-06T09:00:00+08:00\n整组说明：全部为线上一对一，岗位类型 tutoring，授课方式 online，管理员联系电话 13800138000。登记地址为本次验收明确提供的${GEO_FIXTURE.address}，不创建任何科目或年级目录。\n\n${expected.map(e=>`编号：${e.code}\n年级科目：初一，数学\n学员情况：家长发布，学生为男生\n每周次数：1次（周六）\n每次时长：2小时（14:00-16:00）\n对老师的要求：女老师，本科，有家教经验\n薪酬：${e.amount}元/小时\n地址：${GEO_FIXTURE.address}\n备注：仅线上一对一，授课方式online`).join('\n\n')}`;
 return {expected,mail,messageId:`${runId}-mail`};}
