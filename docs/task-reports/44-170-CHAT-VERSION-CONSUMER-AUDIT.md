# 44-170 聊天版本消费者清查与并发回归

## 身份与基线

- 任务：`44-170-CHAT-VERSION-CONSUMER-AUDIT`
- Agent ID：`dsh-version-audit170-20261020`
- 最新 main：`8c4cb3d8`
  - 本批已上线业务：`a8d64ff0`（episode binding 跨无关聊天保留）
  - 上一批已上线：`eb258904`（paid chat basis / proven append position 分离）
  - 更早一批上线：`a37f8218`
  - 已集成最终测试：`10eef235`
- 独立工作树：`.local/worktrees/chat-version-audit-170`
- 分支：`codex/chat-version-audit-170-a8d`
- 本批测试/报告提交：`dd4baabb`（无公共源码修改）
- 状态：待主 Agent 验收；公共源码、协议、内核、提交、媒体、SQL 未修改
- 未调用真实模型、未写生产、未部署

## 与最新 main 的差异

- 最新 main `8c4cb3d8`（已上线 a8d64ff0）；之前冻结的 `d1f60cfb` 只改 4 个测试/报告文件，`b65b9715` 只修正报告基线，均未合入 main。
- 本批在此之上新增/修改：`chat-version-concurrency.test.ts`、`message-response-recovery.test.ts`、`npc-agent-kernel.test.ts`、`npc-native-service.test.ts`、本报告。
- 没有公共源码 diff；不需要 cherry-pick 旧实现提交，也不能把测试/report 当业务实现重复集成。

## 结论

三个版本仍必须分开：

1. `receipt.expectedWorldVersion`：用户输入依据，不可变；
2. `attempt.expectedWorldVersion` / `snapshot.worldVersion`：模型读取基线，不可变；
3. 实际保存版本：提交时由 `resolveAgentCommitVersion` 证明的 append base / commit version，事件、消息、行动结果和人物状态实际追加的位置。

`eb258904` 已支持：**第一条 prefix 之前，其他人物纯交流推进世界后，A 仍可保存**。`resolveAgentCommitVersion` 只在无自有 prefix、输入是本人私聊、且中间事件是限定范围内的纯交流时，返回 `{appendBaseVersion, commitVersion}`；不修改 attempt、snapshot、receipt 或原请求 hash。

仍不支持：**A 已有 prefix 后，其他事件插入，A 后续段再追加**。当前 `resolveAgentCommitVersion` 找到自有 prefix 后，只有“实际版本 == 自有 prefix 版本”才返回，其他插入事件使其返回 null；后续段被 superseded。客户端仍可能收到 committed partial receipt。

本任务只做消费者清查、只读回执审查和真实 PG 回归，不提交公共实现。

## 三个版本的消费者映射

| 消费者 | 文件 / 函数 | 当前用途 | 应保留基线还是改用实际保存版本 |
|---|---|---|---|
| 用户输入接收 | `npc-agent-services.ts` accept；`agent-runtime-repository.ts` `acceptAgentInputInTransaction`；`agent-input-version.ts` | 保存 receipt 原文和客户端版本；准入可允许目标人物未变的无关推进 | **receipt 不可变**；准入可看当前，但不能改写 receipt |
| attempt claim | `agent-runtime-repository.ts` `claim`；`acceptsAgentInputVersion` | attempt 的 expected 版本与 snapshot 绑定；claim 仍按输入/基线准入 | **attempt/snapshot 保持模型基线**；不能为保存成功回写 attempt |
| 上下文准备 | `agent-snapshot-repository.ts` `readPrivateAgentSnapshot` | snapshot.worldVersion 是模型看到的基线 | **保持模型基线** |
| 第一条流式文字（无自有 prefix） | `npc-stream-segment-repository.ts` `persistAndCommitStreamSegment`；`agent-commit-version.ts` `resolveAgentCommitVersion` | `eb258904` 允许 unrelated pure-chat 在 expected 之后、64 版本内；返回 append base 与 commit version；事件/消息写 commitVersion | **模型基线保留；实际事件用 commitVersion**；不是改写 attempt |
| 后续流式文字（已有 prefix） | 同上；`isFirstCommit` / `finalizePrefixEvent` | 找到自有 prefix 后，只接受实际版本仍等于 prefix 版本；其他事件插入则返回 null，段 superseded | **不能回改旧 prefix**；应独立追加新事件，使用实际 commitVersion；旧 prefix 版本不可变 |
| 提前媒体提交 | `npc-agent-kernel.ts` `commitMediaPrefix`；`beginAgentCommitFrameInTransaction`；event.version | 媒体 prefix 与文字共用同一 append 证明；事件/结果已改用 commitVersion | 模型基线保留；媒体事件/任务绑定实际 commitVersion |
| 最终人物状态与行动结果 | `npc-agent-kernel.ts` `commit` / `finishAgentCommit`；`agent-runtime-repository.ts` `finishAgentCommitInTransaction` | 使用 frame 的 commitVersion/appendBase；人物状态、行动结果、事件证据按实际版本写入 | 使用实际 commitVersion；仍保留原 attempt 身份和 actor revision 检查 |
| response_received 恢复 | `run-agent.ts` replay；`npc-agent-services.ts` `recoverMessage` | 保存的 response 重放，不重新调用模型 | **保持原 attempt/snapshot/input**；实际版本只用于追加 |
| 已显示 prefix 的中断封存 | `npc-stream-segment-repository.ts` `sealCommittedStreamPrefix`；`npc-agent-services.ts` `onPrefixFailureSeal` | 把已提交 prefix 封存为合法回合；当前 run-agent 把它作为成功结果返回 | 封存只能覆盖自己的 prefix；回执必须显式标记 partial，不能展示完整成功 |
| 原请求回执 / 重复 HTTP | `world-message-http.ts`；`messages/receipt/route.ts`；`lookupMessage` / `checkMessageReceipt` | 用 commandId/世界/人物/文本/expectedVersion 查找原 attempt/事件；重复请求返回原 receipt | **保留原 command/attempt 身份**；实际 commitVersion 只影响新事件 |
| 事件重放 / 消息来源 / 知情 | `postgres-world-repository.ts` `hydrateInTransaction`；`readCommittedTurnMessages`；来源校验 | 历史消息/事件按 version 投影；prefix 当前是一个事件 | 已保存历史版本不可变；新追加事件单独投影，不能重写旧 prefix 来源 |
| 群聊/现场 SQL 权限 | `db/migrations/0074_agent_native_projection.sql` L9-13/L60-63 | SQL 函数仍写死 `worlds.version = attempt.expected_world_version`、`event.version = expected+1`、actor projected=event.version | **TS 不能单独修**；主 Agent 必须同步 SQL/迁移与 append 语义 |
| 媒体来源重授权 | `actor-media-result-context-repository.ts`；`agent-source-resolver.ts` | 媒体来源、attempt、worldVersion 和 prefix 重新核验 | 来源基线保留；实际版本只用于新事件/任务归属，不能放宽授权 |

## 并发回归（真实 PG + Promise gate）

测试文件：[chat-version-concurrency.test.ts](.local/worktrees/chat-version-audit-170/tests/integration/chat-version-concurrency.test.ts)

不靠 sleep；模型暂停/恢复使用 Promise gate；B 由真实 `sendMessageIfEnabled` 提交；断言读真实世界、消息、attempt 和 DB 事件。

| 用例 | 结果 |
|---|---|
| **首段前 B 纯交流提交，A 仍保存** | **通过**：B 在 v1，A 首段/输入在 v2；A 的 attempt expected=0、snapshot.worldVersion=0、receipt expected=0 保持不变；A 事件版本=2；重复请求返回同一 receipt，A/B 模型调用均不增加 |
| A 已显示第一段，B 独立提交 | B 保留 v2；A 第一段保留 v1；A 后续段未保存；A 仍返回 committed v1（partial）；B 数据不丢，旧 prefix 未被改写 |
| 同人物生成中收到新输入 | 旧 prefix 封存；新输入/新回复保存；旧后续段不覆盖新决定；重复请求不重复调用模型 |
| 重复 HTTP 同 command | 返回同一 receipt，只有一条消息，模型调用不增加 |
| 图片 prefix + 后续中断 | 复用既有 `chat-latency-stage2`，通过；prefix 先提交，后续中断不伪造完整成功 |
| 媒体 prefix 期间 B 插入 | **通过**：A 文字先保存，媒体请求/outbox 各 1 条；B 在 v2；重复 A 请求不新增媒体任务，媒体事件仍只有 1 条 |
| response_received 恢复 | **已修正并通过 9/9**：无关 B 先保存后，A 复用已保存 response、按 v2 提交；原 receipt/attempt/snapshot/模型基线不变；重复恢复/HTTP 不新增模型调用或消息 |
| **A 已有 prefix 后 B 插入，A 第二/第三段及最终保存** | **待接线 todo**：当前失败；`resolveAgentCommitVersion` 在自有 prefix 存在且实际版本已前进时返回 null；不能通过接受丢消息来变绿 |

当前聚焦结果：concurrency 6 项，5 pass，1 todo，0 fail。

证据摘要：

- 首段前成功：A attempt/snapshot/receipt 的预期版本均 0；B 事件 v1、A 事件 v2；A/B 模型调用各 1；重放后仍各 1；用户消息 1 条。
- 首段后交错：A 首段事件 `id/version/payload` 在 B 提交和 A 后缀失败前后 `deepEqual`；`readStreamSegments.summary.completionStatus` 为 `superseded`（非 completed），committedSegmentCount=1；A 后缀不存在，B 消息保留。
- 同人物新输入：旧 prefix 不覆盖新决定；`readCommittedTurnMessages` 与新 receipt 投影一致；重复请求不增模型调用。
- 媒体去重：媒体请求和 outbox 各 1 条；重复请求后请求 ID 不变。
- 恢复：`message-response-recovery` 9/9；A response 复用，modelFactories=0；A 事件 v2、B v1；inputs/attempts/events/messages = 2/2/2/4；重复恢复和 HTTP 不增计数。

### 首段前成功用例的具体断言

- A attempt `expected_world_version=0`，`expected_actor_revision=0`；
- attempt response 内 snapshot `worldVersion=0`，`input.text` 仍是原输入；
- receipt `expectedWorldVersion=0`；
- B 事件版本 1；A 事件版本 2；A 用户输入和 NPC 首段消息 `sourceVersion=2`；
- 同一 A command 重放返回相同 receipt，A/B 模型调用各仍为 1；
- 消息不重复。

## episodeManifest 口头答应但 changes=null（只读追踪）

### 现象

人物收到 `episodeManifest` 后，在 `statements` 里自然答应参与，但最终 wire 输出 `changes:null`；没有 `consideration`，因此没有 `episodeDecision`，事件保持 pending。保存本身成功，语义选择没有发生。

### 准确路径

1. `agent-snapshot-repository.ts` 约 L580 把 `playerEpisode.manifest` 放入 snapshot；`npc-agent-model.ts` 约 L465 放入模型 payload。
2. `npc-agent-model.ts` 的 `responseFormatFor` 约 L129：只有 coordination 是 `required`；player manifest 是 `optional`，payload 的 `considerationAllowed=true`、`considerationRequired=false`。
3. `SYSTEM` 约 L103 明确写“player 有 episodeManifest 时按相关性考虑或 null”，允许 `changes:null` 代替结构化选择。
4. `npc-model-protocol.ts` 的 `npcResponseFormat` 约 L459-463：`optional` 时 `consideration` 可为 null、`changes` 可为 null；`required` 时 `changes` 被收窄为对象。
5. `decodeCurrentNpcWire` 约 L1616 把 `change.consideration ?? null` 传给 `bindNpcConsideration`。
6. `bindNpcConsideration` 约 L1404-1422：player manifest 只提取 `requestId`，**没有** `if (!consideration) throw`；只有 coordination 分支强制。`proposal.episodeDecision` 因此缺失。
7. `agent-kernel.ts` 约 L264-288 只对 coordination 要求 `EPISODE_DECISION_REQUIRED`；manifest 缺失不会被拒绝。约 L789 只在有 `episodeDecision` 时追加 `episodeParticipations`。
8. `episode-lifecycle-repository.ts` 约 L77-85 消费 `saved.choice`、`rt.episodeDecision`、`rt.proposal.episodeDecision`；没有决策就没有消费，事件保持 pending。`agent-narrative-repository.ts` 约 L550 也只校验已存在的 decision。

### 同一次模型调用内的建议

- `responseFormatFor`：player `episodeManifest` 使用 `considerationScope='required'`，但 choice 仍是 `engage|decline|defer|need_information|quiet`；
- `npcResponseFormat` 已支持 required 将 `changes` 收窄为对象；因此同一次输出必须包含 `changes.consideration`，不能再 `changes:null`；
- `bindNpcConsideration`：manifest 存在且 `consideration` 缺失时抛 `NPC_WIRE_CONSIDERATION_REQUIRED`，与 coordination 一致；
- 提示词把“按相关性考虑或 null”改为“必须给明确 choice；无关可 quiet，拒绝可 decline，暂缓/缺信息用 defer/need_information，愿意参与用 engage；不能以普通语句代替结构化选择”。`quiet` 允许不参与，不强制 engage；不使用关键词判定人物意愿；不额外调用模型、不补造 decision；
- 保持现有 `validateAgentProposal` 的 requestId/actor/channel/source scope 和 lifecycle 消费不变。模型若仍只输出 `changes:null`，应作为明确无效输出失败，而不是静默保持 pending；不自动重买。

### 边界

- 这是协议/解析/提示词层的同调用修复建议，公共文件由主 Agent 修改；本任务未改源码。
- 允许人物认为事件无关（quiet）、拒绝（decline）、暂缓（defer/need_information）；不强制参与，不以关键词替人物做决定。
- 需要真实模型复验“愿意参与 -> engage 被消费”和“无关 -> quiet 保留 pending”，夹具不能冒充真实语义选择。

## partial 回执从服务端到手机（只读审查）

### 当前调用链

1. `runNpcAgent` 在流式 prefix 已提交、后续 parse/commit 失败时调用 `onPrefixFailureSeal`，拿到 sealed 结果后直接 `return sealed`（`src/modules/world/application/run-agent.ts` 约 L246-256、L279-291）。
2. `npc-agent-services.sendMessageIfEnabled` 的 `onPrefixFailureSeal` 调 `sealCommittedStreamPrefix`，把结果作为普通 `result` 返回；随后走成功分支，返回 `{status:'committed', eventId, version}`（`src/server/npc-agent-services.ts` 约 L795-830、L867-884）。
3. `world-message-http.ts` 的流式路径把该 receipt 包装成 `complete` 事件（`src/server/world-message-http.ts` 约 L72-110）；非流式路径同样返回完整 receipt（约 L227-268）。
4. `WorldMessageReceiptSchema` 只有可选的 `streamSummary`；`worldMessageClientReceipt` 在旧投影下直接剥离 `streamSummary`（`src/contracts/world-interaction.ts` 约 L96-104、L131-138）。
5. `features/api/client.ts` 流式解析只保存 `complete.receipt`，不检查 `streamSummary.completionStatus`（`src/features/api/client.ts` 约 L285-340）。
6. `world-phone-app.tsx` 收到 receipt 后把用户消息标为 `sent` 并投影消息（`src/features/phone/world-phone-app.tsx` 约 L290-338）；`send-projection.ts` 的 `committedLocalSend` 固定返回 `status:'sent'`，`projectCommittedTurnReceipt` 不读 partial 状态（`src/features/phone/send-projection.ts` 约 L9-20、L61-120）。
7. `/api/v1/worlds/[id]/messages/receipt` 的 committed 查询虽会带 `streamSummary`，`MessageReceiptClient` 只解析，没有部分成功展示逻辑（`src/app/api/v1/worlds/[id]/messages/receipt/route.ts` 约 L44-58；`src/features/api/message-receipt-client.ts`）。

### 结论

部分前缀 + 后缀失败当前会被展示为**完整成功**：用户气泡 `sent`，已保存首段显示，`complete` receipt 正常返回；没有“只保存了第一段/后续未完成”的显式状态。数据库和 segment 表本身已有 `partial_interrupted`，但 receipt/客户端没有把它作为用户可见结果。

### 测试覆盖边界

本批在 service 层验证了 original request、`recoverMessage`、`lookupMessage`、重复请求和 stream summary；没有运行真实 HTTP 路由认证壳，因此 `world-message-http` 的 `complete` 帧和 `/messages/receipt` 路由级响应未做端到端断言。partial 的调用链结论来自只读代码审查；路由级测试留给主 Agent 的统一回执契约。

### 最小修正建议（不修改公共源码）

- 回执层增加明确的 `completionStatus`（或强制流式 receipt 带 `streamSummary`），`onPrefixFailureSeal` 返回的 sealed 结果必须标记 `partial_interrupted`；
- `world-message-http` 的 `complete` 事件与 `/receipt` committed 查询都携带该状态；legacy 不能静默剥离到“看起来完整”；
- `sendWorldMessage`/`world-phone-app` 在 partial 时把用户消息标为 `partial` 或展示“后续未保存，可继续”的提示，但仍保留已保存首段，不回滚、不重发；
- `projectCommittedTurnReceipt` 只投影真实已保存消息；不能用空后缀或重试伪造完整回复。

## 媒体、依赖和失败边界

- 媒体 prefix 期间 B 插入：本批 `chat-version-concurrency` 新用例通过；A 文字先保存，媒体请求和 outbox 各 1 条，B 在 v2；重复 A 请求返回同 receipt，媒体请求 ID 不变，没有第二次生图。
- 媒体失败不产生“图片已送达”：复用 `tests/integration/media-pipeline-cancellation.test.ts`，1/1 通过；明确失败时请求/outbox/task 为 failed，provider 只调用一次，没有成功资产或投递结果。
- 后续中断不丢已创建媒体任务：复用 `chat-latency-stage2.test.ts` 的 media prefix + interrupt case，1/1 通过；媒体请求/outbox 在中断后仍在，不伪造完整完成。
- 依赖失效的成功声明：`chat-latency-stage2.test.ts` 的 dependent statement withholding 通过；没有依赖满足时台词不提交，已满足的无依赖文字独立保存。
- 相关邀约取消后迟到行动不能恢复：尚无并发测试；现有 `actor-appointment-cancellation.test.ts` 只证明普通取消链，迟到 effect 需主 Agent 提供统一重验接口后再补。`0074` 不改。

## 群聊/现场覆盖与缺口

现有覆盖（只读盘点）：

- 群聊：`tests/integration/agent-native-channel.test.ts`、`tests/integration/groups.test.ts`、`tests/integration/npc-native-service.test.ts`（Director 路由/候选/隔离）。
- 现场：`tests/integration/agent-scene-npc-service.test.ts`、`tests/integration/scene-step-persistence.test.ts`、`tests/integration/scenes.test.ts`。
- 通用提交：`chat-latency-stage2.test.ts` 的 before/after/media 交错仅覆盖 private。

缺口：

- 没有“群聊/现场 prefix 后，其他独立交流插入，再继续追加”的测试；
- `0074_agent_native_projection.sql` 仍要求 `world.version = attempt.expected_world_version`、`event.version = expected+1`，仅改 TS 不能通过；
- 本批按用户要求不新增群聊/现场旅程、不改 0074、不自行定义统一提交接口。等主 Agent 提供统一版本准入/追加接口后，各补一条必要旅程。

## 旧测试债务

- `npc-agent-kernel.test.ts`：**13/13 通过**。
  - 修正 waiting plan 的 `missingConditions`；
  - 用真实 accepted-input receipt 解析 source ref，修复 `UNKNOWN_SOURCE`；
  - 未放宽生产校验。
- `npc-native-service.test.ts`：**10/10 通过**。
  - 修复 `UNKNOWN_SOURCE` source ref；
  - 两个旧 Director 夹具改为当前 `director-wire-v14`：使用 `wireCatalog` 的 `candidate:N`/`source:N` 引用，补 `authoredChoices`，不再发送旧 `selectedCandidateIds`/`mode`/`events` 形态；
  - 保留 quiet/selected/unknown 路由、候选分区、拒绝和知情隔离断言；未改生产校验。

## 验证

- `npm run typecheck`：0 errors。
- 聚焦 PG：40 项，39 pass，1 todo，0 fail；concurrency 6（5 pass/1 todo）、kernel 13/13、native 10/10、stage2 1/1、message-response-recovery 9/9、media-pipeline-cancellation 1/1。
- `message-response-recovery` 旧 VERSION_CONFLICT 断言已接管并修正：现在验证纯交流插入后按实际版本保存、response 复用、基线不变、重复恢复/HTTP 不新增模型调用或消息；旧的状态变化/权限/unknown 负向用例继续通过。
- `chat-media-tasks.test.ts` 在裸 Node 导入触发 `server-only` 限制，未计入；媒体失败语义由 `media-pipeline-cancellation` 1/1 覆盖。
- 本批未重复运行全量 `npm test`/boundaries/build；上一批结果不等同于本批新基线。
- 0 真实付费模型、0 生产写、0 部署。

## 主 Agent 接线所需

- 保留 receipt/attempt/snapshot/原请求 hash 不可变；只让实际 append 位置前进。
- 后续流式段在已有 prefix 后遇到其他事件时，必须独立追加事件/消息/行动结果，不能复用或 finalize 旧 prefix；旧 prefix 版本不可变。
- 首段前、后续段、媒体 prefix、最终提交统一使用同一 append 证明；不删除来源、权限、租约、actor revision 检查。
- 群聊/现场 SQL 0074 需同步迁移。
- partial 回执必须显式标记；不能把只保存首段当成完整成功。
- 相关约定取消/条件变化的目标行为仍需 append + effect 重验；当前只有版本冲突的安全失败，未支持。

## 文件清单

新增：

- `tests/integration/chat-version-concurrency.test.ts`
- 本报告

修改：

- `tests/integration/message-response-recovery.test.ts`（接管旧断言）
- `tests/integration/npc-agent-kernel.test.ts`
- `tests/integration/npc-native-service.test.ts`

未改：公共源码、协议、内核、提交、媒体、SQL、生产配置。
