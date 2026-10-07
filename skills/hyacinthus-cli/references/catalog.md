<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
# 科目和年级目录

`requirements options` 只读，返回 subjects、grades、preferred_modes。核对已有目录再选 ID，不凭名称猜 ID。读权限以 `schema requirements.options` 为准。

## 缺失科目/年级目录流程

如果解析行包含 `SUBJECT_NAME_UNMAPPED:*` 或 `GRADE_NAME_UNMAPPED:*`，不要自动创建目录项。先向用户展示缺失名称，并询问是否要添加到风信子家教中心。

先预览创建请求：

```bash
hyacinthus requirements catalog create-missing --file parsed.json --dry-run
```

用户明确批准后执行：

```bash
hyacinthus requirements catalog create-missing --file parsed.json --yes
```

也可以传入明确名称：

```bash
hyacinthus requirements catalog create-missing --subject 科创编程 --grade 小升初 --yes
```

此命令需要 `catalog:write`。

## 目录排序流程

只有用户提供或批准完整有序 ID 列表后，才能使用目录排序命令。

```bash
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --dry-run
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --yes
```

年级排序：

```bash
hyacinthus requirements catalog reorder --target grades --ids 2,1,3 --yes
```

此命令需要 `catalog:write`。


新增目录只修改受影响的目录 ID，不自动填其他缺失业务字段。写入先预览，已有批准沿用当前批准范围；权限和确认遵循 [公共规则](shared.md) 与 [结果和确认](output-risk.md)。
