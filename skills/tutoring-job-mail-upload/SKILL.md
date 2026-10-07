---
name: tutoring-job-mail-upload
description: "检查或整理家教岗位邮件；用户要求上传邮件里的家教岗位时，选择邮件、保存来源、按20字段整理，并通过 Hyacinthus CLI 授权、复核导入和回读。包含错误CSV、进度续接和重复上传处理。"
metadata:
  cliHelp: "hyacinthus --help"
---

<!-- 改动说明：统一20字段与独立联系方式，构造导入数据时保留后端解析的业务优先级。 -->
# 家教岗位邮件处理与内容整理

先按用户需求执行邮件选择和内容整理。仅在进入 CLI 查询或上传阶段时读取 `hyacinthus skills read hyacinthus-cli` 和所选指南；只读取或整理邮件时不预读 CLI 操作指南、不要求 CLI 安装或授权。磁盘文件工具按安装目录读取相邻的 `../hyacinthus-cli/SKILL.md`。

本技能分为三部分：获取邮件、整理岗位为固定20字段、使用 CLI 校验并上传。只获取或整理时不上传；用户明确要求上传后仍须展示本批 dry-run 结果并取得批次批准，不能把任务请求当作所有异常行已经复核。

用户明确提供已保存的邮件原文与邮件身份元数据时，将它们作为本次指定输入，不刷新邮箱、不重新选择邮件。记录来源为保存的邮件样本；不得假称已访问真实邮箱。

用户没有提供邮件、文件路径或可用邮箱连接时，先检查当前工具清单。未提供 Mail/Gmail 读取能力，或邮箱与筛选范围不明时，直接询问要处理的邮件路径、原文或已连接邮箱及筛选条件，并结束本轮。查找范围限定在用户指定位置；不遍历整台机器或读取其他任务目录寻找邮件。收到明确来源后再整理、解析和申请上传权限。

## 一、如何处理邮件

### 1. 找到本次要处理的邮件

1. 使用当前配置的本地 Mail 只读工具刷新邮箱，按用户指定的邮件、日期、主题或邮件 ID 查找；要求“最新邮件”时，选择符合当前筛选条件、发送时间最新的一封。范围或配置不明时先询问。
2. 核对邮件的主题、发送时间和正文开头，确认读到的是目标邮件。找不到指定邮件就报告，不改选其他邮件；没有新邮件是正常结果，不记为失败。
3. 保存完整邮件原文，记录任务编号 `run_id`、邮件 ID `message_id`、发件人、主题、发送时间、读取时间和正文哈希（用于判断内容是否变化）。后面的岗位和文件都对应这份原文，不中途换信。
4. 记录本次读取进度，供下次从已读位置继续；工具不支持读取位置时，按配置回看一段时间并用邮件 ID 去重。原文和任务记录保存成功后才更新进度，失败保留上次进度；同一邮件 ID 内容变化时保留旧原文并记录冲突。
5. 本地 Mail 无法取得可核对的邮件时，才使用已连接的 Gmail 只读工具；明确记录改用 Gmail 的原因和来源，不使用未授权的邮箱凭据。

任务记录文件 `mail_manifest.json` 采用 JSON，最低保留 `run_id`、`message_id`、`source_sha256`（保存的完整 UTF-8 原文字节 SHA-256）、`raw_file`、`normalized_files` 数组和 `upload_result_files` 数组；另记录发件人、主题、读取时间与读取进度。所有原文、任务记录、整理、解析和 confirmed payload 文件统一保存在工作区相对目录 `tasks/<run_id>/`，先创建该目录。run_id 根据邮件身份与原文哈希生成稳定且唯一的任务编号，不仅使用 saved_mail 等固定文件名；同一邮件重放沿用原任务，不同邮件或变更内容保留旧任务并建立新目录。manifest 内文件路径以该 manifest 所在目录为基准，CLI 参数以工作区为基准。未上传时 `upload_result_files` 为空，收到真实回执后才加入结果文件，不能预先写成成功。

`normalized_files` 只登记本次实际用于解析、符合第二部分固定20字段的TXT/CSV，每个岗位在这些文件中只出现一次。岗位来源、邮件元数据、其它格式备份和审计文件另存，并可用独立的 `source_record_files` / `audit_files` 登记；不放入 `normalized_files`。上传只读取本任务的实际整理文件，逐一检查格式与岗位数量。

邮件未核对或原文未保存时，不整理、不上传。不把“邮件已读到”当作“岗位已上传”；用户要求重试时，从指定任务的原文和结果继续，不重新选一封邮件。

邮件处理失败时不要换信或推进读取进度；错误分类及 `errors.csv` 记录格式统一见第三部分。没有匹配邮件是正常结果，不记错误。

## 二、岗位内容整理

### 1. 先分清独立岗位

1. 按原文顺序识别每个独立岗位，记录对应的邮件 ID 和原文段落位置，不能把不同学生、不同岗位的条件混在一起。
2. 同一岗位要求多门科目时，科目放在同一条中；只有原文明示分别招聘或属于不同岗位时才拆开。一对二等同一授课需求不因为有两个学生就自动拆成两条。
3. 区分岗位发布人、联系人和邮箱发件人；转发邮件不代表转发人就是发布人。只有明确适用于整组岗位的城市、联系人等信息，才能用于该组，不能套到下一组。
4. 按下面的20字段整理，不增加临时字段。原文没有的信息留空；明确写“不限”时保留“不限”，不把未说明改成“不限”。有歧义时保留原文，不猜测补齐；交由第三部分的 CLI 解析。
5. 用户指定已整理文件时，使用指定版本，不用旧草稿或邮件原文覆盖它；只检查格式、来源和明确冲突，不重新整理已确认内容。

### 2. 整理特定岗位格式

将邮件中每个岗位的信息整理为20个字段，字段名称和顺序固定。整体字段说明如下。

“需求方”指学生、家长或机构一侧；“要求的……”指对授课教师的条件。

| 顺序 | 字段 | 字段说明 |
| --- | --- | --- |
| 1 | 编号 | 保留原文岗位编号，不自行编造或改号。原文“（陈）HZ260514701”中的编号取 `HZ260514701`，已明确的发布人另外记录。没有编号就留空；多个编号无法区分时保留原文，不猜测。 |
| 2 | 年级 | 只写学生年级或学习阶段。明确的“中班”整理为“幼儿园中班”；“五岁”等低龄表述可归为“幼儿园”，原年龄保留在备注。小学、初中、高中的年级保留完整含义；无法确定时不猜。 |
| 3 | 科目 | 汇总同一岗位的科目，多科用顿号分隔；科目相关的必要补充信息放在备注。 |
| 4 | 需求方角色 | 按原文明示填写家长、学生或机构等；“本人找老师”可写学生。不能因为邮件由中介转发就填写机构，也不能默认所有岗位都是家长发布。 |
| 5 | 需求方性别 | 填学生或需求方的性别，不填教师性别。“男孩”写男，“女孩”写女；同一需求“一男一女”保留“男、女”，人数及一对二说明放时间或备注。性别对应谁不清楚时不猜测，保留原文交给 parse 判断。 |
| 6 | 需求方学历 | 只填原文明示的需求方学历，如本科、硕士；不把教师学历写到这里，不根据学生年级推断家长学历。 |
| 7 | 要求的性别 | 填对教师的性别要求，如男、女、不限。“女老师”写女；“女学生”属于需求方性别。 |
| 8 | 要求的学历 | 填教师学历或在读身份，如大学生、本科、硕士。“大学生”不擅自改为“本科毕业”；“本科及以上”等限定词保留。 |
| 9 | 要求的学校 | 填原文指定的教师就读或毕业学校名称，多个学校保留选择关系。不要把授课地址里的学校当作教师学校要求；学校层次写到下一字段。 |
| 10 | 学校的资质 | 填原文明示的学校层次要求，如985、211、双一流；不根据学校名字自行补出层次，也不把教师资格证写到这里。原文“211高校老师”在此写211，没有指定校名时“要求的学校”留空。 |
| 11 | 授课方式 | 只按原文明示填写线上、线下或online、offline；未说明留空，不从地址猜测。整组声明明确适用于全部岗位时可填入各行。 |
| 12 | 要求的资格 | 填教师职业、资质或经验要求，如专职教师、兼职教师、教师资格证、有经验。专业、教学能力和性格等其他条件放要求；不与学历、学校层次混写。 |
| 13 | 薪酬 | 保留金额、范围、计费单位和附加条件，如“60-80/时”整理为“60-80元/小时”，“300元/2小时”保留原计费方式。不擅自换算，不把不明单位补成小时。 |
| 14 | 时间 | 合并每周次数、每次时长、星期、日期、时间段及一对一/一对二等形式，保留限制。“周一三”写“周一、周三”；只有明确为星期的“124”才写“周一、周二、周四”。明确为晚间的“7~8:30”可写“19:00-20:30”；上午或下午不明时不擅自转换。 |
| 15 | 地址 | **总则：**将地址规范化为可供地理编码解析的地址，按城市、区县、道路/小区/地铁站/地标等层级组合，保留原文定位线索，不补造信息；城市只能取自原文或用户明确提供的信息。**特殊情况：**`#` 后若是区县、商圈、地铁站或地标，也并入地址，不移到备注。例如城市明确为杭州时，“和雅轩#萧山区”整理为“杭州市萧山区和雅轩”。信息不足以定位时保留原文，交由 parse 检查，不猜测补齐。 |
| 16 | 要求 | 放尚未被其他字段完整表达的教学任务、学生情况、专业、教学能力和性格条件，如“英语专业，耐心负责，辅导作业”。已能放入性别、学历、学校或资格字段的条件优先放对应字段，避免整段重复。 |
| 17 | 备注 | 放暑假单、科目补充、班型和其它未被独立字段涵盖的信息。授课方式及联系方式使用专门字段，不放备注；保留有意义的原文和emoji。 |
| 18 | 用户联系方式 | 仅填原文明示的需求方/用户电话、微信，注明各自类型；未给留空。不把邮箱发件人或管理员号码当作用户联系方式。 |
| 19 | 管理员电话 | 仅填原文明示的管理员电话；明确适用于整组时写入各行。不借用用户电话，也不凭发件人猜测；未给留空并由CLI检查必要信息。 |
| 20 | 管理员微信 | 仅填原文明示的管理员微信；明确适用于整组时写入各行，不与用户微信混用；未给留空。 |

### 3. 按固定格式输出

按上表顺序输出20个字段。文本文件每个岗位单独一块，使用“字段名：字段值”，缺失值留空但保留字段名。

若输出为 CSV，以上20字段作为表头，每个岗位一行；缺失值保留空列，不能删列导致后面的值错位。发布人、邮件 ID 和原文位置另存岗位来源记录。用户及管理员联系方式填入各自规范列；角色不明时保留原文并询问，不默认归为管理员。每份整理文件最多100条完整岗位，保持原文顺序。

## 三、CLI 检查与上传

CLI 尚未安装时，先按[官方安装地址](https://raw.githubusercontent.com/DDGRCF/HyacinthusCLI/main/scripts/install.sh)安装，再确认 `hyacinthus --version` 可运行；已安装则直接检查版本。只有用户明确要求上传时才执行写入。

```bash
curl -fsSL https://raw.githubusercontent.com/DDGRCF/HyacinthusCLI/main/scripts/install.sh | bash
hyacinthus --version
```

### 1. 检查 CLI 与字段兼容性

先读本次要用的解析、导入、目录查询及回读能力 schema，汇总 required_scopes 的并集，再检查授权状态。完整上传任务要覆盖解析、写入及需求读取，不能仅申请当前一条命令的权限，导致回读时丢失授权；不申请无关权限。无 token 或出现 `AUTH_REQUIRED` 时，按 `hyacinthus-cli/references/auth.md` 发起授权，展示原始链接并结束本轮；用户批准后对同一 session 执行 `auth wait`。不要向用户索取 token，也不要反复创建 session。

授权成功后首次运行 `hyacinthus doctor --strict`；检查失败就停止。再检查当前登录状态和 CLI 实际 schema：

```bash
hyacinthus auth status
hyacinthus schema requirements.batch_parse
hyacinthus capability schema requirements.batch_import
```

使用用户指定环境/profile，不照抄示例编号，也不要输出登录凭证。20字段是整理后的 TXT/CSV 规范，不是 HTTP JSON 请求的键名；解析 schema 接收 `raw_text`，导入 schema 接收 `confirmed_rows`。不得仅因 schema 没有20个中文 JSON 属性就判定不兼容。

整理文件须保留20个字段及顺序；解析后核对非空信息与岗位编号一一对应，禁止丢字段或合并岗位。若 CLI 明确不支持标签文本，或真实解析丢失字段且无法安全复核，记录 `CLI_SCHEMA_MISMATCH`，停止对应行上传并保留整理文件。

### 2. CLI 解析与预览

确认解析命令支持标签文本后继续。把第二部分整理的 20 字段文本保存为工作区相对目录 `tasks/<run_id>/normalized.txt`。上传前按需读取 `hyacinthus skills read hyacinthus-cli references/shared.md`、`references/requirements-import.md` 和 `references/output-risk.md`，需要授权时再读 `references/auth.md`；每个指南可通过相同 skills read 命令加载。先解析并保存结果：

```bash
hyacinthus requirements parse --file tasks/<run_id>/normalized.txt --output tasks/<run_id>/parsed.json --jq .data.summary
```

按实际 parse 输出处理结果：有错误或要求确认的岗位暂不导入，其他通过项可以继续。不得猜测填充、自动创建科目/年级，或忽略未识别字段。地址、目录、类型和授课方式等逐行业务复核遵循 `hyacinthus-cli` 的解析和导入指南；获得明确复核后可以构造该行的 confirmed payload。

先核对输出来源：stdout envelope 为 `data.rows[].parsed`，`--output` 文件为 `rows[].parsed`。按导入 schema 构造 `confirmed_rows`，仅保留已确认业务字段，不提交 `geo_diagnostic` 等诊断字段；保留班型等原文约束到ext.remark或description，不能在过滤诊断字段时删除业务备注；必要时把 `time_slots: null` 转为数组。必须执行导入指南的“源信息到 confirmed payload”核对：类型和授课方式缺失或 null 时，从已明确的原文/整组声明补齐；线上岗位显式使用online；当前批量契约仍要求明确地址和后端有效定位，来源只有“线上”或“无线下地点”时，询问真实登记地址，不编造地点或坐标。用户电话/微信分别映射到 ext.user_contact_phone / ext.user_contact_wechat，管理员电话/微信分别映射到 ext.admin_contact_phone / ext.admin_contact_wechat；未知联系信息保持空，不搬进备注。次数与每次分钟数写入结构化字段，不能只放在备注或时间窗口。源信息缺失或冲突才询问用户，不删除关键字段触发后端默认。20字段整理文件仍保留用于审计，不把20列 CSV 直接当作 confirmed JSON。确认信息与岗位映射后预览：

```bash
hyacinthus requirements import --file tasks/<run_id>/confirmed.json --idempotency-key tutoring-<run_id> --dry-run --output tasks/<run_id>/preview.json --jq .meta
```

检查保存的完整 dry-run 请求中的岗位数量、字段对应和错误。保留每行 `parsed.ext.priority` 并核对预览值；合并联系方式、备注时不要替换整个 `ext` 而丢掉后端按编号规则算出的优先级。大批次用工作区脚本读取完整 JSON、逐行核对并输出摘要，避免工具截断 stdout；不能只看第一条或被截断的末尾就确认全部通过。`--jq` 仅缩减 stdout，`--output` 仍保存完整命令数据。CLI 输出格式发生变化或无法确认字段映射时，暂停并记录错误，不当作预览通过。

### 3. 用户确认后执行与续接

dry-run 结果无误后，向用户展示将写入的岗位数量和异常项；得到明确批准后，沿用同一幂等键执行：

```bash
hyacinthus requirements import --file tasks/<run_id>/confirmed.json --idempotency-key tutoring-<run_id> --yes --output tasks/<run_id>/upload_result.json
```

只以 CLI 的真实结果记录成功和失败，并用 `requirements search --keyword <岗位编号> --scope all` 逐行回读关键字段。区分 created、updated、failed、待确认和未提交；解析成功或岗位已整理不等于已导入。

将实际回执文件加入任务记录，完成后在该任务目录保存 `final_report.json`：`source_message_id`、`created`、`updated`、`failed`、`pending`，以及 `rows` 数组（`requirement_code`、`status` 为 imported/pending/failed、`reason`）。计数以真实回执和回读为准，待确认行单独计数，不得把整理成功算作导入成功。同一封已完成邮件再次要求上传时，核对原任务和岗位，不重复创建，不覆盖第一次结果；在同一任务目录保存 `replay_report.json`（`source_message_id`、`already_imported`、`new_created`、`failed`）。后三项都是非负整数计数：`already_imported` 是本次核对到的历史已导入行数，不是布尔值；`new_created` 是本次真实新建数，不能把历史 created 当作新创建；`failed` 是本次失败行数。例如30条都已存在且未写入时，三项分别为30、0、0。

超时、断线或回执不明时标记 `UPLOAD_RESULT_UNKNOWN`，沿原请求核对；同一请求恢复保留原 payload 和原幂等键，不换 key。确需对已确定失败的子集重新提交时，先记录原批次结果，再为这个新子批次建立独立稳定键并重新预览、确认；不重传成功项。

### 4. 错误分类与 CSV 记录

邮件获取、格式整理和 CLI 操作中的实际错误都写入同一份 `errors.csv`，每个问题一行。`error_code` 使用下表的稳定分类码；若 CLI 返回程序错误码，原样另存到 `source_error_code`，不要用程序错误码代替本表分类。

```csv
run_id,stage,status,error_code,source_error_code,reason,retryable,next_action,message_id,job_code,source_location,file_path,request_id,source_tool,tool_version,raw_result_path,occurred_at
```

| 分类码 | 含义 |
| --- | --- |
| `MAIL_CONFIG_MISSING` | 邮箱、扫描范围或筛选条件缺失 |
| `MAIL_REFRESH_FAILED` | 邮箱刷新失败或超时 |
| `MAIL_EXPORT_FAILED` | 无法取得完整邮件正文 |
| `MAIL_VERIFY_FAILED` | 邮件身份或内容核对不一致 |
| `MAIL_ID_MISSING` | 邮件缺稳定 ID，无法可靠去重 |
| `MAIL_CONTENT_CHANGED` | 同一邮件 ID 的正文发生变化 |
| `TASK_DATA_SAVE_FAILED` | 原文、manifest 或任务文件保存失败 |
| `JOB_SOURCE_AMBIGUOUS` | 岗位边界、发布人或来源无法确定 |
| `FORMAT_FILE_MISSING` | 指定的整理文件不存在 |
| `FORMAT_FILE_UNREADABLE` | 文件无法读取或解析 |
| `FORMAT_LAYOUT_INVALID` | 字段数量、名称、顺序或列数错误 |
| `FIELD_VALUE_UNCLEAR` | parse 报告字段值无法识别或有歧义 |
| `REQUIRED_VALUE_MISSING` | parse 明确报告必需信息缺失 |
| `ADDRESS_UNLOCATABLE` | parse 报告地址不足以定位 |
| `TIME_UNPARSEABLE` | parse 报告时间无法解析 |
| `PARSE_CONFIRMATION_REQUIRED` | parse 要求人工确认后才能继续 |
| `CLI_PREFLIGHT_FAILED` | CLI doctor、授权或必要 schema 检查失败 |
| `CLI_SCHEMA_MISMATCH` | CLI 无法保留本技能的全部20字段 |
| `UPLOAD_REJECTED` | CLI/网站明确拒绝上传 |
| `UPLOAD_RESULT_UNKNOWN` | 上传后超时、断线或回执无法确认结果 |
| `OTHER` | 实际问题不属于以上分类，在 `reason` 写明细节 |

只在问题实际发生时写记录；没有匹配邮件、字段正常留空都不是错误。`stage` 填“邮件获取”“格式整理”“CLI解析”或“CLI上传”；`status` 填“失败”“需补充”或“待确认”。`reason` 写具体原因，不能只写“失败”，也不得包含密码或 token；程序版本、原始结果位置等信息按实际情况填写，没有则留空。CSV 使用 UTF-8，按 CSV 规则转义逗号、引号和换行。
