// 改动说明：验证并行工具、未结束工具与缺失模型计时不会造成速度统计误判。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnMetrics } from './turn-metrics.mjs';
test('parallel tools are measured as a union and missing usage stays unknown', () => {
  let now = 0; const metrics = createTurnMetrics(() => now);
  now = 10; metrics.observe({type:'tool_execution_start',toolCallId:'a'});
  now = 20; metrics.observe({type:'tool_execution_start',toolCallId:'b'});
  now = 30; metrics.observe({type:'tool_execution_end',toolCallId:'a'});
  now = 40; metrics.observe({type:'tool_execution_end',toolCallId:'b'});
  now = 50; const result = metrics.finish([{role:'assistant',durationMs:12,usage:{input:100,output:20}},{role:'assistant'}]);
  assert.equal(result.toolWallMs,30); assert.equal(result.nonToolWallMs,20);
  assert.equal(result.modelResponseMs,12); assert.equal(result.modelTimedResponses,1);
  assert.deepEqual(result.usage,{input:100,output:20});
});
test('aborted tools extend through finish while retries remain separate', () => {
  let now = 0; const metrics = createTurnMetrics(() => now);
  now = 10; metrics.observe({type:'tool_execution_start',toolCallId:'a'});
  metrics.observe({type:'auto_retry_start'}); now = 25;
  const result = metrics.finish([]); assert.equal(result.toolWallMs,15);
  assert.equal(result.modelResponseMs,null); assert.equal(result.retries,1);
});
