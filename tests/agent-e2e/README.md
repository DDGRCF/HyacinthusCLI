<!-- 改动说明：同步SOP v5版本、21字段及15项/7子项数量，区分当前Docker验收与宿主诊断入口。 -->
# 默认入口：共同 Docker SOP

当前默认真实 Agent 验收为 `npm run test:agent -- --mode docker --sop full`，使用21字段及学校来源查询v5，执行清单为 [sop-v5.json](cases/sop-v5.json)。详细操作见 [SOP.md](SOP.md)。下面原宿主流程保留作 `test:agent:host` 诊断，不计入同容器验收。全部编译使用 job=1。

# 原宿主模式：Pi 驱动 CLI 的邮件批量上传诊断

## 一次正常用户流程

1. CLI 将两个正式 Skills 及全部引用文件 安装到 Pi 的普通 `skills` 目录；Pi 自动发现它们，不给测试 Agent 注入完整操作脚本。
2. 首轮用户只发：**“帮我上传一下邮件里的家教岗位。”** 没有真实邮箱工具时，用户补充指定当前目录的 `saved_mail.txt`。
3. Pi 自己选 Skill、保存来源、整理全部 30 条为固定 21 字段、发起 CLI 授权。用户模拟器只批准 Pi 展示的原始链接；Pi 续接同一会话。
4. Pi 调用真实 API/Worker 解析并 dry-run，展示 30 条摘要并请求批次批准。宿主绑定预览 payload 哈希和幂等键，批准后才允许执行真实导入。
5. Pi 自己逐条回读和如实汇报；独立验收再核对30个编号、薪酬、教师/学生条件、科目/年级、联系方式和时间。再次上传同一邮件不得重复创建。

本目录属于 CLI 交付；后端运行仍只有 `backend/`。`tester-army/e2e@0.17.0` 组织用例，不使用它的内置 Agent 代替 Pi，不再使用 Codex。真实 Pi SDK 在独立原生 Node 进程运行，避免 e2e 的 tsx 加载钩子污染 SDK；外层超时会取消子进程并等待清理。

## 原宿主模式启动（诊断）

```bash
cd cli/tests/agent-e2e
npm ci
npm test                # 离线协议、策略、报告与实际 Pi SDK 接口
npm run test:sandbox    # 真实 bubblewrap/默认工具边界/文件队列，不调用模型或数据库
npm run preflight      # 检查既有测试 API/UI/管理员输入
npm run test:agent:host # 真实 Pi SDK 会话、浏览器授权、Worker、完整导入和重放
npm run test:report:host # 先跑当前离线回归，再跑真实场景，合并用例和实际耗时到 latest.html
```

需要 Linux、bubblewrap、已安装并登录的 Pi、已编译的真实 CLI、浏览器，以及**现有且已准备好的**测试 API/Worker/管理端。后端 readiness 必须明确返回 `x-hyacinthus-test-database: hyacinthus_test`。测试持有后端集成锁，不启动服务、不 reset、不 seed、不读取业务 `.env`；门禁失败就停止，不换成业务库。

`HYACINTHUS_E2E_ADMIN_PASSWORD` 通过私密环境提供，不放入聊天、命令参数、报告或 Agent 工具环境。复用测试管理员账号可由 `HYACINTHUS_E2E_ADMIN_USERNAME` 设置。

### 复用已运行的 Docker 测试栈

现有 `hyacinthus-skills-acceptance` 项目的 API/UI 为 `18012`/`18013`，不能拿原生默认 `8001`/`5667` 误判它未运行。API readiness 必须返回测试库标记，Worker 必须存活。

```bash
cd cli/tests/agent-e2e
node lib/run-existing.mjs http://127.0.0.1:18012 http://127.0.0.1:18013 \
  ../../../.tmp/e2e/skills-alignment/private/driver.env
```

此入口只读取权限为 `0600` 的既有管理员 env，直接运行正常报告流水线，不执行初始化、重建或 seed；不把密码放入命令参数或 Agent 工具环境。需要不同测试端口时显式替换 URL。

### 可配置输入

| 环境变量 | 默认/职责 |
| --- | --- |
| `HYACINTHUS_AGENT_E2E_API_URL` / `HYACINTHUS_AGENT_E2E_ADMIN_URL` | `http://127.0.0.1:8001` / `http://127.0.0.1:5667`，仅 loopback |
| `HYACINTHUS_E2E_CLI_BINARY` | `cli/target/debug/hyacinthus`，必须含当前 bundled Skills |
| `HYACINTHUS_AGENT_E2E_PI_BINARY` | `pi`；使用其实际安装旁的 SDK，不另装或模拟 Agent |
| `HYACINTHUS_AGENT_E2E_PI_PROVIDER` / `HYACINTHUS_AGENT_E2E_PI_MODEL` | 未设置时读取 Pi 现有默认模型；不自动切换模型 |
| `PI_CODING_AGENT_DIR` | 默认 `~/.pi/agent`，宿主 SDK 使用其既有认证，不复制凭据 |
| `HYACINTHUS_AGENT_E2E_CHROME_BINARY` | 可选现有 Chromium；否则 Playwright 默认浏览器 |

默认低推理强度；每轮硬上限 4 分钟、最多 7 轮、整个场景 20 分钟、最多 128 次 CLI 调度。**这些是预算，不是实测用时**；实际耗时以报告为准。模型账单由选定的 Pi 模型产生。当前使用合成的保存邮件样本，不代表访问了真实邮箱。

## HTML 报告

每次场景执行都产生：

- `cli/tests/agent-e2e/reports/latest.html`：最新报告，可直接浏览器打开。
- `cli/.tmp/agent-e2e/<PIMAIL批次>/report.html` / `result.json`：对应批次的 HTML 和机器可读结果。
- `pi-events.jsonl` / `cli-events.jsonl` / `conversation.json`：脱敏 Pi 默认工具与真实 CLI 调度证据。
- `snapshots/`：整理文本、预览输入、实际执行输入与脱敏回执，宿主保护，Agent 无法修改。

报告明确区分 **通过、失败、阻塞、未运行**，显示实际案例/阶段用时、卡点和证据。没有记录用时则显示“未记录”；不把离线通过或 Skill 被发现称为真实岗位导入通过。输入、授权 UI 或模型不可用时也生成阻塞报告。

## 隔离与批准

Pi SDK 和模型连接在宿主运行，四个真正默认工具 `read/bash/edit/write` 的 IO 放入 bubblewrap 空根、网络/PID/mount 隔离。只挂载系统运行文件、本次工作区、只读 Skills/CLI 客户端；宿主认证、业务配置和其它产物不挂载。`/tmp` 仅绑定隔离的系统临时目录；正式 Skill 的产物统一保存在相对路径 `tasks/<run_id>/`。

工具使用 `hyacinthus` 文件队列客户端。该宿主队列套件保留业务 JSON stdout 以便独立留证，不允许 --jq/-q/--format；此环境事实写入测试工作区说明，大结果可保存 --output 文件后自行汇总。独立 Docker 套件使用完整 CLI，支持正常投影。请求目录可写，队列根和响应只读；宿主 broker 执行**真实 CLI 二进制**、固定 API/profile、记录退出码和结果。批准及事件账本不暴露给 Agent。执行的输入是宿主不可变副本，不再重新读取 Agent 可替换的已批准文件。

授权 UI 的 `/api/` 请求固定转发真实测试 API（不伪造响应），阻断 Service Worker、WebSocket 和外部站点，避免现有开发代理误用业务 API。路由实现参考 [Playwright 网络文档](https://playwright.dev/docs/network)。

结束后取消工具和 CLI、撤销本次临时 profile 授权、删除临时 CLI profile、移除原始授权链接和临时队列响应，再发布脱敏报告。任一清理失败都会使验收失败。仍需 CI 容器/资源限额与恶意输入专项审查；本地隔离不是完整系统安全证明。

正式用户也可正常安装这些 Skills：

```bash
hyacinthus skills export --dir "$HOME/.pi/agent/skills"
pi
```

启动后发同一句邮件上传请求；真实邮箱接入是后续独立用例，不在本轮保存邮件测试中。

## 完全独立 Docker 验收

`docker/compose.yml` 部署专用 PostgreSQL/PostGIS、Redis、API、Worker、管理端和 Pi。Pi 在容器内通过正式安装器安装 Skills，使用本机 MiMo Token Plan 的单一 provider 临时凭据；不挂载宿主 Agent 配置或业务环境。

当前标准入口是 `npm run test:agent -- --mode docker --sop full`，由 `docker/sop-run.mjs` 按v5清单执行15个顶层用例及7个恢复子项（E1a～g），包括C3学校查询。结果在 `/tmp/hyacinthus-sop-runs/<run_id>/`，最新报告为 `/tmp/hyacinthus-sop-latest.html`。已有结果可用 `npm run test:report -- --run <run_id>` 重新生成报告；该命令不执行验收。业务契约、构建、初始化、固定用户回复和清理见 [SOP.md](SOP.md) 与 [docker/README.md](docker/README.md)。`docker/acceptance.mjs` 是历史六项脚本，不再作为标准入口。
