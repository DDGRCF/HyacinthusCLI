---
name: hyacinthus-shared
version: 0.1.0
description: "风信子家教中心 Hyacinthus CLI 通用规则：配置、授权、doctor、能力 schema、输出 envelope、dry-run 和高风险确认。"
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus --help"
---

# 风信子家教中心 Hyacinthus CLI 通用规则

当 Agent 需要通过 `hyacinthus` 操作风信子家教中心时，使用本 skill。

## 第一步

业务操作前先运行：

```bash
hyacinthus doctor
```

如果 `doctor` 报告失败项，不要继续执行业务命令。把失败检查项和 hint 汇报给用户。

## Workspace 文件规则

所有 Agent 都可以在有利于审计、批处理或结果复核时写文件。生成文件必须保留在当前 workspace 内，命令参数和 Agent 文件工具调用必须使用相对路径。这些文件和路径规则适用于所有运行 `hyacinthus` 的 Agent 集成，不限定某一个 runner。

推荐路径：

- `inputs/...`：用户提供或整理后的输入文件。
- `outputs/...`：dry-run、execute、parse 或 review 结果文件。
- 当文件路径会直接传给 `hyacinthus --file` 或 `hyacinthus --output` 时，优先使用 workspace 根目录下的简单文件名，例如 `input_hz260514700.txt`、`output_hz260514700_dry.json`。部分 Agent 命令 runner 会拒绝 CLI 参数里的路径分隔符。

如果同一任务已经存在生成文件，要么明确覆盖，要么使用带短 run 后缀的唯一文件名。辅助脚本名必须包含当前任务或批次名，例如 `helper_build_batch05.py`、`helper_report_nb_20260524.py`；不要在反复执行的任务里使用 `helper_build_confirmed.py`、`helper_report.py` 这类泛名。不要为了规避文件名冲突而切换到绝对路径。

不要在 `hyacinthus` 命令参数或 Agent 文件工具路径中使用 `/tmp/...`、`/usr/local/bin/...`、`/data/...` 或宿主机特定工作目录。不要先 `cd /...` 再运行 `hyacinthus`。这是所有当前和未来 Agent runner 的通用规则，因为绝对路径可移植性差，也容易触发工具安全限制。如果命令 runner 拒绝包含 `/` 的路径，单条记录改用 `--text`，批量记录改用 workspace 根目录下的简单文件名。

辅助命令也遵守同一规则。需要检查或转换 JSON 时，在当前 workspace 写一个任务专用的小 helper 脚本，使用唯一文件名或明确覆盖，然后用 `python3 helper_name.py` 处理相对输入/输出文件。不要使用 `/tmp`、`/data`、workspace 绝对路径或 `cd /...`。

命令摘要优先使用 `hyacinthus ... --output result_name.json`，再用 workspace 本地 helper 脚本读取 `result_name.json`。常规流程不要把 `hyacinthus` 输出 pipe 到内联 shell/Python 片段；一些 Agent 命令 runner 会把这类复合 shell 模式判定为不安全。

## 配置

```bash
hyacinthus auth status
```

生产安装默认使用 `https://www.fxzjjzx.cn`；除非用户明确要切换非生产环境，不要要求用户输入 Hyacinthus server URL。仅在开发或 staging 场景，用用户提供的默认实例配置 profile：

```bash
hyacinthus config set-profile dev --base-url http://localhost:8000 --default-instance-id <instance_id>
```

不要把示例 instance ID 复制进命令。除非用户明确给出其他 instance ID，否则使用当前 profile 的默认实例。

不要要求用户粘贴原始 token。如果 `auth status` 返回 `token_present: false`，使用 Agent-specific skill 中的授权链接/二维码流程。

不要打印 token 或 secret。`config show` 会对 token 字段脱敏。

## 授权链接流程

当 `auth status` 返回 `token_present: false`，或命令返回 `AUTH_REQUIRED` 时，为需要的 scopes 创建授权 session：

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

## Agent 身份

`hyacinthus` 会把授权绑定到 profile。每个 profile 都会自动获得稳定的 `client_instance_id`、display name 和一个受支持的 `client_type`。

支持的 client type 和默认值：

| Agent | 默认 home | 默认 profile | client_type | 多实例规则 |
| --- | --- | --- | --- | --- |
| Hermes | `~/.hermes` | `hermes-default` | `hermes` | 使用独立 `HERMES_HOME` 或 `HYACINTHUS_PROFILE` |
| Codex | `~/.codex` | `codex-default` | `codex` | 使用独立 `CODEX_HOME` 或 `HYACINTHUS_PROFILE` |
| Claude Code | `~/.claude` | `claude-default` | `claude` | 使用独立 `CLAUDE_HOME` 或 `HYACINTHUS_PROFILE` |
| PicoClaw | `~/.picoclaw` | `picoclaw-default` | `picoclaw` | 使用独立 `PICOCLAW_HOME` 或 `HYACINTHUS_PROFILE` |
| NullClaw | `~/.nullclaw` | `nullclaw-default` | `nullclaw` | 使用独立 `NULLCLAW_HOME` 或 `HYACINTHUS_PROFILE` |
| Terminal CLI | `$HOME` | `local` | `hyacinthus-cli` | 使用显式 `--profile` 隔离 |

单 Agent 安装通常不需要手动设置身份变量。多 Agent 安装时，Agent home 与 `HYACINTHUS_PROFILE` 必须指向同一个逻辑实例。

## 能力发现

调用不熟悉的能力前先查看 schema：

```bash
hyacinthus capability list
hyacinthus schema requirements.batch_parse
hyacinthus capability schema requirements.batch_import
```

`hyacinthus capability list` 默认优先读取后端能力清单；离线或排查 CLI 自带清单时使用 `--embedded`。当后端接口或能力有变动，先运行：

```bash
hyacinthus capability verify --remote
hyacinthus capability diff --remote
```

如果 `verify` 或 `diff` 报告 drift，不要继续凭记忆调用新能力；先按返回的 capability id、schema 和 required scopes 调整命令。

`hyacinthus capability run <capability_id>` 是通用兜底执行器，只在没有更具体的领域命令时使用。使用前必须：

- 先查看 `hyacinthus capability schema <capability_id>`。
- 按 request_schema 构造 JSON 请求，并让 CLI 做 schema 校验。
- 写能力仍然必须先 `--dry-run`，用户批准后才加 `--yes`。
- GET 能力需要分页时，只在 capability 标记支持分页时使用 `--page-all`。

完整 Agent API 与 capability 对照表维护在主仓库 `docs/requirements/agent-cli/08-agent-api-index.md`。如果某个 `/api/v1/agent/*` 端点或 capability 不在索引里，先补文档再使用或实现新命令。

新增 capability 时，优先使用更语义化的命令，例如 `requirements search/options/parse/import`、`requirements catalog ...`、`user me/update`、`claw status/skills list`。只有语义化命令不存在时，才回退到 `capability run`。

## 用户资料能力

当前授权用户资料用：

```bash
hyacinthus user me
```

更新资料属于写操作，必须先 dry-run，确认后执行：

```bash
hyacinthus user update --display-name 张老师 --contact-wechat fxz-teacher --dry-run
hyacinthus user update --display-name 张老师 --contact-wechat fxz-teacher --yes
```

从 JSON 更新完整资料时使用相对文件名，例如：

```bash
hyacinthus user update --data @profile.json --dry-run
```

不要把手机号、邮箱、微信或 profile 字段写进需求导入 payload，除非对应命令 schema 明确接受该字段。用户资料写入需要 `users:read` 与 `users:write`。

## Claw 状态与 Skill 查询

排查运行环境时使用只读命令：

```bash
hyacinthus admin status
hyacinthus claw status
hyacinthus claw skills list
```

`hyacinthus skills list/show/export/check` 查询的是 CLI 内置/导出的本地 bundled skills；`hyacinthus claw skills list` 查询的是后端登记的 Claw skills。不要混用这两类结果：前者用于确认 CLI 自带说明文件，后者用于确认后台 skill 仓库和实例可选项。

## 输出协议

默认输出是 JSON：

- `ok: true` 表示成功。
- `ok: false` 表示结构化失败。
- 读取 `error.type`、`error.code`、`error.hint` 和 `error.retryable`。
- 不要假设一定存在 `data`。先检查根对象是 `ok/error/data`、`rows/summary` 还是其他文档化形态。
- 如果 CLI 命令返回 `ok: false`，除非命令文档有明确恢复路径，否则停止业务流程并汇报结构化错误。
- 不要假设 Agent 运行时安装了 `jq` 或 `yq`。
- `hyacinthus -q` 只支持简单 dot path 和 `[]` 展开。不要在这里使用 object constructor、pipe、map、filter 或其他复杂 jq 表达式。
- 复杂 JSON 检查或 payload 构造，使用 workspace 本地的小 Python helper 脚本和相对文件名。
- helper 读取命令输出文件时，同时兼容 envelope 和 bare-result 形态：`body = payload.get("data", payload)`。除非已经检查过根 keys，否则不要直接写 `payload["data"]`。
- 汇报导入结果必须来自真实命令输出。不要在 report 脚本里硬编码 `created_ids`、计数或状态。

退出码：

- `0`：成功
- `1`：API/业务错误
- `2`：校验错误
- `3`：认证/权限错误
- `4`：网络错误
- `5`：内部错误
- `6`：内容安全阻断
- `10`：需要确认

## 高风险确认

当命令以退出码 `10` 结束且 `error.type == "confirmation_required"` 时：

1. 向用户展示 `error.risk.action` 和重要参数。
2. 请求用户明确批准。
3. 用户批准后，用原 argv 追加 `--yes` 重试。
4. 用户拒绝则停止。

不要自动追加 `--yes`。

## Dry Run

写操作优先使用：

```bash
hyacinthus <command> --dry-run
```

Dry-run 输出会脱敏敏感字段，并且不会写入数据。
