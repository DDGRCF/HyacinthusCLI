# 科目和年级目录

按[公共规则](shared.md)准备授权。

## 查看与补充

```bash
hyacinthus requirements options
hyacinthus requirements catalog create-missing --subject <缺失科目> --grade <缺失年级> --dry-run
hyacinthus requirements catalog create-missing --subject <缺失科目> --grade <缺失年级> --yes
```

options 需要 `requirements:parse`，返回 `target_roles/subjects/grades/preferred_modes`。目录 ID 从真实结果选取，不凭名称猜。options 没有 `--output`；保存时用 `hyacinthus --format json requirements options > tasks/<run_id>/options.json`。

1. 默认 lenient 解析不生成 `SUBJECT_NAME_UNMAPPED:<名称>` / `GRADE_NAME_UNMAPPED:<名称>`。先用 options 对照原文核对目录；用户要求补全时，用 `--subject` / `--grade` 明确传缺失名称，只传需要的项。
2. create-missing 需要 `catalog:write`。`--file` 只从上述名称诊断提取待创建项，不能凭默认 lenient 结果发现缺失目录；有对应诊断时才传完整 parse envelope 或裸 data。parse-job 先取 result，不传 import-raw 汇总。
3. 按[确认规则](output-risk.md)执行后，将真实返回 ID 回填待导入行，或重新 options 核对。命令不会修改已保存的 parsed/confirmed 文件。

## 排序

```bash
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --dry-run
hyacinthus requirements catalog reorder --target subjects --ids 3,1,2 --yes
```

需要 `catalog:write`，target 为 subjects 或 grades。使用用户批准的完整有序 ID 列表。
