# Football Workbench

Football Workbench 是一个面向 Agentic Football 现场活动的开源运营工作台。它帮助参与者、Staff、TA 和 Admin 在同一个单场活动中完成登记、编组、资源发放、资格确认和比赛运营。

仓库名是 `agentic-football-event-ops`，本地目录历史上使用 `operator-workbench`，产品名统一使用 **Football Workbench**。

Football Workbench 不替代 AWS Workshop、Game Portal、外部报名系统或官方身份系统，也不代办这些系统中的注册和登录。

## 当前能力

以下能力存在于当前 `main` 分支的代码中：

| 模块 | 当前能力 |
| --- | --- |
| 参与者入口 | 昵称登记与唯一性校验、自动生成一人队伍、浏览器绑定和昵称恢复、查看本队资源和个人赛程、提交反馈。 |
| 现场编组 | Staff PIN 会话、按昵称搜索参与者；参与者登记后立即成为已确认的单人队，Staff 可合并或调整队伍。 |
| 资源与资格 | 所有参与者使用统一 Workshop 入口；Admin 导入 Game Portal Code，Staff 按队发放、记录 Workshop 备注并确认参赛资格；Admin 可诊断、补发或回收 Game Portal Code，并处理资格例外。 |
| 比赛运营 | Admin 冻结参赛名单、按 4–32 支实际队数生成小组赛、逐轮开放小组赛和淘汰赛；Staff 只录入当前轮赛果；系统计算积分并提供公开只读现场大屏。 |
| 运行基础 | 操作审计、阶段开关、活动归档重置、SQLite 持久化、健康检查，以及分离的 feedback/live 部署配置。 |

核心现场闭环：

1. Admin 配置活动链接、阶段开关并导入官方 Code。
2. 参与者登记后自动成为一人队伍；Staff 按昵称搜索并按现场需要合并队伍。
3. Staff 向已确认队伍发放资源；参与者在外部 Workshop 和 Game Portal 中自行操作。
4. TA 核验练习赛后确认参赛资格，Admin 冻结最终名单。
5. Admin 生成分组并逐轮开放比赛，Staff 录入当前轮赛果；当前轮全部结束后由 Admin 手动进入下一轮。
6. 参与者查看自己的赛程，现场大屏展示公开赛况。

## 运行架构

当前受支持的运行边界是 Lightsail 风格的单实例部署：

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
- [`public/`](./public/) 包含参与者、Staff/Admin 和 `/display` 页面，同一 Node 服务直接提供这些资源。
- 当前业务状态以一个带版本号的 JSON 文档保存在 SQLite `event_state` 表中，适合单场、低并发现场；项目尚未承诺多活动租户或高可用集群。

## 快速开始

需要 Node.js `>=22.13.0` 和 npm。CI 当前使用 Node.js 24。

```bash
npm ci
PORT=8787 STAFF_PINS='[{"id":"local-staff","pin":"replace-me","enabled":true}]' ADMIN_PIN=replace-admin npm run lightsail:start
```

启动后可访问：

- `http://localhost:8787/`：参与者入口；
- `http://localhost:8787/staff`：Staff 入口；
- `http://localhost:8787/display`：公开现场大屏；
- Admin 从 Staff 工作台中使用独立 Admin PIN 提权。

默认本地数据库是 `.local-data/event.db`。不要把本地数据库、真实 PIN、官方 Code 或生产环境变量提交到仓库。

## 测试

```bash
npm run lint
npm run build
npm test
```

- `npm run lint` 执行当前 ESLint 配置。
- `npm run build` 执行 vinext 构建。
- `npm test` 依次执行构建、Worker/HTML 行为测试、Lightsail 适配器测试和 Playwright E2E。
- `npm run test:lightsail` 与 `npm run test:e2e` 可用于单独定位对应测试层的问题。

自动测试通过不等于 feedback、live、实体手机、弱网或外部 Workshop/Game Portal 已通过业务验收；这些证据需要分别记录。

如需启动一个隔离的人工走查场景：

```bash
npm run acceptance:serve -- --scenario journey --port 4310
```

## 部署模式

| 模式 | 当前边界 |
| --- | --- |
| 本地 | `lightsail:start` 在本机运行 Node + SQLite。 |
| feedback | Docker Compose + Caddy + Node + 独立 SQLite volume。GitHub Actions 会先测试并构建镜像；只有 `main` 且仓库变量 `FEEDBACK_HOSTED_DEPLOY_ENABLED=true` 时才执行部署。 |
| live / Self-hosted | 仓库提供独立的 Compose 和 Caddy 配置；部署方仍需负责实例、volume、PIN、域名、备份恢复和真实环境验收。 |

feedback 的健康检查或镜像部署成功不等于 live 业务验收通过。

## 项目状态与 Roadmap

Football Workbench 当前是 `0.1.0` 的活动专用实现。当前代码覆盖 Agentic Football 单场活动的主要运营闭环，但仍是单 Event、单实例、SQLite 状态文档。

以下是方向性规划，不是已实现能力或交付承诺：

- 把 Agentic Football 特有的名称、资源和比赛流程抽象为可配置的活动对象、角色、阶段和工作流。
- 支持彼此隔离的多个 Event；当前单 Event 已支持在 Admin 中归档并重置业务数据。
- 进一步明确 Hosted 与 Self-hosted 的升级、导出、备份和数据保留边界。
- 在面向更多活动类型前，继续完善身份与会话、细粒度权限、资源生命周期、隐私和可运维性。

项目没有声称通过独立安全审计。生产部署必须按自身风险完成配置复核、备份恢复演练和真实环境验收。

## 贡献与安全

提交代码或文档前请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。安全漏洞不要提交公开 Issue；请按 [`SECURITY.md`](./SECURITY.md) 中的私下报告路径处理。

## License

本项目按 [MIT License](./LICENSE) 发布。
