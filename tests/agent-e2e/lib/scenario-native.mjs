// 改动说明：在无 e2e/tsx 加载钩子的原生 Node 进程内运行真实 Pi SDK；退出前等待独立清理。
import { runSavedMailScenario, cancelActiveScenario } from './scenario.mjs';
import { redact } from './policy.mjs';

/** Convert outer test cancellation into a graceful scenario abort and retained HTML evidence. */
function cancel() { void cancelActiveScenario().catch(error => console.error(redact(error.message))); }
process.once('SIGTERM', cancel);
process.once('SIGINT', cancel);

runSavedMailScenario().then(result => console.log(`PI_SCENARIO_RESULT ${JSON.stringify(result)}`)).catch(error => {
  console.error(redact(error.message));
  process.exitCode = 1;
}).finally(() => {
  process.removeListener('SIGTERM', cancel);
  process.removeListener('SIGINT', cancel);
});
