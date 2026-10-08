# 需求优先级规则

读写都需 `requirements:priority_rules`；先按[公共规则](shared.md)检查。

## 常用命令

```bash
hyacinthus requirements priority-rules list
hyacinthus requirements priority-rules preview
hyacinthus requirements priority-rules matches <rule_id> --page 1 --page-size 20
hyacinthus requirements priority-rules add --pattern '<已确认的正则>' --priority <值> --dry-run
hyacinthus requirements priority-rules update <rule_id> --priority <值> --dry-run
hyacinthus requirements priority-rules refresh <rule_id> --dry-run
hyacinthus requirements priority-rules export-json --path tasks/<run_id>/rules.json
hyacinthus requirements priority-rules import-json --file tasks/<run_id>/rules.json --dry-run
```

enable、disable、delete 也接受 rule_id。预览后按[确认规则](output-risk.md)用同样参数执行 `--yes`，再 list 回读。

## 匹配和刷新

- pattern 是正则。前缀用 `^`，完整编号用 `^...$`，先转义编号中的正则字符。
- 按 sort_order、id 顺序取首个启用且命中的规则。preview/matches 统计每个正则的命中，可重叠，不能当作最终被选中的数量。
- refresh 要求目标规则启用，对其匹配行按**全部启用规则**重算，不强制用该规则优先级。核对 `matched_count/updated_count`。

## 备份与恢复

export-json 保存裸规则数组。导入只保留 `pattern/priority/enabled/description/sort_order`，移除 `id/created_at/updated_at`，恢复后 ID 可能变化。接受数组或 `{"rules": [...]}`。

替换全部规则先备份并确认范围，再显式加 `--replace`；文件里的 replace 会被旗标覆盖。预览和提交使用同一文件、参数。
