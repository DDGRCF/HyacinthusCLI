# 科目、年级和学校目录

按[公共规则](shared.md)准备授权。

## 查学校和资质

```bash
hyacinthus requirements catalog schools --keyword 浙大 --exact
hyacinthus requirements catalog schools --keyword 中国矿业大学
hyacinthus requirements catalog schools --province 浙江省 --tier 211 --limit 20
```

需要 `requirements:read`。正式名、审核别名和学校标识码都可查询；`--id` 按目录 ID 查询，`--exact` 关闭模糊匹配。筛选条件同时生效，省份使用完整名称，`--tier` 为 `985`/`211`/`double_first_class`；翻页按返回的 `skip/limit/has_more` 继续；各页文件摘要须一致，变化时从头重查。

结果保留所有候选，并给出 `match_kind`、985/211/双一流三个独立值、各项资质证据和 `catalog` 来源版本、覆盖范围、文件摘要。多候选（含“南大”“湖大”这类共享简称）先确认具体学校；0条表示当前目录没有符合本次条件的学校，不能推断学校不存在或没有资质。目录未同步会返回 `SCHOOL_CATALOG_SYNC_REQUIRED`，不能用模型记忆补结果。

学校事实只以查询结果为准；招聘条件中的 `required_school_tiers` 仍只写原文明确要求。不能把“985优势学科创新平台”当作985高校。学校目录由管理员同步已审核 CSV，普通 Agent 不创建学校。解析返回 `SCHOOL_NAME_AMBIGUOUS:<名称>` 时，先查询候选、确认完整校名，再重新解析。

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
