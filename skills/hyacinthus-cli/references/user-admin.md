<!-- 改动说明：统一 CLI 入口按需加载本指南，保留业务约束并对齐实际命令。 -->
# 用户资料和后台状态

## 个人资料

查看当前授权用户用 `hyacinthus user me`，先读 `schema users.me_read`。这里的用户是当前 profile 授权用户，不根据邮件发件人或 Agent 名称猜用户。

修改自己的资料先读 `schema users.me_update` 和 `user update --help`，按用户明确提供的字段预览，例如：

```bash
hyacinthus user update --display-name 张老师 --contact-wechat fxz-teacher --dry-run
hyacinthus user update --data @tasks/<run_id>/profile.json --dry-run
```

当前更新需要 users:read 与 users:write。已有授权覆盖本次修改时使用同样参数执行 `--yes`，随后 `user me` 回读。省略字段表示保留还是清空以实际 schema/help 为准，不猜测默认。手机号、邮箱和微信是用户资料，不塞进需求 confirmed_rows，除非该需求字段契约明确接受。

## 后台基础状态

`hyacinthus admin status` 是只读基础状态，需 admin:read；先读 `schema admin.status`。如实展示接口返回的信息，不能推断它执行了部署、重启、数据库维护或诊断了所有服务。
