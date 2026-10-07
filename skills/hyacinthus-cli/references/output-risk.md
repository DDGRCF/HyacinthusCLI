<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
## 输出协议

默认输出是 JSON：

- `ok: true` 表示成功。
- `ok: false` 表示结构化失败。
- 读取 `error.type`、`error.code`、`error.hint` 和 `error.retryable`。
- 按明确输出来源解析：未使用 `--jq` 的 JSON stdout 是 `ok/error/data` envelope；`--output` 成功文件是 bare data。形态不符时报错，不猜测另一格式。
- 如果 CLI 命令返回 `ok: false`，除非命令文档有明确恢复路径，否则停止业务流程并汇报结构化错误。
- 不要假设 Agent 运行时安装了 `jq` 或 `yq`。
- `hyacinthus -q` 只支持简单 dot path 和 `[]` 展开。不要在这里使用 object constructor、pipe、map、filter 或其他复杂 jq 表达式。
- 复杂 JSON 检查或 payload 构造，使用 workspace 本地的小 Python helper 脚本和相对文件名。
- helper 读取 stdout 保存文件时，先检查 `ok` 再严格读取 `payload["data"]`；读取 `--output` 文件时直接验证该命令的 data schema。禁止 `payload.get("data", payload)` 这种双格式兜底。
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


## 写入与确认

写入先使用命令支持的 `--dry-run` 核对目标和数据。用户请求已清楚授权该写入且预览没有超出范围时，可按已有授权执行 `--yes`；不要为同一已批准操作反复询问。任务指南要求批次复核时，先展示批次并取得批准；待确认行需要完成逐行复核，不能用 `--yes` 替代。

退出码 10 / confirmation_required 表示需要确认：展示 action、风险和关键参数，仅在已有明确批准覆盖该操作时追加 `--yes`；否则向用户取得批准。拒绝则停止，不修改参数绕过门禁。

`parse --dry-run` 与 confirmed `import --dry-run` 只预览；`import-raw --dry-run` 会创建真实解析任务，只是不导入需求。需要纯预览时拆开 parse 和 confirmed import。授权和更新提示也可能联网，不能把全部 dry-run 称作离线。

## 失败恢复

读取错误 type/code/hint/detail/retryable，按明确恢复路径处理。未授权读 [授权指南](auth.md)；配置或网络失败诊断原原因；不是每个失败都重新登录。

所有导入入口提供明确非空稳定 idempotency_key。同批预览、提交和恢复使用同一键；回执不明先核对任务和真实结果，不换随机键重传成功项。确实失败的子集另建新批次，保留原结果并重新预览。

真实写入失败、尚未提交、待人工确认与地图处理中分别报告。不要从解析数量推断入库数量。
