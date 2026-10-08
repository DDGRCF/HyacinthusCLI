// 改动说明：真实Pi默认发现Skills，并记录模型用量、响应耗时及工具并行耗时，保留重试证据。
import readline from 'node:readline';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as sdk from '/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { assistantReply } from './reply.mjs';
import { createTurnMetrics } from './turn-metrics.mjs';

const POLICY = Object.freeze({ provider: 'xiaomi-token-plan-cn', model: 'mimo-v2.6-pro', turnMs: 600_000, maxCalls: 128,
  retry: Object.freeze({ enabled: true, maxRetries: 2, baseDelayMs: 2000, maxAgentDelayMs: 10_000 }) });
const home = process.env.PI_CODING_AGENT_DIR;
const cwd = process.env.PI_WORKSPACE || '/workspace';
const sessionId = randomUUID();
const runtime = await sdk.ModelRuntime.create({ authPath: path.join(home, 'auth.json'), refreshOnCreate: false, allowModelNetwork: true });
// Load the local credential snapshot without requesting or replacing the remote model catalog.
await runtime.refresh({ allowNetwork: false });
const model = runtime.getModel(POLICY.provider, POLICY.model);
if (!model || !runtime.hasConfiguredAuth(POLICY.provider)) throw new Error('MiMo Token Plan model/login is unavailable');
const settingsManager = sdk.SettingsManager.inMemory({ defaultProvider: POLICY.provider, defaultModel: POLICY.model,
  defaultThinkingLevel: 'low', compaction: { enabled: false }, retry: POLICY.retry, packages: [], extensions: [], skills: [] });
const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: home, settingsManager,
  noExtensions: true, noPromptTemplates: true, noThemes: true });
await loader.reload();
const skills = loader.getSkills().skills;
const { session } = await sdk.createAgentSession({ cwd, agentDir: home, modelRuntime: runtime, model,
  thinkingLevel: 'low', settingsManager, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(cwd) });
let calls = 0;
let metrics;
/** Emit machine-readable host evidence while leaving normal Pi discovery untouched. */
function emit(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
session.subscribe(event => {
  metrics?.observe(event);
  if (['auto_retry_start', 'auto_retry_end'].includes(event.type)) emit({ event: 'model_retry', detail: event });
  if (['tool_execution_start', 'tool_execution_end'].includes(event.type)) {
    emit({ event: 'tool', detail: event });
    if (event.type === 'tool_execution_start' && ++calls > POLICY.maxCalls) void session.abort();
  }
});
emit({ event: 'ready', sessionId, cwd, model: `${model.provider}/${model.id}`, retryPolicy: settingsManager.getRetrySettings(), skills: skills.map(skill => ({ name: skill.name, description: skill.description, filePath: skill.filePath })) });
const lines = readline.createInterface({ input: process.stdin, terminal: false });
for await (const line of lines) {
  const input = JSON.parse(line);
  if (input.close) break;
  calls = 0;
  const started = performance.now();
  metrics = createTurnMetrics();
  const turnStart = session.messages.length;
  const timer = setTimeout(() => { void session.abort(); }, POLICY.turnMs);
  try {
    await session.prompt(input.prompt);
    const reply = session.messages.findLast(message => message.role === 'assistant');
    const visible = assistantReply(session.messages, turnStart);
    emit({ event: 'reply', text: visible.finalMessage, assistantMessages: visible.assistantMessages,
      stopReason: reply?.stopReason, error: reply?.errorMessage, elapsedMs: performance.now() - started,
      metrics: metrics.finish(session.messages.slice(turnStart)) });
  } catch (error) { emit({ event: 'failure', error: error.message, elapsedMs: performance.now() - started,
    metrics: metrics.finish(session.messages.slice(turnStart)) }); }
  finally { clearTimeout(timer); metrics = undefined; }
}
await session.abort();
session.dispose();
