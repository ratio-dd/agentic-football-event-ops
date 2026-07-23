Status: completed

# 02 Code/PIN 访问边界

## 范围

- Staff/Admin team view 返回已绑定的 Workshop/Game Portal Code。
- participant 仅能看到自己所属队伍的 Code。
- 公共展示、匿名 maintenance snapshot、diagnostics 和日志不返回 Code/PIN 明文。
- maintenance snapshot 默认关闭；开启后只提供脱敏运营信息。

## 测试

- 以角色 × 接口 × 资源状态建立访问矩阵测试。
- 对匿名 JSON 做已知 canary Code/PIN 的深度泄漏断言。
- 验证 Staff、Admin、participant 正常工作路径未被脱敏逻辑破坏。

## Comments
- 2026-07-24：失败测试确认 Staff team view 的 Code 为 `null`，与现场操作需求不符。
- 2026-07-24：Staff/Admin 使用显式 privileged view；participant 仍按本队 client 绑定判断；其他参与者无跨队可见性。
- 2026-07-24：maintenance snapshot 默认关闭；旧状态中的历史默认 `true` 因缺少 Admin 启用时间仍 fail closed；人工启用后仅返回资源计数和 assigned 布尔值。
- 验证：角色 × 接口 canary 深度泄漏测试通过；Node tests 16/16、lint 通过；Playwright Staff Workshop 场景 1/1 通过。
- Git：实现、测试与本任务证据由同一原子提交收口。
