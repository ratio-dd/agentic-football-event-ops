# Football Workbench

Football Workbench 是一个面向现场活动团队的开源运营工作台。仓库名是 `agentic-football-event-ops`，本地目录历史上使用 `operator-workbench`，产品名统一使用 **Football Workbench**。

项目当前服务于 Agentic Football 活动：参与者现场登记后，由 Staff 完成编组、官方资源 Code 发放和 TA 资格确认，再由 Admin 冻结名单、生成赛程并处理例外。长期方向是把这些经验沉淀为尽可能通用的活动运营工具；这一方向仍属于 roadmap，不代表当前已经支持任意活动类型。

Football Workbench 不替代 AWS Workshop、Game Portal、外部报名系统或官方身份系统，也不代办这些系统中的注册和登录。

## 适用用户

- 需要在活动当天协调参与者、队伍、有限资源和赛程的 Agentic Football 运营团队。
- 使用手机工作的现场 Staff、TA 与处理高风险操作的 Admin。
- 希望审阅、试运行或自行部署当前单场活动版本的贡献者和维护者。

参与者是产品的直接用户，但无需创建长期账号；当前身份只服务于单场活动中的现场流程。

## 当前已经实现

以下能力存在于当前代码和测试中，不是未来规划：

| 模块 | 当前能力 |
| --- | --- |
| 参与者入口 | 昵称登记与唯一性校验、浏览器绑定和昵称恢复、现场编号与个人 QR、查看本队资源和个人赛程、提交反馈；参与者求助入口由 Admin 开关控制且默认关闭。 |
| 现场编组 | Staff PIN 会话、按昵称或 `P-xxx` 搜索、扫码定位参与者、1–3 人队伍调度，以及不直接修改状态的自动分配预览和显式发布。当前资源模型最多容纳 32 支队伍。 |
| 资源与资格 | Admin 导入 Workshop Code 和 Game Portal Code；Staff 按队发放、记录 Workshop 备注、处理求助队列并确认参赛资格；Admin 可做资源诊断、补发、回收和资格撤销等例外操作。 |
| 比赛运营 | 冻结参赛名单、生成和调整最多每组 4 队的小组赛、录入积分与赛果、生成淘汰赛、限制有下游结果时的更正，以及公开只读现场大屏。 |
| 运行保障 | 操作审计、阶段开关、SQLite 持久化、健康检查、feedback/live 分离配置、隔离 release acceptance、SQLite 备份/恢复手册，以及不覆盖目标目录的脱敏离线运营包。 |

核心现场闭环是：

1. Admin 配置活动链接、阶段开关并导入官方 Code。
2. 参与者扫码登记，Staff 搜索或扫码定位人员并完成编组。
3. Staff 向已确认队伍发放资源；参与者在外部 Workshop 和 Game Portal 中自行操作。
4. TA 核验练习赛后确认参赛资格，Admin 冻结最终名单。
5. Admin 生成分组，Staff 录入赛果，系统计算积分并推进淘汰赛。
6. 参与者查看自己的赛程，现场大屏展示公开赛况；活动结束后可生成脱敏只读离线包。

## 真实运行架构

当前受支持的运行边界是 Lightsail 风格的单实例部署，而不是历史 ADR 中的无服务器方案：

```text
参与者 / Staff / Admin / 现场大屏
              |
        Caddy（部署时）
              |
     Node.js HTTP 服务
       |             |
 public/ 静态页面   worker/ API 与业务规则
                       |
              SQLite event_state
```

- [`worker/index.ts`](./worker/index.ts) 通过 Worker 风格的 `fetch` 接口承载 API、权限检查、状态转换和乐观版本写入。
- [`lightsail/build-worker.mjs`](./lightsail/build-worker.mjs) 使用 esbuild 将 Worker 打包给 Node 运行。
- [`lightsail/server.mjs`](./lightsail/server.mjs) 提供静态资源、`/healthz` 和 HTTP 适配；[`lightsail/sqlite-d1.mjs`](./lightsail/sqlite-d1.mjs) 把当前所需的 D1 接口映射到 SQLite。
- [`public/`](./public/) 包含参与者、Staff/Admin 和 `/display` 页面；同一 Node 服务直接提供这些资源。
- [`config/tenants.json`](./config/tenants.json) 将可信 Host 映射到 [`config/events/`](./config/events/) 中的 AFC Event tenant；未知 Host 会 fail closed。配置中的 `id` 同时是 `tenantId` 和 SQLite `event_state` 主键。
- 每次请求只会收到服务端解析出的 Event 配置和该 tenant 的 Staff/Admin 凭据；参与者绑定、会话、Code、审计、反馈和赛程都位于对应 tenant 的状态文档中。同一进程和 SQLite 可以同时服务多个 Event，但这不是物理数据库隔离或高可用集群。

ADR-0001 的 AWS Serverless 方案已被 [ADR-0002](./docs/adr/0002-lightsail-single-instance-deployment-target.md) 替代。当前部署和恢复要求以[运行手册](./docs/operations/现场工作台发布与事件运行手册-v1.md)为准。

## 快速开始

需要 Node.js `>=24` 和 npm。首次安装依赖：

```bash
npm ci
```

使用独立的本地 PIN 启动完整工作台：

```bash
PORT=8787 \
TENANT_STAFF_PINS='{"beijing-meetup-2026":[{"id":"beijing-staff","pin":"replace-me","enabled":true}],"shanghai-meetup-2026":[{"id":"shanghai-staff","pin":"replace-shanghai","enabled":true}]}' \
TENANT_ADMIN_PINS='{"beijing-meetup-2026":"replace-admin","shanghai-meetup-2026":"replace-shanghai-admin"}' \
PLATFORM_ADMIN_PIN='replace-platform-admin' \
npm run lightsail:start
```

默认注册表提供北京与上海示例：`http://localhost:8787` / `http://beijing.localhost:8787` 解析为北京，`http://shanghai.localhost:8787` 解析为上海。换一个城市办 AFC 时：

1. 复制 [`config/events/afc-city.example.json`](./config/events/afc-city.example.json)，修改唯一 `id`、城市文案、链接和容量。
2. 在 [`config/tenants.json`](./config/tenants.json) 中添加该 Event 与唯一 Host 的映射。
3. 在 `TENANT_STAFF_PINS`、`TENANT_ADMIN_PINS` 中为该 `tenantId` 配置独立凭据。

PIN、Code、数据库路径不属于活动配置。可用 `TENANT_REGISTRY_PATH` 选择另一份注册表；详细字段与防串场约束见 [`config/events/README.md`](./config/events/README.md)。

也可以访问 `http://localhost:8787/tenants`，使用独立的 `PLATFORM_ADMIN_PIN` 在页面中创建租户。页面覆盖当前全部 Event 配置、Host、Staff/TA 初始 PIN 和 Admin PIN；创建结果持久化在同一 SQLite 的 `tenant_config` 表中并立即生效，不需要重启。平台入口默认只接受 `localhost`、`127.0.0.1` 和 `::1`，生产环境需要用 `PLATFORM_HOSTS` 明确配置专用管理 Host，并在网络层限制访问。

启动后可访问：

- `http://localhost:8787/`：参与者入口；
- `http://localhost:8787/staff`：Staff 入口；
- `http://localhost:8787/ta`：TA 入口（当前复用 Staff 权限模型，可使用独立 TA PIN）；
- `http://localhost:8787/display`：公开现场大屏；
- Admin 从 Staff 工作台中的“更多”入口进行 PIN 提权。

动态租户创建成功后，其基础 URL 对应同样的 `/`、`/staff`、`/ta`、`/admin` 和 `/display` 路径。应用只负责按 HTTP Host 选择租户；DNS、TLS 和 Caddy/反向代理必须由部署方提前把该 Host 路由到当前实例。

默认本地数据库是 `.local-data/event.db`。不要把本地数据库、真实 PIN、官方 Code 或生产环境变量提交到仓库。

## 测试与本地验收

仓库当前脚本提供以下验证层：

```bash
npm run lint
npm run build
npm test
npm run acceptance:release
```

- `npm run lint` 检查 `scripts/`、`lightsail/` 和 `tests/` 中配置的 JavaScript/ESLint 范围。
- `npm run build` 打包 `worker/index.ts` 供 Lightsail/Node 运行。
- `npm test` 依次运行构建、Worker/HTML 行为测试、Lightsail/离线导出测试和 Playwright E2E。
- `npm run acceptance:release` 使用临时 SQLite 和随机端口，分别完成 24 队与 32 队从空状态到唯一冠军的流程。

本地 Playwright 配置当前使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；CI 使用 Playwright 管理的 Chromium。release acceptance 只证明隔离的本地流程，不代表 feedback、live、实体手机、弱网或外部 Workshop/Game Portal 已通过验收。

如需人工走查一个隔离场景：

```bash
npm run acceptance:serve -- --scenario journey --port 4310
```

更多场景和检查点见[现场工作台验收走查](./docs/operations/现场工作台验收走查-v1.md)。

## 部署模式

| 模式 | 当前边界 |
| --- | --- |
| 本地开发/验收 | `lightsail:start` 在本机运行 Node + SQLite；验收脚本使用临时数据库或专用 `.local-data` 数据库。 |
| feedback | Docker Compose + Caddy + Node + 独立 SQLite volume。GitHub Actions 会测试并构建不可变镜像；只有 `main` 且仓库变量 `FEEDBACK_HOSTED_DEPLOY_ENABLED=true` 时才执行 feedback 部署。 |
| live / Self-hosted | 使用独立实例、volume、PIN 和正式活动数据。当前仓库提供 Compose、Caddy 和操作手册，但部署、备份、恢复、域名和现场验收仍由部署方负责。 |

feedback 的健康检查或镜像部署成功不等于 live 业务验收通过。数据库恢复与镜像回滚也是两条不同的操作路径，不能互相替代。

## 项目状态

Football Workbench 当前是 `0.1.0` 的活动专用实现，正在进行产品边界重构：

- 当前代码已经覆盖 Agentic Football 单场活动的主要运营闭环。
- 当前 [`PRD.md`](./PRD.md) 是重新梳理产品边界的草稿；[`docs/product/`](./docs/product/) 中的北京场文档是历史输入，不是当前实现清单。
- 当前架构是多 Event tenant、单实例、共享 SQLite 的逻辑隔离；已经支持通过 Host 和集中配置复用不同城市的 AFC 场次，但不具备任意活动类型、物理租户隔离或高可用承诺。
- 项目没有声称通过独立安全审计。生产部署必须按自身风险完成配置复核、备份恢复演练和真实环境验收。

## Roadmap

下面是方向性规划，不是已实现能力或交付承诺：

- 在现有 AFC 场次配置之上，继续验证哪些资源、角色、阶段和工作流值得抽象；当前没有通用工作流 DSL。
- 支持彼此隔离的 Event 与可重置 Rehearsal Event，而不是依赖单一硬编码活动。
- 让 Hosted 与 Self-hosted 共享同一产品核心，并明确升级、导出、备份和数据保留边界。
- 在面向更多活动类型前，继续完善身份与会话、细粒度权限、资源生命周期、隐私和可运维性。

路线选择以 [`CONTEXT.md`](./CONTEXT.md) 和当前 [`PRD.md`](./PRD.md) 为产品语言入口。欢迎先通过小范围、可验证的贡献帮助收敛这些边界。

## 贡献与安全

提交代码或文档前请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。安全漏洞不要提交公开 Issue；请按 [`SECURITY.md`](./SECURITY.md) 中的私下报告路径处理。

## License

本项目按 [MIT License](./LICENSE) 发布。
