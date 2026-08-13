# Contributing to Football Workbench

感谢你参与 Football Workbench。当前代码服务于 Agentic Football 单场活动；贡献必须明确是在修复或完善当前行为，还是在讨论 roadmap，不要把规划中的能力写成已经实现。

## 本地设置

前置条件：

- Node.js `>=22.13.0`；
- npm；
- 本地 Playwright E2E 当前使用 macOS 的 Google Chrome；CI 使用 Playwright 管理的 Chromium。

安装锁定依赖并启动工作台：

```bash
npm ci
PORT=8787 STAFF_PINS='[{"id":"local-staff","pin":"replace-me","enabled":true}]' ADMIN_PIN=replace-admin npm run lightsail:start
```

默认状态写入 `.local-data/event.db`。不要把它当作可共享的 fixture 或生产备份。

## 验证改动

提交前运行与改动相称的检查，并在 Pull Request 中准确记录结果：

```bash
npm run lint
npm run build
npm test
git diff --check
```

可使用 `npm run test:lightsail` 和 `npm run test:e2e` 单独定位对应测试层的问题。自动测试、本地浏览器、feedback、live 和真实活动是不同证据层；如果某项检查因环境限制不能运行，请记录 `NOT RUN` 及原因。

## Pull Request 范围

保持 PR 小而可审阅，并围绕一个明确问题。PR 描述应包含：

- 问题、用户影响和本次范围；
- 当前行为与期望行为；
- 关键实现取舍，以及是否影响参与者、Staff、Admin、display 或部署边界；
- 实际执行的命令与结果；
- 未验证的环境、人工检查和剩余风险；
- 涉及 UI 时的目标视口与必要截图，且截图不得包含真实敏感数据。

除非 issue 或维护者明确同意，不要在一个功能 PR 中顺带加入框架、provider、registry、schema 系统、runner、生命周期管理器、全局机制、新依赖或无关跨模块重构。依赖和锁文件变更必须有直接理由。

不要整理、重写或删除与你的改动无关的文件。发现已有未提交改动时，先保留并缩小自己的 diff。

## 质量标准

- 服务端必须是真正的权限边界；隐藏按钮或前端路由不能代替 Staff/Admin 校验。
- 保持参与者、Staff、Admin 和 display 的字段可见性彼此独立。
- 涉及 Code、队伍、资格、冻结名单、赛程或赛果的修改，需要覆盖成功、拒绝、重复操作和版本冲突等关键路径。
- 高风险例外操作应保留审计、原因和状态完整性，不要静默修复或重排已发布的活动状态。
- 当前能力和 roadmap 必须明确分开；需求或历史说明不自动等于现状。

## 状态与数据库变更

当前运行时把一个 Event 的 JSON 状态保存在 SQLite `event_state` 表中，并用版本号执行乐观写入。修改状态结构或业务不变量时：

1. 说明新旧状态如何兼容，不能假设部署方会清空数据库。
2. 保持 Participant、Team、Code、资格、冻结名单、Tournament 和 AuditLog 之间的引用一致。
3. 对部分失败使用原子、fail-closed 行为，避免只写入一半的资源或队伍变更。
4. 使用临时或测试专用 SQLite 验证，不得复制、修改或提交 feedback/live 数据。
5. 如需迁移、reset、备份或恢复步骤，必须明确审批点和可恢复性，不能把破坏性命令藏在普通启动流程里。

不得提交真实参与者数据、浏览器标识、反馈内容、SQLite 数据库、备份、Staff/Admin PIN、Workshop/Game Portal Code、AWS/GitHub/SSH/TLS 凭证、`.env` 或生产配置。测试数据必须明显是合成数据。

## 文档与安全

- 命令、Node 版本、架构或当前能力变化时，更新 README，并确保命令来自实际 `package.json` scripts。
- 文档必须区分已实现、已自动测试、已本地验收、已部署和已在真实活动验证。
- 新的架构或运行取舍应留下可审阅的说明，不要只埋在代码注释中。
- 检查所有相对链接和示例命令，删除失效路径。

安全漏洞不得提交公开 Issue、Discussion 或 Pull Request。请按照 [`SECURITY.md`](./SECURITY.md) 私下报告。
