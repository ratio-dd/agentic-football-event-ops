# Football 工作台可靠性加固 Goal

## 背景与证据边界

本 Goal 依据 `../../../docs/lab/2026-07-23-football-workbench-current-state-and-improvement-research-v0.1.md` 的代码、自动化与本地浏览器证据启动。

- 已确认事实：当前实现允许普通 Staff 更正赛果；已完成的下游比赛不会随上游更正失效；Staff 快照拿不到绑定 Code 明文；匿名 maintenance snapshot 默认开放并返回 Code 明文；缺少 24/32 队完整赛事验收与可重复的 release-like 环境。
- 工作假设：赛果修正采用最保守的现场规则；求助闭环先提供最小状态模型，不替代活动现场的人员排班流程。
- 非线上结论：本 Goal 只证明本地隔离环境和仓库实现，不代表 feedback/live 已部署或通过活动验收。
- 待外部确认：AWS Code 的消耗/回收语义、批量发码策略、账号恢复策略与多租户均不在本 Goal 内。

## 目标

通过可独立回滚的 Git 提交，完成以下五个交付单元：

1. 赛果一致性与下游失效。
2. Code/PIN 访问矩阵与匿名接口脱敏。
3. participant help request → Staff/TA claim → resolve 闭环，以及 qualification 边界。
4. 24/32 队确定性完整赛事数据、隔离环境和 release acceptance。
5. 现场验收、初始化/重置、回滚与离线兜底 runbook。

## 统一验收条件

- 所有自动化数据均在临时 SQLite 中创建，不读取或修改真实活动数据。
- Staff 只能首次录入赛果；Admin 只有提供修正原因才能修改已有赛果。
- 若修正会影响已完成下游比赛，API 返回 `409`，整笔状态不变；否则清理受影响的未完成下游并重新解析对阵。
- participant 仅见本队 Code；Staff/Admin 可见已绑定 Code；公共展示、匿名接口和 diagnostics 不返回 Code/PIN 明文。
- maintenance snapshot 默认关闭；人工开启后仍只返回脱敏快照。
- 求助请求有可追踪的 `open → claimed → resolved` 生命周期，参与者与 Staff 界面均可操作。
- 普通 Staff 不能通过通用状态修改把队伍设为 `ta_qualified`。
- 24 队和 32 队均从新建数据跑到唯一冠军，并生成不含敏感值的摘要。
- lint、build、Node tests、Lightsail adapter、Playwright E2E、release acceptance 全部通过。

## Git 与安全约束

- 工作分支：`codex/workbench-reliability-hardening`。
- 每个 issue 的实现、测试与任务证据组成一个可回滚提交；文档/环境若可独立回滚则单独提交。
- 每次提交只显式 stage 对应文件，并检查 `git diff --cached --check` 与 staged diff。
- 不提交用户已有的 `lightsail/Caddyfile.feedback-ip`、`.playwright-cli/`、`canvas/`。
- 不 push、不部署、不运行生产重置；不记录 Code、PIN 或真实参与者信息。
- 不删除或弱化既有测试，不用静态字符串断言冒充真实 journey。

## 最终审查

最终审查覆盖权限矩阵、错误路径、数据库原子性、敏感信息、测试真实性、runbook 可执行性和 Git provenance。只有所有 issue 完成、完整命令集通过且无未解决审查项时，Goal 才能完成。
