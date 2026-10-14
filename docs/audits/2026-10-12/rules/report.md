# CLI 内嵌规则整体审查（2026-10-12）

检查范围：当前实际安装的 CLI 0.1.16；2个 Skill 入口、11份引用文档，共674行；相关内嵌 schema 说明及关键导入转换代码。只审查内嵌规则，不采用封存旧 Skill 或本机非内嵌规则覆盖结论。
结构检查：13份内嵌文件与源码逐字一致；79处相对文件引用均存在；隔离 export/check 通过；两个 Skill 元信息校验通过。示例 JSON import --dry-run 通过，但这不证明示例虚构 ID 在网站目录有效，也不证明真实地图定位或写入。
结论：总体结构紧凑、任务路由可读；存在3项明确冲突（含规则与程序/用语冲突），另有边界、生产口径、职责、接口限制及重复维护问题，不能宣布已完全统一。

已经一致且应保留的部分：
- 字段对象、学员性别、默认家长/普通兼职、不增义、联系方式角色已集中在字段指南；本次新加的偏好和否定边界在该主指南内部一致。
- errors 是实际拒绝依据；warnings不阻断。协议缺字段/矛盾与业务 warning 不同，不能删除真实协议检查。
- 权限、环境、幂等键和未知回执恢复边界一致；正常已有批准可以 --yes，不需要每批重新申请授权。
- stdout envelope 与 --output 裸data 的说明一致；不把预览当写入回执。
- 正常 import/upload_run 写前定位，文档未把正常上传写成入库后等地理队列；专门地理查询/复核接口可以保留为按需工具。
- 合理的分层引用或字段专项说明不算冗余。未发现大面积复制堆砌。

问题明细：

1. [高][明确冲突] 多科默认是否拆单
位置：cli/skills/hyacinthus-cli/references/requirements-format.md:27；cli/skills/tutoring-job-mail-upload/SKILL.md:40；cli/skills/tutoring-job-mail-upload/SKILL.md:41
事实：字段指南说同岗多科只在明确分别招聘时拆岗；邮件指南却把未说明是否同一老师或分别招聘的多科岗位放入问题清单。这让同一原文得到不同处理。
建议：明确分别招聘才拆；单有多科不构成拆单疑义；仅有实质性冲突或岗位边界无法归属时记录问题。

2. [高][规则与程序冲突] 混合授课
位置：cli/skills/hyacinthus-cli/references/requirements-format.md:35；cli/assets/agent-cli-capabilities.yaml:342；cli/src/commands.rs:2993
事实：指南和内嵌 schema 描述明确混合时填 hybrid；实际 import 将所有非 online 值转换为 offline。隔离 dry-run 复现 hybrid -> offline。
建议：按已约定口径统一为明确线上才 online，其余 offline；原文混合安排保留在文字说明。接口枚举是否保留要与公开契约区分，不能只为了文案删除服务器仍支持的枚举。

3. [中][用语冲突] 教师资格示例
位置：cli/skills/hyacinthus-cli/references/requirements-format.md:36；cli/skills/hyacinthus-cli/references/requirements-format.md:63；cli/skills/hyacinthus-cli/references/requirements-format.md:103
事实：主规则仅输出普通兼职/专职教师，TXT 示例及 JSON raw_text 仍写兼职教师。
建议：只修改两处示例为普通兼职，保留接口 part_time_teacher，不追加别名清单。

4. [中][边界模糊] 年龄与幼儿园年级
位置：cli/skills/hyacinthus-cli/references/requirements-format.md:5；cli/skills/hyacinthus-cli/references/requirements-format.md:17；cli/skills/hyacinthus-cli/references/requirements-format.md:26
事实：总则不推断缺失信息，并区分五岁和五年级；字段行又允许低龄年龄按目录归幼儿园，未明确是否必须原文明示就读。年龄不能唯一证明学员在读哪个班。
建议：仅明确就读信息映射目录；只有年龄时保留年龄，不擅自赋予班级/年级。

5. [高][与已约定生产流程不一致] 逐行复核、查重、回读
位置：cli/skills/tutoring-job-mail-upload/SKILL.md:52；cli/skills/tutoring-job-mail-upload/SKILL.md:60；cli/skills/tutoring-job-mail-upload/SKILL.md:66；cli/skills/hyacinthus-cli/references/requirements-import.md:31；cli/skills/hyacinthus-cli/references/requirements-import.md:49
事实：邮件流程固定 parse 后逐行核对，再预览、核对更新范围、逐编号 search 回读。与用户已约定正常格式二直接上传、网站判断新建更新延期、异常集中处理不一致。一般导入指南的仅批准新建时查重属于必要的特殊范围，不能误删。
建议：将批量邮件正常路径和仅新建/指定回读任务分开；整理时完成语义检查，转换依据整理产物核对，成功回执作为计数来源；只处理失败或未知结果，不把逐行原文复核和 search 回读作为正常批次必经步骤。

6. [中][执行职责需讲清] 次数与时长
位置：cli/skills/hyacinthus-cli/references/requirements-format.md:38；cli/skills/hyacinthus-cli/references/requirements-import.md:33；cli/skills/hyacinthus-cli/references/requirements-import.md:88
事实：字段规则定义结构化时间，导入指南准确说明 parse 不生成四个字段。两者不是逻辑冲突；当前要求 Agent 补 JSON，直接 import-raw 会缺结构字段。
建议：明确完整导入应使用已补齐的 confirmed_rows，不能把 import-raw 宣称为所有字段无损的捷径；若另行实现自动转换，再同步更新指南。

7. [中][接口能力限制] 延期分类报告
位置：cli/skills/tutoring-job-mail-upload/SKILL.md:68；cli/skills/hyacinthus-cli/references/requirements-import.md:61；backend/src/contracts/http/requirements/agent.rs:241
事实：邮件最终报告只有 created/updated/failed/pending；普通 batch_import 真实响应也只有 created/updated/failed，不能独立确认 extended。upload_run 有 extended，但不是同一接口。
建议：说明不同接口真实支持的结果分类；不得靠猜测补出延期计数。要满足独立延期统计，需要相应真实回执能力，不能仅改报告字段。

8. [中][语言层次混用] 复核一词覆盖不同职责
位置：cli/skills/hyacinthus-cli/SKILL.md:21；cli/skills/tutoring-job-mail-upload/SKILL.md:48；cli/skills/hyacinthus-cli/references/requirements-import.md:27；cli/skills/hyacinthus-cli/references/output-risk.md:19
事实：语义整理检查、后端字段校验、用户写入确认、地理人工复核混用复核/确认说法；confirmed_rows 本身是接口名称，不能据此推导每行都需要人重新批准。
建议：使用整理、解析、提交、回执描述主流程；人工确认和地理复核限定各自适用条件，保留真实接口键名。

9. [低][重复维护风险] schema 重述业务语义
位置：cli/assets/agent-cli-capabilities.yaml:274；cli/assets/agent-cli-capabilities.yaml:289；cli/assets/agent-cli-capabilities.yaml:320；cli/assets/agent-cli-capabilities.yaml:342
事实：字段指南声明是唯一语义判断来源，但 schema 描述仍复制对象、默认值和授课方式口径。授课方式已发生漂移；教师性别描述未同步本次偏好边界，虽不直接矛盾但可引发歧义。
建议：schema 保留类型、枚举、接口限制；业务判断简短引用唯一字段指南，避免复制第二套长解释。

10. [中][生产约定覆盖缺项] 邮件执行节奏与复用
位置：cli/skills/tutoring-job-mail-upload/SKILL.md:15；cli/skills/tutoring-job-mail-upload/SKILL.md:43
事实：已有发布人分目录、50条一文档和空行分隔；尚未写入没有新邮件时仅等待60秒重查、正常文档间隔3秒，以及已整理正确结果的本地复用同步。未提供可用本地库组件时，不应臆造缓存能力。
建议：按实际可用组件补充有授权的生产约定；不引入定时服务，不让未知本地库/旧任务锁阻塞普通整理。此项是覆盖不足，不是内嵌文本自相矛盾。

本轮只检查，没有修改规则、程序、安装包或生产服务器。没有运行真实邮件上传或独立模型准确率评测，文档结构通过不等于语义整理准确率已证明。

后续修订：用户确认非线上全部归线下，授课方式一项已解决；内嵌指南与schema说明已原位同步，本机CLI已重新编译安装，15项交付测试及5种授课方式导入预览通过。CLI提交7b92d50，总仓库提交10d1f82。其他检查项未在本次修改。

后续修订：资格示例一项已解决，TXT与JSON raw_text统一使用普通兼职，本机CLI已编译安装；15项交付测试通过，两个示例全文一致。CLI提交6cdcc2a，总仓库提交4227637。

后续修订：年龄与年级边界已按用户确认的白名单收口；原文明示年级优先，无年级时才使用3岁小班、4岁中班、5—6岁大班、18岁及以上成人。其他年龄不推断，保留原年龄及依据。CLI提交530ffa3，总仓库提交73e017e，本机CLI已编译安装。
