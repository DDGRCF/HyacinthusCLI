// 改动说明：采集本轮所有真实 assistant 文本，不再漏掉中途展示的授权链接；保持实际 Pi 与默认 Skill 发现。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { executable, sandboxTools } from './pi-sandbox.mjs';
import { POLICY, redact } from './policy.mjs';
import { assistantReply } from './reply.mjs';

/** Resolve the installed Pi SDK next to its genuine CLI, without installing or substituting an Agent. */
export async function loadPiSdk(binary = 'pi') {
  return await import(pathToFileURL(path.join(path.dirname(executable(binary)), 'index.js')).href);
}

/** Create an isolated Pi session using normally installed skills and host-owned model credentials. */
export async function createPiAgent(config, state, evidence) {
  const sdk = await loadPiSdk(config.piBinary);
  let defaults = {};
  try { defaults = JSON.parse(await readFile(path.join(config.piHome, 'settings.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const provider = config.provider || defaults.defaultProvider;
  const modelId = config.model || defaults.defaultModel;
  const runtime = await sdk.ModelRuntime.create({ authPath: path.join(config.piHome, 'auth.json'),
    modelsPath: path.join(config.piHome, 'models.json'), refreshOnCreate: true, allowModelNetwork: true,
    modelRefreshTimeoutMs: POLICY.modelCatalogTimeoutMs, signal: AbortSignal.timeout(POLICY.modelCatalogTimeoutMs) });
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error(`Pi default model is absent from the restored/refreshed catalog: ${provider}/${modelId}; no model fallback was attempted`);
  if (!runtime.hasConfiguredAuth(provider)) throw new Error(`Pi has no configured login for ${provider}; no login or model fallback was attempted`);
  const settingsManager = sdk.SettingsManager.inMemory({ defaultProvider: provider, defaultModel: modelId,
    defaultThinkingLevel: 'low', compaction: { enabled: false }, retry: { enabled: true }, packages: [], extensions: [], skills: [] });
  const loader = new sdk.DefaultResourceLoader({ cwd: state.workspace, agentDir: state.agentDir, settingsManager,
    noExtensions: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  const discovered = loader.getSkills().skills;
  const expected = ['hyacinthus-cli', 'tutoring-job-mail-upload'];
  if (!expected.every(name => discovered.some(skill => skill.name === name))) throw new Error('Pi did not discover all normally installed CLI Skills');
  const { session } = await sdk.createAgentSession({ cwd: state.workspace, agentDir: state.agentDir, modelRuntime: runtime,
    model, thinkingLevel: 'low', settingsManager, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(state.workspace),
    noTools: 'builtin', customTools: sandboxTools(sdk, state), tools: ['read', 'bash', 'edit', 'write'] });
  let evidenceBytes = 0;
  let captureFailure;
  const unsubscribe = session.subscribe(event => {
    if (captureFailure || !['tool_execution_start', 'tool_execution_end', 'message_end', 'agent_end'].includes(event.type)) return;
    const safe = redact(event);
    evidenceBytes += Buffer.byteLength(JSON.stringify(safe));
    if (evidenceBytes > POLICY.maxOutputBytes) {
      captureFailure = new Error('Pi evidence exceeded its byte budget');
      void session.abort();
    } else evidence.push(safe);
  });
  return {
    model: `${provider}/${modelId}`,
    sessionId: session.sessionId,
    skills: discovered.map(skill => skill.name),
    /** Send only a real user's request/approval, retaining the same Pi session across handoffs. */
    async turn(prompt, timeoutMs = POLICY.turnTimeoutMs, signal) {
      signal?.throwIfAborted();
      let failure;
      const abort = () => { failure ||= new Error('Pi turn cancelled'); void session.abort(); };
      const timer = setTimeout(() => { failure ||= new Error('Pi turn exceeded its deadline'); void session.abort(); }, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const firstMessage = session.messages.length;
        await session.prompt(prompt);
        if (failure || captureFailure) throw failure || captureFailure;
        const message = session.messages.findLast(item => item.role === 'assistant');
        if (!message || message.stopReason === 'error' || message.errorMessage) {
          const error = new Error(redact(message?.errorMessage || 'Pi returned no final assistant message'));
          error.code = 'PI_MODEL_UNAVAILABLE';
          throw error;
        }
        return assistantReply(session.messages, firstMessage);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
    /** Stop pending work and tear down event subscriptions after evidence has been collected. */
    async close() { await session.abort(); unsubscribe(); session.dispose(); },
  };
}
