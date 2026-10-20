# 44-171 追加、恢复与回执验收

## 基线、工作树与范围

- 任务：`44-171-APPEND-RECOVERY-ACCEPTANCE`
- Agent：`dsh-append171-20261020`
- 最新 main：`cf7b5c1b`
- 工作树：`.local/worktrees/append-recovery-171`
- 分支：`codex/append-recovery-171`
- 已复用且不重复集成：
  - `7a8f2c7f` 独立追加消息单元
  - `b636887d` final/seal 按真实单元补齐记忆来源
  - `fdb89b7e` 并发测试更新、解除 post-prefix todo
  - `fee10094` 上线验收
  - `cf7b5c1b` 交接登记
- 本批文件：
  - 新增 `tests/integration/append-receipt-route171.test.ts`
  - 新增 `tests/integration/append-effect-dependencies171.test.ts`
  - 交接维护 `tests/integration/chat-version-concurrency.test.ts`
  - 交接接管 `tests/integration/message-response-recovery.test.ts`
  - 专属报告
- 本批测试/报告提交：`301a3068`（无公共源码修改）
- 未修改公共源码、协议、内核、SQL、媒体生命周期、手机页面；未部署。

## 结论

原请求路由、真实 receipt 查询、流式 complete 帧和恢复现在可以区分：

- 完整完成：`streamSummary.completionStatus='completed'`，全部真实 append unit 消息；
- 部分完成：`partial_interrupted`，只保留真实已保存单元；
- 用户中断：`superseded`，旧 prefix 保留、后缀不出现；
- 真正未知：receipt 为 `unconfirmed + recovery=unknown`，不是第四种 `streamSummary` 状态；
- 用户输入已发送与 NPC 整轮完成由 `streamSummary` 区分；
- lookup 刷新不调用模型、不新增消息/事件；
- 新投影 v2 的每条消息带真实 `sourceEventId/sourceVersion`，旧投影 v1 不伪造这些字段。

本批未发现新的生产实现错误。发现一个**兼容性风险**：旧 `npc-wire-v14` 模型输出在完整两单元 + final 已提交时，`streamSummary` 仍是 `partial_interrupted`；当前 `npc-wire-v15` 正常返回 `completed`。这属于旧模型协议输出的观测，不是当前主协议验收失败；需主 Agent 决定是否补 v14 兼容。

## 真实路由证据

测试：[append-receipt-route171.test.ts](.local/worktrees/append-recovery-171/tests/integration/append-receipt-route171.test.ts)

使用真实 `worldMessageRoute`、真实 `/messages/receipt` 路由处理器、原 `npcAgentServices`、本地真实 PostgreSQL；仅对 `server-only`/`next/server` 做测试运行时替换，服务、认证、数据库和提交链真实执行。受控模型适配器不等于真实模型体验验收。

### 完整完成

- 请求升级到投影 v2；
- receipt `status=committed`；
- `streamSummary.completionStatus=completed`，`committedSegmentCount=2`；
- 消息为用户 + 两段 assistant，共 3 条；
- 每条消息的 `sourceEventId/sourceVersion` 与 `messageEvents` 对应；两段 assistant 分别来自 v1/v2，不是伪造同一来源；
- 同一 command 再次查询返回完全相同的 body；
- 模型调用仍为 1；
- 事件/消息计数不变；
- 旧投影 v1 返回合法 committed receipt，但不带 `messages`/`streamSummary`，不伪造来源。

### partial_interrupted

- 首段真实提交后模型后缀失败；
- `/messages/receipt` 返回 `status=committed`、`streamSummary.completionStatus=partial_interrupted`、`committedSegmentCount=1`；
- 只有用户输入和已保存首段，未保存后缀不出现；
- 同一 command 的流式 `complete` 帧携带相同 summary 和真实已保存消息；
- 路由查询模型调用仍为 1（创建回合时的调用），没有因 lookup 再调用模型。

### superseded

- 旧回合首段显示后，用户对同人物发出新输入；
- 旧 receipt 的 `streamSummary.completionStatus=superseded`，只保留旧首段，旧后缀不保存；
- 新输入/新回复独立保存；
- 旧 prefix 不被改写。

### unknown

- attempt 为 `unknown_after_send`；
- `/messages/receipt` 返回 `status=unconfirmed`、`recovery=unknown`；
- 没有 `streamSummary`，没有事件；
- 不自动重新调用模型，不把 unknown 混成 partial 或 completed。

### 媒体与 final 同请求

- A 首段文字和媒体 prefix 先保存，B 随后插入，A final 仍保存；
- route receipt 为 `completed`，文字消息来源真实；
- 媒体请求 1 条、outbox 1 条、action result 1 条，sourceEventId 均为媒体 prefix 事件；
- 刷新 receipt 不新增事件/消息/媒体任务；
- A/B 模型调用各 1，合计 2。

### 并发 refresh

- 4 个 concurrent receipt 查询 + 1 个 stream complete 帧同时执行；
- 全部返回 `completed` 且 body 一致；
- 模型调用仍为 1；
- 事件/消息/媒体计数不变。

## 并发与恢复证据

- `chat-version-concurrency.test.ts`：6/6 通过。
  - 首段前 B 提交，A 正常保存；
  - 首段后 B 插入，A 第二/第三段继续追加；
  - 同人物新输入不覆盖新决定；
  - 原首段事件 `id/version/payload` 在后续提交前后 `deepEqual`；
  - 重复 HTTP 不增加模型调用、消息；
  - 媒体 prefix 只产生 1 个媒体请求和 1 个 outbox，B 插入不重复生图。
- `message-response-recovery.test.ts`：9/9 通过。
  - `response_received` 复用已保存 response，模型构造数为 0；
  - receipt/attempt/snapshot 基线不变；
  - 按实际 append 版本保存；
  - 重复恢复/查询不新增事件或消息；
  - 权限、状态变化、unknown 不自动重买的负向用例继续通过。
- `chat-latency-stage2.test.ts`：1/1 通过。
  - 媒体 prefix 在模型后缀前创建；
  - 中断保留已登记任务；
  - 重放消息一致；
  - final/seal 的每个 statement 单元都有真实 `memory_source_refs` 来源；
  - 媒体任务失败不会产生已送达结果（另由 `media-pipeline-cancellation` 1/1 覆盖）。

## 相关条件变化的实际行为

新增 `append-effect-dependencies171.test.ts`，在真实 PG 上用原内核验证：

- 模型生成期间，直接把相关约定状态改为 cancelled（模拟“取消发生在生成中”）；
- 模型返回一个无依赖普通文字 + 一个依赖取消行动的“处理好了”台词；
- 结果：
  - 已取消约定保持 cancelled，未被恢复；
  - 无依赖文字保存成功；
  - 依赖行动的“处理好了”台词没有展示；
  - action result 为 `failed`，failureCode=`APPOINTMENT_ALREADY_TERMINAL`；
  - 模型只调用 1 次，没有因行动失败重新购买整轮回复。

因此“迟到行动不能恢复取消事项、依赖失败文字不展示”在当前内核已有基础行为。仍需主 Agent 接的是：取消事件如何进入 append 许可；实际事件版本前进后，普通文字和依赖行动如何分别结算。当前测试是直接改状态，不等于真实取消事件并发旅程。

## 暂不能验收的目标

### 相关邀约取消后的迟到行动

当前没有通过原模型入口的并发旅程。需要主 Agent 先确认：

- 取消事件如何参与 append 许可；
- 迟到 `appointment.*` 行动应在内核哪一层重验当前约定状态；
- 失败的行动如何影响同轮无依赖文字和依赖文字。

最小预期：已取消邀约不能被迟到行动恢复；依赖失败行动的成功台词不能展示；无依赖文字仍可保存；不重新购买整轮模型。当前由于 append 许可只承认无共享变化的纯交流，相关取消通常会被版本准入挡住（安全失败），但没有可用的目标行为接口，不能标记为已实现。

### 群聊/现场

见下节，未写测试、未改 SQL。

## 导演观察与控场只读审计

当前 `DirectorSnapshot` 已有字段：

| 目标能力 | 当前字段/路径 | 状态 |
|---|---|---|
| 世界时间 | `storyAt`、`observedThroughVersion/evaluatedThroughVersion` | 有 |
| 世界事件候选 | `candidates`、`episodes`、`authoredEligibility`、`occupiedAuthoredEventKeys` | 有 |
| 事实/观察 | `observations`（fact/speech/belief/plan/result，含 `knownByActorIds`） | 有，但位置/行动结果不是独立清单 |
| NPC 目标/计划/等待 | `actorStates` | 有，具体等待状态由 actor state 投影 |
| NPC 各自知情 | `actorKnownTopics`、`observations.knownByActorIds` | 有边界，需继续验证不串知情 |
| 玩家承诺/拒绝/暂缓 | `actorStates.decisions`、`episodes`、`observations` | 有间接记录，无独立玩家决定清单 |
| 导演安排 | `DirectorDecision` 的 candidates/opportunities | 导演不能直接执行 NPC 行动 |
| 长期推进 | 调度器/advance 入口 | 未在本测试包证明 |

结论：

- 导演已有“当前虚构世界 + 当前存档”的观察基础，不是完全没有全局能力；
- 但世界位置、行动结果、玩家决定还没有稳定的独立投影，候选/机会选择与“人物最终是否承接”仍是两件事；
- 导演不能替 NPC 决定，当前候选/机会协议基本符合；
- 需要补只读测试：导演看到 B 的私密信息不代表 B 的 NPC 知道；候选事件与 actorState 的目标/等待一致；玩家拒绝/暂缓不被当成答应。

本批不新增导演公共测试文件；以上作为主 Agent 接线和测试矩阵输入。

## 群聊/现场准备

现有覆盖：

- 群聊：`tests/integration/groups.test.ts`、`agent-native-channel.test.ts`、`npc-native-service.test.ts`；
- 现场：`agent-scene-npc-service.test.ts`、`scene-step-persistence.test.ts`、`scenes.test.ts`；
- 私有追加：本批及 stage2。

缺口与接口：

- `0074_agent_native_projection.sql` 仍要求 `world.version = attempt.expected_world_version`、`event.version = expected + 1`、actor state projected = event.version；
- 群聊/现场没有“prefix 后其他独立交流插入再继续追加”的旅程；
- 需要主 Agent 提供统一的 append base/commit 版本入口和 SQL 证明，再各补一条原入口数据库旅程；
- 哪些状态依赖共享事件、哪些独立交流可复用私有追加规则，必须由统一实现决定，不能由测试自行推断；
- 本批不改 0074、不新增迁移、不用私聊通过代替群/现场验收。

## 验证

- `npm run typecheck`：0 errors。
- 聚焦真实 PG：26/26 通过
  - route receipt：7/7
  - effect dependency：2/2
  - concurrency：6/6
  - recovery：9/9
  - stage2：1/1
  - media-pipeline-cancellation：1/1
- 未重复全量 `npm test`/boundaries/build；最终门禁由主 Agent 执行。
- 0 真实付费模型、0 生产写、0 部署。

## 主 Agent 最小接线清单

1. 群聊/现场的统一 append base/commit 版本与 0074 SQL 迁移；
2. 相关邀约/行动条件的 append 许可与迟到 effect 重验；
3. 旧 `npc-wire-v14` 完整回合的 `streamSummary.completed` 兼容决策；
4. 路由级 partial 回执在真实部署环境的页面展示验收；
5. 最终集成、全量门禁、真实模型体验和部署。

## 文件清单

新增：

- `tests/integration/append-receipt-route171.test.ts`
- `tests/integration/append-effect-dependencies171.test.ts`
- 本报告

复用/维护：

- `tests/integration/chat-version-concurrency.test.ts`
- `tests/integration/message-response-recovery.test.ts`
- `tests/integration/chat-latency-stage2.test.ts`
- `tests/integration/media-pipeline-cancellation.test.ts`

未改：公共协议、服务入口、内核、版本准入、SQL、媒体生命周期、手机页面、生产配置。
