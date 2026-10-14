# CLI 内嵌格式二规则：隔离测试报告（2026-10-12）

范围：现有已安装 CLI 0.1.16 的 import --dry-run、本地当前后端纯解析函数、只读获取的实际科目/年级目录。未调用生产解析接口、定位服务或生产写入。
样本：12 条，BKB609、BKB673 为已有邮件保存原文；另 10 条为截图片段/合成边界用例，不是假称找到了 JA058/QA166 的完整邮件。格式二由当前 Codex 按内嵌指南整理，不是独立模型或 CLI 自主整理的成功率测试。
结果：原文直接解析 12/12 至少一项与预期不同；先整理格式二再宽松解析，7/12 仍有遗漏，全部为次数/时长的 19 个字段；实际 CLI 导入预览保留这些遗漏。标准格式二中的年级、科目映射（含泰语回退其他）、学员/教师性别、薪酬和地址，本组断言通过。
纯解析测试运行成功只证明拿到了输出，不代表语义用例全部通过。dry-run 只验证请求，不证明岗位已落坐标、入库或展示。

确认的问题与修订建议：
1. 执行路径：parse/import-raw 不执行本地语义整理，只提交输入给服务器。把原邮件直接解析是导致上述漏项和错位的共同路径。邮件流程应固定先整理标准格式二，不能把 parse 当语义整理。
2. 对象与否定：教师经历“五年级”误混进学员年级；“不是五年级”仍被直接解析为五年级。字段指南已有对象规则，但直接解析不会可靠执行它。
3. 偏好与限制：真实 BKB609“男老师优先”直接解析为硬性 male。内嵌字段指南未明确优先/更好/倾向与限/必须的边界。建议就地明确：偏好保留要求，硬性性别默认不限，仅明确限定才写男/女。
4. 次数和时长：标准格式二“每周5次，每次2小时”仍只有 class_time_text，四个结构字段不生成；CLI 导入转换也不补。建议在 CLI 本地标准字段转换阶段完成，不给服务器自由文本解析再堆别名。不能从费用120元/2小时推断每次授课两小时。
5. 目录：泰语不在现目录。宽松模式回退“其他”并有 SUBJECT_NAME_FALLBACK_TO_OTHER warning，具体泰语仍保留原文和要求；严格模式不做这个回退。电子琴可归已有“乐器”并保留具体名称，不能伪造独立科目 ID。
6. 薪酬：合成“专职老师280元一个小时”直接解析能拿到280但漏单位和专职资格；整理成明确资格+280元/小时后通过。真实 BKB609“可议价”经格式二解析 is_negotiable 仍为 false，但文字仍保存；这是本轮额外发现的结构化精度限制，不作为卡住上传的理由。
7. 文本矛盾：字段指南授课方式仍允许 hybrid，已装二进制却把所有非online改offline；示例资格仍写“兼职教师”，主规则只允许“普通兼职/专职教师”。应修改原位置而非追加第二套规则。
8. 效率：邮件指南仍要求 parse后逐行复核/预览；字段指南又要求整理阶段对照全文补漏。与已约定整理一次、正常文档直接上传的流程不一致，不能依靠反复人工复核填补转换能力。

逐条对比（不把选定针对性用例比例称为生产错误率）：

BKB673 | existing_source
原文：编号：BKB673 / 信息：初一男生，全科偏理，一周5次，晚上6点30开始，140-160/2h / 地址：鄞州区钟盈小区 / 要求：男生，宁波大学，经验丰富，理科优秀，有耐心负责任
原文直解析：subject_ids 预期=[15] 实际=[]; condition.requester_gender 预期="male" 实际=null; weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null; address_detail 预期="宁波市鄞州区钟盈小区" 实际="鄞州区钟盈小区"
格式二宽松解析：weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null
格式二严格解析：weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null
CLI 导入预览：weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null
raw errors=[] warnings=[]
normalized errors=[] warnings=[]

BKB609 | existing_source
原文：编号：BKB609 / 信息：幼儿园中班男生，泰语，日常需要，后续可能出国，周末一周一次，120-140/2h（可议价） / 地址：慈溪复地一期御溪雅苑 / 要求：男老师优先 / ￼
原文直解析：subject_ids 预期=[29] 实际=[]; condition.requester_gender 预期="male" 实际=null; condition.required_gender 预期="any" 实际="male"; weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null
格式二宽松解析：weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null
格式二严格解析：subject_ids 预期=[29] 实际=[]; weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null
CLI 导入预览：weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null
raw errors=[] warnings=[]
normalized errors=[] warnings=["SUBJECT_NAME_FALLBACK_TO_OTHER:泰语"]

TEST30003 | screenshot_excerpt_with_synthetic_context
原文：编号：TEST30003 / 学员：高二 / 补习科目：数学 / 要求：专职老师280元一个小时 / 补习地点：杭州市上城区留香园
原文直解析：condition.required_occupation 预期="full_time_teacher" 实际="part_time_teacher"; compensation.billing_period 预期="hourly" 实际=null; address_detail 预期="杭州市上城区留香园" 实际=null
格式二宽松解析：本用例断言通过
格式二严格解析：本用例断言通过
CLI 导入预览：本用例断言通过
raw errors=["ADDRESS_DETAIL_MISSING"] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

TEST30004 | synthetic_control
原文：编号：TEST30004 / 科目：高一数学 / 学员情况：男孩 / 辅导地址：杭州市西湖区文三路 / 课时费：每小时150元
原文直解析：grade_ids 预期=[11] 实际=[]; subject_ids 预期=[2] 实际=[29]; condition.requester_gender 预期="male" 实际=null
格式二宽松解析：本用例断言通过
格式二严格解析：本用例断言通过
CLI 导入预览：本用例断言通过
raw errors=[] warnings=["SUBJECT_NAME_FALLBACK_TO_OTHER:高一数学"]
normalized errors=[] warnings=[]

TEST30005 | synthetic_control
原文：编号：TEST30005 / 学员五年级男生，学电子琴，每周一次。 / 补习地点：嘉兴市南湖区南湖天地 / 教师要求：女生优先
原文直解析：subject_ids 预期=[25] 实际=[]; condition.requester_gender 预期="male" 实际=null; weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null; address_detail 预期="嘉兴市南湖区南湖天地" 实际=null
格式二宽松解析：weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null
格式二严格解析：weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null
CLI 导入预览：weekly_frequency_min 预期=1 实际=null; weekly_frequency_max 预期=1 实际=null
raw errors=["ADDRESS_DETAIL_MISSING"] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

TEST30006 | synthetic_control
原文：编号：TEST30006 / 初一女孩补习英语，必须女老师。 / 上门地址：武汉市洪山区光谷天地 / 时间：每周五次，每次两小时
原文直解析：condition.requester_gender 预期="female" 实际=null; condition.required_gender 预期="female" 实际="any"; weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null; session_duration_minutes_min 预期=120 实际=null; session_duration_minutes_max 预期=120 实际=null; address_detail 预期="武汉市洪山区光谷天地" 实际=null
格式二宽松解析：weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null; session_duration_minutes_min 预期=120 实际=null; session_duration_minutes_max 预期=120 实际=null
格式二严格解析：weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null; session_duration_minutes_min 预期=120 实际=null; session_duration_minutes_max 预期=120 实际=null
CLI 导入预览：weekly_frequency_min 预期=5 实际=null; weekly_frequency_max 预期=5 实际=null; session_duration_minutes_min 预期=120 实际=null; session_duration_minutes_max 预期=120 实际=null
raw errors=["ADDRESS_DETAIL_MISSING"] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

TEST30007 | synthetic_control
原文：编号：TEST30007 / 学生：初二男生，英语 / 一周两到三次，每次一个半到两个小时，周末时间协商。 / 地址：杭州市拱墅区九龙仓君玺
原文直解析：grade_ids 预期=[9] 实际=[]; subject_ids 预期=[3] 实际=[]; weekly_frequency_min 预期=2 实际=null; weekly_frequency_max 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=120 实际=null
格式二宽松解析：weekly_frequency_min 预期=2 实际=null; weekly_frequency_max 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=120 实际=null
格式二严格解析：weekly_frequency_min 预期=2 实际=null; weekly_frequency_max 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=120 实际=null
CLI 导入预览：weekly_frequency_min 预期=2 实际=null; weekly_frequency_max 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=120 实际=null
raw errors=[] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

TEST30008 | synthetic_control
原文：编号：TEST30008 / 学员：初一女生，数学 / 老师需有教过五年级的经验，男老师优先。 / 面试：浙江大学紫金港校区 / 实际授课：杭州市拱墅区文樾上院
原文直解析：grade_ids 预期=[8] 实际=[6, 8]; condition.requester_gender 预期="female" 实际=null; address_detail 预期="杭州市拱墅区文樾上院" 实际=null
格式二宽松解析：本用例断言通过
格式二严格解析：本用例断言通过
CLI 导入预览：本用例断言通过
raw errors=["ADDRESS_DETAIL_MISSING"] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

TEST30009 | synthetic_control
原文：编号：TEST30009 / 家教地址：杭州市滨江区丹枫实验小学附近，上门辅导。 / 孩子二年级，女，语文数学 / 要求：大学生，有经验 / 时间：每次90分钟，每周3次
原文直解析：condition.requester_gender 预期="female" 实际=null; weekly_frequency_min 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=90 实际=null; address_detail 预期="杭州市滨江区丹枫实验小学附近" 实际="杭州市滨江区丹枫实验小学附近，上门辅导。"
格式二宽松解析：weekly_frequency_min 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=90 实际=null
格式二严格解析：weekly_frequency_min 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=90 实际=null
CLI 导入预览：weekly_frequency_min 预期=3 实际=null; session_duration_minutes_min 预期=90 实际=null; session_duration_minutes_max 预期=90 实际=null
raw errors=[] warnings=[]
normalized errors=[] warnings=["STRICT_VALUE_UNMAPPED:要求的学历"]

TEST30010 | synthetic_control
原文：编号：TEST30010 / 五岁女孩，全英语陪玩，不是五年级。 / 授课地点：杭州市西湖区求是新村 / 老师认真负责，男女不限
原文直解析：grade_ids 预期=[] 实际=[6]; condition.requester_gender 预期="female" 实际=null; address_detail 预期="杭州市西湖区求是新村" 实际=null
格式二宽松解析：本用例断言通过
格式二严格解析：本用例断言通过
CLI 导入预览：本用例断言通过
raw errors=["ADDRESS_DETAIL_MISSING"] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

TEST30011 | synthetic_control
原文：编号：TEST30011 / 高二数学同步辅导 / 线上网课，上课地点所在城市：杭州市 / 一周一次，每次两小时 / 费用280元每小时
原文直解析：preferred_mode 预期="online" 实际="offline"; weekly_frequency_min 预期=1 实际=null; session_duration_minutes_min 预期=120 实际=null; address_detail 预期="杭州市" 实际=null
格式二宽松解析：weekly_frequency_min 预期=1 实际=null; session_duration_minutes_min 预期=120 实际=null
格式二严格解析：weekly_frequency_min 预期=1 实际=null; session_duration_minutes_min 预期=120 实际=null
CLI 导入预览：weekly_frequency_min 预期=1 实际=null; session_duration_minutes_min 预期=120 实际=null
raw errors=["ADDRESS_DETAIL_MISSING"] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

TEST30012 | synthetic_negative_control
原文：编号：TEST30012 / 学生：初三男生 / 学习内容：同步辅导 / 授课地点：杭州市萧山区金鸡路附近 / 女生优先，暂时未确定具体科目 / 费用120元/2小时
原文直解析：grade_ids 预期=[10] 实际=[]; address_detail 预期="杭州市萧山区金鸡路附近" 实际=null
格式二宽松解析：本用例断言通过
格式二严格解析：本用例断言通过
CLI 导入预览：本用例断言通过
raw errors=["ADDRESS_DETAIL_MISSING"] warnings=["FIELD_RECOGNITION_NOTICE"]
normalized errors=[] warnings=[]

版本：
{
  "root": "35a1e694740a66c40b932ce9537f3bf8041080bd",
  "cli": "f5160ba983c1faf6a87585a225d63684251cae18",
  "backend": "0d6fe9c96ca48cb057664d3cc5fd1b7d2f37617c",
  "installed_cli": "hyacinthus 0.1.16"
}

本轮未修改永久规则或程序、未提交 GitHub、未部署阿里云。临时探针已从后端源文件移除，保留 probe.patch 供复现。
