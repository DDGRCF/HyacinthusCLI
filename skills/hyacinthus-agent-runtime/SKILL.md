---
name: hyacinthus-agent-runtime
description: 在 Agent 运行时使用风信子家教中心 Hyacinthus CLI，包括链接/二维码授权交接。
---

# 风信子家教中心 Hyacinthus CLI Agent 运行规则

当 Agent 运行时需要通过 `hyacinthus` CLI 操作风信子家教中心时，使用本 skill。

## 运行时文件路径

Agent 文件工具和 shell 命令必须使用当前 workspace 内的相对路径。示例：

- `skills/hyacinthus-shared/SKILL.md`
- `input_batch.txt`
- `parse_result.json`
- `confirmed_rows.json`

不要把 `/data/...`、`/tmp/...` 或其他宿主机/容器绝对路径传给 Agent 文件工具或命令参数。工具返回里出现绝对路径时，只把它当作提示信息；后续操作继续使用当前 workspace 的相对路径。

## 授权

1. 先检查当前授权 profile。单实例 Agent 可以使用默认推断 profile；多实例必须设置对应运行时 home 环境变量或 `HYACINTHUS_PROFILE`。

```bash
hyacinthus auth status
```

支持的 Agent client type：

- `hermes`：Hermes Agent
- `codex`：Codex
- `claude`：Claude Code
- `picoclaw`：PicoClaw
- `nullclaw`：NullClaw
- `hyacinthus-cli`：直接终端 CLI

2. 如果当前 profile 没有 token，或业务命令返回 `AUTH_REQUIRED`，把以下字段转交给用户：

- `session_id`
- `authorize_url`
- `qr_code_text`
- `user_code`
- `required_scopes`
- `expires_at`

必须保留授权响应里的原始 `session_id`，后续等待命令需要使用同一个 session。

3. 请用户打开授权 URL 或扫描二维码文本，并完成授权。

4. 用户确认已授权后，等待同一个 session 并保存凭据：

```bash
hyacinthus auth wait --session-id "<session_id>"
```

5. 只有 `token_saved` 为 `true` 后，才能重试原业务命令。

发送授权链接给用户后，不要再运行 `hyacinthus auth login --scope ... --wait`。这会创建新的授权 session，无法观察已经发给用户的链接是否完成授权。

多 Agent 实例不能复用同一个 `hyacinthus` profile。每个运行时 home 必须绑定独立 profile：

```bash
HERMES_HOME=/home/r/.hermes-wechat-a HYACINTHUS_PROFILE=hermes-wechat-a hermes gateway run
```

## 权限范围

- 需求解析需要 `requirements:parse`。
- 需求导入需要 `requirements:write`。
- Claw 状态和 skills 需要 `claw:read`。
- 后台状态需要 `admin:read`。

不要要求用户粘贴原始 token。必须使用授权 URL/二维码交接流程。

## 写操作

写操作优先先 dry-run；命令支持 `--output` 时，把 dry-run 输出保存到 workspace 文件中，便于审计。

只有用户明确批准，或用户请求本身已经清楚要求执行时，才可以带 `--yes` 执行。如果 Agent runner 阻止已批准命令，不要为了绕过限制而改变命令语义。使用 runner 文档支持的审批/执行路径；如果只能通过 workspace 脚本执行，脚本必须只包含用户批准过的原命令，使用相对文件名，并把结果写入 workspace 输出文件。

## 输出读取

风信子家教中心 Hyacinthus CLI 默认返回 JSON envelope。重点读取：

- `ok`
- `data`
- `error.type`
- `error.code`
- `error.detail`
- `meta.command`

遇到 `AUTH_REQUIRED` 时，授权交接字段在 `error.detail` 下。
