# 公共规则

## 执行步骤

1. 选任务指南，按已给出的命令执行；参数或权限不清楚时查该命令的 `--help`、`schema <id>`。
2. 调业务接口前运行 `auth status`。按完整任务准备权限，例如解析、导入和回读；缺授权时读[授权指南](auth.md)。
3. 首次收到 `token_saved: true` 后或排障时运行 `doctor --strict`，不用每条命令都检查。
4. 按任务指南执行；写入和恢复遵循[结果和确认](output-risk.md)。

沿用当前地址、profile 和默认实例。网络失败时检查原环境，不自行换环境或清凭据。查询成功但无匹配是正常结果，直接报告；用户指定的范围不要扩大，也不顺便查后台状态。

## 文件和能力

- 任务文件统一放在工作区 `tasks/<run_id>/`，例如 `raw.txt`、`parsed.json`、`confirmed.json`、`result.json`。CLI 参数用相对路径，重试沿用原任务目录。读取安装的 Skill 文件可用其真实绝对路径。
- `capability list`、`schema <id>` 默认读内嵌清单，不需要授权。严格离线加全局 `--no-notice`；查询后端用 `capability list --remote` 或 `capability schema <id> --remote`。
- 有专用命令就用专用命令；否则按 schema 使用 `capability run <id>`。未登记的能力报告缺口，不猜命令或绕到 raw API。
- 怀疑版本不同，用 `capability diff --remote --strict`。文档源文件更新后须重新构建、发布，已安装版本才会更新。
