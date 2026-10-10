---
name: tutoring-job-mail-upload
description: "检查或整理家教岗位邮件；用户要求上传邮件里的家教岗位时，选择邮件、保存来源、按21字段整理，并通过 Hyacinthus CLI 授权、复核导入和回读。包含错误CSV、进度续接和重复上传处理。"
metadata:
  cliHelp: "hyacinthus --help"
---

# 家教岗位邮件处理

按用户要求读邮件、整理或上传。只读和整理无需 CLI 授权；上传才读相邻[CLI 公共规则](../hyacinthus-cli/references/shared.md)和[解析导入指南](../hyacinthus-cli/references/requirements-import.md)。

## 1. 选邮件，保存来源

- 已保存的邮件原文及身份元数据是指定输入，直接用它，不重新选信；不得假称已访问真实邮箱。
- 否则使用用户指定、当前可用的邮件读取工具。没有原文且没有可用邮件工具时，只询问来源并结束本轮；在邮件来源取得、核验并保存前，不申请 CLI 权限、不运行 Hyacinthus CLI `auth login` / `auth wait` 或 parse/import。取得并核验来源后，才按第 3 节申请最小 CLI 权限。筛选范围缺失时询问邮箱条件。找不到指定邮件就报告，不换信。没有新邮件是正常结果。
- 核对邮件 ID、主题、时间和正文，保存完整 UTF-8 原文。run_id 由邮件身份和正文哈希生成；同一内容重试沿用原任务，内容变化保留旧任务并新建目录。
- 若工具已有读取进度，原文和记录保存成功后再推进；失败保留旧进度，不为单次任务新建进度系统。

文件放 `tasks/<run_id>/`。`mail_manifest.json` 至少保存：

```json
{
  "run_id": "<本任务编号>",
  "message_id": "<邮件ID>",
  "source_sha256": "<完整原文字节的SHA-256>",
  "raw_file": "raw.txt",
  "normalized_files": ["normalized-001.txt"],
  "batches": [{"batch_id": "001", "normalized_file": "normalized-001.txt", "idempotency_key": "tutoring-<run_id>-001"}],
  "upload_result_files": []
}
```

另记录发件人、主题、发送/读取时间。manifest 路径以自身目录为基准，CLI 路径以工作区为基准。normalized_files 只登记实际用于解析的规范 TXT/CSV，不放元数据和备份。每批有稳定 batch_id、各自的规范/解析/确认/预览/回执文件和 `tutoring-<run_id>-<batch_id>` 键；真实回执收到后才加入 upload_result_files。

## 2. 拆岗位，整理字段

按以下边界识别独立岗位，再整理格式二。每条岗位都保留来源邮件 ID、原文段落位置和拆分依据。

- **拆分条件：** 原文明确列出多个实际授课地址；明确分别招聘不同科目的老师（例如数学和英语各招一位）；明确分开招聘不同教师席位或学生组；或分别报价且每个价格明确对应不同教师条件。按明确的地址、科目、招聘席位或教师条件拆成独立岗位，并把原文共同信息复制到各岗位。
- **合并条件：** 原文明确由同一位老师负责多科、多个学生或一对二/一对多时，保留为一个岗位。单有多个科目、学生人数、学习目标或地点名称，不足以证明需要拆分；接送点、交通换乘点、面试点、教师所在学校和仅试课地点不算实际授课地址。
- **无法判断时：** 如果原文没有说明多科是否由同一位老师负责、是否分开招聘，或某地点是否实际授课地址，不猜测拆分或合并；把该条原文及待确认点放入问题清单，继续整理其他边界明确的岗位。
- **编号：** 未拆分且原文有业务编号时，原样保留完整编号。拆分且原文有业务编号时，以原编号为前缀，用“原编号-地址”或“原编号-科目”区分各岗位；地址后缀须取原文中足以区分该岗位的实际授课地址，科目后缀填写该岗位对应的科目名。原文没有业务编号时，以实际授课地址作为编号；同一地址拆出不同科目时，用“地址-科目名”区分。不得用接送点、面试点、教师学校或地图反查地址作编号，也不得编造流水号或使用“其他”等含糊后缀。同地址、同科目仍无法唯一编号时，列入问题清单，不自行创造其他编号规则。
- 按原文顺序、发布人分别建目录；每份整理文档最多50条岗位，每条按唯一的[21字段格式二](../hyacinthus-cli/references/requirements-format.md)完整分段，岗位之间空一行。不同发布人的岗位不得放在同一文档；每条岗位只能出现在正常文档或问题清单其中一处。用户指定了整理版本时沿用，不用旧稿覆盖。

发件人不一定是发布人或联系人。城市及联系方式只用于明确对应的发布人和岗位。整理后核对岗位数量、编号唯一性、原文出处和岗位分段。


## 3. 解析、复核、上传

未安装或缺授权时按[授权指南](../hyacinthus-cli/references/auth.md)处理；本流程上传及回读需要 `requirements:parse/requirements:write/requirements:read`。

对 normalized_files 的每批按[解析导入指南](../hyacinthus-cli/references/requirements-import.md)执行一次 parse、逐行复核、保存 confirmed_rows，再预览：

```bash
hyacinthus --format json requirements parse --file tasks/<run_id>/normalized-<batch_id>.txt --output tasks/<run_id>/parsed-<batch_id>.json --jq .data.summary
hyacinthus --format json requirements import --file tasks/<run_id>/confirmed-<batch_id>.json --idempotency-key tutoring-<run_id>-<batch_id> --dry-run --output tasks/<run_id>/preview-<batch_id>.json --jq .meta
hyacinthus --format json requirements import --file tasks/<run_id>/confirmed-<batch_id>.json --idempotency-key tutoring-<run_id>-<batch_id> --yes --output tasks/<run_id>/upload_result-<batch_id>.json
```

按导入指南展示新增/更新范围、数量和异常，核对已有编号的更新是否获准，再按[确认规则](../hyacinthus-cli/references/output-risk.md)执行。

各批独立记录提交行与回执，报告汇总各批真实计数。同键换 payload 会重放原回执，不检查内容变化；不同批次及修改后的内容必须用新 batch_id 和新键。

## 4. 回读与报告

- 用 `requirements search --keyword <编号> --scope all` 回读，精确核对 requirement_code、ID、状态等摘要。可核对的字段范围见[查询指南](../hyacinthus-cli/references/requirements-query.md)。
- 写入回执与回读分开：回读失败记 readback_failed，保留写入事实，不重传。按导入回执的失败行索引关联本次提交行和邮件来源。
- 保存 final_report.json：`source_message_id/created/updated/failed/pending`，以及 rows（requirement_code、status=imported/pending/failed、reason）。计数来自真实回执；整理或解析成功不算已上传。
- 超时或结果不明记 UPLOAD_RESULT_UNKNOWN，核对原任务，用原 payload、原幂等键恢复；已知失败子集另建批次，成功项不重传。

重复上传同封邮件时，核对相同身份/哈希、原行、历史成功回执和当前编号。仅搜到同编号不能证明该邮件已上传；内容变化或无历史证据时展示差异，按批准范围处理。

保存 replay_report.json：`source_message_id/already_imported/new_created/failed`，后三项均为本次整数计数。30条已有且未写入时为30、0、0，不把历史 created 算成新建。

## 5. 记录实际错误

每个实际问题写一行 errors.csv，CLI 原码放 source_error_code：

```csv
run_id,stage,status,error_code,source_error_code,reason,retryable,next_action,message_id,job_code,source_location,file_path,request_id,source_tool,tool_version,raw_result_path,occurred_at
```

| 阶段 | error_code 分类 |
| --- | --- |
| 邮件获取 | MAIL_CONFIG_MISSING、MAIL_REFRESH_FAILED、MAIL_EXPORT_FAILED、MAIL_VERIFY_FAILED、MAIL_ID_MISSING、MAIL_CONTENT_CHANGED |
| 文件和岗位 | TASK_DATA_SAVE_FAILED、JOB_SOURCE_AMBIGUOUS、FORMAT_FILE_MISSING、FORMAT_FILE_UNREADABLE、FORMAT_LAYOUT_INVALID |
| 解析 | FIELD_VALUE_UNCLEAR、REQUIRED_VALUE_MISSING、ADDRESS_UNLOCATABLE、TIME_UNPARSEABLE、PARSE_CONFIRMATION_REQUIRED |
| CLI与上传 | CLI_PREFLIGHT_FAILED、CLI_SCHEMA_MISMATCH、UPLOAD_REJECTED、UPLOAD_RESULT_UNKNOWN |
| 其他 | OTHER，reason 写具体原因 |

stage 用“邮件获取/格式整理/CLI解析/CLI上传”，status 用“失败/需补充/待确认”。UTF-8 CSV 正确转义，不写凭据。正常空值、无匹配邮件和后端 warnings 不记成失败或阻断；诊断可另存。
