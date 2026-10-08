// 改动说明：e2e 只调度真实 Pi SDK 自然语言验收；禁用缓存、并发与自动重试。
import type { E2EConfig } from 'e2e';
import { POLICY } from './lib/policy.mjs';

/** CLI agent acceptance is serialized and always executes fresh model decisions. */
export default {
  projectId: 'hyacinthus-pi-cli',
  targets: [{ name: 'pi-cli', platform: 'cli' }],
  tests: ['tests/*.e2e.ts'],
  timeout: POLICY.testTimeoutMs,
  cleanupTimeout: POLICY.cleanupTimeoutMs,
  workers: 1,
  retries: 0,
  cache: 'off',
  trace: 'off',
  video: 'off',
  reporters: ['list', 'junit', 'markdown'],
} satisfies E2EConfig;
