<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
# 公共规则

## 执行顺序

1. 阅读任务指南，用 `--help` / `schema` 确认实际参数。Skills、help、内嵌清单与 schema 不需要授权；仅整理输入也无需授权。
2. 真正调用业务接口前检查 `auth status`，按本次能力的 `required_scopes` 授权。缺授权或权限时读 [授权指南](auth.md)。
3. 首次完成授权后或排查服务故障时，运行 `doctor --strict`。缺 token 应完成授权再检查；配置、清单或服务失败按具体错误修复，不把所有失败都解释为需重新登录。不要每条业务命令都重复 doctor。
4. 按业务指南执行。写入、确认和失败恢复读 [结果和确认](output-risk.md)。

业务请求成功时按真实结果完成用户任务。零条匹配是正常结果；不要为了“检查一下”调用与当前任务无关的后台、资料或写接口，额外申请无关权限，或扩大用户指定的数据范围。

`doctor` 默认可能在检查项失败时仍返回 `ok: true`；门禁用 `--strict`，诊断时逐项检查 `data.checks`。`--offline` 只跳过服务连接，仍会检查 token。

授权批准解决访问权限；写入使用用户针对具体预览的独立业务确认。授权完成后保留原任务的“先预览”要求，不直接执行写入。

## 任务文件

原文、整理、解析、confirmed payload、预览、回执放在当前工作区相对任务目录，例如 `tasks/<run_id>/raw.txt`、`tasks/<run_id>/parsed.json`、`tasks/<run_id>/confirmed.json`。只整理时可以保存文件，不提前上传。

CLI 的 `--file`、`--output`、`--data @file` 使用当前工作区内相对路径；目录可嵌套。需要时先创建任务目录。重试沿用原任务目录和已确认文件，辅助脚本以任务命名。不要使用 `/tmp` 或宿主绝对路径存放 CLI 任务数据。

这条规则针对任务数据；读取安装的 Skill 文件时使用 Agent 文件工具返回的真实路径，引用相对 Skill 所在目录解析。不要因为 Skill 安装路径是绝对路径而无法读取。

## 能力与权限

`capability list` 和 `schema <id>` 默认使用内嵌清单；`capability list --remote` / `capability schema <id> --remote` 查询后端。严格离线读取带全局 `--no-notice`。没有 `--embedded` 参数。

怀疑版本不一致时运行 `capability diff --remote --strict`。发现差异先读后端 schema 和所需权限，不凭旧参数盲调。`capability run` 只执行已登记、校验通过的能力。不存在的能力报告缺口，不能开 raw API 代替登记。

沿用 `auth status` 返回的当前配置地址与 profile；仅首次安装未配置时使用默认生产环境。网络或权限错误不构成切换环境的授权。用户明确指定环境时才改 URL/profile。`--instance-id` 是可选请求标识，不是 Agent 身份；没配置就不补填，不照抄示例 ID。

只以真实输出汇报：查询成功、解析完成、写入成功、地图完成分别是不同阶段。
