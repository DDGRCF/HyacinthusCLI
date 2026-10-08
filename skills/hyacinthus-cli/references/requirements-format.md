# 需求字段格式

TXT 每个岗位一块，用“字段名：字段值”；CSV 每个岗位一行，使用下表21个字段作表头。规范输出按表中顺序，空值保留字段或空列，不能删列导致错位。

输入可以是任意列数、任意顺序，识别别名；不要求补齐可选值。未说明留空，不推断缺失信息；明确写“不限”才保留不限。原文另存，不把标签和值改成斜杠串。

## 字段规则

“需求方”是学生、家长或机构；“要求的…”是教师条件。21字段是文本模板，JSON 使用下表的后端键；科目/年级 ID 从 options 或已批准的创建回执选取，学校 ID 从[学校查询](catalog.md#查学校和资质)选取。类型以 `schema requirements.batch_import` 为准。

| 顺序 | 中文字段 | JSON 字段 | 整理规则和类型 |
| --- | --- | --- | --- |
| 1 | `编号` | `requirement_code` | 保留业务编号；“（陈）HZ260514701”取 `HZ260514701`，发布人另记。多个编号无法区分时复核。 |
| 2 | `年级` | `grade_ids` | 中班写幼儿园中班；五岁、4岁等低龄可归幼儿园，原年龄写备注。JSON：真实整数 ID 数组/null/[]/省略，不传名称。 |
| 3 | `科目` | `subject_ids` | 同岗多科用顿号分隔，仅分别招聘时拆岗；教师条件写要求。“全科作业（理科为主）”填全科，“理科为主”写备注。JSON：真实整数 ID 数组/null/[]/省略。 |
| 4 | `需求方角色` | `condition.requester_role` | 按原文填家长、学生或机构；中介转发不代表需求方是机构。 |
| 5 | `需求方性别` | `condition.requester_gender` | 单值性别。“一男一女”留空，人数、性别组合和一对二写备注；对象不明时复核。 |
| 6 | `需求方学历` | `condition.requester_education_level`、`condition.requester_education_note` | 填需求方学历，补充说明写 `requester_education_note`。 |
| 7 | `要求的性别` | `condition.required_gender` | 填教师性别要求，JSON 为单值。 |
| 8 | `要求的学历` | `condition.required_education_levels`、`condition.required_education_note` | 保留学历限制和在读身份；大学生不等于本科毕业。levels 用后端学历值字符串数组，不写 null；在读等说明写 `required_education_note`。 |
| 9 | `要求的学校` | `condition.required_school_names`、`condition.required_school_ids` | 填教师就读/毕业学校，保留多校选择关系；地址中的学校不算。names 为字符串数组，ids 为真实整数 ID 数组，均不写 null；层次写下一字段。 |
| 10 | `学校的资质` | `condition.required_school_tiers` | 填明示的985、211、双一流等层次，不按校名推断。“211高校老师”只填211；教师资格证写要求。JSON：明示985/211/双一流分别用 `985`/`211`/`double_first_class`，组成字符串数组，不写 null。 |
| 11 | `授课方式` | `preferred_mode` | 线上/线下/混合对应 online/offline/hybrid，不从地址推断；整组声明须明确适用。JSON 不传 null，缺失或冲突先复核，不删字段触发默认。 |
| 12 | `要求的资格` | `condition.required_occupation` | 职业身份：大学生/兼职→part_time_teacher，专职/全职→full_time_teacher，明示职业不限→any，未提供可为 null。经验、教师资格证写要求。 |
| 13 | `薪酬` | `compensation` | 保留金额、范围、单位和附加条件，不猜单位、不换算。amount_min/max 为十进制字符串，单位写 billing_period/billing_unit_text，原文写 raw_text。 |
| 14 | `时间` | `class_time_text`、`time_slots`、`weekly_frequency_min/max`、`session_duration_minutes_min/max` | 保留次数、每次时长、日期和时段。“周一三”可展开；124明确为星期、7~8:30明确为晚间才展开。JSON 次数用整数、时长用分钟，无范围时 min=max；time_slots 用数组，null转[]，weekday为1–7，时间用分钟；原文写 class_time_text。 |
| 15 | `地址` | `address_detail` | 城市只取原文或用户上下文，混合城市分组；保留区县、道路、小区、站点、地标，包括#后定位线索，不移到备注。确认杭州时“和雅轩#萧山区”写“杭州市萧山区和雅轩”。online也需真实地址，location由后端验证。 |
| 16 | `要求` | `description` | 放未被独立字段表达的教学任务、学生情况、专业、经验、资格证、能力和性格。 |
| 17 | `备注` | `ext.remark` | 放暑假单、回收单、科目补充、班型、原年龄和多人情况，保留有意义的原文及emoji。非地址#标签按含义写要求/备注。JSON 只用 ext.remark，不加顶层 remark。 |
| 18 | `用户电话` | `ext.user_contact_phone` | 填用户/需求方电话，不借管理员或发件人信息。联系角色或电话/微信类型不明时保留原文询问，不默认管理员。JSON：string/null；空值静默，非法仅 warning。 |
| 19 | `用户微信` | `ext.user_contact_wechat` | 填用户/需求方微信，不借管理员或发件人信息。JSON：string/null；空值静默，非法仅 warning。 |
| 20 | `管理员电话` | `ext.admin_contact_phone` | 填管理员电话，不借用户电话；整组明确适用才写各行，行内值优先。JSON：string/null；和管理员微信至少一项合法非空，已填非法值由后端报 error。 |
| 21 | `管理员微信` | `ext.admin_contact_wechat` | 填管理员微信，不借用户微信；整组明确适用才写各行，行内值优先。JSON：string/null；和管理员电话至少一项合法非空，已填非法值由后端报 error。 |

## 文本示例

下面用一条虚构的高一数学需求展示全部21字段。需求方是母亲，学生是儿子，两者的性别不混填；所有信息均为示例，真实任务缺项仍留空。

```text
编号：DEMO-HZ-001
年级：高一
科目：数学
需求方角色：家长
需求方性别：女
需求方学历：本科
要求的性别：女
要求的学历：本科
要求的学校：浙江大学
学校的资质：211
授课方式：线下
要求的资格：兼职教师
薪酬：150-200元/小时
时间：每周1次，每次2小时；周六14:00-16:00
地址：杭州市西湖区文三路与学院路交叉口附近
要求：学生为高一男生，基础较弱；有高中数学辅导经验，讲解清楚，耐心负责
备注：一对一；需求方为母亲
用户电话：13900000001
用户微信：demo_parent
管理员电话：13800000001
管理员微信：demo_admin
```

## JSON 构造规则

业务行使用上表的 JSON 键。普通导入将行放进 confirmed_rows 数组，持久批次放进 requirement；提交步骤见[导入流程](requirements-import.md#3-保存-confirmed_rows)。

| 项目 | 规则 |
| --- | --- |
| 岗位类型 | `requirement_type` 为 tutoring/consulting/resource_exchange/general；按原文复核，不删除关键字段触发默认。 |
| ext 合并 | 保留解析所得 `ext.priority` 及其他业务值，再合并联系方式和备注，不能用只含联系方式的新对象覆盖。 |
| 字段投影 | 只保留 import schema 的业务字段，过滤顶层 `geo_diagnostic` 等诊断，不提交 `status/matched_user_id`。不能把中文列、解析 row 包装或整个 confirmed_rows 请求当作业务行。 |
| CLI 自动转换 | 直接读完整 parse 输出时，CLI 会过滤 geo_diagnostic 并转换 time_slots:null；显式 confirmed_rows 需自行按表中类型构造。 |
| 输入识别 | 合并别名“用户联系方式”仍可识别，整理时拆开；旧“联系方式/contact”不再识别。多条不以编号开头的标签记录用空行分隔。未知字段被忽略，非编号重复字段保留先识别值；重复编号（同值或别名也算）报记录边界错误，诊断读取见[解析流程](requirements-import.md#2-核对每行)。 |

## JSON 示例

这是上面同一条需求的业务行。本例假设目录查询已返回“数学 ID=101、高一 ID=201”；这些 ID 仅演示映射，执行时换成真实查询结果。学校按原文名称填写，定位交给后端。

```json
{
  "requirement_code": "DEMO-HZ-001",
  "requirement_type": "tutoring",
  "preferred_mode": "offline",
  "subject_ids": [
    101
  ],
  "grade_ids": [
    201
  ],
  "description": "学生为高一男生，基础较弱；有高中数学辅导经验，讲解清楚，耐心负责",
  "raw_text": "编号：DEMO-HZ-001\n年级：高一\n科目：数学\n需求方角色：家长\n需求方性别：女\n需求方学历：本科\n要求的性别：女\n要求的学历：本科\n要求的学校：浙江大学\n学校的资质：211\n授课方式：线下\n要求的资格：兼职教师\n薪酬：150-200元/小时\n时间：每周1次，每次2小时；周六14:00-16:00\n地址：杭州市西湖区文三路与学院路交叉口附近\n要求：学生为高一男生，基础较弱；有高中数学辅导经验，讲解清楚，耐心负责\n备注：一对一；需求方为母亲\n用户电话：13900000001\n用户微信：demo_parent\n管理员电话：13800000001\n管理员微信：demo_admin",
  "condition": {
    "requester_role": "parent",
    "requester_gender": "female",
    "requester_education_level": "bachelor",
    "required_gender": "female",
    "required_education_levels": [
      "bachelor"
    ],
    "required_school_names": [
      "浙江大学"
    ],
    "required_school_tiers": [
      "211"
    ],
    "required_occupation": "part_time_teacher"
  },
  "compensation": {
    "raw_text": "150-200元/小时",
    "amount_min": "150",
    "amount_max": "200",
    "currency": "CNY",
    "billing_period": "hour",
    "billing_unit_text": "元/小时",
    "is_negotiable": false
  },
  "weekly_frequency_min": 1,
  "weekly_frequency_max": 1,
  "session_duration_minutes_min": 120,
  "session_duration_minutes_max": 120,
  "class_time_text": "每周1次，每次2小时；周六14:00-16:00",
  "time_slots": [
    {
      "weekday": 6,
      "start_minute": 840,
      "end_minute": 960
    }
  ],
  "address_detail": "杭州市西湖区文三路与学院路交叉口附近",
  "ext": {
    "user_contact_phone": "13900000001",
    "user_contact_wechat": "demo_parent",
    "admin_contact_phone": "13800000001",
    "admin_contact_wechat": "demo_admin",
    "remark": "一对一；需求方为母亲"
  }
}
```
