---
name: hyacinthus-cli
description: "使用风信子家教中心 Hyacinthus CLI 查询、整理、解析、导入和延期家教需求，管理科目年级与需求优先级规则，读取或修改个人资料、查询后台状态；也用于 CLI 配置、授权、权限、能力发现和故障诊断。处理家教岗位邮件时先使用 tutoring-job-mail-upload 的邮件流程。"
metadata:
  requires:
    bins: ["hyacinthus"]
  cliHelp: "hyacinthus --help"
---

<!-- 改动说明：整合 Hyacinthus 系列业务路由，并让实例检查明确进入公共和授权诊断指南。 -->
# 风信子家教中心 CLI

`hyacinthus` 是风信子家教中心的命令行入口。通过后端 HTTP 接口查询和管理业务，授权绑定当前 Agent 的 profile。后端负责业务校验、权限和持久化；CLI 提供命令、能力 schema、预览及结构化结果。

## 先选任务，再读指南

按用户意图选择下表中的指南，只读当前任务需要的文件。到下一阶段再加载该阶段指南，不一次读完全部 references。首次实际调用 CLI（包括检查实例、doctor 和排障）时读 [公共规则](references/shared.md)。只整理文本或邮件时无需 CLI 授权。

用户说“检查当前实例是否可用”“检查CLI”或“诊断故障”时，先读 [授权和环境](references/auth.md)，使用 `doctor --strict`，逐项报告检查结果。有效授权存在而连接失败时保留授权和当前实例，明确停止；只做必要的连接检查，不读取模型凭据文件、不扫描其它任务目录，也不额外调用后台业务状态或业务写接口。

一次执行用户当前提出的任务。业务接口成功返回零条匹配时，直接报告无匹配并结束该查询；后台状态检查、其他数据范围或新写操作等用户提出后再进入对应指南。

| 用户要做的事 | 按需指南 | 命令入口 |
| --- | --- | --- |
| 检查实例可用性、CLI检查、故障诊断、安装、登录、授权、权限或切换环境 | [授权和环境](references/auth.md) | `doctor --strict` / `auth` / `config` |
| 找需求、查编号、看过期需求、单条延期 | [查询和延期](references/requirements-query.md) | `requirements search/extend` |
| 将原始家教岗位整理为规范字段 | [字段整理](references/requirements-format.md) | 整理文本，随后按需 parse |
| 解析、批量导入、复核异常行、恢复解析任务 | [解析和导入](references/requirements-import.md) | `requirements parse/parse-job/import/import-raw` |
| 查看科目年级、补充缺失目录、调整目录顺序 | [目录管理](references/catalog.md) | `requirements options/catalog` |
| 查看或修改优先级规则、预览命中、刷新优先级、导入导出规则 | [优先级规则](references/priority-rules.md) | `requirements priority-rules` |
| 批量查重、只读预检、持久上传、批量延期、查询或复核地图队列 | [批次和地图](references/batch-and-geo.md) | `capability run <id>` |
| 查看或修改自己的资料、查询后台基础状态 | [用户和后台](references/user-admin.md) | `user me/update` / `admin status` |
| 解析结果、退出码、写入确认、输出文件或失败恢复 | [结果和确认](references/output-risk.md) | JSON envelope / `--output` / `--dry-run` |
| 不确定是否已有能力、指南没列出的能力 | [能力索引](references/capability-map.md) | `capability list` / `schema` / `--help` |

## 按安装版本发现命令

```bash
hyacinthus --help
hyacinthus capability list
hyacinthus schema <capability_id>
hyacinthus <命令组> --help
```

优先用对应语义命令；仅当没有专用命令时，按已登记的 schema 使用 `capability run <id>`。指南列举的是常用任务，完整能力以当前安装版本的清单为准。未登记能力明确报告缺口，不猜命令、不启用 raw API 旁路。

Skills 和 references 随 CLI 二进制内嵌，可不登录、不联网读取。优先从同一二进制读取，避免磁盘指南与版本不一致：

```bash
hyacinthus --no-notice skills list
hyacinthus --no-notice skills list hyacinthus-cli/references
hyacinthus --no-notice skills read hyacinthus-cli references/priority-rules.md
```

`skills read <name>` 读取入口，`skills read <name> <path>` 或 `skills read <name>/<path>` 读取引用；默认直接输出 Markdown，需要 JSON 时加 `--json`。磁盘阅读时按本入口的位置解析相对链接。
