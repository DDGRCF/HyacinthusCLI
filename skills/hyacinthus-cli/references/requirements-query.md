<!-- 改动说明：区分精确编号查询与科目年级筛选，明确正常空结果的结束条件，并保留延期契约。 -->
## 需求搜索流程

1. 根据用户意图选关键词与 scope。找“当前有效的初一数学”时使用 active，按科目关键词“数学”搜索，再用返回的 subject_names、grade_names 核对数学与初一；不要假定标题必然包含连写的“初一数学”。按编号找需求时用完整编号并核对 requirement_code。
2. 读当前 search --help/schema，确认 skip、limit 与结果分页字段。需要完整结果时按实际分页继续，同一关键词不重复查询同一页。
3. 检查授权并执行真实 search。success 且 items 为空表示本次范围无匹配，直接向用户报告，查询任务结束。
4. 有结果时展示用户需要的岗位信息并注明范围。查询完成后，后台状态、其他科目或其他范围的搜索等待用户提出新要求；admin status 需要独立的 admin:read，不能用作空结果查询的附加检查。

用户指定 active 时沿用 active；“没有有效需求”和“接口失败”按真实成功/错误返回区分。不要由空结果推断服务未部署、需要新增授权或发生数据库故障。

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

当前 search 返回摘要，包含编号、ID、科目、年级、状态等，不提供完整薪酬、条件、授课方式和时间字段。不要编造详情命令或声称已通过摘要核对这些字段；完整业务字段以保存的请求、真实写入回执和有权限的独立详情核对为准。

## 需求延期流程

用户要求“延期需求”“续期需求”“激活过期需求并刷新截止时间”，且给出需求编号时，使用 `requirements extend`。该命令按业务 `requirement_code` 定位需求，不使用数据库 ID。

默认延期使用后端配置的默认有效期，逻辑与后台需求列表的延期/激活一致：

```bash
hyacinthus requirements extend HZ260514701 --dry-run
hyacinthus requirements extend HZ260514701 --yes
```

如果用户明确给出延期到某个时间，传 `--expires-at`，时间必须是未来时间：

```bash
hyacinthus requirements extend HZ260514701 --expires-at 2027-07-10T12:00:00 --dry-run
hyacinthus requirements extend HZ260514701 --expires-at 2027-07-10T12:00:00 --yes
```

此命令需要 `requirements:write`。执行成功后只汇报关键字段：

- `requirement_id`
- `requirement_code`
- `expires_at`

常见失败码：

- `REQUIREMENT_CODE_REQUIRED`：编号为空。
- `REQUIREMENT_CODE_NOT_FOUND`：编号不存在，向用户说明没有找到该需求编号。
- `REQUIREMENT_CODE_DUPLICATED`：编号重复，需要人工在后台处理。
- `REQUIREMENT_EXTEND_EXPIRES_AT_INVALID`：手动延期时间不是未来时间。


批量延期使用 [批次和地图](batch-and-geo.md)。调用前查看当前 schema，写入确认遵循 [结果和确认](output-risk.md)。
