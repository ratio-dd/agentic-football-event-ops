Status: pending

# 04 隔离 release acceptance 环境与数据

## 范围

- 提供单命令 release acceptance runner。
- 每次使用全新临时 SQLite、显式随机端口和确定性 fixture。
- 24 队与 32 队均完成注册/资格/分组/全部比赛/淘汰赛/冠军 journey。
- 验证赛程计数、每队分组场次、淘汰赛来源、唯一冠军与访问安全 canary。
- 输出机器可读且脱敏的验收摘要；失败保留足够诊断，不输出 Code/PIN。

## 测试

- runner 连续执行至少两次无数据串扰。
- 24/32 两套 fixture 均通过完整 journey。
- CI 可复用同一命令，不依赖已启动的开发服务。

## Comments
- 暂无。
