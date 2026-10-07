<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
# 需求优先级规则

用户要管理编号匹配规则、查看影响或刷新优先级时使用。先查看 `requirements priority-rules --help` 和对应 capability schema；读写 scopes 以 schema 为准。

## 查询与备份

```bash
hyacinthus requirements priority-rules list --output tasks/<run_id>/rules.json
hyacinthus requirements priority-rules preview --output tasks/<run_id>/counts.json
hyacinthus requirements priority-rules matches <rule_id> --page 1 --page-size 20
hyacinthus requirements priority-rules export-json --path tasks/<run_id>/rules-backup.json
```

list 查看规则；preview 看已保存规则的命中数，matches 分页读某规则命中的需求。它们不预览尚未创建的任意规则。先核对真实 rule_id、pattern、priority、启用状态和顺序，保存当前规则用于比较。

## 创建与修改

```bash
hyacinthus requirements priority-rules add --pattern '<用户确认的模式>' --priority <优先级> --dry-run
hyacinthus requirements priority-rules update <rule_id> --priority <优先级> --dry-run
hyacinthus requirements priority-rules enable <rule_id> --dry-run
hyacinthus requirements priority-rules disable <rule_id> --dry-run
hyacinthus requirements priority-rules delete <rule_id> --dry-run
```

按用户提供的数据构造请求，不凭示例规则猜编号或优先级。预览核对后按 [确认协议](output-risk.md) 用原命令追加 `--yes`。执行后 list 回读变更；需要了解实际命中时再 preview/matches。

`pattern` 是正则表达式，不是 shell 通配符。前缀匹配使用 `^<经过正则转义的前缀>`；完整编号匹配加 `^` 与 `$`，不要直接把用户编号当正则。启用规则按排序取首个命中的优先级；修改排序和 refresh 前先核对影响。

## 刷新、导入和替换

`refresh <rule_id>` 会写入匹配需求的优先级，不是只读查询或本地缓存刷新。先查看规则及命中范围，再 `refresh <rule_id> --dry-run`，批准后执行 `--yes`。

`import-json --file tasks/<run_id>/rules.json --dry-run` 预览规则导入；JSON 形状以 `schema requirements.priority_rules.import` 为准。`--replace` 替换现有规则，先保存备份并明确替换范围。确认后使用同一文件和参数执行 `--yes`。导出、预览和确认结果分别保存，不把导出称作已导入。
