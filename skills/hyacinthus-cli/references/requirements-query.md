# 查询和延期

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

当前使用后端默认有效期；`--expires-at` 虽可传入，实际不应用。用户要求指定日期时报告此限制，不能承诺已延期到该日。单条延期恢复为 open，取消已有匹配并清理失效标记；确认遵循[结果和确认](output-risk.md)。

成功报告 `requirement_id/requirement_code/expires_at`。编号为空、不存在、重复或时间无效时，按返回 code/hint 处理。

批量延期及其当前限制见[批次指南](batch-and-geo.md#批量延期限制)。
