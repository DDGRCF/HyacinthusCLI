// 改动说明：实际 Pi 用户流程与离线回归分区，首屏不混算通过数；完整用例脱敏转义并显示实测耗时。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const LABELS = { passed: '通过', failed: '失败', blocked: '阻塞', not_run: '未运行' };

/** 去敏并转义所有动态文本，适用于文本节点及双引号属性。 */
function escape(value) {
  return redact(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** 隐去常见凭据；调用方仍须在采集阶段完成领域特定脱敏。 */
function redact(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [已脱敏]')
    .replace(/((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1[已脱敏]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已脱敏]@');
}

/** 仅显示实际记录的非负有限毫秒值，保留零值。 */
function duration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '未记录';
  if (value < 1000) return `${Number(value.toFixed(2))} 毫秒`;
  if (value < 60_000) return `${Number((value / 1000).toFixed(2))} 秒`;
  return `${Math.floor(value / 60_000)} 分 ${Number(((value % 60_000) / 1000).toFixed(2))} 秒`;
}

/** 使用封闭状态样式，未知状态不注入属性。 */
function status(value) {
  const known = Object.hasOwn(LABELS, value);
  return `<span class="status ${known ? escape(value) : 'unknown'}">${known ? LABELS[value] : `未知（${escape(value ?? 'unknown')}）`}</span>`;
}

/** 保留完整列表，通过原生折叠和滚动区域控制阅读密度。 */
function list(values, empty = '未记录') {
  if (!Array.isArray(values) || values.length === 0) return `<p class="muted">${escape(empty)}</p>`;
  return `<div class="evidence"><ul>${values.map((value) => `<li>${escape(redact(value))}</li>`).join('')}</ul></div>`;
}

/** Render complete case records without conflating protocol/unit success with user-flow acceptance. */
function caseTable(cases) {
  if (!cases.length) return '<p class="muted">未记录用例</p>';
  return `<table><thead><tr><th scope="col">名称</th><th scope="col">状态</th><th scope="col">实际耗时</th><th scope="col">原因</th></tr></thead><tbody>${cases.map((item) => `<tr><td data-label="名称"><div class="text">${escape(redact(item.name))}</div><small class="text">${escape(redact(item.id))}</small></td><td data-label="状态">${status(item.status)}</td><td data-label="实际耗时">${escape(duration(item.durationMs))}</td><td data-label="原因"><div class="text">${escape(redact(item.reason ?? '未记录'))}</div>${item.evidence?.length ? `<details><summary>脱敏证据（${item.evidence.length}）</summary>${list(item.evidence)}</details>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

/** 写入无脚本、无远程资源的独立报告，并自动创建父目录。 */
export async function writeHtmlReport(file, report) {
  const cases = Array.isArray(report.cases) ? [...report.cases].sort((a, b) =>
    Number(String(b.id).startsWith('pi-')) - Number(String(a.id).startsWith('pi-'))) : [];
  const stages = Array.isArray(report.stages) ? report.stages : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const piCases = cases.filter((item) => String(item.id).startsWith('pi-'));
  const offlineCases = piCases.length ? cases.filter((item) => !String(item.id).startsWith('pi-')) : [];
  const primaryCases = piCases.length ? piCases : cases;
  const counts = Object.keys(LABELS).map((key) => `${LABELS[key]} ${primaryCases.filter((item) => item.status === key).length}`);
  const unknown = primaryCases.filter((item) => !Object.hasOwn(LABELS, item.status)).length;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escape(report.runId)} · 测试报告</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f8;--surface:#fff;--text:#20252b;--muted:#505b66;--line:#cbd2d9;--accent:#17634b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:24px}h1{font-size:clamp(24px,4vw,36px);margin:0 0 12px}h2{font-size:22px;margin:0 0 16px}header{border-top:5px solid var(--accent);padding:20px 0}section{margin-top:32px;padding-top:20px;border-top:1px solid var(--line)}p{margin:8px 0}.muted,dt{color:var(--muted)}.summary{display:grid;grid-template-columns:1fr 1fr;gap:12px}.summary p{margin:0}.metric{font-size:24px;font-variant-numeric:tabular-nums}dl{display:grid;grid-template-columns:100px 1fr;gap:6px 16px}dd{margin:0}table{width:100%;border-collapse:collapse;background:var(--surface)}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{color:var(--muted)}td:first-child{width:28%}.status{font-weight:700;border-left:3px solid var(--accent);padding-left:8px;white-space:normal}details{margin-top:10px}summary{cursor:pointer;color:var(--accent)}summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.evidence{max-height:24rem;overflow:auto}li{margin:8px 0;white-space:pre-wrap}article{padding:12px 0;border-bottom:1px solid var(--line)}.text{white-space:pre-wrap;overflow-wrap:anywhere}small{display:block;color:var(--muted)}
.status.failed{color:#a8233b;border-color:#a8233b}.status.blocked,.status.unknown{color:#825700;border-color:#825700}.status.not_run{color:var(--muted);border-color:var(--line)}
@media(prefers-color-scheme:dark){:root{--bg:#15191d;--surface:#1d2329;--text:#edf0f3;--muted:#b8c3cd;--line:#53606c;--accent:#8bd4b8}.status.failed{color:#ff9cad;border-color:#ff9cad}.status.blocked,.status.unknown{color:#efd08a;border-color:#efd08a}}
@media(max-width:767px){main{padding:16px}.summary{grid-template-columns:1fr}dl{grid-template-columns:80px 1fr}table,tbody,tr,td{display:block}thead{display:none}tr{padding:12px 0;border-bottom:1px solid var(--line)}td,td:first-child{width:100%;padding:6px 12px;border:0}td::before{content:attr(data-label);display:block;font-size:13px;color:var(--muted)}}
@media print{.evidence{max-height:none;overflow:visible}body{background:white;color:black}}
</style></head><body><main>
<header><h1>${piCases.length ? 'Pi 邮件岗位上传 · 本轮诊断' : '测试报告'}</h1><div class="summary"><p>${piCases.length ? '用户流程状态' : '总体状态'} ${status(report.status)}</p><p>${piCases.length ? '本轮主验收用时' : '实际总耗时'} <strong class="metric">${escape(duration(report.durationMs))}</strong></p><p>${piCases.length ? 'Pi 流程用例' : '用例总数'} ${primaryCases.length}</p><p>${escape(counts.join(' · '))}${unknown ? ` · 未知 ${unknown}` : ''}</p></div>
${blockers.length ? `<p class="text"><strong>最先卡点：</strong>${escape(redact(blockers[0].stage))} · ${escape(redact(blockers[0].reason))}</p><p class="text"><strong>下一步：</strong>${escape(redact(blockers[0].nextAction))}</p>` : ''}
<details><summary>运行信息</summary><dl><dt>运行 ID</dt><dd class="text">${escape(report.runId)}</dd><dt>Agent</dt><dd>${escape(report.agent)}</dd><dt>模型</dt><dd class="text">${escape(report.model)}</dd><dt>开始</dt><dd>${escape(report.startedAt ?? '未记录')}</dd><dt>结束</dt><dd>${escape(report.endedAt ?? '未记录')}</dd></dl></details></header>
<section><h2>${piCases.length ? '实际 Pi 流程' : '用例'}</h2>${caseTable(primaryCases)}</section>
${offlineCases.length ? `<section><h2>离线工程回归</h2><p class="muted">${offlineCases.length} 项；通过 ${offlineCases.filter((item) => item.status === 'passed').length}。这些结果不代表真实授权、解析或上传成功。</p><details><summary>展开完整离线用例</summary>${caseTable(offlineCases)}</details></section>` : ''}
<section><h2>卡点</h2>${blockers.length ? blockers.map((item) => `<article><h3 class="text">${escape(item.stage)}</h3><p class="text">原因：${escape(item.reason)}</p><p class="text">修复建议：${escape(item.nextAction)}</p></article>`).join('') : '<p class="muted">未记录卡点</p>'}</section>
<section><h2>阶段耗时</h2><p class="muted">按实测毫秒转换单位并取两位小数，原始记录不变。</p>${stages.length ? stages.map((item) => `<article><strong class="text">${escape(item.name)}</strong> ${status(item.status)}<p>实际耗时：${escape(duration(item.durationMs))}</p><p class="text">${escape(item.detail)}</p></article>`).join('') : '<p class="muted">未记录阶段</p>'}</section>
<section><h2>脱敏证据摘要</h2><p class="muted">常见凭据已自动遮蔽；调用方需确保原始证据已完成业务脱敏。状态仅反映输入记录，不代表真实导入已通过。</p>${list(report.evidence)}</section>
<section><h2>备注</h2>${list(report.notes)}</section>
</main></body></html>`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html, 'utf8');
}
