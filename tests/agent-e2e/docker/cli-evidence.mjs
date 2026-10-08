// 改动说明：按真实CLI输出来源读取完整data，并区分命令帮助与实际调用及被拒绝的尝试。
import { flag, without } from './sop-policy.mjs';

/** Return complete structured data only from a successful, explicitly identified CLI output source. */
export function cliData(event){
 if(event?.exitCode!==0||event.denied)return undefined;
 if(event.result?.ok===false&&event.result.error!==undefined)return undefined;
 const argv=Array.isArray(event.argv)?event.argv:[];
 if(argv.includes('--help')||argv.includes('-h'))return undefined;
 const projection=(flag(argv,'--jq')??flag(argv,'-q')??'').trim();
 let data;
 if(event.resultSource==='cli-output-file'){
  if((!projection||projection==='.')&&event.result?.ok===false)return undefined;
  data=event.outputData;
 }else if(event.resultSource!==undefined)return undefined;
 else if(!projection||projection==='.'){
  if(event.result?.ok!==true)return undefined;
  data=event.result.data;
 }else if(projection==='.data')data=event.result;
 else return undefined;
 return data!==null&&typeof data==='object'?data:undefined;
}

/** Match an actual command or denied attempt while excluding explicit command help. */
export function isCliCommand(event,action){
 const argv=Array.isArray(event?.argv)?event.argv:[];
 if(argv.includes('--help')||argv.includes('-h'))return false;
 if(event?.action!==undefined)return event.action===action;
 const local=without(argv,['--format','--jq','-q','--request-id','--base-url','--profile','--token','--instance-id'])
  .filter(arg=>!['--no-notice','--verbose'].includes(arg));
 const command=action.split(' ');
 return command.length>0&&command.every((part,index)=>local[index]===part);
}
