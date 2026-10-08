# 批次和地图

用于持久上传、批量延期和地图复核。先读[公共规则](shared.md)、`schema <id>`；普通解析导入用[解析和导入](requirements-import.md)。

## 能力

| ID（均以 requirements. 开头） | 用途 | scope |
| --- | --- | --- |
| identity_lookup | 查 new/update/duplicate 和 current_revision_key | requirements:read |
| preflight_v2 | 只读检查结构与身份，不解析地图 | requirements:parse |
| upload_run | 写前解析/复用定位，再写通过行并保存运行单 | requirements:write |
| geocode_run | 读取返回的地图运行单 | requirements:read |
| geocode_release | 提交人工定位或重排地图任务 | requirements:write |
| batch_extend_v2 | 默认延期，复用已有坐标 | requirements:write |

```bash
hyacinthus capability run requirements.identity_lookup --data @tasks/<run_id>/identity.json
hyacinthus capability run requirements.preflight_v2 --data @tasks/<run_id>/preflight.json
hyacinthus capability run requirements.upload_run --data @tasks/<run_id>/upload.json --dry-run
hyacinthus capability run requirements.upload_run --data @tasks/<run_id>/upload.json --yes --output tasks/<run_id>/result.json
```

当前查身份/预检最多200行，上传/延期/复核100行。dry-run 只预览，不替代真实 preflight；输出行为见[结果指南](output-risk.md)。

## 请求与恢复

preflight.json 顶层只放 rows；upload.json 另加 client_run_id，可按 schema 加 instance_id。不要把上传请求原样用于预检。

upload_run/preflight_v2 的 rows[] 用 `client_row_id`、可选 `revision_key/operation_key` 和嵌套 `requirement`。requirement 按[业务行格式](requirements-format.md#json-构造规则)构造；内嵌 schema 只标 object，预览通过不代表业务通过。

upload_run/batch_extend_v2 用稳定 client_run_id/client_row_id，不加普通导入的 idempotency_key。同请求断线后用原能力、原键、原内容续读，改变内容会冲突。revision_key 是来源修订证据，**不是并发锁**；duplicate 要求提交修订键与已保存的相同，不能只凭编号认定。

## 地图在哪一步

upload_run 包括 online 在内，**先定位或复用有效定位，再写入**。定位失败行 write_status=failed；即使 geo_status=needs_review/unavailable，也不能算已入库。

按 row_outcomes 汇报：write_status 为 pending/created/updated/extended/failed，geo_status 为 pending/resolved/needs_review/invalid/unavailable/not_required。write_failed/geo_pending 是计数。只有真实返回非空 geo_run_id 才查询 geocode_run，runner 不自动轮询全流程。

geocode_release 用真实 geo_run_id，按 rows[].row_id 或 requirement_code 选行；row_id 是运行单行 ID，不是需求 ID。人工复核后传 `location:{lng,lat}`，可附 confirmed_address/diagnostic；未传 location 表示重排。

release 只选择 write_status=created/updated 的真实行，**不会重试需求写入失败**。它逐行提交，后续行报错时前面的行可能已生效；错误或回执不明时先用 geocode_run 读取原运行单，再处理未完成行，不套用 upload_run 的稳定键重放保证。写入失败行保存回执，修正后另建子批次，按[确认和恢复规则](output-risk.md)提交。

## 批量延期限制

batch_extend_v2 和单条 extend 虽接收 expires_at，当前都使用后端默认有效期，不能指定截止日期。批量延期保留 matched 状态；单条延期恢复 open 并取消匹配，不能互相替代。按真实 expires_at、extended/write_failed 报告，不按预览推断日期已生效。
