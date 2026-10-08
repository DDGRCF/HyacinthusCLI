// 改动说明：覆盖学校完整data投影、全部候选及来源快照，不接受遗漏院校。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { schoolQueryCase, verifySchoolSnapshot, verifyMiningSchoolCandidates, verifyZhejiangSchoolCandidates, verifySchoolQueryReply } from './sop-schools.mjs';

/** Build the smallest complete evidence record for a known 985 school. */
function fixture(){return {catalog:{coverage:'reviewed schools',sources:['official_schools','985','211','double_first_class'].map(kind=>({kind,url:'https://www.moe.gov.cn/',version:'2026'})),data_files:['official_schools.csv','school_tiers.csv','school_aliases.csv','school_sources.csv','school_supplements.csv','school_tier_mappings.csv'].map(file=>({file,sha256:'a'.repeat(64)}))},items:[{is_985:true,is_211:false,is_double_first_class:false,source_url:'https://www.moe.gov.cn/',source_version:'2026',synced_at:'2026-10-08',qualification_evidence:[{qualification:'985',listed_name:'浙江大学',source_url:'https://www.moe.gov.cn/',source_version:'2006'}]}]};}
test('school provenance covers the complete source snapshot and matches every positive fact',()=>{
 verifySchoolSnapshot(fixture());
 for(const change of [v=>v.catalog.sources.pop(),v=>v.catalog.data_files.pop(),v=>v.catalog.data_files[0].sha256='bad',v=>v.items[0].qualification_evidence=[],v=>v.items[0].is_211=true]){
  const value=fixture();change(value);assert.throws(()=>verifySchoolSnapshot(value));
 }
 const empty=fixture();empty.items=[];verifySchoolSnapshot(empty);
});
test('v5 adds a readonly school conversation with valid dependencies',async()=>{
 const spec=JSON.parse(await readFile(new URL('../cases/sop-v5.json',import.meta.url)));
 assert.equal(spec.version,'sop-v5');assert.equal(spec.cases.length,15);
 const visited=new Set();for(const c of spec.cases){assert.ok(c.dependsOn.every(id=>visited.has(id)));visited.add(c.id);}
 const school=spec.cases.find(c=>c.id==='C3');assert.equal(school.type,'mixed');assert.deepEqual(school.scopes,['requirements:read']);assert.ok(school.prompt&&school.unknownPrompt);
});

/** Build a named school with its own fact flags and exactly matching positive proof rows. */
function school(name,id,flags,match_kind='partial'){
 const base=fixture().items[0];
 return {...base,name,id,school_code:String(4100000000+id),province:'浙江省',match_kind,is_985:flags[0],is_211:flags[1],is_double_first_class:flags[2],qualification_evidence:['985','211','double_first_class'].filter((_,i)=>flags[i]).map(qualification=>({qualification,listed_name:name,source_url:'https://www.moe.gov.cn/',source_version:'2026'}))};
}
/** Return one complete response envelope with controllable paging. */
function schoolPage(items,total=items.length,has_more=false){return {...fixture(),items,total,has_more};}
/** Keep the test's related entities separate, including the three unqualified colleges. */
function families(){return {
 mining:[school('中国矿业大学',128,[false,true,true],'name'),school('中国矿业大学（北京）',130,[false,true,true]),school('中国矿业大学徐海学院',129,[false,false,false])],
 zhejiang:[school('浙江大学',1830,[true,true,true],'alias'),school('浙大城市学院',1814,[false,false,false]),school('浙大宁波理工学院',1815,[false,false,false])],
};}

test('all three mining-prefix candidates are valid and the college never inherits qualifications',()=>{
 const {mining}=families();verifyMiningSchoolCandidates(mining);verifySchoolSnapshot(schoolPage(mining));
 assert.throws(()=>verifyMiningSchoolCandidates(mining.slice(0,2)),/Missing or unexpected/);
 const inherited=structuredClone(mining);inherited[2].is_211=true;inherited[2].is_double_first_class=true;
 assert.throws(()=>verifyMiningSchoolCandidates(inherited),/Incorrect independent qualifications/);
 assert.throws(()=>verifySchoolSnapshot(schoolPage(inherited)));
 const sameID=structuredClone(mining);sameID[2].id=sameID[0].id;assert.throws(()=>verifyMiningSchoolCandidates(sameID),/distinct identities/);
});
test('fuzzy Zhejiang includes colleges, while their fact flags and proofs stay separate',()=>{
 const {zhejiang}=families();verifyZhejiangSchoolCandidates(zhejiang);verifySchoolSnapshot(schoolPage(zhejiang));
 assert.throws(()=>verifyZhejiangSchoolCandidates(zhejiang.slice(0,1)),/Missing or unexpected/);
 const inherited=structuredClone(zhejiang);inherited[1].is_985=true;assert.throws(()=>verifyZhejiangSchoolCandidates(inherited),/Incorrect independent qualifications/);
});
test('user answer names every returned candidate and leaves all of them unselected',()=>{
 const {mining,zhejiang}=families();const text='教育部2026名单：'+[...mining,...zhejiang].map(s=>s.name).join('、')+'。全部列出，未做取舍。';
 verifySchoolQueryReply(text,[...mining,...zhejiang]);
 assert.throws(()=>verifySchoolQueryReply(text.replace('中国矿业大学徐海学院','独立学院'),mining),/omitted/);
 assert.throws(()=>verifySchoolQueryReply(text.replace('浙大城市学院','城市学院'),zhejiang),/omitted/);
 assert.throws(()=>verifySchoolQueryReply(text+'建议选择中国矿业大学（北京）'),/selected or recommended/);
 assert.throws(()=>verifySchoolQueryReply(text.replace('未做取舍','已为你选定中国矿业大学（北京）')),/unselected|selected/);
});
test('ordinary confirmation wording and a neutral complete list do not require a fixed denial phrase',()=>{
 const {mining,zhejiang}=families();const names=[...mining,...zhejiang].map(s=>s.name).join('、');
 for(const ending of ['以下全部候选，请确认具体学校。','需确认具体学校。','需要确认具体学校。','待确认具体学校。','请明确具体学校。','请从候选中确认学校。','']){
  verifySchoolQueryReply('教育部2026名单：'+names+'。'+ending,[...mining,...zhejiang]);
 }
});
test('three-candidate conversation proceeds to the actual unknown call and all 17 engineering reads',async()=>{
 const {mining,zhejiang}=families();const events=[],reads=[],saved=[];let tasks=0,closed=false;
 const event=(keyword,data)=>({action:'requirements catalog schools',exitCode:0,argv:['requirements','catalog','schools','--keyword',keyword,...(keyword==='浙大'?[]:['--jq','.data'])],result:keyword==='浙大'?{ok:true,data}:data});
 const pi={broker:{events},discovery:{sessionId:'unit-C3'},async task(){
  tasks++;
  if(tasks===1){events.push(event('中国矿业大学',schoolPage(mining)),event('浙大',schoolPage(zhejiang)));return {text:'教育部2026名单：'+[...mining,...zhejiang].map(s=>s.name).join('、')+'。未替你选定。'};}
  events.push(event('虚构校名-unit',schoolPage([])));return {text:'本次筛选无结果，不能认定没有211资质。'};
 }};
 const pairFacts={'南京大学':[true,true,true],'南昌大学':[false,true,true],'湖南大学':[true,true,true],'湖北大学':[false,false,false],'宁波大学':[false,false,true],'宁夏大学':[false,true,true],'西南财经大学':[false,true,true],'西安财经大学':[false,false,false],'华南理工大学':[true,true,true],'华中科技大学':[true,true,true]};
 const pairs={南大:['南京大学','南昌大学'],湖大:['湖南大学','湖北大学'],宁大:['宁波大学','宁夏大学'],西财:['西南财经大学','西安财经大学'],华工:['华南理工大学','华中科技大学']};
 const summary=await schoolQueryCase({definition:{prompt:'original prompt',unknownPrompt:'虚构校名-{run_id}'},session:async()=>pi,close:async()=>{closed=true;},runId:'unit',evidence:async(_id,file,data)=>{saved.push({file,data});},readCLI:async(_pi,argv)=>{
  reads.push(argv);const value=flag=>{const i=argv.indexOf(flag);return i<0?undefined:argv[i+1];};const key=value('--keyword');const exact=argv.includes('--exact');
  if(key==='中国矿业大学'){const skip=Number(value('--skip')??0);return schoolPage(mining.slice(skip,skip+1),3,skip<2);}
  if(key==='浙大')return schoolPage(exact?[zhejiang[0]]:zhejiang);
  if(key===zhejiang[0].school_code)return schoolPage([{...zhejiang[0],match_kind:'code'}]);
  if(value('--id'))return schoolPage([{...zhejiang[0],match_kind:'id'}]);
  if(key==='%'||key==='_')return schoolPage([]);
  if(key==='海军军医大学')return schoolPage([{...school('海军军医大学',2900,[false,true,true],'name'),school_code:null,province:null}]);
  if(pairs[key])return schoolPage(pairs[key].map((name,i)=>school(name,3000+i,pairFacts[name],'alias')));
  if(value('--province'))return schoolPage([zhejiang[0]]);
  throw new Error('Unrecognized engineering flags '+argv.join(' '));
 }});
 assert.equal(tasks,2);assert.equal(reads.length,17);assert.equal(summary.ambiguousCandidates,3);assert.equal(summary.engineeringQueries,17);assert.equal(summary.unknownNotInferred,true);assert.equal(closed,true);
 assert.ok(saved.some(s=>s.file==='agent-unknown.json'&&s.data.calls.length===1));
 const engineering=saved.find(s=>s.file==='engineering-queries.json').data;
 assert.deepEqual([engineering[3],engineering[4],engineering[15]].map(e=>[e.data.total,e.data.has_more]),[[3,true],[3,true],[3,false]]);
 assert.equal(engineering[0].data.total,1);assert.equal(engineering[16].data.total,3);
});
