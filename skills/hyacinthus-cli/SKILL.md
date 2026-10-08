---
name: hyacinthus-cli
description: "使用风信子家教中心 Hyacinthus CLI 查询、整理、解析、导入和延期家教需求，查询学校及资质，管理科目年级与需求优先级规则，读取或修改个人资料、查询后台状态；也用于 CLI 配置、授权、权限、能力发现和故障诊断。处理家教岗位邮件时先使用 tutoring-job-mail-upload 的邮件流程。"
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus --help"
---

# 风信子家教中心 CLI

使用 `hyacinthus` 查询和管理 Hyacinthus 家教业务。实际调用前读[公共规则](references/shared.md)，再按任务选指南；只整理文本时无需登录。

## 任务导航

| 任务 | 指南 | 命令 |
| --- | --- | --- |
| 安装、授权、检查实例或排障 | [授权和环境](references/auth.md) | `auth` / `config` / `doctor --strict` |
| 找需求、查编号、单条延期 | [查询和延期](references/requirements-query.md) | `requirements search/extend` |
| 整理文本、核对字段 | [字段格式](references/requirements-format.md) | TXT / CSV / JSON 映射 |
| 解析、复核、导入、恢复解析任务 | [解析和导入](references/requirements-import.md) | `requirements parse/parse-job/import/import-raw` |
| 科目、年级、学校资质、缺失目录和排序 | [目录管理](references/catalog.md) | `requirements options/catalog` |
| 优先级规则、命中和备份 | [优先级规则](references/priority-rules.md) | `requirements priority-rules` |
| 持久批次、批量延期和地图复核 | [批次和地图](references/batch-and-geo.md) | `capability run <id>` |
| 个人资料、后台状态 | [用户和后台](references/user-admin.md) | `user me/update` / `admin status` |
| 输出、确认和失败恢复 | [结果和确认](references/output-risk.md) | `--output` / `--dry-run` |
| 查找其他能力 | [能力索引](references/capability-map.md) | `capability list` / `schema` |

邮件岗位先读相邻的[邮件流程](../tutoring-job-mail-upload/SKILL.md)。需要下一步时再读对应指南，不必一次读完。

## 查看命令和指南

```bash
hyacinthus --help
hyacinthus --no-notice --jq '.data.capabilities[].id' capability list
hyacinthus schema <capability_id>
hyacinthus <命令组> --help
hyacinthus --no-notice skills read hyacinthus-cli references/requirements-import.md
```

Skills 随二进制内嵌，可以不登录、不联网读取。`skills read <name>` 读入口，追加相对路径读 reference；默认输出 Markdown，`--json` 输出 JSON。优先读当前二进制内的指南，参数以当前 help/schema 为准。
