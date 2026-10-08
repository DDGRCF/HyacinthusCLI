// 改动说明：学校验收保留全部相关候选，逐校核对资质并区分精确、模糊和三页结果。
import assert from 'node:assert/strict';

/** Require the reviewed source snapshot even for empty pages. */
export function verifySchoolSnapshot(data){
 assert.deepEqual(data.catalog.sources.map(s=>s.kind).sort(),['official_schools','985','211','double_first_class'].sort());
 for(const source of data.catalog.sources){assert.match(source.url,/^https:\/\//);assert.ok(source.version);}
 assert.deepEqual(data.catalog.data_files.map(f=>f.file).sort(),['official_schools.csv','school_tiers.csv','school_aliases.csv','school_sources.csv','school_supplements.csv','school_tier_mappings.csv'].sort());
 for(const file of data.catalog.data_files)assert.match(file.sha256,/^[a-f0-9]{64}$/);
 assert.ok(data.catalog.coverage);
 for(const item of data.items){
  assert.ok(item.source_url&&item.source_version&&item.synced_at);
  const positive=[['is_985','985'],['is_211','211'],['is_double_first_class','double_first_class']].filter(([field])=>item[field]).map(([,tier])=>tier).sort();
  assert.deepEqual(item.qualification_evidence.map(e=>e.qualification).sort(),positive);
  for(const proof of item.qualification_evidence)assert.ok(proof.listed_name&&proof.source_url&&proof.source_version);
 }
}

/** Require all three mining-name matches and keep the independent college unqualified. */
export function verifyMiningSchoolCandidates(items){
 assert.deepEqual(items.map(s=>s.name).sort(),['中国矿业大学','中国矿业大学（北京）','中国矿业大学徐海学院'].sort(),'Missing or unexpected mining-name candidate');
 assert.equal(new Set(items.map(s=>s.id)).size,3,'Related schools must have distinct identities');
 for(const school of items){
  const expected=school.name==='中国矿业大学徐海学院'?[false,false,false]:[false,true,true];
  assert.deepEqual([school.is_985,school.is_211,school.is_double_first_class],expected,`Incorrect independent qualifications: ${school.name}`);
 }
}

/** Check fuzzy Zhejiang results while keeping each college’s qualifications separate. */
export function verifyZhejiangSchoolCandidates(items){
 assert.deepEqual(items.map(s=>s.name).sort(),['浙江大学','浙大城市学院','浙大宁波理工学院'].sort(),'Missing or unexpected fuzzy Zhejiang candidate');
 assert.equal(new Set(items.map(s=>s.id)).size,3,'Related schools must have distinct identities');
 for(const school of items)assert.deepEqual([school.is_985,school.is_211,school.is_double_first_class],school.name==='浙江大学'?[true,true,true]:[false,false,false],`Incorrect independent qualifications: ${school.name}`);
}

/** Require all returned candidates in the answer and reject an explicit choice or recommendation. */
export function verifySchoolQueryReply(text,returnedItems=[]){
 for(const school of returnedItems)assert.ok(text.includes(school.name),`Answer omitted returned candidate ${school.name}`);
 for(const name of ['中国矿业大学（北京）','中国矿业大学徐海学院'])assert.ok(text.includes(name),`Answer omitted ${name}`);
 assert.match(text,/中国矿业大学(?![（(]|徐海)/,'Answer omitted the main mining university');
 assert.doesNotMatch(text,/已(?:为你|替你)?(?:选择|选定)|(?:推荐|建议)(?:你|您)?(?:选择|选定)/,'Answer selected or recommended one candidate');
 assert.match(text,/来源|教育部|名单/);assert.match(text,/20\d\d/);
}

/** Exercise a fresh Agent conversation, then verify additional actual CLI boundaries separately. */
export async function schoolQueryCase({definition,session,close,readCLI,evidence,runId}){
 const pi=await session('C3');
 try{
  const reply=await pi.task(definition.prompt);
  const calls=pi.broker.events.filter(e=>e.action==='requirements catalog schools'&&e.result?.ok);
  await evidence('C3','agent-queries.json',calls);
  assert.ok(calls.length>=2,'Agent did not actually query both schools');
  const zju=calls.flatMap(e=>e.result.data.items).find(s=>s.name==='浙江大学');
  assert.ok(zju,'Missing actual Zhejiang University result');
  assert.deepEqual([zju.is_985,zju.is_211,zju.is_double_first_class],[true,true,true]);
  const candidates=[...new Map(calls.flatMap(e=>e.result.data.items).filter(s=>s.name.includes('中国矿业大学')).map(s=>[s.id,s])).values()];
  verifyMiningSchoolCandidates(candidates);
  verifySchoolQueryReply(reply.text,calls.flatMap(e=>e.result.data.items));
  for(const call of calls)verifySchoolSnapshot(call.result.data);
  const unknown=await pi.task(definition.unknownPrompt.replaceAll('{run_id}',runId));
  const unknownCalls=pi.broker.events.filter(e=>e.action==='requirements catalog schools'&&e.result?.ok&&e.argv.some(arg=>arg.includes(`虚构校名-${runId}`)));
  await evidence('C3','agent-unknown.json',{text:unknown.text,calls:unknownCalls});
  assert.ok(unknownCalls.some(e=>e.result.data.total===0&&e.result.data.items.length===0),'Agent did not query the unknown name');
  for(const call of unknownCalls)verifySchoolSnapshot(call.result.data);
  assert.match(unknown.text,/不能|无法|不代表|不等于|不意味着/);
  assert.ok(!pi.broker.events.some(e=>e.writes||e.denied),'School lookup attempted a write or forbidden command');
  const engineering=[];
  for(const flags of [
   ['--keyword','浙大','--exact'],['--keyword',zju.school_code,'--exact'],['--id',String(zju.id)],
   ['--keyword','中国矿业大学','--limit','1'],['--keyword','中国矿业大学','--skip','1','--limit','1'],
   ['--keyword','中国矿业大学','--skip','99'],['--keyword','%'],['--keyword','_'],
   ['--keyword','海军军医大学','--exact'],['--province','浙江省','--tier','211'],
   ['--keyword','南大','--exact'],['--keyword','湖大','--exact'],
   ['--keyword','宁大','--exact'],['--keyword','西财','--exact'],['--keyword','华工','--exact'],
   ['--keyword','中国矿业大学','--skip','2','--limit','1'],['--keyword','浙大'],
  ]){
   const data=await readCLI(pi,['requirements','catalog','schools',...flags]);
   verifySchoolSnapshot(data);assert.deepEqual(data.catalog,calls[0].result.data.catalog,'Directory changed between queries');engineering.push({flags,data});
  }
  assert.equal(engineering[0].data.total,1);assert.equal(engineering[0].data.items.length,1);
  assert.equal(engineering[0].data.items[0].name,'浙江大学');assert.equal(engineering[0].data.has_more,false);
  assert.equal(engineering[0].data.items[0].match_kind,'alias');
  assert.equal(engineering[1].data.items[0].match_kind,'code');
  assert.equal(engineering[2].data.items[0].match_kind,'id');
  const pages=[engineering[3].data,engineering[4].data,engineering[15].data];
  for(const page of pages){assert.equal(page.total,3);assert.equal(page.items.length,1);}
  assert.deepEqual(pages.map(page=>page.has_more),[true,true,false]);
  verifyMiningSchoolCandidates(pages.flatMap(page=>page.items));
  assert.equal(engineering[5].data.total,3);assert.equal(engineering[5].data.items.length,0);assert.equal(engineering[5].data.has_more,false);
  verifyZhejiangSchoolCandidates(engineering[16].data.items);assert.equal(engineering[16].data.total,3);assert.equal(engineering[16].data.has_more,false);
  assert.equal(engineering[6].data.total,0);assert.equal(engineering[7].data.total,0);
  const military=engineering[8].data.items[0];assert.equal(military.name,'海军军医大学');
  assert.equal(military.is_985,false);assert.equal(military.is_211,true);assert.equal(military.is_double_first_class,true);
  assert.equal(military.school_code,null);assert.equal(military.province,null);
  assert.ok(engineering[9].data.items.every(s=>s.province==='浙江省'&&s.is_211));
  assert.deepEqual(engineering[10].data.items.map(s=>s.name).sort(),['南京大学','南昌大学'].sort());
  assert.deepEqual(engineering[11].data.items.map(s=>s.name).sort(),['湖南大学','湖北大学'].sort());
  assert.deepEqual(engineering[12].data.items.map(s=>s.name).sort(),['宁波大学','宁夏大学'].sort());
  assert.deepEqual(engineering[13].data.items.map(s=>s.name).sort(),['西南财经大学','西安财经大学'].sort());
  assert.deepEqual(engineering[14].data.items.map(s=>s.name).sort(),['华南理工大学','华中科技大学'].sort());
  await evidence('C3','agent-queries.json',calls);await evidence('C3','engineering-queries.json',engineering);
  return {session_id:pi.discovery.sessionId,agentQueries:calls.length,engineeringQueries:engineering.length,sourceSnapshotVerified:true,ambiguousCandidates:candidates.length,unknownNotInferred:true,militaryCoverage:true,readOnly:true};
 }finally{await close(pi);}
}
