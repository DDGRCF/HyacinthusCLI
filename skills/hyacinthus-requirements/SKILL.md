---
name: hyacinthus-requirements
version: 0.1.0
description: "风信子家教中心需求处理规则：解析原始家教需求、确认缺失科目/年级目录、重排目录项，并通过 hyacinthus requirements 命令导入确认后的需求。"
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus requirements --help"
---

# 风信子家教中心需求处理

当用户要清洗、解析、确认或导入家教需求记录到风信子家教中心时，使用本 skill。

先阅读 `../hyacinthus-shared/SKILL.md`，遵守其中的认证、doctor、dry-run 和错误处理规则。

## 实例身份

默认使用当前 Hyacinthus CLI profile 里的默认实例。不要主动添加 `--instance-id`。
只有用户明确给出实例 ID，或 `hyacinthus auth status` 显示没有 `default_instance_id` 时，才需要补实例 ID。

## 解析前整理格式

在调用解析命令前，必须先把原始需求整理成明确的中文键值行。保留字段标签，不要把带标签的信息改写成斜杠分隔的无标签文本。

```text
编号：HZ260514701
年级：幼儿园中班
性别：不限
科目：全科
薪资：60-80元/小时
时间：1次（周中）；2小时（四点半以后）
地址：杭州市临安区16号线青山湖科技城站
要求：大学生老师，有经验，耐心负责的
备注：一对二，一男一女；英语专业
```

上面示例来自这条原始数据：

```text
编号： （陈）HZ260514701
地址： #16号线青山湖科技城站
年级科目： 中班，全科
学员情况：#一对二，一男一女
每周次数： 1次（周中）
每次时长： 2小时（四点半以后）
对老师的要求： 大学生老师，有经验，耐心负责的#英语专业的，
薪酬： 60-80/时
```

整理规则：

- 按含义归类，不要只看原始标签名。
- 清洗或重新解析时，始终保留 `字段名：字段值` 的中文标签。
- 整理后的字段只能使用并严格按这个顺序输出：`编号`、`年级`、`性别`、`科目`、`薪资`、`时间`、`地址`、`要求`、`备注`。
- 缺失字段填 `未填写`，不要省略字段。
- 不要新增 `微信`、`联系方式`、`授课时间`、`薪酬` 等临时字段。
- 不要把结构化字段改成 `编号 / 年级 / ... / 地址` 这种斜杠串。
- `地址` 必须尽量保留原始可定位信息，并按“城市 + 区县 + POI/小区/道路/地铁站/附近地标”组织；不要只保留一个模糊 POI。
- 原文地址里的 `#区县`、`#商圈`、`#地铁站`、`#附近地标` 是地址限定信息，必须并入 `地址`，不能移到 `备注`。例如 `地址：和雅轩#萧山区` 应整理成 `地址：杭州市萧山区和雅轩`。
- 原文非地址字段里的 `#...` 片段按含义处理：老师要求、专业、经验、班型、暑假单、回收单等放到 `要求` 或 `备注`；去掉开头的 `#`，并轻微整理标点。
- 不要把城市、区县、地铁线、地铁站、小区名、道路名、交叉口、附近地标错误放进 `备注`。
- 如果命令或用户给了 preset city，例如杭州，地址必须保留这个城市上下文：可以在整理文本中写 `地址：杭州市萧山区和雅轩`，也可以在命令中传 `--preset-city 杭州` 并写 `地址：萧山区和雅轩`。但 `备注：杭州` 是错误格式。
- 不适合放进固定字段的联系方式文本，放到 `备注`。
- 学生性别放 `性别`；老师性别要求放 `要求`。
- `年级` 尽量整理成后端目录里的完整名称。低龄表达要补全：`五岁`、`4岁`、`幼儿园` 这类写成 `幼儿园`；`中班` 写成 `幼儿园中班`；目录不存在时走缺失年级确认创建流程。
- `薪资` 写金额、范围和单位，优先使用 `元/小时`、`元/次` 这类明确单位。
- `科目` 只放真实科目名。括号或补充语中的“老师优秀”“可以一位老师”“理科为主”“主要作业”等不是科目，放到 `要求` 或 `备注`。例如 `语文，数学，（老师优秀，可以一位老师）` 整理为 `科目：语文，数学`，并把括号内容放 `备注`。
- `全科作业（理科为主）` 这类表达优先整理为 `科目：全科`，把 `作业辅导，理科为主` 放到 `备注`。
- `时间` 放每周次数、每次时长、星期/日期/时间段，以及一对一/一对二等上课形式说明。把 `周一三` 整理为 `周一、周三`；把 `124` 这类星期数字整理为 `周一、周二、周四`；把 `7~8：30` 整理为 `19:00-20:30`。
- 保留有用的订单编号、城市或渠道前缀；去掉表情、广告语和无关噪声。
- `备注` 放暑假单、回收单、线上单、校区附近说明、班型说明、额外标签等。

如果地址只有城市/区县、字段混杂、多个需求被合并、科目/年级/地址不清楚，必须先标记为需要人工确认，不要自动导入。

## 地址质量红线

地址整理失败是导入风险，不允许把“返回了地址字段”当作通过。整理、解析、导入前后都要专门检查地址：

- 整理前先从原文抽取全部地址线索：城市、区县、街道/道路、交叉口、小区/学校/商场/地铁站、方位距离、`#` 后面的区县/地标。
- 整理后的 `地址` 必须能追溯到原文线索，不得编造；但可以把原文分散的城市/区县/地标合并成更完整地址。
- 如果原文没有城市，但用户或命令提供了 `--preset-city`，必须确认城市上下文被传给解析命令；不要把 preset city 写进 `备注`。
- 如果原文有区县或地标限定，整理后丢失了这些限定，必须先修正整理文本，再调用 parse/import。
- 调用 parse/import 前做一次地址自检：`地址` 是否包含区县、具体 POI/小区/道路/站点，以及城市上下文是否来自地址文本或 `--preset-city`。若 `备注` 中出现城市/区县/地标，而 `地址` 或命令参数中缺失这些信息，说明整理错误，必须先改。
- 如果 parse/import 返回 `address_detail: null`、`ADDRESS_DETAIL_MISSING`、`GEO_SUSPICIOUS`、`GEO_GEOCODE_MEDIUM_CONFIDENCE`、`GEO_GEOCODE_FALLBACK_USED`、`GEO_SUGGEST_EMPTY`、`GEO_PLACE_EMPTY`，不要自动导入；先检查是否因为整理阶段把地址线索放错、删掉或拆散。
- 如果地理诊断的 `reverse.address_detail` 与整理后的地址明显不一致，必须人工复核，不要自动导入。
- 汇报失败原因时，地址问题必须排在目录缺失之前；目录可以补，错误地址不能放过。

地址整理反例：

```text
原文地址：和雅轩#萧山区
用户/命令 preset city：杭州
错误整理：
地址：萧山区和雅轩
备注：杭州，数学专业
可接受整理 A：
地址：杭州市萧山区和雅轩
备注：数学专业
可接受整理 B：
地址：萧山区和雅轩
备注：数学专业
并在 parse/import 命令中传 `--preset-city 杭州`
```

## 解析流程

1. 除非本次会话已经确认过环境，否则先运行 `hyacinthus doctor`。
2. 需要确认目录 ID、科目/年级名称、授课方式或 AI 文本限制时，先查询元数据：

```bash
hyacinthus requirements options
```

`requirements options` 返回 `subjects`、`grades`、`preferred_modes` 和 `batch_force_ai_text_limit`。遇到年级/科目不确定时，先用它核对现有目录；不要靠记忆猜 ID。

3. 解析原始文本：

```bash
hyacinthus requirements parse --file input.txt
```

短文本可以直接使用 `--text`：

```bash
hyacinthus requirements parse --text "高一数学，瓯海区，周末上课"
```

也可以先写入文件，特别是批量文本、需要保留审计记录或需要保存 dry-run/execute 输出时。所有 agent 写文件都必须写到当前工作区内，并在命令里使用相对路径。传给 `hyacinthus --file/--output` 的文件优先用简单文件名，例如 `input_hz260514700.txt`、`output_hz260514700_dry.json`；不要使用 `/tmp/...`、`/usr/local/bin/...`、`/data/...` 或任何 agent 专属工作区绝对路径，也不要先 `cd /...`。

运行 `hyacinthus` 命令时不要添加 `cd /... &&` 前缀。默认命令已经在当前工作区执行，直接运行：

```bash
hyacinthus requirements import-raw --file input_batch.txt --preset-city 杭州 --dry-run
```

不要写成：

```bash
cd /absolute/agent/workspace && hyacinthus requirements import-raw --file input_batch.txt --preset-city 杭州 --dry-run
```

4. 检查解析结果：

- `data.summary.auto_commit_ready`
- `data.summary.needs_confirmation`
- `data.rows[].can_auto_commit`
- `data.rows[].needs_confirmation`
- `data.rows[].confirmation_reasons`
- `data.rows[].parsed.address_detail`
- `data.rows[].parsed.geo_diagnostic`

凡是 `needs_confirmation: true` 的行，都不能自动导入。

## 需求搜索流程

用户要查重、确认某编号/地址是否已存在、或导入前要求先看已有需求时，使用：

```bash
hyacinthus requirements search --keyword HZ260514701
hyacinthus requirements search --keyword 青山湖科技城站 --scope active
```

搜索能力只读，需要 `requirements:read`。`scope` 可用：

- `active`：当前有效需求，默认。
- `all`：全部需求。
- `invalid`：失效/无效需求。
- `expired`：已过期需求。

搜索结果只用于查重和定位，不等于导入成功。导入仍必须走 parse/import-raw/import 的确认规则。

## 警告处理

把 `confirmation_reasons` 当作人工复核动作；收集未映射目录名称时再查看 `warnings`：

- 存在 `errors`：修复前该行不可用。
- `ADDRESS_DETAIL_MISSING`：要求补充可定位地址。
- `GEO_GEOCODE_MEDIUM_CONFIDENCE` / `GEO_GEOCODE_FALLBACK_USED` / `GEO_SUGGEST_EMPTY` / `GEO_PLACE_EMPTY` / `GEO_SUSPICIOUS`：先复核地址整理是否丢失区县、地标或站点；确认地址可靠前不要导入。
- `SUBJECTS_EMPTY_FOR_TUTORING`：要求补充科目；目录策略确认前保持阻塞。
- `GRADE_EMPTY_FOR_TUTORING`：要求补充年级，或确认目录缺口。
- `*_UNMAPPED:*`：创建目录项前必须先询问用户。
- `TIME_SLOTS_PARSE_FAILED`：保留原始时间文本，要求人工复核。
- `LOW_CONFIDENCE` / `DESCRIPTION_REQUIRED`：要求人工复核。
- `REQUIREMENT_CODE_EMPTY`：标记复核；如果业务要求编号，必须补编号。
- `MULTIPLE_REQUIREMENT_CODES_FOUND`：拆分需求行，或确认只保留一个编号。
- `CONTACT_PHONE_INVALID`：修正联系方式字段。

汇总复核项时，先展示简洁的 `confirmation_reasons`，不要直接输出整段 JSON。

## 缺失科目/年级目录流程

如果解析行包含 `SUBJECT_NAME_UNMAPPED:*` 或 `GRADE_NAME_UNMAPPED:*`，不要自动创建目录项。先向用户展示缺失名称，并询问是否要添加到风信子家教中心。

先预览创建请求：

```bash
hyacinthus requirements catalog create-missing --file parsed.json --dry-run
```

用户明确批准后执行：

```bash
hyacinthus requirements catalog create-missing --file parsed.json --yes
```

也可以传入明确名称：

```bash
hyacinthus requirements catalog create-missing --subject 科创编程 --grade 小升初 --yes
```

此命令需要 `catalog:write`。

## 地址复核完成流程

地址警告不代表该行一定不能导入，而是代表 Agent 不能自行判断。如果一行除地址警告外都可用，但被地址问题阻塞：

1. 先展示 normalized address、原始地址文本和地址警告原因。
2. 请用户确认 normalized address，或提供修正后的可定位地址。
3. 用户确认或修正地址后，把复核后的地址写入 confirmed row payload。
4. 然后才能用 confirmed rows 调用 `requirements import`。

如果地址只是 `未来科技城这边` 这类模糊区域，用户单纯说“确认”仍不够；除非用户明确接受该需求只保留区域级精度，否则优先要求补充具体小区、道路、学校、地铁站、商场或门牌附近点。

导入复核后的行时，从 parse 结果的 `rows[].parsed` 构造 confirmed payload；如果 `parse --output` 文件顶层是 `rows` 对象，不要直接把该原始文件传给 import。

读取 parse 输出时，同时兼容两种形态：

- 完整 stdout envelope：`data.rows[].parsed`
- `--output` 文件：`rows[].parsed`

没有检查根 keys 前，不要假设一定存在 `data.rows`。

把完整 `parsed` 对象复制进 `confirmed_rows`；除非必须修改复核字段，否则不要逐字段重建。如果用户在 parse 后批准创建目录，只更新受影响的 ID 字段，例如 `grade_ids`，其余 parsed payload 保持原样。

导入 confirmed rows 前，按 import schema 形态校验 payload：

- `confirmed_rows` 必须是数组。
- `time_slots` 必须是数组；如果 parse 产出 `null`，转换为 `[]`。
- `grade_ids` 和 `subject_ids` 必须是包含已确认目录 ID 的数组。如果任一字段缺失或为空，不要静默设成 `[]`；先解决年级/科目。
- `address_detail` 必须是用户确认后的可定位地址。
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
hyacinthus requirements import --file confirmed_reviewed.json --idempotency-key requirements-reviewed-<stable-batch-id> --dry-run
hyacinthus requirements import --file confirmed_reviewed.json --idempotency-key requirements-reviewed-<stable-batch-id> --yes
```

如果使用 stdout 中包含 `data.rows` 的完整 parse output envelope，`requirements import --file parse_envelope.json --yes` 可以为已批准项转换 confirmed rows。如果保存文件来自 `parse --output` 且以 `{"rows": ...}` 开头，必须自行创建 `confirmed_rows` payload。

## 目录排序流程

只有用户提供或批准完整有序 ID 列表后，才能使用目录排序命令。

```bash
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --dry-run
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --yes
```

年级排序：

```bash
hyacinthus requirements catalog reorder --target grades --ids 2,1,3 --yes
```

此命令需要 `catalog:write`。

## 导入流程

对原始复制需求文本或 dataset 文件，优先使用原子 raw import 命令，让 CLI 而不是 Agent 过滤行：

单条或短文本：

```bash
hyacinthus requirements import-raw --text "高一数学，瓯海区，周末上课" --preset-city 温州 --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --dry-run
```

文件流程适合长输入或需要审计记录的场景：

```bash
hyacinthus requirements import-raw --file input_batch.txt --preset-city 杭州 --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --dry-run --output output_import_raw_dry_run.json -q .data.parse_summary
hyacinthus requirements import-raw --file input_batch.txt --preset-city 杭州 --preset-contact-phone 13800000000 --preset-contact-wechat hyacinthus_admin --yes --output output_import_raw_execute.json -q .data.parse_summary
```

任何 Agent 命令参数都不要使用绝对路径。使用当前 workspace 下的相对路径。此规则适用于所有当前和未来的 Agent runner。

`import-raw` 会先解析，只导入 `can_auto_commit: true` 且 `needs_confirmation: false` 的行，并报告带 confirmation reasons 的 skipped rows。处理 dataset 时，把完整结果写入 `outputs/`，stdout 只保留摘要路径；除非调试，不要打印大段 `skipped_rows` JSON。

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

汇报：

- `created`
- `updated`
- `failed`
- `failed_rows`
- `skipped_rows` for `import-raw`

如果 `failed > 0`，不要用新的 idempotency key 盲目重试整个批次。

## 禁止事项

- 不要导入需要确认的行。
- 没有用户明确批准时，不要创建缺失科目或年级。
- 没有用户批准的完整有序 ID 列表时，不要重排科目或年级。
- 除非 CLI 已生成并返回 idempotency key，否则不要在没有 idempotency key 的情况下导入。
- 不要绕过 `import-raw`/`parse` 对原始文本的确认规则。
- 不要复制 `1` 这类示例 instance ID；除非用户明确指定，否则使用 profile 默认实例。
- 不要编造地址、时长、薪资或老师要求来填补缺失字段。
- 不要把 raw API 作为常规路径。
- 不要打印 token 或 secret。
