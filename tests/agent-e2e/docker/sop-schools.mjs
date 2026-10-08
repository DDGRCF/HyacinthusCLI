// 改动说明：真实学校查询核对独立来源、候选、未知结果和当前目录覆盖。
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

/** Exercise a fresh Agent conversation, then verify additional actual CLI boundaries separately. */
export async function schoolQueryCase({definition,session,close,readCLI,evidence,runId}){
 const pi=await session('C3');
 try{
  const reply=await pi.task(definition.prompt);
  const calls=pi.broker.events.filter(e=>e.action==='requirements catalog schools'&&e.result?.ok);
  assert.ok(calls.length>=2,'Agent did not actually query both schools');
  const zju=calls.flatMap(e=>e.result.data.items).find(s=>s.name==='浙江大学');
  assert.ok(zju,'Missing actual Zhejiang University result');
  assert.deepEqual([zju.is_985,zju.is_211,zju.is_double_first_class],[true,true,true]);
  const candidates=calls.flatMap(e=>e.result.data.items).filter(s=>s.name.includes('中国矿业大学'));
  assert.equal(new Set(candidates.map(s=>s.id)).size,2,'Agent did not retrieve both mining universities');
  assert.match(reply.text,/中国矿业大学.*北京|中国矿业大学（北京）/s);
  assert.match(reply.text,/来源|教育部|名单/);
  assert.match(reply.text,/20\d\d/);
  for(const call of calls)verifySchoolSnapshot(call.result.data);
  const unknown=await pi.task(definition.unknownPrompt.replaceAll('{run_id}',runId));
  assert.ok(pi.broker.events.some(e=>e.action==='requirements catalog schools'&&e.result?.ok&&e.argv.some(arg=>arg.includes(`虚构校名-${runId}`))&&e.result.data.total===0),'Agent did not query the unknown name');
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
  ]){
   const data=await readCLI(pi,['requirements','catalog','schools',...flags]);
   verifySchoolSnapshot(data);assert.deepEqual(data.catalog,calls[0].result.data.catalog,'Directory changed between queries');engineering.push({flags,data});
  }
  assert.equal(engineering[0].data.items[0].match_kind,'alias');
  assert.equal(engineering[1].data.items[0].match_kind,'code');
  assert.equal(engineering[2].data.items[0].match_kind,'id');
  assert.equal(engineering[3].data.total,2);assert.equal(engineering[3].data.has_more,true);
  assert.equal(engineering[4].data.has_more,false);assert.notEqual(engineering[3].data.items[0].id,engineering[4].data.items[0].id);
  assert.equal(engineering[5].data.total,2);assert.equal(engineering[5].data.items.length,0);
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
  return {session_id:pi.discovery.sessionId,agentQueries:calls.length,engineeringQueries:engineering.length,sourceSnapshotVerified:true,ambiguousCandidates:2,unknownNotInferred:true,militaryCoverage:true,readOnly:true};
 }finally{await close(pi);}
}
