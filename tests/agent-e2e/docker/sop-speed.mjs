// 改动说明：从真实SDK事件收集脱敏速度数据，区分独立会话、连续任务和状态复用。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
/** Collect numeric turn and CLI observations without copying prompts, tool arguments or credentials. */
export async function collectSopSpeed(output) {
  const sessions = [];
  async function visit(dir) {
    const entries = await readdir(dir, {withFileTypes:true});
    if (entries.some(entry => entry.name === 'pi-events.ndjson')) {
      const action = path.relative(path.join(output, 'cases'), dir);
      const events = (await readFile(path.join(dir, 'pi-events.ndjson'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const turns = events.filter(event => ['reply','failure'].includes(event.event)).map((event, index) => ({turn:index + 1, event:event.event, elapsedMs:event.elapsedMs, metrics:event.metrics ?? null}));
      let cli = []; try { cli = JSON.parse(await readFile(path.join(dir, 'cli-events.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const sum = getter => {const values = turns.map(getter).filter(Number.isFinite); return values.length ? values.reduce((a,b) => a+b,0) : null;};
      const kind = action === 'D1' ? '连续邮件任务 D1-D3' : action === 'D4' ? '新会话，复用邮件与授权' : /unavailable|E1e$/.test(action) ? '新会话，复用授权或恢复状态' : '新会话，新profile';
      const actions = {};
      for (const event of cli) { const name = event.action || '未分类'; actions[name] ||= {count:0,durationMs:0,denied:0,failed:0}; const a = actions[name]; a.count++; a.durationMs += Number.isFinite(event.durationMs) ? event.durationMs : 0; a.denied += Boolean(event.denied); a.failed += event.exitCode !== 0; }
      sessions.push({action,kind,turns,wallMs:sum(turn => turn.elapsedMs),toolWallMs:sum(turn => turn.metrics?.toolWallMs),modelResponseMs:sum(turn => turn.metrics?.modelResponseMs),modelResponses:sum(turn => turn.metrics?.modelResponses),modelTimedResponses:sum(turn => turn.metrics?.modelTimedResponses),inputTokens:sum(turn => turn.metrics?.usage?.input),outputTokens:sum(turn => turn.metrics?.usage?.output),cacheReadTokens:sum(turn => turn.metrics?.usage?.cacheRead),toolCalls:events.filter(event => event.event === 'tool' && event.detail?.type === 'tool_execution_start').length,cliCalls:cli.length,cliActions:actions,retries:events.filter(event => event.event === 'model_retry' && event.detail?.type === 'auto_retry_start').length});
    }
    for (const entry of entries) if (entry.isDirectory()) await visit(path.join(dir, entry.name));
  }
  await visit(path.join(output, 'cases'));
  const result = {model:'xiaomi-token-plan-cn/mimo-v2.6-pro',thinking:'low',note:'墙钟包含工具及模型；各列不可相加。缺失模型计时与用量为null。新会话不都从空授权开始。',sessions};
  await writeFile(path.join(output, 'speed.json'), JSON.stringify(result, null, 2));
  return result;
}
