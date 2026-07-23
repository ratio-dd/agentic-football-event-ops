Status: completed

# 05 现场 runbook 与离线兜底

## 范围

- 更新当前仓库中文 runbook，区分本地、feedback、live 三层证据。
- 明确安全初始化/重置、验收、升级、失败回滚和现场检查清单。
- 提供脱敏离线运营包导出：队号、资格、冻结名单显示名、赛程、比分与冠军；排除 Code、PIN 和会话信息。
- 写明离线包只能用于断网连续运营/人工展示，不是数据库恢复备份。

## 测试

- 自动测试导出 schema 和敏感字段黑名单。
- 用 fixture 生成样例并验证可读性、确定性和脱敏。
- runbook 命令在本地逐条试跑。

## Comments
- 2026-07-24：新增 `npm run ops:export-offline -- --db <absolute-copy> --output-dir <new-dir>`，输出白名单 JSON 与断网可直接打开的 HTML；输出目录已存在时拒绝覆盖。
- 白名单覆盖活动、计数、队伍状态、成员显示名/现场编号、冻结名单、积分、赛程、比分和冠军；key blacklist 排除 Code/PIN/session/client/token/feedback/audit/note。
- 测试用真实 Worker + SQLite fixture 生成冻结名单和比分，验证 JSON/HTML 均不含 canary Code、PIN、client，并验证二次写入被拒绝。
- 新 runbook 区分本地、feedback、live 证据，写明 Git revert、停写备份、可恢复 reset、SQLite restore、镜像回滚、离线包和事件日 checklist。
- 验证：Lightsail/offline tests 3/3、lint、`git diff --check` 通过。主机 backup/reset/restore 命令仅完成仓库级审查，未连接或修改 feedback/live。
- Git：导出器、自动测试、验收清单、runbook 与本任务证据由同一原子提交收口。
