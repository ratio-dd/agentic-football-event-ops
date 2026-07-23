Status: pending

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
- 暂无。
