# 解析和导入

先读[公共规则](shared.md)和[字段格式](requirements-format.md)。推荐：**解析一次 → 复核 → 保存 confirmed_rows → 预览 → 提交同一文件**。

## 常用命令

```bash
hyacinthus requirements options
hyacinthus requirements parse --file tasks/<run_id>/normalized.txt --output tasks/<run_id>/parsed.json --jq .data.summary
hyacinthus requirements parse-job <job_id> --output tasks/<run_id>/job.json
hyacinthus requirements import --file tasks/<run_id>/confirmed.json --idempotency-key tutoring-<run_id> --dry-run --output tasks/<run_id>/preview.json
hyacinthus requirements import --file tasks/<run_id>/confirmed.json --idempotency-key tutoring-<run_id> --yes --output tasks/<run_id>/result.json
```

parse/options 需要 `requirements:parse`，import 需要 `requirements:write`；查重、区分新增/更新范围或回读需要 `requirements:read`。

## 1. 准备输入并解析

- parse/import-raw 的 `--file|--text|--data` 三选一。file 接收 UTF-8 TXT/CSV（`-` 为 stdin），不直接读二进制 XLSX；默认 lenient 支持自由文本。
- `--data @file.json` 是含 raw_text 的解析请求，preset 和 mode 写在 JSON 里，不与任何 preset 或 --strict/--lenient 旗标混用。
- 文本可用用户提供的 `--preset-city`、`--preset-contact-phone`、`--preset-contact-wechat`，后两者是默认管理员联系方式，行内值优先。import 无 preset 选项，复核后按字段格式写入行数据。

`parse --dry-run` 只预览请求，不创建任务。真实 parse 创建异步任务，提取字段后解析地图，生成候选 `location/geo_diagnostic`，不写需求；CLI 等待完整结果。

超时或交付不明且有 job_id，优先执行返回的 recovery_command，用 parse-job 查询原任务，沿用原 profile、地址、客户端绑定和 instance_id。queued/retry_wait/running 稍后再查；failed/cancelled 报告失败；succeeded 取 **result**。没有返回 job_id 时先报告创建结果不明，不盲目重建。

## 2. 核对每行

业务准入只看后端 `errors`：空数组可导入，非空需修正；warnings 展示但不阻断。`can_auto_commit/needs_confirmation/confirmation_reasons` 必须与 errors 一致，缺失或矛盾是协议错误，不能自行改裁决。没有行级置信度门槛。

核对 `parsed` 与原文的编号、类型、授课方式、目录、条件、薪酬、次数/时长、地址、联系方式和备注。明确来源可补入，信息缺失或冲突才询问；不能删除关键字段触发默认，也不编造地址/坐标。目录未匹配 warning 不自动创建，用户要求补全时见[目录管理](catalog.md)。

当前 parse 不生成 `weekly_frequency_min/max` 和 `session_duration_minutes_min/max` 四个次数/时长字段。要完整保存原文的次数与课时，按字段格式补入 confirmed_rows；直接导入 parse 输出或 import-raw 不会自动补齐。

出现 `FIELD_RECOGNITION_NOTICE` 时，核对 unknown_fields/duplicate_fields/ignored_values，确认忽略了哪些源信息。文本诊断在行 field_recognition，表格聚合在结果顶层 field_recognition；重复编号报 `TEXT_RECORD_BOUNDARY_AMBIGUOUS`，按 errors 处理。

地址诊断与原文不一致时展示差异；GEO_* 按实际 errors/warnings 分类，不自行升级 warning。缺地址（含 online）或 `ADDRESS_DETAIL_MISSING` 落在 errors 时，请用户补齐地址后再预览；不能提供“确认无地址直接写入”，用户确认不能代替补齐必需字段或后端定位校验。

## 3. 保存 confirmed_rows

按[字段格式中的 JSON 规则和示例](requirements-format.md#json-构造规则)核对原文，保存已通过或修正的行，再执行本页的 import 预览。

把字段格式中的业务行放入 confirmed_rows 数组。import 接受 `{confirmed_rows, idempotency_key}`、裸行数组、parse envelope 或裸 parse data。直接传 parse 输出时任意行有 errors 会拒绝整批；要提交通过项，先筛选并保存明确 confirmed_rows。键非空、无空白，JSON 与旗标给的键必须相同。

不同批次用不同键；同键即使换了 payload，也会重放原回执，后端不检查内容是否改变。

## 4. 预览、提交和读结果

需要区分新增/更新，或用户只批准新增时，先按[查询指南](requirements-query.md)用 scope all 精确核对本批编号；批量也可用[identity_lookup](batch-and-geo.md)。查重结果是查询时状态，不提供并发锁或原子“仅新增”保证。

再执行 import dry-run，展示已查到的新增/更新范围、数量和异常，按[确认规则](output-risk.md)提交同一文件和键。dry-run 只校验/预览请求，不查询已有编号，也不保证后端业务通过。

导入按编号**新增或更新**。已有编号会替换内容及科目/年级/时间关联，设为 open、清空匹配并重置生命周期；空字段不会保留旧值。用户只批准新增时先处理编号冲突。

真实导入在写入前按地址验证定位，或复用已有需求的有效定位；不直接信任客户端候选坐标。包括 online 在内，定位失败进入 failed_rows。普通 import 不返回 geo_run_id，不能描述成入库后等地图；实际外部地图调用次数取决于缓存和复用。

| 命令 | stdout data / --output 文件的内容 |
| --- | --- |
| parse | 解析结果 rows/summary |
| parse-job | 任务对象；成功结果在 result 内 |
| import | created/updated/failed、created_ids/updated_ids、failed_rows、idempotency_key/idempotent_replay |
| import-raw | 外层 parse_summary/job_id/skipped/warnings；真实写入统计在 import_summary |

failed_rows.index 从1开始，按**实际提交顺序**对应来源。ok:true 仍可能部分失败，恢复见[结果和确认](output-risk.md)。

## 预览行为

| 命令 | 实际行为 |
| --- | --- |
| parse --dry-run | 预览解析请求，不创建任务或解析地图 |
| import --dry-run | 检查权限并预览，不解析地图或写需求 |
| import-raw --dry-run | 创建真实解析任务并解析地图，导入阶段只预览 |

预览不统一代表离线。

## import-raw 的使用边界

已批准直接解析并导入时可用：

```bash
hyacinthus requirements import-raw --file tasks/<run_id>/normalized.txt --idempotency-key tutoring-<run_id> --yes --output tasks/<run_id>/result.json
```

每次调用（含 dry-run）都会创建新解析任务，导入键不去重解析。先预览再批准时优先用本页的 parse→import 流程；已做 raw dry-run，则查原 job 的 result 构造 import，不再 raw 一次。

raw 只提交 errors=[] 且 can_auto_commit=true 的行，其余报告 skipped。dry-run 的 import_summary 是预览对象，无通过行时为 null，不能当写入统计；真实执行无通过行但有 skipped 时退出2，保留 job_id 和原键。raw 汇总不是完整 parse，不能直接传给 import/catalog。

需要完整保存次数/课时，按[保存 confirmed_rows](#3-保存-confirmed_rows)补齐后用 import 提交。
