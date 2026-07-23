Status: completed

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
- 2026-07-24：新增 `npm run acceptance:release`；先构建 Lightsail Worker，再为 24/32 队各启一个随机端口和全新临时 SQLite，结束后停止子进程并删除临时目录。
- 完整 journey：登记、建队、发放两类 Code、资格确认、冻结、4 队小组循环、全部小组赛、16 槽淘汰赛和唯一冠军。
- 断言：24 队 6 组/36 场小组赛/4 个 bye/11 场淘汰赛；32 队 8 组/48 场小组赛/无 bye/15 场淘汰赛；每队 3 场小组赛；下游来源胜者一致。
- 安全：participant 本队 Code 正向校验；anonymous/display/maintenance canary 反向泄漏校验；stdout 只输出脱敏 JSON 摘要。
- 验证：连续运行两次均通过，冠军均为 `T-001`，两轮使用不同随机端口且每个场景从 `T-001` 重新开始；lint 通过。CI 已复用同一命令。
- Git：runner、CI gate 与本任务证据由同一原子提交收口。
