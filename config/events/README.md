# AFC 活动配置

每个文件定义一个 AFC Event tenant。运行时由 [`../tenants.json`](../tenants.json) 按请求 Host 选择配置；同一个进程可以同时服务多个 Event。

开新城市时复制 `afc-city.example.json`，至少修改：

- `id`：全局唯一、稳定的小写标识。它也是 SQLite `event_state` 的主键；换城市必须换 `id`，否则会继续读取旧场次数据。
- `branding`：页面标题、城市和大屏文案。
- `links`：本场 Workshop 与 Game Portal 地址。
- `teamPolicy`、`tournamentPolicy`：本场 AFC 的容量和赛制参数。
- `defaultGates`：新建场次第一次启动时的现场开关默认值。

复制配置后，还必须把新 Event 及其唯一 Host 加入 `tenants.json`，并在 `TENANT_STAFF_PINS`、`TENANT_ADMIN_PINS` 中配置该 tenant 自己的凭据。未知 Host 会被拒绝。

这里不保存 PIN、Code、数据库路径或其他凭据。Admin 在现场修改的链接和开关会保存在该 tenant 的 SQLite 状态里；配置仅提供新场次默认值。
