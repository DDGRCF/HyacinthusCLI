# 同一 Pi 容器的标准验收 SOP

<!-- 改动说明：统一清单、Docker入口、确认规则、逐例证据和清理；全部编译使用单job。 -->

## 一次完整测试

在仓库根目录构建当前后端和 CLI/Pi 镜像；**所有编译 job=1**：

```bash
docker build --network host -f docker/backend.Dockerfile --build-arg CARGO_BUILD_JOBS=1 -t hyacinthus-skills-e2e-backend:20261006 .
docker build --network host -f cli/tests/agent-e2e/docker/agent.Dockerfile -t hyacinthus-skills-e2e-pi:20261007-v5 .
```

然后进入 `cli/tests/agent-e2e` 执行：

```bash
npm run test:agent -- --mode docker --sop full
```

前提：Docker、Node、Playwright Chromium 已安装；本机Pi已登录 `xiaomi-token-plan-cn`；本机`.env.runtime`有可用腾讯地图server/browser配置（可用HYACINTHUS_E2E_MAP_ENV_FILE指定专属地图env）。执行器只复制该 provider 的临时凭据，管理员和地图凭据不进入Agent容器；地图只复制allowlist两项到测试API/Worker，先探测真实地图服务，再验证运行中的Rust API确实取得定位，之后才进入Agent业务。容器NO_PROXY包含内网及apis.map.qq.com，避免继承的宿主loopback代理挡住地图请求。

完整轮次持有专属环境锁，在开始时仅初始化一次项目 `hyacinthus-skills-acceptance`，通过受保护的 Rust admin 命令重建该项目的 `hyacinthus_test`。不会连接宿主业务库。准备时停止其它正在占用这一测试项目的任务；不能中途 reset、改 Skills 或换容器。

## 固定用例

机器清单：`cases/sop-v3.json`，执行与报告共同读取。详细操作卡为 `/tmp/hyacinthus-shared-container-test-plan.html` 第10章。

| 编号 | 检查 | 通过标准 | 类型 |
| --- | --- | --- | --- |
| A1 | 正式安装器导出 | 自动、指定 Pi、相对目录均得到2入口/11引用；与二进制一致 | 容器工程 |
| A2 | 旧清单升级和损坏 | 清理登记的旧入口；保留自建文件；缺失/改坏引用被检出 | 容器工程 |
| A3 | 离线读取 | 无凭据、真实 seccomp 禁止 socket/connect、坏配置均可读13份正文；拒绝越界路径；守护CLI在任务子目录读取相对输入并保存完整预览 | 容器工程 |
| B1 | 自然语言发现 | 默认 Pi loader 发现入口；Agent自行读技能并正确回答 | 真实 Pi |
| B2 | doctor | 健康实例实际 strict 通过；保留有效token并真实禁止CLI socket/connect时明确失败且不继续写入 | 真实 Pi |
| B3 | 未登录查询 | 原始 URL 真实浏览器授权；继续原申请；合法空查询直接结束 | 真实 Pi |
| C1 | 修改显示名 | 实际预览、批准前不变、批准指纹匹配、回读目标值 | 真实 Pi |
| C2 | 创建前缀规则 | 实际正则 `^<run_id>-`，优先级5；D3验证实际命中 | 真实 Pi |
| D1 | 邮件保存/整理 | 原始字节/SHA稳定，30条顺序和20标签正确，相对路径可解析 | 真实 Pi |
| D2 | 解析与预览 | API/Worker真实解析；保留诊断；核对全部来源字段与30条请求；检查解析优先级保留、CNY、唯一数学/初一年级及未编造学校或需求方学历 | 真实 Pi＋独立角色解析工程检查 |
| D3 | 导入/完整详情 | 批准前0条；created30/updated0/failed0；独立管理员详情逐条正确（401时重新登录并仅重试只读请求一次） | 真实 Pi＋宿主只读 |
| D4 | 新会话重放 | 同容器新会话保留邮件状态；already_imported整数30、新增0、未尝试写入，30个ID和首次结果不变 | 真实 Pi |
| E1a～f | 负例和恢复 | 拒绝授权、歧义确认、旧批准拒绝变化、未知结果原键恢复、明确失败新子批次、online缺地址拒绝；分别记录真实Pi/协议覆盖 | 混合 |
| E2 | 清理/报告 | 授权撤销、临时模型凭据删除、Pi停止、地图复制密钥与API/Worker容器移除、已知密钥写证据前脱敏、公开文本扫描、桌面手机渲染 | 宿主 |

D1～D3自然连续在一个业务会话执行，阶段检查独立留证。D2另用控制器提交20字段角色样本，仅真实解析，核对不同的用户电话、管理员电话及管理员微信，不上传岗位、不把该样本或答案交给模型；contact-field-probe.json明确标记工程检查。其它任务开新会话/profile。D4开新会话保留邮件profile和任务目录。每例核对同一容器ID、CLI哈希与Skills哈希。

## 固定用户回应

- 无邮件来源：仅提供 `saved_mail.txt`，说明是保存邮件、不连接邮箱。
- CLI授权：真实浏览器打开原始链接、核对任务范围后批准，再说明“CLI访问权限已批准，请完成预览并等待业务确认”。
- 歧义：仅回答样本预设问题；不要给命令或修好的payload。
- 写入：核对完整预览的数量、编号、业务字段、哈希及稳定键后，再说该例确认语。
- 改输入：重新预览批准；旧批准不可用于新数据。
- 未知回执：先核对真实状态，保留原请求和原键；确定失败的新子批次才用新键并重新批准。

批准和真实事件保存在宿主；CLI由宿主调度**在同一 Pi 容器**执行。Agent仍使用默认工具和正式安装的 Skills，没有注入操作脚本、答案或宿主历史对话。root封存输入并在执行前校验真实预览指纹。Pi启用SDK自带模型重试，最多2次，事件记录到pi-events.ndjson；这是模型请求续接，保留已有工具历史，不自动重试业务写入。超过预算仍真实失败。

## 实际业务字段

30条均为 tutoring/online/数学/初一、家长发布、男学生、女老师、本科、有家教经验；第1～30条分别100～129元/小时；每周1次、120分钟、周六14:00～16:00；管理员电话13800138000；优先级5；地址明确为杭州市西湖区浙江大学紫金港校区，由真实腾讯地图及后端取得定位；不编造坐标。按小时计费接受CLI schema示例的`hour`及后端解析器产生的`hourly`；不接受其它单位或未知值。

期望只存在宿主验证程序。当前批量契约包括online也必须有地址、有效定位和合法管理员contact。sop-v1的无地址样本曾真实失败，记录保留；v2使用明确地址并增加E1f。v3将邮件入口与通用指南统一为20字段，管理员电话进入专门列，授课方式显式，用户联系方式与管理员微信未知时留空；旧v2结果属于历史16字段验收，不替代当前v3。CLI search用于编号/ID摘要，完整字段使用独立管理员详情。未提供职业身份时不把“有经验”塞进职业枚举。warnings只展示；后端errors必须真实修正和必要确认，未解决信息保持阻塞。

## 结果和专项

结果：`/tmp/hyacinthus-sop-runs/<run_id>/result.json`、`report.html`、`cases/<id>/`、渲染截图；总览 `/tmp/hyacinthus-sop-latest.html`。

```bash
npm run test:agent -- --mode docker --sop selected --cases D1,D2,D3,D4
npm run test:agent -- --mode docker --sop selected --cases A3,B1
npm run test:agent -- --mode docker --sop selected --cases A3,B1 --preserve-run SOP完整轮次ID
npm run test:report -- --run <run_id>
```

专项自动加入依赖，在既有容器恢复临时模型凭据并开新轮次；不会reset。缺环境或既有版本不符合时应先做完整验收。未选项标not_run，不称全量通过。

完整测试后可运行 `A3,B1` 专项验证同容器复用和相对路径。`--preserve-run` 替换为完整通过轮次的实际 `SOP` 数字ID；执行器独立回读其30条岗位，检查原ID、编号、创建时间和全部来源字段，并生成 `same-container-reuse.json`。同时对比两轮 `fingerprint.container_id`、`image_id`、`cli_hash` 和 `skills_hash`，必须全部一致；两轮状态分别保留。专项会建立新的任务目录，不能把旧邮件结果当作这次产物。执行器允许切入本任务的物理子目录，拒绝越界路径与指向任务外的符号链接；相对输入、输出按实际工作目录解析。

状态：passed/failed/blocked/not_run。失败记录产品、Agent、验证程序或环境原因；不覆盖历史，不自动盲重试写入。失败也必须执行清理和生成报告。

旧宿主模式保留为 `test:agent:host` / `test:report:host`，仅作诊断，结果不计入同容器验收。旧 `docker/acceptance.mjs` 不再作为标准入口；共同执行逻辑在 `sop-run.mjs`。
