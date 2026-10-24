# 44-205 advance 读取竞态与 VERSION_CONFLICT

状态：本地代码与回归完成，待部署后观察原档/定时任务。root 唯一集成。

## 根因

`npc-agent-advance-services.ts` 先在事务外读取 `worlds.get()`，再在一个读事务里比较当前 `worlds.version`。玩家私聊或另一人物在这两个读之间提交时，当前版本会大于事务外快照，旧代码直接抛 `VERSION_CONFLICT`，批处理因此中断。

生产记录对应 `world 278 vs 批 268`；这是可安全重读的 stale pre-read，不是已支付结果或真实提交冲突。

## 修复

- 新增内部错误 `ADVANCE_READ_STALE`，只表示“事务外快照过期”。
- `retryAdvanceReadOnce` 只对这个内部错误重读一次；其他 `VERSION_CONFLICT` 原样返回 409。
- 批处理在每个 `advanceOne` step 内重试，不重跑整个 batch；此前已提交的前缀保留。
- 显式导演复查、legacy advance、retry-director 路径同样只重读一次。
- 不吞 paid/unknown，不重买模型，不新增表/字段/迁移。
- 日志 `advance-read-stale-retry` 只记录 `worldId` 与路径，不输出用户内容或密钥。

## 验证

- `tests/agent-advance-batch.test.ts`：stale 只重试一次；连续 stale 第二次失败；真实 `VERSION_CONFLICT` 不重试。
- `tests/agent-schedule-collectors.test.ts`、`tests/npc-agent-model.test.ts` 通过。
- `npm run check` **3992/3992**。
- 无生产写、无真实模型调用、无迁移。

## 尚未完成

- 部署后需确认原档 advance 不再出现 `VERSION_CONFLICT`，并观察一次真实连续推进。
- 若真实提交阶段仍冲突，应保留 409 给客户端重读，不做无限重试或静默重买。

## 部署后观察（2026-10-24）

`58590b8f` / `46025a13` 已 READY。生产 `渣男体验` 4953 仍持续出现
`POST /advance/operation` 503，`failureCode:"COMMAND_CONFLICT"`，world 280 不变，约每 20 秒一次。
这与本报告修复的“事务外 world.version 过期”不同；本批只证明 stale read 不再直接抛
`VERSION_CONFLICT`，不能宣称生产推进循环已恢复。需要单独定位 operation/attempt 冲突，
不能靠清 lease、强制重试或手工写世界冒充通过。

## 2026-10-24 现场根因：入场探针在锁内全量读取模型响应

部署 `dpl_CQWkTyG2YkPToj8b1MGM953pkofu` 后，读取同一真实档时出现连接池级联超时：

- `GET /worlds/4953...`、`GET /groups`、`POST /clock/activity` 在 10 秒连接超时后返回 503；
- 单次 `clock/activity` 曾持续 40–147 秒，最终 409 `VERSION_CONFLICT`；
- Supabase 只读快照显示 17 条长事务，头部事务持续 133 秒，持 `worlds` 行锁；
  后续 12+ 条 `FOR UPDATE worlds` 全部排在它后面，`pg_blocking_pids` 形成队列；
- 头部事务执行的是 `readAgentPhoneEntryProbe` 的 attempt 查询。该查询在持有
  `worlds`/`world_clock` share lock 时读取了该世界全部 `agent_attempts.a.response`；
  生产 `agent_attempts` 仅 6,693 行但总大小 **75 MB**（响应为 TOAST 大字段），
  同世界 268 条消息、286 个事件。全量读取导致锁持有时间被放大，随后所有入场、
  心跳和推进请求排队，最终 10 秒连接池超时。

这不是 `COMMAND_CONFLICT` 本身，但足以把真实档推进循环拖成持续 503。原先的
`COMMAND_CONFLICT` 诊断还没有机会稳定运行，不能把本次修复当作该冲突已解决。

### 修复

1. `agent-phone-entry-probe.ts` 不再选择 `a.response`，改为
   `(a.response IS NOT NULL) AS has_response`；唯一使用点改为布尔值。
2. `PostgresDatabase.transaction` 统一设置 `SET LOCAL lock_timeout = '5000ms'`：
   任何请求遇到长行锁时快速失败并释放连接，不把整个连接池拖死。
3. 新增回归断言：入场探针的 attempt 查询必须包含 `has_response`，且不得出现
   `a.response,`。
4. `PostgresDatabase` 连接池按 serverless 收缩：`max 8→3`、
   `connectionTimeout 10s→5s`、`idleTimeout 10s→1s`，并启用
   `allowExitOnIdle`。原配置在大量短生命周期函数实例下会保留过多 Supabase
   pooler 客户端，放大了锁队列。
5. 入场探针和 opening 读取不再对 `worlds`/`world_clock` 持有 `FOR SHARE`。
   探针只是入场提示，调用方会在真正执行前重新校验 world version、paid/unknown
   和权限；把长读放在 share lock 内会把一次慢查询放大成全体请求排队。
6. `narrative-wake-repository` 不再选择未使用的 `a.response`。生产只读快照曾
   捕获该查询在同一入场事务里持续 190 秒，`director_runtime_attempts` 总大小
   62MB；该字段从未被此读取器使用。

### 本地验证

- 聚焦 `agent-phone-entry-focus`：6/6。
- 本地真实 PG 锁验证：第二事务在 **5,012ms** 后以 `55P03`（lock timeout）失败。
- `npm run check`：**3998/3998**。
- `npm run build`：通过，31/31 页面。
- 热修复提交前未写生产业务数据；只终止了卡住的应用事务并用只读快照取证。

### 第一次部署后观察（ff27bd74 / dpl_GpzP5trCMRUzYhvmXAunKmjnaG35）

新版本 READY 后，入场本身从数十秒降到 2.3 秒，`GET /groups` 为 0.5–8 秒；
但 `POST /clock/activity` 仍大量 10 秒连接超时，Supabase pooler 间歇性
`authentication did not complete`。现场仍有约 5 秒一次的多个客户端心跳，
说明仅去掉全量响应读取还不足以清空既有 pooler 压力。已追加连接池收缩，
等待第二次部署确认；此时仍不能宣称锁队列或 `COMMAND_CONFLICT` 已解决。

### 待完成

- 推送并部署第二次连接池收缩后重新打开 4953，确认不再出现 10 秒连接池超时和
  40 秒以上 `clock/activity`；再单独观察 `POST /advance/operation` 是否仍返回
  `COMMAND_CONFLICT`。
- 若 `COMMAND_CONFLICT` 仍存在，继续用已部署的 `agent-input-command-conflict`
  与 `agent-attempt-command-conflict` 安全日志定位，不重买 unknown、不强写真实档。
