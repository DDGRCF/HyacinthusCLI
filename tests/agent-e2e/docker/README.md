# 同一 Pi＋CLI 容器的标准验收

<!-- 改动说明：同步SOP v5的15项/7子项与报告命令，保留历史入口的诊断定位。 -->

完整操作、固定样本和判定标准见 [SOP.md](../SOP.md)，机器清单为 [sop-v5.json](../cases/sop-v5.json)。所有编译使用 **job=1**。

## 一次运行

在仓库根目录构建：

```bash
docker build --network host -f docker/backend.Dockerfile --build-arg CARGO_BUILD_JOBS=1 -t hyacinthus-skills-e2e-backend:20261009-sop-v5 .
docker build --network host -f cli/tests/agent-e2e/docker/agent.Dockerfile -t hyacinthus-skills-e2e-pi:20261009-sop-v5 .
```

进入 `cli/tests/agent-e2e`：

```bash
npm run test:agent -- --mode docker --sop full
npm run test:report -- --run <run_id>
```

需要 Docker、Node、Playwright Chromium、可运行的bwrap及`/usr/bin/python3`、本机已登录的 `xiaomi-token-plan-cn` 和可用腾讯地图配置。执行器持有独占锁，只初始化该 Docker 项目的 `hyacinthus_test`；数据库管理走受保护的 Rust admin 命令。Pi 与真实 CLI 共用一个容器，API、Worker、数据库、Redis、MinIO 和管理端分别运行。管理端采用固定既有镜像，不代表当前全部前端源码已验收。

Pi 使用默认 Skills 发现和工具，收到自然语言请求、原始保存邮件以及固定用户回应。宿主负责真实浏览器访问授权、独立业务批准和只读详情核对。CLI 在同一 Pi 容器执行；Pi 没有 Docker socket、宿主历史和期望答案，也拿不到管理员或地图凭据。

当前v5沿用21字段并增加C3学校来源查询。online同样需要真实地址、有效定位和合法管理员联系信息；v2起正例明确提供地址并使用真实腾讯地图，缺地址保留为拒绝负例。邮件是合成保存样本，不连接邮箱。15个顶层用例及7个恢复子项（E1a～g）分别记录工程、真实Pi和混合协议覆盖。

## 结果、专项和清理

结果与脱敏证据：`/tmp/hyacinthus-sop-runs/<run_id>/`；最新 HTML：`/tmp/hyacinthus-sop-latest.html`。`test:report -- --run <run_id>`只重新生成既有结果的报告和渲染证据，不执行验收。失败与未运行如实保留；专项不能称完整通过。

```bash
npm run test:agent -- --mode docker --sop selected --cases D1,D2,D3,D4
```

专项恢复服务后复用已有 Pi 容器，不 reset，自动重新执行依赖。每例前后核对容器、CLI 和 Skills 哈希。

结束时撤销本轮授权，停止 Pi，删除临时模型凭据、复制地图密钥及持有地图密钥的 API/Worker 容器，保留其它专属测试服务与数据。bwrap将本任务的宿主凭据目录设为只读；来源只读一次并生成MiMo私有快照，实际Docker挂载必须只读且不暴露原文件。删除前强制核对MiMo来源及快照哈希；宿主整文件及其他provider变化只记录观察，不声称整宿主文件未变。旧失败轮次保留原判定。完整部署的额外清理只针对本项目：

```bash
docker compose --env-file .tmp/e2e/skills-alignment/compose.env -p hyacinthus-skills-acceptance -f cli/tests/agent-e2e/docker/compose.yml down
```

模型每轮任务620秒、128次工具调用、每例最多8轮回应，整轮2小时。预算不会在运行中扩大，耗时按实际记录。

## 历史入口

`acceptance.mjs`、`audit.mjs`、`report.mjs` 和 `render-report.mjs` 是早期六项验收证据工具，不是当前标准执行入口。宿主诊断另用 `test:agent:host`，不计入同容器验收。
