Status: pending

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
- 暂无。
