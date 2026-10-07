<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
# 当前能力导航

此表对齐发布时内嵌的 capability 清单，帮助从用户任务定位命令和业务指南。参数与权限用当前 `hyacinthus schema <id>` 获取，不在这里复制 schema。help、auth/config/doctor、skills 和 parse-job 是控制/恢复命令，可通过 `hyacinthus --help` 发现。

| capability ID | 用途 | 正式命令 | 业务指南 |
| --- | --- | --- | --- |
| `requirements.batch_parse` | 批量解析需求 | `hyacinthus requirements parse` | [requirements-import.md](requirements-import.md) |
| `requirements.batch_import` | 批量导入需求 | `hyacinthus requirements import` | [requirements-import.md](requirements-import.md) |
| `requirements.extend` | 延期需求 | `hyacinthus requirements extend` | [requirements-query.md](requirements-query.md) |
| `requirements.search` | 搜索需求 | `hyacinthus requirements search` | [requirements-query.md](requirements-query.md) |
| `requirements.priority_rules.list` | 查询需求优先级规则 | `hyacinthus requirements priority-rules list` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.create` | 创建需求优先级规则 | `hyacinthus requirements priority-rules add` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.update` | 更新需求优先级规则 | `hyacinthus requirements priority-rules update` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.delete` | 删除需求优先级规则 | `hyacinthus requirements priority-rules delete` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.enable` | 启用需求优先级规则 | `hyacinthus requirements priority-rules enable` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.disable` | 停用需求优先级规则 | `hyacinthus requirements priority-rules disable` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.preview_counts` | 预览需求优先级规则命中数 | `hyacinthus requirements priority-rules preview` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.matches` | 查询需求优先级规则命中编号 | `hyacinthus requirements priority-rules matches` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.refresh` | 刷新需求优先级 | `hyacinthus requirements priority-rules refresh` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.import` | 导入需求优先级规则 | `hyacinthus requirements priority-rules import-json` | [priority-rules.md](priority-rules.md) |
| `requirements.options` | 需求元数据选项 | `hyacinthus requirements options` | [catalog.md](catalog.md) |
| `catalog.create_missing` | 确认创建缺失科目/年级 | `hyacinthus requirements catalog create-missing` | [catalog.md](catalog.md) |
| `catalog.reorder` | 科目/年级目录排序 | `hyacinthus requirements catalog reorder` | [catalog.md](catalog.md) |
| `users.me_read` | 读取个人资料 | `hyacinthus user me` | [user-admin.md](user-admin.md) |
| `users.me_update` | 更新个人资料 | `hyacinthus user update` | [user-admin.md](user-admin.md) |
| `admin.status` | 后台基础状态 | `hyacinthus admin status` | [user-admin.md](user-admin.md) |
| `requirements.upload_run` | 创建或续读岗位上传运行单 | `hyacinthus capability run requirements.upload_run` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.geocode_run` | 查询岗位地图运行单 | `hyacinthus capability run requirements.geocode_run` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.geocode_release` | 批量放行或重排地图复核 | `hyacinthus capability run requirements.geocode_release` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.batch_extend_v2` | 批量延期并复用坐标 | `hyacinthus capability run requirements.batch_extend_v2` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.identity_lookup` | 批量岗位身份与版本查询 | `hyacinthus capability run requirements.identity_lookup` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.preflight_v2` | 岗位只读预检 | `hyacinthus capability run requirements.preflight_v2` | [batch-and-geo.md](batch-and-geo.md) |
