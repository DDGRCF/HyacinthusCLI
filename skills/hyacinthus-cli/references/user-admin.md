# 用户资料和后台状态

按[公共规则](shared.md)准备授权，写入遵循[确认规则](output-risk.md)。

## 个人资料

```bash
hyacinthus user me
hyacinthus user update --display-name 张老师 --contact-wechat fxz-teacher --dry-run
hyacinthus user update --data @tasks/<run_id>/profile.json --dry-run
```

me 读当前授权用户，需要 `users:read`；update 需要 `users:read/users:write`。按批准执行同样参数 `--yes`，再 me 回读。

JSON：`display_name` 在顶层；性别、生日、简介、默认地址/坐标、紧急联系人放 `profile`；微信等放 `profile.ext`。例如 `{"profile":{"ext":{"contact_wechat":"fxz-teacher"}}}`。这里不是需求导入的 ext；身份手机号、邮箱、密码、账号状态不属于此更新接口。

profile 的 NullablePatch 字段省略保留、null 清空。`profile.ext: null` 清空整个扩展对象；只清微信用 `profile.ext.contact_wechat: null`。其他字段按 `schema users.me_update`，不要一律用 null 清空。

## 后台状态

`hyacinthus admin status` 需要 `admin:read`，只读基础状态；按实际返回汇报，不表示执行了部署或维护。
