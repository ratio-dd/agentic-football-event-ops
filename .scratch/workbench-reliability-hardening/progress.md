# 进度与验证证据

## 当前状态

- Goal：completed
- 分支：`codex/workbench-reliability-hardening`
- 基线：`main@f2847aa`
- 当前步骤：已完成，等待交付

## 提交与验证记录

| Issue | 状态 | Commit | 验证 |
| --- | --- | --- | --- |
| 01 赛果一致性 | completed | `9853873` | build；Node tests；lint |
| 02 Code 访问边界 | completed | `2e4fc3a` | Node tests；lint；Playwright |
| 03 求助闭环与资格边界 | completed | `2c767fa` | Node tests；lint；Playwright |
| 04 release acceptance 环境 | completed | `2bc4f78` | 24/32 队完整 journey |
| 05 runbook 与离线兜底 | completed | `a30c51e` | Lightsail/offline tests；lint；diff check |
| 复核边界修复 | completed | `29dec2a` | 满载队列、旧状态导出、唯一决赛回归 |
| 06 最终验证与审查 | completed | 本证据提交 | lint；完整 `npm test`；release acceptance 连续 2 次；Git provenance |

## 工作树保护

以下内容属于用户，不纳入本 Goal 的 stage/commit：

- `lightsail/Caddyfile.feedback-ip`
- `.playwright-cli/`
- `canvas/`

## Comments

- 2026-07-24：Goal 建立；明确排除依赖 AWS/产品决策的事项。
- 2026-07-24：赛果单元完成；失败基线为旧实现对普通 Staff 更正返回 `409`，新策略按角色、原因和下游完成状态执行。
- 2026-07-24：Code 访问矩阵完成；匿名/公共/diagnostics canary 不泄漏，Staff 与本队 participant 的正常路径通过。
- 2026-07-24：求助状态机和 qualification 边界完成；求助不持久化自由文本，跨参与者不可见。
- 2026-07-24：隔离 release acceptance 完成；每个场景使用独立临时 SQLite 和随机端口，CI 已加入 gate。
- 2026-07-24：脱敏离线包与发布/事件运行手册完成；未触碰 feedback/live 或真实数据。
- 2026-07-24：复核发现并修复三个边界：500 条 active 求助时 fail closed、离线导出兼容缺少资源数组/冻结快照的旧状态、release runner 断言恰好一个决赛。
- 2026-07-24：最终 HEAD 通过 lint；完整 `npm test`（Node 17/17、Lightsail/offline 3/3、Playwright 17 passed + 1 expected skipped）；两次 `npm run acceptance:release` 的 24/32 队场景全部 passed，且均使用新临时 SQLite 与随机端口。
