# 44-168 上下文读取与首回复等待优化

## 身份与范围

- 任务 ID：`44-168-CONTEXT-READ-FIRST-REPLY`
- Agent ID：`dsh-context-read168-20261020`
- 角色：执行者；主 Agent 为唯一集成、公共契约、合并、部署负责人
- 独立工作树：`/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/context-read-168`
- 分支：`codex/context-read-168`，基线 `4685cd74`（main）
- 状态：待验收；未推送、未部署、未写生产
- 允许修改范围见主表 `docs/DEVELOPMENT.md` 的 44-168 行。NPC 协议/提示词/内核/流式提交/请求恢复/世界版本准入/工具执行/媒体生命周期/公共 SQL/生产配置均未修改。

## 结论

普通私聊和索图请求共用同一条 `readPrivateAgentSnapshot` 上下文组装路径。优化前同一夹具下一轮上下文读取为 **45 次查询**（带计划/记忆时 60 次），优化后分别降到 **32 / 39 次**（-29% / -35%）；索图请求同为 **60 → 39 次**。同夹具实测 `contextPrepareMs`：普通冷启动 **42.58ms → 31.09ms**，带计划/记忆 **32.41ms → 20.32ms**，索图 **31.65ms → 23.68ms**。这些是单机单次夹具结果，不是 SLA；真实收益主要是数据库往返和组装量，模型生成仍占首条文字延迟的绝大部分。

## 实际路径（普通私聊 / 索图）

1. `POST /api/v1/worlds/:id/messages` → `NpcMessageError`/HTTP 层 → `npcAgentServices.sendMessageIfEnabled`。
2. 首条 `worlds + agent_runtime_worlds` 控制查询（epoch、deletedAt、世界时间）。
3. `PostgresClockStore.read` + `accept` 保存玩家输入回执（付费前幂等围栏）+ 原 attempt 查询。
4. `turnWorlds.get` 完整 hydrate 世界（所有消息、日程、媒体请求、便签、事实；有到场事件时还会重放全部历史事件）。
5. 一次 `readPrivateAgentSnapshot` 事务（44-163 已从 ~18 个子事务收敛为 1 个）：
   - 稳定人设：`readPublicationActorModulesCached`（不可变发布模块，按 owner/world/actor/definitionRef 缓存；先由 `readActorSituation` 的 `FOR SHARE` 版本校验失效）+ `actorContext` 选 persona 模块。
   - 当前会话：`actorContext` 从世界消息取最近 12 条、按相关性取历史 8 条；`readActorSituation` 取本人已交付的作者方向。
   - 关键记忆：`loadActorMemories`（角色 200 条上限）+ 被遗忘来源 blocked set；`actorContext` 再做 3000 字符预算。
   - 有效事项：facts / appointments / matters / choices / goals / plans / responsibilities / decisions / focus。
   - 工具相关材料：本人 awareness、自有物品、媒体完成结果、观察 inbox、narrative 作者上下文、episode follow-ups/results、strategy basis。
6. `readActorStrategyBasis` 再次补齐 state 引用的来源（accepted input、message、memory、fact、appointment、媒体结果、群/现场来源）。
7. `attachAgentWorldContextInTransaction` 合并 awareness、inbox、narrative recall、媒体完成、episode 生命周期。
8. `runNpcAgent` claim / `markRequestSent` / 模型预检 / 首次模型调用；流式时首条独立 statement 由 44-164 的 prefix 提交先落库再呈现；索图时 44-167 在流中提交媒体前缀并启动原后台队列。

## 发现的重复读取、重复解析与无消费者数据

| 问题 | 证据 | 处理 |
|---|---|---|
| 同一快照内 narrative 作者上下文被读 3 次 | inbox 内一次、inbox 后 recall 一次、strategy basis 一次；每次还各读一次 forgotten sources | 快照事务内只读一次，strategy/inbox/recall 复用同一 packet；blocked 一次传入 |
| 无媒体结果时仍做两次完整媒体头校验 | `readActorMediaCompletionContext` 每次先读 world+engine、forgotten，再查结果；strategy 和 attach 各一次 | 先查有界结果；空结果可直接返回。默认调用方仍保留 world head 校验以维持 NOT_FOUND/VERSION_CONFLICT 语义；快照路径因已校验头部而显式跳过空结果二次头读 |
| `readActorSituation` 对没有作者交付的普通私聊也跑七表 join | 夹具中该查询 2.7–4.2ms，是单条最贵上下文查询 | 第一条 `FOR SHARE` 查询合并 `EXISTS` 交付预检；无交付直接返回，保留版本校验 |
| awareness 两次读 world 行 | world state/version 一次，当前版本 event id 一次 | 合并为一条带子查询的 `FOR SHARE` |
| inbox 场景与群成员各查一次；无场景/群时仍读消费表 | 普通私聊固定多 2–3 次查询 | 场景/群成员合并为一条 UNION；两者都为空时跳过消费读取 |
| strategy basis 对无对应 handle 的类型仍查 messages/memories/facts/appointments/calendar/initial/genesis | 带计划/记忆的夹具中多出约 10 次查询 | 按 handle 前缀和长度短路；原生 strategy 的群/现场历史校验保持原样 |
| `readActorEpisodeResults` 每次重读 forgotten | 有 episode 时多一次查询 | 传入快照已读的 blocked set |
| 完整世界 hydrate 后才按 actor 裁剪 | `turnWorlds.get` 把全部历史/投影读入内存，snapshot 只用最近 12+8 条消息及可见事项 | **未改**（公共世界仓储/提交入口，交主 Agent 接线，见下） |
| claim 时再次完整计算 strategy basis | `markRequestSentWithSources` 在 claim 事务内重新读 narrative/media/native/初始快照 | **未改**（执行运行时接口，交主 Agent） |
| 模型 payload 在首 token 前构建两次 | `NpcAgentModel.validateInput` 调 `prepare`，`describeSuppliedContext` 再调一次；`decideStream` 才复用 WeakMap | **未改**（NPC 模型/协议，交主 Agent） |
| 全回合提交 95–103 次查询 | 普通 95、索图 103；首条流式文字已由 44-164 prefix 提交，但非流式索图仍等整轮 | **未改**（统一提交/内核，交主 Agent） |

## 实施的读取简化（逐文件）

- `actor-narrative-observation-sources.ts`：`frame.blockedSources` 可选；同一事务已有 forget 快照时不再重复查。
- `actor-observation-inbox.ts`：可接收同一事务的 narrative packet / blocked set；场景与群成员一次 UNION 查询；二者都为空时跳过消费读取。返回的 `narrativeKnowledgeIds`、12 条/16000 字节预算与排序保持原逻辑。
- `agent-source-resolver.ts`：
  - `readActorStrategyBasis` 可复用 narrative packet 和 blocked set；
  - 媒体空结果可跳过二次头读（仅快照路径显式开启）；
  - inputs/messages/memories/facts/appointments/calendar/initial/genesis 按 handle 类型短路；
  - 原生群/现场历史认证未改。
- `actor-media-result-context-repository.ts`：先读有界结果；空结果时默认仍做 world/engine/版本校验（保持现有测试的 NOT_FOUND/VERSION_CONFLICT），只有显式 `skipEmptyHeadCheck` 的快照调用才跳过；有结果时才读 blocked 并继续原完整来源链。
- `actor-situation-repository.ts`：保留原 `FOR SHARE` 版本查询，新增轻量 `EXISTS` 交付预检；普通私聊不再跑七表 join。这里有意用两条廉价查询换掉一条昂贵 join，并保持既有测试桩/调用契约兼容。
- `world-awareness-repository.ts`：world 行与当前 version event id 合并为一次 `FOR SHARE` 查询。
- `episode-result-context-repository.ts`：可选 blocked set。
- `agent-snapshot-repository.ts`：快照事务内一次 narrative 读取；传给 strategy、inbox、recall；媒体空结果头读跳过；episode results 复用 blocked set。缓存仍只有原有不可变发布人物模块，键和版本失效依据未变。
- `src/modules/world/application/actor-context.ts`、`src/modules/memory/infrastructure/memory-store.ts`：**未改**。审查后未发现可安全删除的消费者；记忆 200 条上限与 3000 字符预算仍是有效约束，改它会影响排序或丢失关键记忆。
- 新增 `tests/integration/context-read-first-reply.test.ts`。

## 对照结果

同一真实 PostgreSQL 夹具，确定性模型桩，无真实付费模型。表中 `contextQueryCount` 来自服务端 telemetry；`contextPrepareMs` 为单次样本，存在波动，不能当 SLA。

| 场景 | 改前上下文查询 | 改后上下文查询 | 改前 contextPrepareMs | 改后 contextPrepareMs |
|---|---:|---:|---:|---:|
| 普通私聊（冷、无计划） | 45 | 32 | 42.58 | 31.09 |
| 普通私聊（带目标/计划/关键记忆） | 60 | 39 | 32.41 | 20.32 |
| 索图请求（同一路径） | 60 | 39 | 31.65 | 23.68 |

补充测量（同一脚本、连续 warm turn）：

- 普通 warm turn：45 → 32 次；`contextSqlMs` 约 18.6 → 13.6（-27%）。
- 索图：45 → 32 次；`contextSqlMs` 约 32.9 → 13.3（-60%）；`contextPrepareMs` 29.16 → 10.80（单次样本，复跑 23.68，仅作方向）。
- 整轮查询（含提交）：普通 146 → 127，带计划 162 → 135，索图 169 → 142。
- 单轮事务数保持 11；没有新增后台队列、定时器或恢复状态。

## 未修改及原因

- **完整世界 hydrate**：`src/server/npc-agent-services.ts` 的 `turnWorlds.get` 会把全部消息/日程/媒体/事实读入并可能重放历史事件，之后 snapshot 才按 actor 裁剪。这是剩余最大的一处“读取后不用”。替换它需要公共世界仓储/提交入口的新端口，交主 Agent。
- **claim 时 strategy basis 重算**：`src/modules/world/infrastructure/agent-runtime-repository.ts` 在 `markRequestSentWithSources` 再次调用 `readActorStrategyBasis`，用于 `AGENT_REVISION_CONFLICT` 校验。可在快照里生成 strategy 摘要并传入，但不能削弱该校验，交主 Agent。
- **模型 payload 双构建**：`src/modules/world/infrastructure/npc-agent-model.ts` 的 `validateInput` 与 `describeSuppliedContext` 各调一次 `prepare`。建议在 `validateInput` 也写入现有 `WeakMap<AgentSnapshot>`（snapshot 不可变），`describeSuppliedContext`/`decideStream` 直接复用；属于 NPC 模型/协议范围，交主 Agent。
- **全回合提交等待**：普通 95、索图 103 次提交查询。44-164 已让流式首条文字先提交；非流式的索图仍等整轮。合并/并行提交属于统一提交与内核，交主 Agent。
- **媒体/计划/记忆语义**：没有删除任何明确选择、有效计划、关键记忆或工具结果；只删除了同一事务内的重复读取。最新玩家输入仍由 `input` 直接进入 sources，并在 attach 最后重新做 `authorizedAgentState`。

## 交主 Agent 的接线建议（不自行实现第二套入口）

1. **有界世界视图替代完整 hydrate**（优先）：
   - 调用点：`src/server/npc-agent-services.ts` 中 `const world = await turnWorlds.get({ userId: ownerId }, command.worldId);`
   - 新增一个只读端口（可放在 `agent-snapshot-repository.ts` 或 world application 端口）返回：
     - `worlds.state` 的紧凑快照（版本、时间、actors、space、matters/choices 等）；
     - 该 actor 最近 12 条 + 有界候选历史消息（例如 ≤200 条，供 `actorContext` 排序）；
     - 该 actor 可见的 facts/appointments/matters/choices（按现有 visibility/知情过滤）。
   - 必须保留：世界版本读取与 `FOR SHARE`/准入校验、kernel commit 时的完整状态重验、观众/知情裁剪；不能用缓存替代版本校验。
   - 预期收益：普通私聊少读/少解析全部历史；在长世界上比本次 32/39 次查询更明显。本次未做，故未计入实测。
2. **claim 复用 strategy 摘要**：`markRequestSentWithSources` 已有 `snapshot` 参数；可让快照记录一份仅供校验的 strategy 来源摘要（不改变模型输入），claim 用它替代重新完整读取；若摘要缺失再回退现读。不得放宽 `AGENT_REVISION_CONFLICT` 或 source 授权。
3. **模型 payload 单次构建**：`NpcAgentModel.validateInput` 复用 `prepare` 结果到现有 `prepared` WeakMap；只对同一不可变 snapshot 生效，不跨请求缓存。可减少首 token 前一次完整 payload 构建和多次 `JSON.stringify`。
4. **媒体结果一次读取**：若要让 attach 完全复用 strategy 已读的媒体结果，需要 `readActorStrategyBasis` 额外返回 media observations（目前只返回 sources）。这是接口形状变更，建议由主 Agent 评估，不建议在快照里另建缓存。

## 验证

- 新增真实 PostgreSQL 夹具测试：`tests/integration/context-read-first-reply.test.ts` **1/1 通过**。覆盖：
  - 普通 warm turn ≤34、带计划/记忆 ≤40、索图 ≤40（实测 32 / 39 / 39）；
  - 最新玩家输入、accepted input source、目标/计划、关键记忆仍在授权后的 snapshot 中；
  - 索图同轮提交自然文字 + 真实 `world_media_requests` 行。
- 相关既有真实库测试：
  - `actor-media-result-context.test.ts`、`actor-media-context-wiring.test.ts`、`actor-situation.test.ts`、`world-awareness.test.ts`、`chat-latency-stage1.test.ts` **均通过**。
  - 另跑了 narrative/agenda 相关 5 个文件；其中 14 通过/33 失败，与同夹具的 `4685cd74` 基线 **14 通过/33 失败完全一致**，属于该测试库/端口环境失败，不是本次回归。`agent-native-strategy.test.ts` 在 55432 基线与本分支同样失败；其专用端口 55503 未占用/未启动，未伪绿。
- `npm run check:boundaries`：通过（692 files）。
- `npm run typecheck`：0 errors。
- `npm run build`：通过。
- 最终聚焦真实库组合：`context-read-first-reply`、媒体结果/接线、actor-situation、world-awareness、chat-latency-stage1 **41/41 通过**。
- `npm test` 全量单元测试：**3843/3843 通过，0 fail，0 skipped**。首轮曾因 `actor-situation` 查询形状与 3 个 mock 测试桩不兼容出现 3 个失败；改为保留原 `FOR SHARE` 版本查询 + 轻量 `EXISTS` 预检后全部通过（代价是上下文多 1 次廉价查询，已计入上表）。
- 0 真实付费模型、0 生产数据库写、0 生产部署。数据库仅使用主目录既有本地 55432 `parallel_life_test` 的合成夹具；未启动新 PG 实例，未占用他人专用端口。

## 集成注意事项

- 所有改动均为可选参数/内部调用顺序，未改公共契约、SQL、API 响应、NPC 输出协议或内核权限。
- `44-154-J`、`44-163` 的冻结源已集成；本次只做读取去重，未改其媒体/流式语义。若主 Agent 认为 `agent-snapshot-repository.ts`/`agent-source-resolver.ts`/`actor-media-result-context-repository.ts` 归属仍未释放，请回退对应文件，保留其余已独立验证的修改。
- 合并后请由主 Agent 统一跑完整 `npm run check`、必要真实模型索图/私聊验收、Vercel READY 与公网验证；本报告不声称已上线。

## 接续点

- 当前状态：代码、测试、报告已冻结，提交后主表标待验收。
- 下一条操作：主 Agent 审核文件归属与 diff，合入 main；若采用有界世界视图，先冻结端口形状再实现，不与本次快照去重并行写同一文件。
