<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
## 配置

```bash
hyacinthus auth status
```

首次安装且未配置环境时默认使用 `https://www.fxzjjzx.cn`。`auth status` 已返回配置地址/profile，或环境变量已配置时，以当前环境为准；网络失败不授权切换生产环境、改 profile、清理凭据或要求用户粘贴 token。先检查该地址的连通性和代理设置，再如实报告具体故障。仅用户明确要求切换开发或 staging 场景时，使用用户提供的实例配置：

```bash
hyacinthus config set-profile dev --base-url http://localhost:8000 --default-instance-id <instance_id>
```

不要把示例 instance ID 复制进命令。除非用户明确给出其他 instance ID，否则使用当前 profile 的默认实例。

不要要求用户粘贴原始 token。如果 `auth status` 返回 `token_present: false`，使用 本指南 中的授权链接/二维码流程。

不要打印 token 或 secret。`config show` 会对 token 字段脱敏。

## 授权链接流程

只有尚未创建授权 session 时，才为需要的 scopes 创建会话。命令返回 `AUTH_REQUIRED` 时先读取已有 `authorize_url` / session 信息；若已经创建会话，展示同一链接并结束本轮回复，等用户批准后运行 `auth wait`，不要再次 login：

```bash
hyacinthus auth login --scope "<required scopes>"
```

读取以下字段；CLI 已将设备密钥收口到 `0600` 的本地 pending state，不会在正常输出中返回它：

- `session_id`
- `pending_state`（只是本地私有文件路径，不转交给用户）
- `authorize_url`
- `qr_code_text`
- `user_code`
- `required_scopes`
- `expires_at`

用户确认完成授权后，等待同一个 session：

```bash
hyacinthus auth wait
```

只有 `token_saved` 为 `true` 后，才能重试原业务命令。如果同时返回 `acknowledgement_pending: true`，本地已经认证成功，再次运行 `hyacinthus auth wait` 即可恢复后端确认。

发送授权链接给用户后，不要再运行 `hyacinthus auth login --scope ... --wait`。这会创建新的授权 session，无法观察已经发给用户的链接是否完成授权。

## 授权与写入确认

授权链接批准的是CLI访问权限。原任务要求先预览时，auth wait成功后继续完成预览并等待单独的业务确认；不能把“授权已批准，请继续”当作批准新建规则、修改资料或导入岗位。一次回复同时展示授权链接和业务预览时，也要分别记录访问批准与批次批准。用户已经明确批准过原业务预览时可以保留该批准，但执行内容必须与原批准一致。

## Agent 身份

`hyacinthus` 会把授权绑定到 profile。每个 profile 都会自动获得稳定的 `client_instance_id`、display name 和一个受支持的 `client_type`。

支持的 client type 和默认值：

| Agent | 默认 home | 默认 profile | client_type | 多实例规则 |
| --- | --- | --- | --- | --- |
| Hermes | `~/.hermes` | `hermes-default` | `hermes` | 使用独立 `HERMES_HOME` 或 `HYACINTHUS_PROFILE` |
| Codex | `~/.codex` | `codex-default` | `codex` | 使用独立 `CODEX_HOME` 或 `HYACINTHUS_PROFILE` |
| Claude Code | `~/.claude` | `claude-default` | `claude` | 使用独立 `CLAUDE_HOME` 或 `HYACINTHUS_PROFILE` |
| Pi | `~/.pi/agent` | `pi-agent` | `pi` | 使用独立 `PI_CODING_AGENT_DIR`（目录名须不同）或 `HYACINTHUS_PROFILE` |
| Terminal CLI | `$HOME` | `local` | `hyacinthus-cli` | 使用显式 `--profile` 隔离 |

单 Agent 安装通常不需要手动设置身份变量。多 Agent 安装时，Agent home 与 `HYACINTHUS_PROFILE` 必须指向同一个逻辑实例。

Pi profile 优先级：显式 `--profile` > 非空 `HYACINTHUS_PROFILE` > Pi 进程/配置目录 > 其他 Agent home > 当前 active profile > `local`。`AI_AGENT=pi`、`PI_CODING_AGENT=true` 或非空 `PI_SESSION_ID` 识别 Pi；非空 `PI_CODING_AGENT_DIR` 也识别 Pi 并覆盖默认目录。默认 profile `pi-agent`，自定义目录对应 `pi-<目录名规范化后>`，不使用会话 ID 生成身份。Pi 不会被遗留 `CODEX_HOME` 抢占。SDK 不保证进程标记，可设置 `PI_CODING_AGENT_DIR` 或显式配置 `--client-type pi` 的 profile。

`pi` 只匹配 profile 名中的完整 token，例如 `pi-agent`、`worker_pi`；`api-prod`、`spider` 不会被误判。既有 profile 身份与 Token 的实例、client type、backend 绑定校验不变。

Pi 技能安装使用 `npx @ddgrcf/hyacinthus-cli skills install --target pi`，默认 `~/.pi/agent/skills`，非空 `PI_CODING_AGENT_DIR` 覆盖为该目录下的 `skills`；显式 `--dir` 优先。不会启动 Pi 或读取 Pi credentials。


## 正常授权顺序

### 单独检查实例是否可用

用户只要求检查实例或诊断CLI时，先用 `auth status` / 已脱敏的 `config show` 确认当前实例，然后运行 `doctor --strict`。doctor检查本地配置、内嵌清单和受认证的capabilities端点；不是后台业务状态查询，不调用 `admin status` 或申请 `admin:read`。

未登录时先向用户说明在线doctor需要有效Agent授权。只为本次只读检查申请最小的 `requirements:read`，展示原始链接并等待用户批准，再对同一申请 `auth wait`，重新运行 `doctor --strict`。当前profile已经有有效授权时复用，不为了doctor重新申请其他业务权限。连接失败保持当前环境并报告，不换生产地址。

先确定本次能力的 required_scopes，再运行 `auth status`。没有 token 时运行 `auth login --scope "<required scopes>"`，向用户展示原始 authorize_url 和 user_code；不要输出设备密钥。用户完成授权后对同一 profile 运行 `auth wait`。

业务返回 AUTH_REQUIRED 且 `error.detail` 已含会话时，直接展示该会话的原始链接并结束本轮。用户明确完成批准后才 wait；同一轮先等待会导致用户拿不到链接、无法批准。不要反复创建链接。已有 token 但权限不足时按实际缺失 scopes 补授权，不要求用户粘贴 token。

`auth check --scope "..."` 检查本地 scope 提示，不能证明服务端实时授权；真实 grant 详情用 `auth token status`。完成授权后按公共规则运行 `doctor --strict`。`auth logout` 和 `auth token revoke` 撤销远端授权，不能当作普通排障第一步。

## CLI 未安装

先检查 `hyacinthus --version`，已安装就使用它。正式安装通过 `npx @ddgrcf/hyacinthus-cli install`；指定 Agent 可用 `--skills-target codex|claude|hermes|pi`，指定目录用 `--skills-dir <dir>`。私有发布需要现有 npm/GitHub 访问权，不输出访问凭据。安装后新会话才能可靠加载新增 Skills。
