Status: completed

# 03 求助闭环与 qualification 边界

## 范围

- participant 创建最小求助请求，查看自己的请求状态。
- Staff 查看队列、claim、resolve；状态流为 `open → claimed → resolved`。
- 请求持久化并记录操作时间；不把敏感 Code/PIN 写入请求或审计摘要。
- 普通 Staff 的通用状态修改不能设置 `ta_qualified`，资格确认只走专用动作。

## 测试

- API 状态机、非法转换、跨参与者可见性和持久化。
- participant 与 Staff 界面的真实浏览器闭环。
- 通用状态绕过被拒绝，专用 qualification 正常。

## Comments
- 2026-07-24：先以失败测试固定两个缺口：通用状态接口可直接设置/撤销 `ta_qualified`；仓库不存在 participant help request API。
- 2026-07-24：实现无自由文本的四类求助、单 active request、participant 隔离视图、Staff 队列和 `open → claimed → resolved` 持久化状态机。
- 2026-07-24：通用状态接口不再接受 `ta_qualified`，已确认资格也不能由普通 Staff 降级；确认走专用 TA 动作，撤销走 Admin 动作。
- 验证：Node tests 17/17、lint 通过；Playwright participant → Staff claim → resolve → participant readback 1/1 通过；canary 自由文本未写入数据库。
- Git：实现、测试与本任务证据由同一原子提交收口。
