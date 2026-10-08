// 改动说明：学校验收拒绝缺来源、缺文件摘要和错误资质证据，并检查v5依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifySchoolSnapshot } from './sop-schools.mjs';

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
