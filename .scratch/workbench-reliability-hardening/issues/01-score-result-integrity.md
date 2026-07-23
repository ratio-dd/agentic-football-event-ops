Status: completed

# 01 赛果修正与下游一致性

## 范围

- Staff 仅能首次录入未完成比赛的赛果。
- Admin 修正已有赛果时必须提交非空原因。
- 计算所有受影响下游；只要其中已有完成比赛，返回 `409` 且不修改任何状态。
- 若下游尚未完成，清理受影响的赛果/胜者并重新解析对阵。
- 审计记录包含修正原因及可安全保存的 before/after 赛果。

## 测试

- 普通 Staff 修正被拒绝。
- Admin 无原因修正被拒绝。
- Admin 修正未进入已完成下游时，对阵正确重算。
- 已完成下游存在时整笔拒绝，赛果、胜者和对阵完全不变。
- group、semifinal、final 关键路径均有不变量验证。

## Comments
- 2026-07-24：先补充失败测试，旧实现对 Staff 更正返回旧的锁定逻辑，且无法安全重算下游。
- 2026-07-24：实现 Staff 首次录入、Admin 带原因修正、下游完成前置拒绝、group bracket 重建和 knockout descendants 清理/重算。
- 验证：`npm run build`、`node --test tests/rendered-html.test.mjs`（16/16）、`npm run lint` 通过。
- Git：实现、测试与本任务证据由同一原子提交收口。
