Status: completed

# 01 Admin 控制参与者现场求助

## 实施

- 增加默认关闭的 `participantHelp` gate。
- Admin 活动设置增加开关。
- 参与者、Staff 与 API 同步执行开关语义。
- 保留关闭前 active 请求的处理能力。

## 验证

- Node 状态机与默认值测试。
- Playwright Admin 开关、参与者入口和 Staff 存量队列测试。
- lint、build 与相关回归。

## Comments

- 2026-07-25：开始实施。
- 2026-07-25：实现并验收完成。参与者求助默认关闭；Admin 可随时启停；关闭后拒绝新请求、隐藏空入口，同时保留并允许 Staff 处理已有 active 请求。
- 2026-07-25：`npm run lint`、`npm test` 全部通过；Node 17/17、Lightsail/offline 3/3、Playwright 17 passed / 1 expected skipped；新增专项 E2E 1/1 通过。
