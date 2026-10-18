# 查询、延期和过期

实际调用遵循[公共规则](shared.md)。

## 查询

```bash
hyacinthus requirements search --keyword 数学 --scope active
hyacinthus requirements search --keyword HZ260514701 --scope all
```

查询已发布需求只需 `requirements:read`，search 不依赖 options 或解析权限。scope 为 `active`（默认）、`all`、`invalid`、`expired`，按用户范围选择；跨有效期查重用 all。

1. keyword 是模糊匹配。查编号逐项核对 `requirement_code`；找“初一数学”可搜数学，再核对 `subject_names/grade_names`。
2. 用 `skip/limit` 分页，当前 limit 上限100。`has_more: true` 时下一页取返回的 skip + limit；本页筛选无目标仍继续。
3. 翻页结束（has_more=false）仍无匹配时，报告本次关键词和范围无匹配并结束；不换关键词、范围或权限重查。失败按真实错误处理。

search 只返回摘要，不含完整薪酬、条件、授课方式和时间；不能声称这些字段已回读核对。批量身份查询见[批次指南](batch-and-geo.md)。

## 单条延期

按业务编号延期，需要 `requirements:write`：

```bash
hyacinthus requirements extend HZ260514701 --dry-run
hyacinthus requirements extend HZ260514701 --yes
```

普通延期取原截止时间与本次候选截止时间的较晚者，只延长、不缩短。省略 `--expires-at` 用服务端处理时刻加后台有效期；指定时使用该未来候选时间。保留 matched 状态，其他状态恢复 open 并清理下架；确认遵循[结果和确认](output-risk.md)。

成功报告 `requirement_id/requirement_code/expires_at`。编号为空、不存在、重复或时间无效时，按返回 code/hint 处理。

批量延期及其当前限制见[批次指南](batch-and-geo.md#批量延期限制)。

## 单条立即过期

按准确业务编号执行，需 `requirements:write`：

```bash
hyacinthus requirements expire HZ260514701 --dry-run
hyacinthus requirements expire HZ260514701 --yes
```

`expire` 只将截止时间设为服务端当前时刻或保留更早的既有截止时间，不延期、不删除、不改变匹配或下架状态。公开列表和地图按截止时间过滤后不再展示该需求。重复执行不会把已经过期的期限向后移动；不接受客户端指定日期。

`extend` 按只延长规则续期；`expire` 立即结束展示并保留记录；`delete` 永久删除。不得相互替代。

先核对准确编号，再预览及确认，成功回读 `requirement_id/requirement_code/expires_at`。未找到或授权失败必须报告实际错误，不能提示成功；不要用生产岗位做写入测试。

## 明确缩短与删除

特殊情况设置一个未来截止时间（`requirements:write`），允许明确缩短，保留匹配和下架状态：

```bash
hyacinthus requirements set-deadline HZ260514701 --expires-at 2027-07-10T12:00:00+08:00 --dry-run
hyacinthus requirements set-deadline HZ260514701 --expires-at 2027-07-10T12:00:00+08:00 --yes
```

无时区按北京时间 +08:00；过去或当前截止时间被拒绝，立即结束使用 `expire`。

删除须同时具备 `requirements:write` 与 `admin:read`，并明确确认：

```bash
hyacinthus requirements delete HZ260514701 --dry-run
hyacinthus requirements delete HZ260514701 --yes
```

仅需停止展示优先使用 `expire`；删除不可用延期找回。成功分别报告实际期限或 `deleted: true`，不得把预览当成功，不要对真实生产岗位做写入测试。
