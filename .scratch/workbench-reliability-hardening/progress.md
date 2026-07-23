# 进度与验证证据

## 当前状态

- Goal：active
- 分支：`codex/workbench-reliability-hardening`
- 基线：`main@f2847aa`
- 当前步骤：离线运营包与现场 runbook

## 提交与验证记录

| Issue | 状态 | Commit | 验证 |
| --- | --- | --- | --- |
| 01 赛果一致性 | completed | 本 issue 原子提交 | build；Node tests 16/16；lint |
| 02 Code 访问边界 | completed | 本 issue 原子提交 | Node 16/16；lint；Playwright 1/1 |
| 03 求助闭环与资格边界 | completed | 本 issue 原子提交 | Node 17/17；lint；Playwright 1/1 |
| 04 release acceptance 环境 | completed | 本 issue 原子提交 | 连续 2 次：24/32 队均 passed；lint |
| 05 runbook 与离线兜底 | pending | - | - |
| 06 最终验证与审查 | pending | - | - |

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
