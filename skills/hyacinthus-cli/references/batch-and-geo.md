<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
# 批次与地图运行单

用于持久批次上传、批量延期、上传前只读预检与地图复核。每一步先 `capability schema <id>`，依 request_schema、required_scopes 与 risk_level 构造参数；专用语义命令存在时优先用专用命令。

| 步骤 | capability ID | 实际作用 |
| --- | --- | --- |
| 查编号和版本 | `requirements.identity_lookup` | 只读返回 new/update/duplicate 与当前版本；以 schema 中批次数限制为准 |
| 校验结构和身份动作 | `requirements.preflight_v2` | 只读预检，不写需求、不调用地图 |
| 写入并保存运行单 | `requirements.upload_run` | 用稳定 client_run_id、client_row_id 提交或续读同批结果 |
| 查询地图运行单 | `requirements.geocode_run` | 按返回的 geo_run_id 读取逐行地图状态 |
| 人工复核或重新排队 | `requirements.geocode_release` | 写操作，提交已确认坐标或按契约重新排队 |
| 批量延期 | `requirements.batch_extend_v2` | 按准确编号延期，复用已有坐标，不重新调用地图 |

例如 `hyacinthus capability run requirements.identity_lookup --data @tasks/<run_id>/identity.json`。不要照抄虚构运行单 UUID；从真实回执取得 upload_run_id、geo_run_id 和逐行句柄。

先完成所需授权，再查询身份与预检；确认写入范围后预览 upload_run，批准后提交，保存完整运行单和逐行结果。地图后续用同一 geo_run_id 查询，不重复上传已写入需求。needs_review 的行展示原因，取得具体地址/坐标复核后再 release；不能仅因为用户批准导入就自行批准疑似错误坐标。

断线后保存并复用 client_run_id 与原 payload 续读，不为同批随机生成新键。批量延期前核对编号与当前版本，确认目标时间，不更改已有业务条件。业务写入成功、write_failed、geo_pending、geo_needs_review 和 geo_resolved 分开汇报；具体状态与计数以实际 schema/回执为准。
