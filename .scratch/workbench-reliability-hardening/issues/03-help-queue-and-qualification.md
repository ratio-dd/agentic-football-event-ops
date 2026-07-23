Status: pending

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
- 暂无。
