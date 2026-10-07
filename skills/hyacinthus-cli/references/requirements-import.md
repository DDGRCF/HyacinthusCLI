<!-- 改动说明：批量导入保留后端解析优先级，复核授课方式、独立联系方式和源信息。 -->
## 解析流程

1. 原始文本先读 [字段整理](requirements-format.md)；按 [公共规则](shared.md) 完成所需授权与首次服务检查。
2. 需要确认目录 ID、科目/年级名称或授课方式时，先查询元数据：

```bash
hyacinthus requirements options
```

`requirements options` 返回 `subjects`、`grades` 和 `preferred_modes`。遇到年级/科目不确定时，先用它核对现有目录；不要靠记忆猜 ID。

3. 解析原始文本：

```bash
hyacinthus requirements parse --file input.txt
```

后端 CSV/XLSX 表格解析和字段标签文本均按字段名映射到统一20字段规范（见[字段整理](requirements-format.md)）；本 CLI 的 --file 仅接收 UTF-8 TXT/CSV，不直接上传二进制 XLSX。`用户联系方式`（合并列）以及 `用户电话`、`用户微信` 都归入 `ext.user_contact_phone`、`ext.user_contact_wechat`；`管理员电话`、`管理员微信`（别名 `电话`、`手机号`、`联系电话`、`微信`、`微信号`）归入 `ext.admin_contact_phone`、`ext.admin_contact_wechat`。旧列名 `联系方式`、`contact` 已移除识别，落 unknown-field warning，不做兼容。这些命名输入不限制列数或顺序，也不要求补齐全部可选字段。未知字段、重复字段或别名值冲突会生成行级诊断，需复核；不会仅因列数不同而拒绝整个输入。业务必填值仍在提交前校验。多条字段标签记录若不以编号开头，必须用空行分隔；边界不清楚时提示复核，不猜测字段归属。自由文本继续由默认解析处理。城市和联系方式建议通过 `--preset-city`、`--preset-contact-phone`、`--preset-contact-wechat` 传入。混合城市的批次必须先按已确认城市拆分；不得用同一个 `--preset-city` 覆盖不同城市。城市不明确的记录先询问用户，不自动归类。

短文本可以直接使用 `--text`：

```bash
hyacinthus requirements parse --text "高一数学，瓯海区，周末上课"
```

当前批量契约对online岗位同样要求地址和有效定位。地址或城市不明时保留源文、向用户补充确认，不编造地点或客户端坐标。长文本或批次输入使用工作区相对任务目录；大结果保存完整文件并只向 stdout 输出摘要，避免 Agent 工具截断：

```bash
hyacinthus requirements parse --file tasks/<run_id>/normalized.txt --output tasks/<run_id>/parsed.json --jq .data.summary
```

仅计划请求时 `parse --dry-run` 不创建任务。真实 parse 会创建异步解析任务并等待；失败、超时或交付不明时保存 `error.detail` / `meta` 的任务句柄，并用 `requirements parse-job <job_id>` 查询原任务，不重新提交来替代恢复。查询不会创建新任务；pending/running 稍后再查询，failed/cancelled 如实汇报，succeeded 读取 result。遵循实际 `--help`，不猜取消命令。

4. 检查解析结果：

- `data.summary.auto_commit_ready`
- `data.summary.needs_confirmation`
- `data.rows[].can_auto_commit`
- `data.rows[].needs_confirmation`
- `data.rows[].confirmation_reasons`
- `data.rows[].parsed.address_detail`
- `data.rows[].parsed.geo_diagnostic`

只依据后端 `errors` 判断业务准入：空数组可导入，非空数组需修正后重新解析或提交。后端 `can_auto_commit` / `needs_confirmation` / `confirmation_reasons` 必须与 `errors` 一致；缺失或矛盾的必要字段是协议错误，CLI 不修复或猜测裁决。批量导入不再提供行级 confidence 或 `--min-confidence`。

## 警告处理

`confirmation_reasons` 等于后端 `errors`，不是 warnings 的升级：

- 存在 `errors`：该行不可用；`--yes` 不能绕过错误。
- `warnings`（目录、地址、时间等诊断）：向用户展示，不阻断导入，不触发 CLI 自有业务规则。
- 用户联系方式违规仅 warning：`USER_CONTACT_PHONE_INVALID`（用户手机号格式不对）、`USER_CONTACT_WECHAT_INVALID`（用户微信格式不对）；为空静默。CLI import-raw review 行在 `warning_labels` 附这些可读中文，仅展示，不本地校验、不拦截。
- 需要新建目录项或修改原始业务信息时，仍须取得该操作授权；这不是对 warnings 的准入阻断。
- 没有置信度阈值或低置信度阻断代码；其它业务及地理编码诊断中的 confidence 保持原契约。

汇总复核项时，先展示简洁的 `confirmation_reasons`，不要直接输出整段 JSON。需要用户逐字段确认时，展示中文字段名、原值与建议修正值；不要用内部 ID、置信度字段或整个结构化对象代替业务确认。

## 地址复核完成流程

地址 warnings 仅展示，不阻断后端批准的行。下面的核对用于保留源信息或修正后端 errors，不得把 warnings 自动转成阻断：

先检查原文与授课方式。原文明示线上而 parsed 的 preferred_mode 缺失、为 null，或错误识别为 hybrid/offline 时，向用户展示这一不一致，按明确原文构造显式 online 的 confirmed payload；同时按当前契约提供明确地址并由后端获得有效定位。原解析诊断保留，预览中说明修正与各行核对结果，取得本批复核批准后提交。原文和用户说明没有歧义且业务必要信息齐全时，修正 confirmed payload 并等待批次确认；不为了迎合错误解析值而修改原邮件、补造地址或反复解析同一文本。最终写入仍由后端校验，有 errors 时继续解决或停止。

所有岗位按后端地址与定位契约执行以下复核：

1. 先展示 normalized address、原始地址文本和地址警告原因。
2. 请用户确认 normalized address，或提供修正后的可定位地址。
3. 用户确认或修正地址后，把复核后的地址写入 confirmed row payload。
4. 然后才能用 confirmed rows 调用 `requirements import`。

如果地址只是 `未来科技城这边` 这类模糊区域，用户单纯说“确认”仍不够；除非用户明确接受该需求只保留区域级精度，否则优先要求补充具体小区、道路、学校、地铁站、商场或门牌附近点。

导入修正后的行时，从 parse 结果构造明确 `confirmed_rows` payload。`--yes` 只批准写入，不绕过后端 errors；实际提交仍由后端逐行裁决。CLI dry-run 只预览请求，不保证后端接受业务字段。

读取 parse 输出时按明确来源选择，不能用缺字段回退猜格式：

- 完整 stdout envelope：`data.rows[].parsed`
- `--output` 文件：`rows[].parsed`

没有检查根 keys 前，不要假设一定存在 `data.rows`。

保留已确认的业务字段，按 import schema 构造 `confirmed_rows`；`geo_diagnostic` 等解析诊断不是写字段。`requirement_type` / `preferred_mode` 缺失、null、未知或与源文明确的信息不一致时，必须回到源信息复核，不能删除字段触发后台默认。源邮件或用户已明确提供的信息可以按真实 schema 补入；源信息本身缺失或冲突时才询问用户。批准创建目录后只更新受影响的 ID，不猜测其他业务值。

## 从源信息到 confirmed payload 的必查项

解析成功、没有警告、local dry-run 通过，都不证明源信息已完整写入。不要只复制非 null 的 parsed 字段；预览前逐行与原文、整组声明核对，检查以下结构化字段，而不是仅在 description/备注里留下文字：

| 源信息 | confirmed row 中核对的字段 |
| --- | --- |
| 岗位类型、授课方式 | `requirement_type`、`preferred_mode`；按 options/schema 的枚举填写 |
| 明确的线上授课 | `preferred_mode: online`；保留明确来源地址，由后端解析有效定位，不提供虚构坐标 |
| 科目、年级与岗位编号 | 已确认的 `subject_ids`、`grade_ids`、`requirement_code` |
| 学生/需求方与老师条件 | `condition.requester_*` 与 `condition.required_*` 分开，不能互换 |
| 职业与经验 | `required_occupation` 使用 schema 的兼职、全职、不限或 null 枚举；“有家教经验”保留在 description，不当作职业，原文没有职业身份时不猜 |
| 薪酬 | `compensation` 的金额与计费单位 |
| 每周次数、每次时长、上课时间 | `weekly_frequency_min/max`、`session_duration_minutes_min/max`、`time_slots` 与 `class_time_text`；时间窗口不能代替次数和时长 |
| 整组或行内管理员联系方式 | `ext.admin_contact_phone`、`ext.admin_contact_wechat`；行内明确值优先 |
| 用户联系方式 | `ext.user_contact_phone`、`ext.user_contact_wechat`；违规仅 warning，为空静默 |
| 后端解析的优先级 | 保留各行 `parsed.ext.priority`；这是后端按已保存规则算出的业务值，不是可删除的诊断字段 |

例如源文明确“每周1次，每次2小时”，次数字段填写1、时长字段填写120分钟；没有范围时 min/max 使用同一明确值。源文未提供时保持 schema 允许的空值，不猜测。解析未提取这些数字时从明确原文补齐，不删除字段后声称信息完整。

构造 `confirmed_rows` 时保留 `parsed.ext.priority`，逐行核对预览值与解析值一致。不要用仅包含联系方式的全新 `ext` 覆盖原对象；合并确认的联系方式和备注后保留已有业务字段。删除优先级会使导入采用默认值，不能把这种结果称作已应用编号规则。`priority_rule_id`、`priority_rule_pattern` 等规则追踪信息是否可提交，以实际 import schema 为准；它们不代替 `ext.priority`。

如果线上源文最终变成未填 `preferred_mode` 的 payload，预览即使通过也不能提交；后端可能按默认方式处理。出现 `REQUIREMENT_GEOCODING_UNAVAILABLE` 时核对地址、地图服务与源文；online也不能免除地址或定位错误，修复服务或补充真实地址后重新预览确认。

导入 confirmed rows 前，按 import schema 形态校验 payload：

- `confirmed_rows` 必须是数组。
- confirmed row 只能包含创建内容字段，不得包含 `status` 或 `matched_user_id`；导入始终创建 open、未匹配需求，后续状态变化必须使用管理员 lifecycle 接口。
- `time_slots` 必须是数组；如果 parse 产出 `null`，转换为 `[]`。
- `grade_ids` 和 `subject_ids` 必须是包含已确认目录 ID 的数组。如果任一字段缺失或为空，不要静默设成 `[]`；先解决年级/科目。
- `address_detail` 必须是用户提供或确认的明确地址（包括online）；客户端填的坐标不是后端验证证据。
- `requirements import` 不接受 `--preset-city`、`--preset-contact-phone` 或 `--preset-contact-wechat`；这些选项属于 parse/import-raw 流程。
- 如果 confirmed import 提供了默认 admin contact 值，除非行内已有更具体的 admin contact，否则写入每行的 `ext.admin_contact_phone` 和 `ext.admin_contact_wechat`。不要只把 `admin_contact_phone` 或 `admin_contact_wechat` 放在行顶层后就汇报为已保存。

```json
{
  "confirmed_rows": [
    { "...": "copy one reviewed rows[].parsed object here" }
  ],
  "idempotency_key": "requirements-reviewed-<stable-batch-id>"
}
```

然后先 dry-run，用户批准后执行：

```bash
hyacinthus requirements import --file tasks/<run_id>/confirmed.json --idempotency-key requirements-reviewed-<stable-batch-id> --dry-run
hyacinthus requirements import --file tasks/<run_id>/confirmed.json --idempotency-key requirements-reviewed-<stable-batch-id> --yes
```

完整 parse envelope 或 bare parse data 只提取后端 errors 为空的行；存在 errors 时阻止该导入，不用 --yes 放行。修正后用明确 confirmed_rows、非空稳定键和 --yes 提交，warnings 不要求额外批准。

## 导入流程

对原始复制需求文本或 dataset 文件可使用 raw import 组合流程；解析和导入是两次请求，不是跨请求原子事务。必须明确提供批次稳定键，CLI 只筛选可自动提交行：

单条或短文本：

```bash
hyacinthus requirements import-raw --text "高一数学，瓯海区，周末上课" --preset-city 温州 --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --idempotency-key reviewed-wz-batch-001 --dry-run
```

文件流程适合长输入或需要审计记录的场景：

```bash
hyacinthus requirements import-raw --file input_batch.txt --preset-city 杭州 --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --idempotency-key reviewed-hz-batch-001 --dry-run --output output_import_raw_dry_run.json -q .data.parse_summary
hyacinthus requirements import-raw --file input_batch.txt --preset-city 杭州 --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --idempotency-key reviewed-hz-batch-001 --yes --output output_import_raw_execute.json -q .data.parse_summary
```

任何 Agent 命令参数都不要使用绝对路径。使用当前 workspace 下的相对路径。此规则适用于所有当前和未来的 Agent runner。

`import-raw` 会先解析，只导入后端 `errors` 为空且 `can_auto_commit: true` 的行，展示 warnings，并报告 errors / confirmation reasons 的 skipped rows。处理 dataset 时，把完整结果写入 `outputs/`，stdout 只保留摘要路径；除非调试，不要打印大段 `skipped_rows` JSON。

如果导入前需要查重，先用 `requirements search` 按编号、地址或关键标题查；但查重不能替代 idempotency key，也不能绕过 dry-run/confirmation。

对已解析或已确认的 JSON rows：

1. 使用 idempotency key。
2. 先 dry-run：

```bash
hyacinthus requirements import --file confirmed.json --idempotency-key cli-demo --dry-run
```

3. 执行：

```bash
hyacinthus requirements import --file confirmed.json --idempotency-key cli-demo --yes
```

按命令和交付来源汇报，禁止缺字段就回退或报告零失败：

- `import`：stdout envelope 的 `data` 或 --output 文件顶层读取 `created`、`updated`、`failed`、`failed_rows`、`idempotency_key` 和 `idempotent_replay`。
- `import-raw`：在同一来源的 `import_summary` 读取上述导入统计；`skipped_rows` 与 `parse_summary` 位于外层。`import_summary` 为 null 时明确报告未提交，不把解析行数当作入库数量。
- `failed > 0` 或响应/输出失败时保留原稳定键、任务句柄和提交状态；不要换新键盲目重试。

需求写入成功与异步地理编码完成是两个状态。以导入结果确认数据库写入，以后端返回的定位状态判断地理编码；不得为了等待坐标重复提交已成功的需求，也不得把尚未完成的定位汇报为已完成。

## 禁止事项

- 不要用 --yes 绕过后端 errors；warnings 仅展示，不额外阻断。
- 没有用户明确批准时，不要创建缺失科目或年级。
- 没有用户批准的完整有序 ID 列表时，不要重排科目或年级。
- 所有导入入口必须由调用方明确提供非空稳定键；禁止无键导入、随机替换、忽略 JSON/旗标的键冲突。
- 不要绕过 `import-raw`/`parse` 对原始文本的确认规则。
- 不要复制 `1` 这类示例 instance ID；除非用户明确指定，否则沿用 profile 的可选请求标识，没有默认值时不补填。
- 不要编造地址、时长、薪资或老师要求来填补缺失字段。
- 不要把 raw API 作为常规路径。
- 不要打印 token 或 secret。
