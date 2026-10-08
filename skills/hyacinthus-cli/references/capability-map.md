# 能力索引

参数和权限查 `hyacinthus schema <id>`。下表命令均以 `hyacinthus` 开头，按任务读对应指南。

| capability ID | 命令 | 指南 |
| --- | --- | --- |
| `requirements.batch_parse` | `requirements parse` | [requirements-import.md](requirements-import.md) |
| `requirements.batch_import` | `requirements import` | [requirements-import.md](requirements-import.md) |
| `requirements.extend` | `requirements extend` | [requirements-query.md](requirements-query.md) |
| `requirements.search` | `requirements search` | [requirements-query.md](requirements-query.md) |
| `requirements.priority_rules.list` | `requirements priority-rules list` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.create` | `requirements priority-rules add` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.update` | `requirements priority-rules update` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.delete` | `requirements priority-rules delete` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.enable` | `requirements priority-rules enable` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.disable` | `requirements priority-rules disable` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.preview_counts` | `requirements priority-rules preview` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.matches` | `requirements priority-rules matches` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.refresh` | `requirements priority-rules refresh` | [priority-rules.md](priority-rules.md) |
| `requirements.priority_rules.import` | `requirements priority-rules import-json` | [priority-rules.md](priority-rules.md) |
| `requirements.options` | `requirements options` | [catalog.md](catalog.md) |
| `catalog.create_missing` | `requirements catalog create-missing` | [catalog.md](catalog.md) |
| `catalog.reorder` | `requirements catalog reorder` | [catalog.md](catalog.md) |
| `users.me_read` | `user me` | [user-admin.md](user-admin.md) |
| `users.me_update` | `user update` | [user-admin.md](user-admin.md) |
| `admin.status` | `admin status` | [user-admin.md](user-admin.md) |
| `requirements.upload_run` | `capability run requirements.upload_run` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.geocode_run` | `capability run requirements.geocode_run` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.geocode_release` | `capability run requirements.geocode_release` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.batch_extend_v2` | `capability run requirements.batch_extend_v2` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.identity_lookup` | `capability run requirements.identity_lookup` | [batch-and-geo.md](batch-and-geo.md) |
| `requirements.preflight_v2` | `capability run requirements.preflight_v2` | [batch-and-geo.md](batch-and-geo.md) |

import-raw 组合 parse 和 import，无独立 capability ID。parse-job 是任务恢复命令，成功取 result；export-json 用规则 list 能力写本地文件。auth/config/doctor/skills 等控制命令查 `hyacinthus --help`。
