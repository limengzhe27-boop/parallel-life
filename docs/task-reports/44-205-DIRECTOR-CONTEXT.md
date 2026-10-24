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
7. 私聊 focus 可见性按 `owner + worldId + worldVersion + threadId` 缓存 5 分钟
   （最多 512 条）。同一版本下消息、约定和联系人不会变化；group/scene 仍走
   完整 frame。真实档每个心跳都在重复同一段 25 秒 frame 查询，这是持续负载的
   主要来源；缓存只在世界版本变化时重新校验。
8. `endpoint` 增加数据库断连短路：只识别 Postgres 连接错误码/消息，打开
   15 秒进程内断路器，期间请求直接 503，不再每次心跳都去抢 pooler 连接。
   浏览器/SDK 仍看到明确的 UNAVAILABLE + requestId；健康检查不经过此层。
9. director snapshot 与 director 校验不再对同一个 `PoolClient` 使用
   `Promise.all` 读取 actorKnownTopics，改为顺序读取。生产日志已出现
   `client.query() when the client is already executing a query`，同一连接
   并发查询会打乱 pg 协议/事务，是 `UNCLASSIFIED` 与连接中断的直接风险。

### 本地验证

- 聚焦 `agent-phone-entry-focus`：6/6；私聊 focus 缓存：1/1；HTTP 断连短路：8/8。
- 本地真实 PG 锁验证：第二事务在 **5,012ms** 后以 `55P03`（lock timeout）失败。
- `npm run check`：**4000/4000**。
- `npm run build`：通过，31/31 页面。
- 热修复提交前未写生产业务数据；只终止了卡住的应用事务并用只读快照取证。

### 第一至四次部署后观察

`ff27bd74` 后入场从数十秒降到 2.3 秒，`GET /groups` 为 0.5–8 秒；但
`POST /clock/activity` 仍出现 10 秒连接超时，Supabase pooler 间歇性
`authentication did not complete`。追加 `83178c87` 收缩连接池、
`3dd1160a` 去掉 opening/probe 的 `FOR SHARE`、`e4347057` 去掉 narrative
wake 未使用的 director response 后，仍有 55–78 秒 `clock/activity` 和 503。

最终只读取证（2026-10-24 15:00 左右）：

- world 仍为 **v286**，clock `story_now=2026-10-17T11:02:06Z`、`paused=false`；
- `agent_advance_operations` 最近完成项全部 `succeeded=false`、
  `failure_code=UNCLASSIFIED`；
- 最新 operation work 全部指向同一个 NPC command
  `760064dd-15cc-8118-a488-b7486e008f92`；
- `agent_input_receipts` 有该 command 的 wake 收据，但 `agent_attempts` 与
  `director_runtime_attempts` 都没有对应行，说明在“已接收输入、尚未 claim
  attempt”的中间态反复失败；
- 无 `agent-input-command-conflict` / `agent-attempt-command-conflict` 安全日志。

这说明 `COMMAND_CONFLICT` 不再是当前可观测的失败码；当前主因是 Supabase
项目级连接/性能饱和（连 `world_clock` 的 autovacuum ANALYZE 都能等 38 秒），
导致 advance 事务在创建 attempt 前被连接中断。不能通过清 lease、删 receipt、
手工插入 attempt 或重买 unknown 来“修复”。

### 缓存部署后观察（15:15–15:20）

`d12c801a` READY 后，`clock/activity`、`/groups`、`/world` 多数恢复 200，
长事务里不再出现重复的私聊 frame；这说明缓存确实削掉了心跳的主要长读。

但真实档仍停在 **v286**，并进入另一个明确的串行状态：

- 07:04、07:16、07:17 的 advance 均成功返回 `deferred:"scheduler_busy"`、
  `played:0`；
- 07:15 一次 operation 跑 66 秒后 `failure_code=UNCLASSIFIED`；
- 07:19:37 创建 operation `74d863c1`，batch lease 续到 07:24:13，期间新请求
  只能得到 `advance-lease-busy`；
- 没有新的 `agent_attempts`，没有新的付费调用；旧的
  `unknown_after_send` `ed1b3823`（expected world v99）仍按规则保留。

也就是说，`COMMAND_CONFLICT` 当前没有复现；阻塞变成“DB 断连导致 operation
无法收尾 → 270 秒 batch lease 周期”。lease 本身是防重复付费的正确保护，
不能为了“看起来推进”而手工清；需要等持有者结束或 lease 过期，且 DB 恢复
后再验证下一轮 advance。

### 15:30 · 同连接并发查询修复

生产日志捕获到 pg 警告：

`client.query() when the client is already executing a query is deprecated`

`director-snapshot-repository` 和 `director-runtime-repository` 都在同一个
`PoolClient` 上用 `Promise.all` 读取多个 actor 的 knownTopics。pg 的一个 client
只能顺序执行查询；并发提交会打乱协议/事务，可能导致连接中断和
`UNCLASSIFIED`。`cd321bd1` 改为同一 client 顺序读取；部署后同窗口该警告为 **0**。
这消除了一个明确的代码风险，但 Supabase 随后仍然 `authentication did not
complete`，世界继续停在 v286，不能把“警告消失”当成真实推进通过。

### 阻塞与恢复条件

- 阻塞：Supabase `parallel-life` 项目连接池/计算资源饱和，生产 API 间歇
  `authentication did not complete`、10 秒连接超时和 55–78 秒事务。
- 恢复条件：Supabase 连接与查询延迟恢复正常，或项目升级/迁移到可承载的实例。
- 恢复后验证：同一 command 能创建 attempt；advance 提交新事件或明确 quiet；
  `COMMAND_CONFLICT` 安全日志不再出现；真实档连续体验才可重新验收。
- 在此之前不写真实档、不删 receipt、不强写 attempt、不重买旧 unknown；本轮
  四次代码修复仍保留，未回退。

### 2026-10-25 · 旧 wake receipt 重放循环（已定位，代码待部署）

Supabase 管理连接已可读，生产 health 200，但世界仍为 **v286**。只读核对发现
阻塞已不是单纯的连接容量：

- `agent_advance_operations` 每约 30 秒新建一次，最近连续 `finished_at` 均为
  27–44 秒后 `failure_code=VERSION_CONFLICT`；最新 operation 仍在 270 秒 lease 内。
- 所有 operation work 都指向同一个 command
  `760064dd-15cc-8118-a488-b7486e008f92`，kind=`npc`。
- 该 command 只有 `agent_input_receipts` 收据，`expectedWorldVersion=123`，没有
  任何 `agent_attempts`；当前世界已是 v286。
- 该收据的 text 是 `npc_own_condition_ready`，candidateId 为
  `observation:c425...`，basis 是旧 `media-result:f312...`。
- 生产全库符合“wake、无 attempt、receipt 版本落后于当前世界”的收据只有 **1 条**，
  即上述收据；不是大量脏数据。

根因：候选仍会从旧 media-result source 重新产生；`attempts.accept` 命中旧收据
后按幂等 replay 返回，不重新做世界版本校验；执行阶段再以 v123 对 v286 失败。
由于没有 attempt 行，候选消费逻辑也不会把它视为已处理，于是每个调度 tick 都
重复一次完整 operation。

修复：读取 advance 事务时额外取“无 attempt 的旧 wake 收据”，解析其 candidateId，
在候选进入调度前排除；旧收据、旧 attempt、世界数据均不修改。解析与阈值逻辑放在
[`agent-wake-recovery.ts`](../../src/modules/world/domain/agent-wake-recovery.ts)，
查询与过滤在
[`npc-agent-advance-services.ts`](../../src/server/npc-agent-advance-services.ts)。
没有新增数据库字段、表或迁移；没有调用商业模型，没有写生产世界。

本地验证：

- `tests/agent-wake-recovery.test.ts` **5/5**（旧版本才消费、当前/未来版本不消费、
  非法 JSON 忽略、重复 candidate 去重）。
- `npm run typecheck` 通过；`npm run check` **4005/4005**；`npm run build` 通过
  （31/31 页面）。
- 生产只读 SQL 已确认旧收据会被查询命中并解析出 candidateId。

部署后验证条件：同一 command 不再被选中；operation 不再每 30 秒
`VERSION_CONFLICT`；若没有其他到期工作，世界应正常 quiet 而不是继续空转；
若出现新候选，才允许产生新 attempt。**在观察到这些之前，不宣称 v286 已推进。**
