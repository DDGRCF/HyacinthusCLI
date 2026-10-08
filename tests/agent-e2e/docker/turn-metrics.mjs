// 改动说明：记录真实Pi轮次的工具并行耗时、模型响应耗时和用量，不保存提示或凭据。
/** Measure tool intervals against a monotonic turn clock without double-counting parallel calls. */
export function createTurnMetrics(clock = () => performance.now()) {
  const started = clock(), active = new Map(), intervals = [];
  let toolCalls = 0, retries = 0;
  return {
    observe(event) {
      const now = clock();
      if (event.type === 'tool_execution_start') { toolCalls++; active.set(event.toolCallId, now); }
      if (event.type === 'tool_execution_end' && active.has(event.toolCallId)) {
        intervals.push([active.get(event.toolCallId), now]); active.delete(event.toolCallId);
      }
      if (event.type === 'auto_retry_start') retries++;
    },
    finish(messages) {
      const ended = clock(), ranges = [...intervals, ...[...active.values()].map(start => [start, ended])].sort((a, b) => a[0] - b[0]);
      let toolWallMs = 0, last = started;
      for (const [start, end] of ranges) { toolWallMs += Math.max(0, end - Math.max(start, last)); last = Math.max(last, end); }
      const responses = messages.filter(message => message.role === 'assistant');
      const usage = {};
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens']) {
        const values = responses.map(message => message.usage?.[key]).filter(value => Number.isFinite(value) && value >= 0);
        if (values.length) usage[key] = values.reduce((a, b) => a + b, 0);
      }
      const durations = responses.map(message => message.durationMs).filter(value => Number.isFinite(value) && value >= 0);
      return { wallMs: ended - started, toolWallMs, nonToolWallMs: Math.max(0, ended - started - toolWallMs), toolCalls, retries,
        modelResponses: responses.length, modelTimedResponses: durations.length,
        modelResponseMs: durations.length ? durations.reduce((a, b) => a + b, 0) : null, usage };
    }
  };
}
