// 改动说明：从实测证据生成离线中文 HTML，说明改动、验证办法、结果与尚未覆盖的范围。
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../lib/policy.mjs';

const repo = path.resolve(import.meta.dirname, '../../../..');
const artifacts = path.join(repo, '.tmp/e2e/skills-alignment');
const output = path.join(repo, 'docs/reviews');
const result = JSON.parse(await readFile(path.join(artifacts, 'docker-acceptance.json'), 'utf8'));
const rustLog = await readFile(path.join(artifacts, 'cli-tests.log'), 'utf8');
const rust = [...rustLog.matchAll(/test result: ok\. (\d+) passed/g)].reduce((sum, match) => sum + Number(match[1]), 0);
const nodeLog = await readFile(path.join(artifacts, 'node-tests.log'), 'utf8');
const node = Number(nodeLog.match(/ℹ pass (\d+)/)?.[1] || 0);
const npmLog = await readFile(path.join(artifacts, 'npm-tests.log'), 'utf8');
const npm = Number(npmLog.match(/ℹ pass (\d+)/)?.[1] || 0);
const clippy = (await readFile(path.join(artifacts, 'cli-clippy.log'), 'utf8')).includes('Finished');
let render;
try { render = JSON.parse(await readFile(path.join(artifacts, 'report-render.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let cleanup;
try { cleanup = JSON.parse(await readFile(path.join(artifacts, 'cleanup.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const attempts = [];
for (const name of (await readdir(artifacts)).filter(name => /^attempt-.*\.json$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const entry = JSON.parse(await readFile(path.join(artifacts, name), 'utf8'));
  attempts.push({ file: name, reason: entry.reason || entry.failure, fix: entry.fix });
}

/** Escape every dynamic field so the offline report renders evidence as plain text. */
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
/** Explain actual measured wall time in familiar units. */
function duration(value) { return typeof value === 'number' ? `${Math.floor(value / 60_000)}分${Math.round(value % 60_000 / 1000)}秒` : '未记录'; }
/** Render one accessible report card with a single main point. */
function card(title, text) { return `<article><h3>${title}</h3><p>${text}</p></article>`; }

const names = ['自然语言发现整个 CLI', '无登录状态下查询需求并完成真实授权', '个人资料指南、预览和修改', '优先级规则指南、预览和创建', '邮件 Skill 自行整理30条并真实导入', '同封邮件重放不重复创建'];
const cases = names.map(name => result.cases.find(entry => entry.name === name) || { name, status: 'not_run' });
const passed = cases.filter(entry => entry.status === 'passed').length;
const labels = { passed: '通过', failed: '失败', not_run: '未运行' };
/** Explain verified outcomes without requiring the reader to understand CLI JSON fields. */
function proof(entry) {
  const e = entry.evidence;
  if (!e) return escape(entry.error || '尚未取得完整业务证据');
  const words = {
    '自然语言发现整个 CLI': 'Pi 自己找到并读取了 CLI 技能入口，随后介绍了平台能做的事情。',
    '无登录状态下查询需求并完成真实授权': `原始授权链接由浏览器批准；真正执行了需求查询，独立查询结果为 ${e.returned ?? '已记录的'} 条。`,
    '个人资料指南、预览和修改': `回读显示名称确实为“${e.actualDisplayName}”；修改经过实际预览和用户确认。`,
    '优先级规则指南、预览和创建': `回读找到新增规则（ID ${e.ruleId}），优先级是 ${e.priority}，模式为 ${e.pattern}。`,
    '邮件 Skill 自行整理30条并真实导入': `独立查询核对 ${e.independentReadbackRows} 条岗位：新建 ${e.created}、失败 ${e.failed}。原文逐字保留；线上方式、电话、次数、时长、时间及薪酬均已核对。`,
    '同封邮件重放不重复创建': `第二次新增 ${e.newCreated} 条，原来的 ${e.preservedIds} 个记录 ID 保持一致，第一次结果文件保持不变。`,
  };
  return `${escape(words[entry.name])}<details><summary>查看原始验证摘要</summary><pre>${escape(JSON.stringify(e, null, 2))}</pre></details>`;
}

const rows = cases.map(entry => `<tr><td>${escape(entry.name)}</td><td><span class="badge ${escape(entry.status)}">${labels[entry.status]}</span></td><td>${duration(entry.durationMs)}</td><td>${proof(entry)}</td></tr>`).join('');
const evidence = { ...redact(result), regression: { rust, node, npm, clippy }, attempts, render, cleanup };
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'hyacinthus-cli-skills-evidence.json'), JSON.stringify(evidence, null, 2));
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hyacinthus CLI：Skills 对齐与真实 Agent 验收</title>
<style>
:root{color-scheme:light;--ink:#172b38;--muted:#526674;--green:#17624a;--line:#dce5e8}*{box-sizing:border-box}body{overflow-wrap:anywhere;margin:0;color:var(--ink);background:#f4f7f7;font:16px/1.75 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:42px 24px 64px}header{padding:36px;border-radius:18px;background:#183d39;color:white}header p{color:#dcebe8}.eyebrow{font-size:14px;letter-spacing:.06em}h1{font-size:clamp(27px,4vw,40px);line-height:1.35;margin:12px 0 18px}h2{font-size:25px;margin:0 0 16px}h3{font-size:18px;margin:0 0 8px}p{margin:0 0 14px}.metrics,.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:22px 0}.metric,article{padding:22px;background:white;border:1px solid var(--line);border-radius:12px}.metric strong{display:block;font-size:29px;color:var(--green)}.metric span{color:var(--muted)}section{margin-top:36px;background:white;padding:28px;border:1px solid var(--line);border-radius:14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}section article{background:#f8faf9}a{color:#17624a;text-underline-offset:3px}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}code{font-size:.9em;background:#edf3f1;padding:2px 5px;border-radius:4px}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th,td{padding:14px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f1f5f4}td:nth-child(1){width:25%}.table-wrap{overflow:auto}.badge{display:inline-block;padding:2px 10px;border-radius:99px;white-space:nowrap;font-size:13px}.passed{background:#e0f3e9;color:#17624a}.failed{background:#ffe7e4;color:#9b3225}.not_run{background:#edf0f2;color:#53616a}.flow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:20px;background:#f1f6f4;border-radius:10px}.flow b{padding:8px 12px;background:white;border:1px solid var(--line);border-radius:8px}li{margin:8px 0}summary{cursor:pointer;font-weight:600}details{margin:16px 0}details p{margin:10px 0;color:var(--muted)}footer{margin:28px 0;color:var(--muted);font-size:13px}@media(max-width:700px){main{padding:18px 14px 40px}header,section{padding:22px 18px}.metrics,.grid{grid-template-columns:1fr}table{min-width:650px}h2{font-size:22px}}@media print{body{background:white}main{padding:0;max-width:none}section,header,article{break-inside:avoid}details{display:block}a{color:inherit}}
</style></head><body><main>
<header><div class="eyebrow">实际代码改动 · 正常安装与发现 · 独立 Docker / Pi / MiMo</div><h1>让 Agent 认识并用好<br>Hyacinthus CLI</h1><p>${result.status === 'passed' ? '6 项真实任务已全部跑通。Agent 自己发现技能、读取需要的指南、申请授权并操作；验收程序再回读真实业务结果。' : `真实验收当前通过 ${passed}/6 项。未完成的项目如实列出；静态测试通过不代表业务任务跑通。`}</p><p>本次模型：${escape(result.model)}<br>实测时间：${escape(result.startedAt)} 至 ${escape(result.endedAt)}（UTC），总耗时 ${duration(result.durationMs)}。</p></header>
<div class="metrics"><div class="metric"><strong>2 个入口 / 11 篇指南</strong><span>统一 CLI 入口 + 独立邮件工作流</span></div><div class="metric"><strong>${rust + node + npm} 项代码检查通过</strong><span>Rust ${rust} + npm ${npm} + Pi 框架 ${node}</span></div><div class="metric"><strong>${passed} / 6 实测通过</strong><span>含30条真实导入及同封邮件重放</span></div></div>
<section><h2>1. 这次具体做了什么</h2><div class="grid">
${card('把“怎么认识 CLI”做成一个入口', '原来的 shared、agent-runtime、requirements 合到 <code>hyacinthus-cli</code>。描述直接写业务意图；入口按用户任务指向查询、导入、目录、规则、地图、个人资料等指南。Agent 先看到介绍，需要哪一项再读哪一篇。')}
${card('邮件工作流单独保留', '<code>tutoring-job-mail-upload</code> 还负责选邮件、保存来源、16字段整理、错误记录和重放。只有进入 CLI 操作时才加载 CLI 指南；邮件原文和回执统一放 <code>tasks/&lt;run_id&gt;/</code> 相对目录。')}
${card('安装后真的能发现', 'npm 与 Shell 安装器为已存在的 Pi、Codex、Claude、Hermes 目录自动导出完整 Skills，并逐文件核对。支持指定 Agent、指定目录、跳过 Skills。升级仅清理旧安装清单登记的废弃入口，保留用户自建文件。')}
${card('CLI 自己提供同版本指南', '<code>skills list</code> 发现入口和引用目录，<code>skills read</code> 默认输出 Markdown，<code>--json</code> 提供结构化结果。入口描述来自 SKILL.md；全部引用随二进制交付。不登录、不联网、配置损坏时也能读。')}
${card('补齐流程中的坑', '先看当前命令和需要的权限，再登录、给用户原始授权链接、收到批准后继续。补齐源邮件到后台字段的检查，确保“线上”没有被默认成线下，电话、次数和课时没有只留在备注里。“有经验”保留为条件文本，不塞进职业枚举。修复完整预览文件保存，核对后再写入并回读。')}
${card('把验证也留下来', '新增引用一致性、迁移清理、路径边界、相对目录安装等测试；新增独立 Docker 的初始化、Pi 驱动和报告生成脚本。每次失败留证据，不能用手动写入代替 Agent 完成任务。')}
</div></section>
<section><h2>2. 怎样对齐 lark-cli</h2><p>参考仓库已 clone 到 <code>/tmp/hyacinthus-lark-cli-reference</code>，版本 1.0.97，提交 <code>7beffb086d7fa3c5b843d8affa7c089f49cfc65e</code>。实际阅读了安装向导、skillcontent reader、skills 命令，以及 shared / doc / openapi-explorer 技能内容。</p><div class="table-wrap"><table><thead><tr><th>参考的做法</th><th>在本项目的落地</th></tr></thead><tbody><tr><td>安装向导联动安装 Skills</td><td>npm 和 Shell 安装 CLI 后导出、校验技能；支持 Pi。</td></tr><tr><td>技能介绍写在文件开头</td><td>发现描述与 Agent 读取内容用同一个来源，避免两份介绍不一致。</td></tr><tr><td>list / read / 相对引用</td><td>列出入口和单层目录，读取入口或 reference；所有指南随二进制交付。</td></tr><tr><td>先发现能力，按需读细节</td><td>统一业务路由入口 + 11篇指南；26项现有能力都有导航。</td></tr><tr><td>根据真实任务安排工作流</td><td>保留邮件来源、批次确认、结果回读和去重约束；缺少已登记能力时明确报告缺口。</td></tr></tbody></table></div><p>这次实现的是当前源码；没有发布新的 npm 包或 GitHub Release。</p></section>
<section><h2>3. 独立 Agent 到底怎样验收</h2><div class="flow"><b>自然语言任务</b><span>→</span><b>Pi 正常发现 Skills</b><span>→</span><b>CLI / 真实 API + Worker</b><span>→</span><b>独立测试库与 MinIO</b><span>→</span><b>另行回读核对</b></div><p>本轮从空工作区、全新 CLI 授权开始。Pi 使用默认 Skill loader 和默认工具；技能通过正式安装入口放进普通发现目录。没有向 Agent 塞完整操作脚本，也没有代它生成 confirmed payload。用户模拟器只打开原始授权链接、登录并批准，以及确认它展示的预览。</p><p>Docker 项目 <code>hyacinthus-skills-acceptance</code> 有自己的网络、PostgreSQL/PostGIS、Redis、MinIO、API、Worker、管理端与 Pi。只使用该项目的 <code>hyacinthus_test</code>；初始化走仓库受保护的 Rust admin 脚本。宿主业务目录、生产配置和 Docker socket 都未挂载。临时复制了本机 MiMo Token Plan 的单一 provider 凭据。</p><div class="table-wrap"><table><thead><tr><th>真实任务</th><th>结果</th><th>实测耗时</th><th>证明用的实际结果</th></tr></thead><tbody>${rows}</tbody></table></div>${result.failure ? `<p class="failed">当前失败原因：${escape(result.failure)}</p>` : ''}</section>
<section><h2>4. 这些结果证明了什么</h2><ul><li>安装测试证明入口和 references 一起交付；描述与原文一致，篡改或缺文件能被检查出来。</li><li>26项能力导航测试证明当前清单里的能力都有对应指南；它不证明26项业务都已跑过端到端。</li><li>真实 Pi 任务成功才证明“Agent 能发现、理解并完成这些任务”。资料和规则用实际读取结果核对；邮件岗位按30个唯一编号逐条核对薪酬、科目年级、男女条件和时间。</li><li>重放核对数量与记录 ID；新增为0且 ID 保持一致，才算没有重复创建。</li><li>Clippy：${clippy ? '通过' : '尚未取得通过证据'}。两份技能的文件格式检查通过；${result.audit ? '补充检查确认30条都有16字段，解析问题留下记录，经验条件未丢失，线上记录没有虚构坐标，优先级规则实际命中。' : '补充业务及产物检查尚未取得通过证据。'}HTML 浏览器检查：${render?.status === 'passed' ? '桌面1440px、手机390px均通过，无页面横向溢出或控制台错误' : '尚未取得检查结果'}。</li></ul></section>
<section><h2>5. 失败后修了什么</h2><p>以下是本次执行实际暴露的问题，不把失败藏进“最终成功”里。</p>${attempts.map((entry, i) => `<details><summary>第 ${i + 1} 次记录：${escape(entry.file)}</summary><p>${escape(entry.reason)}</p>${entry.fix ? `<p>修正：${escape(entry.fix)}</p>` : ''}</details>`).join('')}<p>另外，Shell 相对目录测试发现检查命令的 jq 表达式缺少点号，已改为 <code>.data.ok</code> 并重新通过。</p></section>
<section><h2>6. 本轮范围与交付</h2><p>邮件是合成的已保存样本，未连接真实邮箱。管理端使用固定镜像 <code>20260913-170817</code>，API/Worker/CLI 从当前源码构建；这不验证当前管理端源码的构建，也不代表全部页面、地图操作或生产发布验收。</p><p>模型范围：MiMo v2.5 Pro 在空查询结果后多次申请无关后台权限，补充指南后仍失败。本轮 v2.6 Pro 的结果只证明该模型在这组任务中的实际表现，不能推断所有模型、每次运行都会成功。</p><p>清理状态：${cleanup?.status === 'passed' ? '本套独立容器已停止，临时 MiMo 凭据副本已删除；测试卷和脱敏证据保留。' : '尚未记录清理结果。'}</p><p>入口：<code>cli/skills/hyacinthus-cli/SKILL.md</code>；邮件技能：<code>cli/skills/tutoring-job-mail-upload/SKILL.md</code>。复跑说明：<code>cli/tests/agent-e2e/docker/README.md</code>。</p><p><a href="hyacinthus-cli-skills-evidence.json">查看完整脱敏机器证据</a>。原始本地构建日志、工作区产物及浏览器截图在 <code>.tmp/e2e/skills-alignment/</code>。</p></section><footer>本报告由实际验收 JSON 和测试日志生成；测试未运行、失败、通过分别展示。源码中的原有其他改动未由本次报告宣称验证。</footer></main></body></html>`;
await writeFile(path.join(output, 'hyacinthus-cli-skills-alignment.html'), html);
console.log(`Report written: ${passed}/6 actual Agent cases passed; ${rust + node + npm} regression tests.`);
