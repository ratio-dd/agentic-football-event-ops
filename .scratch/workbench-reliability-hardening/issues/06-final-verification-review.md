Status: completed

# 06 最终验证、审查与 Git 交付

## 验证命令

- `npm run lint`
- `npm run build`
- `npm test`
- `node --test tests/lightsail-adapter.test.mjs`
- `npm run test:e2e`
- 新增的 release acceptance 命令（连续两次）

## 审查清单

- 访问控制与敏感值深度泄漏。
- 赛果修正错误路径、状态原子性和下游不变量。
- 求助状态机权限与跨参与者隔离。
- 临时数据库、端口和子进程清理。
- 离线导出字段白名单。
- 中文 runbook 命令与实际脚本一致。
- `git diff`、`git status`、`git log` 证明提交原子、用户工作树未被吸收。

## Comments

- 2026-07-24：本地审查发现三个可复现边界并在 `29dec2a` 修复：满载 active 求助队列不再无界增长；离线导出兼容缺少资源数组和 `competition.frozenTeams` 的旧状态；release acceptance 要求恰好一个决赛。
- `npm run lint`：通过，无 warning/error。
- `npm test`：通过；Node 17/17、Lightsail/offline 3/3、Playwright 17 passed，人工视觉画廊 1 个按设计 skipped。
- `npm run acceptance:release` 连续两次通过。每轮分别创建 24/32 队全新临时 SQLite：24 队 36 场小组赛、11 场实际淘汰赛、4 个 bye；32 队 48 场小组赛、15 场实际淘汰赛、0 个 bye；每个场景均产生唯一冠军并通过公共接口敏感值 canary。
- 沙箱内首次完整测试仅因禁止监听 `127.0.0.1` 返回 `EPERM`；按权限流程在沙箱外重跑同一 `npm test` 后全部通过。
- 未 push、未部署、未连接或修改 feedback/live，未读取或修改真实活动数据。
- 用户既有 `lightsail/Caddyfile.feedback-ip`、`.playwright-cli/`、`canvas/` 保持未 stage、未提交。
