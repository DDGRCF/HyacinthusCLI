// 改动说明：回归完整CLI data来源、失败和非法投影边界，以及帮助和被拒绝命令尝试的区分。
import assert from 'node:assert/strict';
import test from 'node:test';
import { cliData, isCliCommand } from './cli-evidence.mjs';

/** Build an output observation without executing any CLI or live service. */
function observation(overrides={}){
 return {action:'requirements search',exitCode:0,argv:['requirements','search'],result:{ok:true,data:{items:[],total:0}},...overrides};
}

test('complete envelope and explicit data projections preserve the original data',()=>{
 const data={items:[],total:0};
 for(const argv of [[],['--jq','.'],['--jq= . '],['-q','.'],['--jq','']]){
  const event=observation({argv,result:{ok:true,data}});
  assert.equal(cliData(event),data);assert.deepEqual(event.result,{ok:true,data});
 }
 for(const argv of [['--jq','.data'],['--jq= .data '],['-q','.data'],['-q=.data']]){
  const event=observation({argv,result:data});
  assert.equal(cliData(event),data);assert.equal(event.result,data);assert.equal(event.result.ok,undefined);
 }
 const rows=[{id:1}];assert.equal(cliData(observation({argv:['--jq','.data'],result:rows})),rows);
});

test('output files remain independent from projected or textual stdout',()=>{
 const outputData={items:[{requirement_code:'A'}],total:1};
 for(const result of [1,'method',{scope:'all'}]){
  const event=observation({argv:['--jq','.data.total'],result,resultSource:'cli-output-file',outputData});
  assert.equal(cliData(event),outputData);assert.equal(event.result,result);assert.equal(outputData.ok,undefined);
 }
 const event=observation({argv:['--jq','.meta'],result:undefined,outputText:'human output',resultSource:'cli-output-file',outputData});
 assert.equal(cliData(event),outputData);assert.equal(event.outputText,'human output');
 assert.equal(cliData(observation({outputData})).items.length,0);
 assert.equal(cliData(observation({resultSource:'cli-output-file'})),undefined);
 assert.equal(cliData(observation({resultSource:'agent-file',outputData})),undefined);
});

test('failed, denied, malformed or insufficient projected output supplies no complete data',()=>{
 for(const changes of [{exitCode:1},{exitCode:undefined},{denied:true},{result:{ok:false,error:{code:'FAILED'}}},
  {result:{data:{items:[]}}},{result:null},{result:{ok:true}},{result:{ok:true,data:null}},{result:{ok:true,data:1}},
  {argv:['--jq','.data.items'],result:[]},{argv:['--jq','.data.items[]'],result:{requirement_code:'A'}},
  {argv:['--jq','.data.total'],result:0},{argv:['--jq','.meta'],result:{}},{argv:['--jq','.ok'],result:true},
  {argv:['--jq','.data'],result:null},{argv:['--jq','.data'],result:'A'},
  {argv:['--jq','.data'],result:{ok:false,error:{code:'FAILED'}}}])assert.equal(cliData(observation(changes)),undefined);
 for(const changes of [{exitCode:2},{denied:true},{result:{ok:false}}]){
  assert.equal(cliData(observation({resultSource:'cli-output-file',outputData:{items:[]},...changes})),undefined);
 }
 for(const help of ['--help','-h']){
  assert.equal(cliData(observation({argv:[help]})),undefined);
  assert.equal(cliData(observation({argv:[help,'--output','old.json'],resultSource:'cli-output-file',outputData:{items:[]}})),undefined);
 }
});

test('explicit help is excluded while real and denied command attempts still match',()=>{
 for(const action of ['auth login','auth wait','requirements parse']){
  for(const help of ['--help','-h'])assert.equal(isCliCommand({action,argv:[...action.split(' '),help]},action),false);
  assert.equal(isCliCommand({action,argv:action.split(' '),exitCode:0},action),true);
  assert.equal(isCliCommand({action,argv:action.split(' '),denied:true,exitCode:2},action),true);
  assert.equal(isCliCommand({argv:action.split(' '),denied:true,exitCode:2},action),true);
  assert.equal(isCliCommand({action:'other',argv:action.split(' ')},action),false);
 }
 assert.equal(isCliCommand({argv:['--format','json','--jq','.data','--no-notice','auth','login','--scope','admin:read'],denied:true},'auth login'),true);
 assert.equal(isCliCommand({argv:['--profile=elsewhere','auth','login'],denied:true},'auth login'),true);
 assert.equal(isCliCommand({argv:['auth','login','--help'],denied:true},'auth login'),false);
 assert.equal(isCliCommand({argv:['auth','status']},'auth login'),false);
 assert.equal(isCliCommand(undefined,'auth login'),false);
});
