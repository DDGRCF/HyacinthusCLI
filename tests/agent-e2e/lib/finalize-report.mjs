// 改动说明：将独立 CLI Skill 契约证据附加到本轮阻塞报告；不混算主验收墙钟或杜撰单例耗时。
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { writeHtmlReport } from './html-report.mjs';

/** Retain real Rust output timings as independent evidence and render an accessible static report snapshot. */
async function main() {
  const directory = path.resolve(import.meta.dirname, '../reports');
  const report = JSON.parse(await readFile(path.join(directory, 'suite.json'), 'utf8'));
  const rust = JSON.parse(await readFile(path.join(directory, 'cli-skill-contract.json'), 'utf8'));
  if (report.status !== 'blocked' || report.cases.find(item => item.id === 'pi-2')?.status !== 'passed'
      || report.cases.find(item => item.id === 'pi-3')?.status !== 'blocked'
      || !report.cases.find(item => item.id === 'pi-3')?.reason?.includes('Existing isolated API is unavailable')
      || report.cases.some(item => /^pi-[4-8]$/.test(item.id) && item.status !== 'not_run')) {
    throw new Error('This snapshot utility only applies to a recorded API-unavailable run; use the normal report suite for other outcomes');
  }
  report.cases = report.cases.filter(item => !String(item.id).startsWith('offline-rust-'));
  report.stages = report.stages.filter(item => item.name !== '独立 CLI/Rust Skill 契约');
  for (const item of rust.cases) report.cases.push({ ...item, id: `offline-rust-${item.id}`, evidence: [rust.command] });
  report.stages.push({ name: '独立 CLI/Rust Skill 契约', status: rust.status,
    durationMs: rust.testDurationMs, detail: `Rust runner 输出测试阶段 ${rust.testDurationMs / 1000} 秒，编译阶段 ${rust.compileDurationMs / 1000} 秒；此任务独立执行，不计入本轮主验收墙钟，未记录单例耗时。` });
  const clarifications = [
    '本轮 Pi 用户流程在测试 API 门禁停止：未发送邮件上传任务，未发起用户授权，未解析、预览或导入 30 条；准备阶段通过不代表任务成功。',
    '已修复先前模型目录初始化问题：恢复正常目录加载/限时刷新后，既有默认模型可被识别，没有更换模型。',
    'openai-codex 是 Pi 的模型认证提供方名称；被测运行入口为独立 Pi SDK 进程，不是 Codex CLI。',
    '复用测试库，不重建、不 seed、不连接真实邮箱；本轮数据为保存的合成邮件样本。',
    '主验收用时仅覆盖本次 Pi/Node 报告流水线；另附 CLI/Rust 的独立结果，不将两者加总。',
  ];
  report.notes = [...new Set([...(report.notes || []), ...clarifications])];
  await writeFile(path.join(directory, 'suite.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeHtmlReport(path.join(directory, 'latest.html'), report);
  const snapshot = path.resolve(import.meta.dirname, '../../../../docs/reviews/pi-mail-upload-e2e-report.html');
  await mkdir(path.dirname(snapshot), { recursive: true });
  await writeHtmlReport(snapshot, report);
  console.log(JSON.stringify({ status: report.status, durationMs: report.durationMs, cases: report.cases.length,
    html: snapshot }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
