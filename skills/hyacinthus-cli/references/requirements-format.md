# 需求字段格式

TXT 每个岗位一块，用“字段名：字段值”；CSV 每个岗位一行，使用下表21个字段作表头。规范输出按表中顺序，空值保留字段或空列，不能删列导致错位。

输入可以是任意列数、任意顺序，识别别名。不要虚构原文事实；空值、默认值和“其他”按各字段规则处理，不套用统一兜底。原文另存，不把标签和值改成斜杠串。后台标题不属于这21个字段；除非用户明确要求，本流程不生成或更新标题。

## 字段规则

需求方角色只有“家长”或“机构”；学生是接受辅导的人，不作为需求方角色。学生/学员的性别填“需求方性别”；“要求的…”是教师条件。21字段是文本模板，JSON 使用下表的后端键；科目/年级 ID 从 options 或已批准的创建回执选取，学校 ID 从[学校查询](catalog.md#查学校和资质)选取。类型以 `schema requirements.batch_import` 为准。

### 通用提取原则

- 按内容含义判断所属对象和字段，原文标签不决定去向；混合内容拆开填写，已由字段完整表达的信息不再写入要求或备注。保留有用的时间、语气和限制，不推断原文未说明的事实。
- 是否拆单、拆分记录如何保留共同字段及生成编号，统一按[岗位上传流程](../../tutoring-job-mail-upload/SKILL.md)执行；接送点、交通换乘点、面试点、教师所在学校或仅试课安排不算实际授课地址。

| 顺序 | 中文字段 | JSON 字段 | 整理规则和类型 |
| --- | --- | --- | --- |
| 1 | `编号` | `requirement_code` | 整理时把原文中的完整编号原样填入，包括字词、括号、前后缀、分隔符和标签；例如原文写“线下LCM26100808”，编号就是“线下LCM26100808”，不可删掉“线下”。同时按标签含义填写对应字段（如授课方式填线下），但不把完整编号重复抄进“要求”或“备注”。多个编号无法区分时需核对；没有业务编号时按用户格式二约定使用具体地址作为编号，不编造编号。完整编号及历史短编号的重复处理，按[岗位上传流程](../../tutoring-job-mail-upload/SKILL.md)执行。 |
| 2 | `年级` | `grade_ids` | 按学生明确的年级或学段匹配目录；有明确年级不得留空，无对应项填“其他”。七/八/九年级对应初一/初二/初三。仅原文明示年龄大于18岁时填“成人”；只有年龄且不超过18岁、没有年级或学段时留空，年龄写备注。“新、准、升”等时间限定写备注，字段填对应年级；不根据年级推断年龄。JSON：真实整数 ID 数组/null/[]/省略，不传名称。 |
| 3 | `科目` | `subject_ids` | 按原文明确的教学任务匹配后台目录；明确的科目类别按目录展开，与已列科目去重。仅在简称含义明确时映射，不推断原文未说明的科目。作业辅导按原文范围填写，不自动视为全科。无对应目录项或原文未说明科目时填“其他”；未说明时备注注明“原文未明确科目”。教师学科要求写入“要求”。JSON：真实整数 ID 数组/null/[]/省略。
| 4 | `需求方角色` | `condition.requester_role` | 只填原文明确的家长或机构；学生不填此角色。中介转发不代表需求方是机构；无法确认时留空，不猜。 |
| 5 | `需求方性别` | `condition.requester_gender` | 填原文明确的学生/孩子/学员性别，不用家长、发布人或教师性别代替。与年级等信息混写时拆开提取，已填字段的性别不在要求或备注重复。多人性别组合无法用单值表达时留空，在备注保留组合及对应关系；对象不明时不猜。 |
| 6 | `需求方学历` | `condition.requester_education_level`、`condition.requester_education_note` | 填需求方学历，补充说明写 `requester_education_note`。 |
| 7 | `要求的性别` | `condition.required_gender` | 仅填教师明确的硬性性别要求，JSON 为单值。填入后从“要求”删除重复的硬性要求；“优先、最好、倾向”等偏好留在“要求”且不填本字段。先确认性别描述指向教师。 |
| 8 | `要求的学历` | `condition.required_education_levels`、`condition.required_education_note` | 保留学历限制和在读身份；大学生不等于本科毕业。学历值使用后端认可的字符串数组，不传 `null`；在读等说明写入 `required_education_note`。 |
| 9 | `要求的学校` | `condition.required_school_names`、`condition.required_school_ids` | 只填明确要求老师就读/毕业的学校；无歧义简称规范为全称，简称有歧义时原样保留并待核对。“师范大学”“一本”等泛称不补造具体校名；地址中的学校不算。偏好校名留在“要求”，不填本字段。学校名称用字符串数组，学校 ID 用真实整数数组，均不传 `null`；学校层次写入下一字段。 |
| 10 | `学校的资质` | `condition.required_school_tiers` | 填硬性教师学校要求的资质：原文明确层次时直接填写；“92院校”按用户约定展开为985、211。只写明确校名时，查询目录或按[catalog.md](catalog.md#查学校和资质)中的官方名单流程匹配并补入985/211/双一流资质，即使原文未写层次。来源证据不足或匹配不唯一时需核对，不凭记忆推断；查询失败不等于无资质。偏好层次留在“要求”，不填本字段。教师资格证写入“要求”。JSON：用 `985`/`211`/`double_first_class` 组成字符串数组，不传 `null`。 |
| 11 | `授课方式` | `preferred_mode` | 按主要课程安排及声明适用范围填写：线上/线下/混合对应 online/offline/hybrid。原文有具体实体上课地址且未明确整个岗位线上时，填线下；“仅试课可线上”不改变常规方式。声明范围不明、信息缺失或冲突时待核对，不删字段触发默认。 |
| 12 | `要求的资格` | `condition.required_occupation` | 仅分普通兼职和专职教师。默认普通兼职（`part_time_teacher`）；原文明示专职、全职、在职或一线教师等硬性条件时填 `full_time_teacher`，原文写“不限”也填普通兼职。“专职优先”写在“要求”，不硬筛选。高薪、机构单、教师资格证、毕业多年不代表专职。价格不判断资格；分别报价且对应不同教师画像时按拆单规则分配。经验、教师资格证写“要求”。 |
| 13 | `薪酬` | `compensation` | 保留金额、区间、计价单位、结算方式及“报价/面议”等原意；不把每小时写成每次，不推断时长或资格，不擅自折算月薪。不同价档按拆单规则分配到对应记录。amount_min/max 为十进制字符串，单位写 billing_period/billing_unit_text，原文写 raw_text。 |
| 14 | `时间` | `class_time_text`、`time_slots`、`weekly_frequency_min/max`、`session_duration_minutes_min/max` | 保留每周频次、星期、时段、单次时长、假期、试课和后续安排。频次不等于具体星期；价格计价单位不证明上课时长。“周一三”可展开；时间不明不猜。JSON 中次数用整数、时长用分钟；无范围时 min=max；`time_slots` 用数组，`null` 转为空数组，星期用1–7表示，时间用分钟表示；原文写入 `class_time_text`。 |
| 15 | `地址` | `address_detail` | 优先填写当前岗位明确的城市、区县和地点主体，保留小区、楼栋、校区、地铁站、出口及“附近”等限定；邮件未写城市时，可用联系方式表中明确对应发布人的城市作佐证，不得覆盖邮件地址。不得因同名地点、共用区名、历史缓存或地图结果猜城市。删除字段标签、薪酬、时间和广告词；拆单按上方统一规则。纯线上岗位按既定格式写“城市（线上单）编号”。 |
| 16 | `要求` | `description` | 只写教师的专业、经验、能力、教学方式、偏好、限制和例外；硬性条件填对应结构字段，不重复抄写。保留“优先、最好、也可、不要”等限定；偏好不当作硬性条件。学生信息按其对应字段填写。确实没有教师要求时，可按用户授权填写“认真负责”。 |
| 17 | `备注` | `ext.remark` | 填学生基础、成绩、教材、目标、课程背景、学习习惯、试课安排及回收/加急等信息；保留字段无法表达的年龄、年级时间限定、多人或多科关系，以及“原文未明确科目”等说明。不放教师条件或已由结构字段完整表达的信息，不放程序哈希、旧错误或后台诊断。JSON 只使用 `ext.remark`，不加顶层 `remark`。 |
| 18 | `用户电话` | `ext.user_contact_phone` | 填用户/需求方电话，不借管理员或发件人信息。联系角色或电话/微信类型不明时保留原文询问，不默认管理员。JSON：string/null；空值静默，非法仅 warning。 |
| 19 | `用户微信` | `ext.user_contact_wechat` | 填用户/需求方微信，不借管理员或发件人信息。JSON：string/null；空值静默，非法仅 warning。 |
| 20 | `管理员电话` | `ext.admin_contact_phone` | 填管理员电话，不借用户电话；整组明确适用才写各行，行内值优先。JSON：string/null；和管理员微信至少一项合法非空，已填非法值由后端报 error。 |
| 21 | `管理员微信` | `ext.admin_contact_wechat` | 填管理员微信，不借用户微信；整组明确适用才写各行，行内值优先。JSON：string/null；和管理员电话至少一项合法非空，已填非法值由后端报 error。 |

## 文本示例

下面用一条虚构的高一数学需求展示全部21字段。需求方是母亲、学生是儿子；角色填“家长”，学生明确的性别填入“需求方性别”。示例没有专职要求，所以资格填默认值“普通兼职”。所有内容均为示例；真实任务按各字段的留空、默认和兜底规则处理，不补造事实。

```text
编号：DEMO-HZ-001
年级：高一
科目：数学
需求方角色：家长
需求方性别：男
需求方学历：本科
要求的性别：女
要求的学历：本科
要求的学校：浙江大学
学校的资质：985、211、双一流
授课方式：线下
要求的资格：普通兼职
薪酬：150-200元/小时
时间：每周1次，每次2小时；周六14:00-16:00
地址：杭州市西湖区文三路与学院路交叉口附近
要求：有高中数学辅导经验，讲解清楚，耐心负责
备注：基础较弱；一对一
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
  "description": "有高中数学辅导经验，讲解清楚，耐心负责",
  "raw_text": "编号：DEMO-HZ-001\n年级：高一\n科目：数学\n需求方角色：家长\n需求方性别：男\n需求方学历：本科\n要求的性别：女\n要求的学历：本科\n要求的学校：浙江大学\n学校的资质：985、211、双一流\n授课方式：线下\n要求的资格：普通兼职\n薪酬：150-200元/小时\n时间：每周1次，每次2小时；周六14:00-16:00\n地址：杭州市西湖区文三路与学院路交叉口附近\n要求：有高中数学辅导经验，讲解清楚，耐心负责\n备注：基础较弱；一对一\n用户电话：13900000001\n用户微信：demo_parent\n管理员电话：13800000001\n管理员微信：demo_admin",
  "condition": {
    "requester_role": "parent",
    "requester_gender": "male",
    "requester_education_level": "bachelor",
    "required_gender": "female",
    "required_education_levels": [
      "bachelor"
    ],
    "required_school_names": [
      "浙江大学"
    ],
    "required_school_tiers": [
      "985",
      "211",
      "double_first_class"
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
    "remark": "基础较弱；一对一"
  }
}
```
