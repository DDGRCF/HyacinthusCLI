# 授权和环境

查看当前环境和本地授权：

```bash
hyacinthus auth status
```

沿用返回的地址和 profile。首次安装且未配置时默认 `https://www.fxzjjzx.cn`；仅用户要求切换时改配置。`token_present` 只说明本地有 token，不证明远端授权仍有效。

## 授权步骤

1. 从任务 schema 汇总所需 scopes，无 token 或缺权限时申请。
2. 若错误 `AUTH_REQUIRED` 已带 session 和 `authorize_url`，直接沿用；否则创建一次会话：

```bash
hyacinthus auth login --scope "<required scopes>"
```

3. 收到 pending 时，展示原始 `authorize_url` 和 `user_code`，结束当前回复，等用户批准。批准前不执行 auth wait，也不重复 login。
4. 批准后沿用同一 profile、session：

```bash
hyacinthus auth wait
```

`token_saved: true` 后继续原任务。若 `acknowledgement_pending: true`，再执行同一 `auth wait`。不要再次 login 创建新链接。授权批准的是访问权限；任务要求先预览时，仍按[写入确认](output-risk.md)执行。

不索取或打印 token、设备密钥。`auth check --scope` 只检查本地 scope 提示；不带 scope 时会访问 capabilities。实时授权详情用 `auth token status`。logout/revoke 会撤销授权，只在用户要求时执行；`logout --local-only` 只清本地。

## 检查实例

```bash
hyacinthus doctor --strict
```

逐项读成功输出的 `data.checks`；strict 失败读 `error.detail.checks`。默认 doctor 可能在检查失败时仍返回 `ok: true`。`--offline` 跳过连接检查，仍检查 token。

只检查实例时复用已有授权；尚未授权可申请最小的 `requirements:read`。读完 doctor 检查项后报告并结束，不额外查询需求/options或扩业务权限；通过仅表示这些检查通过，不代表全部业务功能已验收。无需 `admin:read` 或 `admin status`。连接失败保留环境，报告具体检查项和错误。

## 身份和安装

单 Agent 通常无需手填身份。非空的 `HERMES_HOME`、`CODEX_HOME`、`CLAUDE_HOME` 按目录名生成 profile，例如 `~/.codex` 对应 `codex-codex`；否则沿用 active profile 或 `local`。多实例用独立 home 或显式 profile，不复制示例 instance ID。

Pi 标记或非空 `PI_CODING_AGENT_DIR` 优先于其他 Agent home；默认 `pi-agent`，自定义目录为 `pi-<目录名>`。显式 `--profile`、`HYACINTHUS_PROFILE` 优先。SDK 可设置 Pi 目录或配置 `client_type: pi`。

未安装时用 GitHub 安装脚本，自动导出 Skills 到已有 Agent 目录：

```bash
curl -fsSL https://raw.githubusercontent.com/DDGRCF/HyacinthusCLI/main/scripts/install.sh | bash
```

有 npm 包访问权限时也可用 `npx @ddgrcf/hyacinthus-cli install --skills-target codex`；此安装器下载时还需 GitHub token。target 可为 `codex|claude|hermes|pi`，目录可用 `--skills-dir`。已有 CLI 时用 `hyacinthus skills export --dir <agent-skills-dir>` 更新 Skills，安装后新会话加载。
