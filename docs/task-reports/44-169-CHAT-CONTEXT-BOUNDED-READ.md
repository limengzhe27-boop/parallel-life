# 44-169 聊天上下文有界读取

## 身份与状态

- 任务 ID：`44-169-CHAT-CONTEXT-BOUNDED-READ`
- Agent ID：`dsh-context-bounded169-20261020`
- 开发基线：`11f570cf`（已含 `06f1777b` 的上下文去重、NPC v15、即时媒体免目标计划、模型输入复用）；交付前已 rebase 到最新 main `551760f7`
- 独立工作树：`/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/chat-context-bounded-169`
- 分支：`codex/chat-context-bounded-169`
- 状态：待主 Agent 验收；公共聊天入口未切换，未部署
- 未修改：`npc-agent-services.ts` 实际入口、NPC 协议/提示词/模型、`npc-agent-kernel.ts`、流式分段、claim/提交/恢复、公共 SQL、媒体生命周期、生产配置

## 结论

新增了专用只读契约 `ChatContextRead` 和实现 `readChatContextWorld`。它按**当前世界、当前人物、当前渠道**读取，并接受调用方提供的明确旧引用：

- compact 世界身份/版本/时间/人物；
- 作者预设开场消息 + 有界近期运行消息；
- 调用方可选提供的明确旧消息/事实/约定引用；
- 人物 durable state 中的承诺、拒绝、暂缓、问题、计划、约定和责任（完整）；
- 可见 matters/choices；
- 作者开场事实、近期事实、matter 关联事实和明确引用事实；
- 所有 active 约定 + 有界最近终态约定 + 明确引用约定。

它不是完整 `WorldState`：新类型 `PrivateChatWorld` 只包含聊天消费者实际依赖的字段，并附带 `ChatContextCompleteness` 说明哪些是完整、哪些是有界、哪些仍需原媒体解析器。旧入口可用它替换 `turnWorlds.get`，不再每次加载全部消息、事实、约定、便签和媒体请求。

同一 600 条历史、104 条事实、53 条约定的真实 PG 夹具（含新增的邀约响应核对）：

| 指标 | 完整 hydrate | 有界读取 | 变化 |
|---|---:|---:|---:|
| SQL 查询数 | 4 | 5 | **+1（邀约响应核对）** |
| 返回行数 | 759 | 334 | **-56%** |
| 世界 JSON 字节 | 181,227 | 75,606 | **-58%** |
| 单次墙钟 | 约 84ms | 约 85ms | 本地夹具内无稳定差异 |

短对话夹具（2 条作者开场 + 1 条初始约定）：4 vs 5 查询、4 vs 4 行、2,244 vs 2,196 字节、约 6.2 vs 6.5ms，基本持平。**本批真正减少的是加载行数和字节数；邀约响应核对使有约定世界的查询数增加 1。没有证明整体回复速度提升，本地小样本不是 SLA。**

## 读取契约

文件：[chat-context-read.ts](.local/worktrees/chat-context-bounded-169/src/modules/world/application/chat-context-read.ts)

```ts
export type PrivateChatWorld = Pick<
  WorldState,
  | 'id' | 'ownerId' | 'version' | 'title' | 'time' | 'actors'
  | 'messages' | 'facts' | 'appointments' | 'matters' | 'choices'
>;

export type ChatContextRead = {
  world: PrivateChatWorld;
  actorState: ActorAgentState | null;
  completeness: ChatContextCompleteness;
};
```

`completeness` 明确区分：

- `world: complete_compact_state`：compact state 是权威的，但 messages/facts/appointments 不是全量；
- `actorState: complete | missing`；
- `messages`：作者开场 + 有界运行窗口 + 引用；`runtimeWindowLimit`、`runtimeWindowHasMore`、opening/runtime/referenced 计数、未解析引用；
- `facts`：作者/legacy 开场 + 近期 + matter 关联 + 引用；`recentLimit`、`recentHasMore`；
- `appointments`：active 完整 + 最近终态 + 引用；`terminalLimit`、`terminalHasMore`；
- `matters/choices`：compact state 中该人物可见部分的完整集合；
- `mediaResults: not_loaded_existing_media_result_resolver_remains_required`：媒体完成/失败/处理中仍由原 resolver 读取，不能从本结果推断“没有媒体结果”；
- `attendanceReplay: bounded_reader_throws_when_required`：有历史现场到场事件的世界必须回退完整 hydrate；
- `notes: not_loaded_not_used_by_private_chat_context`；
- `referenced`：`explicitRequested/explicitResolved/explicitUnresolved`（调用方可选引用）、`stateRequired/stateResolved/stateUnresolved`（人物持久状态必需引用）、`deferredToExistingResolver`（显式或状态引用的 media/action ID）；
- 回退不是 completeness，而是抛出 `ChatContextFallbackError`：`code=CHAT_CONTEXT_FULL_HYDRATE_REQUIRED`，`reason` 为 `attendance | invitation-reconciliation | explicit-reference-limit | state-reference-limit | linked-evidence-limit`。

## 读取算法

文件：[chat-context-read-repository.ts](.local/worktrees/chat-context-bounded-169/src/modules/world/infrastructure/chat-context-read-repository.ts)

单个事务、同一版本视图：

1. **世界 + 初始快照 + 人物状态（1 条查询）**
   - `worlds` 行 `FOR SHARE`，取 compact `state`/`version`；
   - `world_initial_snapshots` 只取 `state->messages/facts/appointments/time`，不把完整初始世界读入；
   - `actor_agent_states` 取该人物完整 durable state；
   - 同时用 `EXISTS` 检测历史 attendance 事件；命中则抛 `CHAT_CONTEXT_FULL_HYDRATE_REQUIRED`，由主 Agent 回退原 `worlds.get`。
2. **近期运行消息 + 精确旧消息（1 条查询）**
   - 最近 `runtimeWindowLimit`（默认 200，最大 500）条 `world_messages`，按 ordinal 取最新；
   - 同一 SQL 的 exact CTE 精准读取 `message:`/`opening:` 引用、人物 state 的 message source、以及调用方传入的旧消息 ID；
   - 与作者开场消息合并：开场在前，运行消息按 `event version + ordinal` 排序；
   - 不把“最近 200 条”用于截断有效事项；旧事项由 state/exact 通道独立读取。
3. **事实（1 条查询）**
   - 初始 facts + legacy compact facts + 最近 `recentFactLimit`（默认 80，最大 200）+ matter/choice 关联事件 facts + `fact:` 引用；
   - 过滤 visibility、believedByActorId、narrativeContext（作者私密 packet 只走原 inbox）、来源版本；
   - `linked` CTE 只读选中 matter 的 source/evidence/milestone/step 事件，防止 `matter_result`/`pursuit_result` 见证被“最近 80 条”截掉。
4. **约定（1 条查询）**
   - 该人物参与的全部 active `proposed/confirmed` 约定；
   - 最近 `terminalAppointmentLimit`（默认 20，最大 50）条终态约定；
   - `appointment:` 引用和 responsibility.subject appointment；
   - 初始约定与运行投影走原 `mergeAppointments` 一致性校验。
5. **历史邀约响应（有约定时 1 条查询）**
   - 按被选中的 appointment ID 读取全部 `invitation.responded` 事件；
   - 事件按 version 升序，逐条用原 `applyInvitationEvent` 领域规则应用到从投影/初始快照得到的约定；
   - 只要事件序列与投影状态不能一致应用，抛 `invitation-reconciliation` 回退，不猜测、不忽略；
   - 这一步保证“响应只在事件流、投影仍旧”的旧档与完整读取一致。
6. **引用与证据边界**
   - 调用方显式引用上限 256，超出直接回退（不静默截断）；
   - 人物 state 必需的 `message/opening/fact/appointment` 引用上限 768，超出回退；在范围内**全部精确读取**，不再按 256 截断；
   - matter/choice 关联事件上限 512，超出回退；
   - linked facts 按 `ordinal,id` 确定性排序读取 201 条；超过 200 条即回退，不静默漏结果。

有约定世界最多 5 条 SQL；无约定/短对话最多 4 条。**没有用“内存裁剪完整 hydrate”冒充优化**：查询本身只取上述行。

## 保留行为与覆盖

集成测试：[chat-context-bounded-read.test.ts](.local/worktrees/chat-context-bounded-169/tests/integration/chat-context-bounded-read.test.ts)

| 场景 | 覆盖 |
|---|---|
| 普通短对话 | 2 条作者开场、0 运行消息；运行窗口不误报有更多；返回顺序正确 |
| 长历史世界 | 600 条运行消息、104 facts、53 appointments；窗口/计数/hasMore 正确 |
| 很早仍有效的承诺/拒绝/暂缓/问题/计划/约定/责任 | actor state 完整返回；旧计划、旧责任、旧问题、旧 decision 均在 |
| 当前明确引用很早的消息 | `message:old` 即使超出 200 窗口也精准返回 |
| 明确引用的旧事实/约定 | `fact:old`、`appointment:old` 精准返回 |
| 作者预设与运行消息混合 | 开场在前，运行消息按版本/ordinal；不重排、不重写时间 |
| 其他人物的私人信息 | 他人 message/secret fact 不进入；显式引用不可见 fact 只报 unresolved，不泄露 |
| 媒体完成/失败/处理中 | 本读取不加载媒体，completeness 明确要求原 resolver；显式 media/action ID 进入 deferred 列表 |
| 旧邀约响应只在事件流、投影仍旧 | 用原 `applyInvitationEvent` 顺序应用；与完整 `worlds.get` 的 cancelled 状态一致 |
| 初始约定已终止、终态超出窗口 | 初始约定仍在，但响应核对将其取消；不复活为 proposed/confirmed |
| 关键持久引用超过旧 256 上限 | 300 条 state 必需 message 引用全部精确取回，`stateRequired/stateResolved` 各≥300 |
| 事项关联证据超过 200 上限 | 确定性排序 + 201 行探测，超限抛 `linked-evidence-limit` 回退 |
| 调用方显式引用超过 256 | 抛 `explicit-reference-limit` 回退，不静默丢引用 |
| 缺失/不可见来源、旧存档 | 缺失引用 unresolved；attendance 世界抛 `attendance` 回退，不静默使用旧投影 |
| 版本一致/隔离 | 单事务、`FOR SHARE`、版本上界；无跨请求缓存 |

额外验证：用完整 `worlds.get` 和有界 world 分别调用原 `readPrivateAgentSnapshot`，两者都保留最新输入、旧 goal/responsibility、旧 message source，且都不含他人私有 fact。

## 任务 B：actor-context 预算计算

审查发现原 `fits()` 每次同时执行：

- `JSON.stringify(context)`
- `JSON.stringify({ context, userText })`

真实夹具下每次 `actorContext` **435 次 JSON.stringify**，约 3.95–4.04ms/次。

实施了**不改变任何选择/裁剪语义**的改动：

```ts
const userTextJsonLength = JSON.stringify(userText).length;
const fits = () => {
  const contextLength = JSON.stringify(context).length;
  return contextLength <= ACTOR_CONTEXT_LIMIT &&
    contextLength + userTextJsonLength + 24 <= ACTOR_INPUT_LIMIT;
};
```

`JSON.stringify({context,userText})` 的固定包装正好是 24 字符；因此第二个预算不再重复序列化 context。结果：

- JSON.stringify：435 → 290 次（-33%）；
- `actorContext`：约 3.95–4.04ms → 2.77–3.03ms/次（同夹具，单次样本，有波动）；
- 原 8 项 `actor-context.test.ts` 全部通过，包括 escape-heavy 预算和历史选择顺序测试。

没有继续做“增量长度累计”优化：它需要同时保持中文/转义/数组分隔和每个 append/pop 的精确长度，收益约 1–2ms/轮，语义风险高于本批价值；留作后续。

## 三个审查问题的修复

### 1. 旧邀约响应一致性

原完整读取会按 version 顺序对约定应用 `invitation.responded`。有界读取现在在约定合并后增加一条定向查询，只读取被选中 appointment ID 的响应事件，按 version 升序逐条调用原有领域函数 `applyInvitationEvent`：

- 接受 → confirmed；
- 取消 → cancelled；
- 改期 → 新时刻 + proposed；
- 到场/未到 → attended/missed；
- 写入 `responseAt`/`responseVersion`。

如果事件序列无法与投影/初始快照状态一致应用，抛 `ChatContextFallbackError(reason='invitation-reconciliation')`，由主 Agent 回退完整 hydrate；不猜测、不忽略旧事件。测试用“投影仍 proposed、响应只在事件流”的初始约定和运行约定各一条，验证有界读取与完整 `worlds.get` 都为 `cancelled`。

### 2. 初始约定不因终态窗口复活

初始约定仍全量读取，但不再直接信任其 proposed/confirmed 状态。响应核对会读取该 appointment 的全部历史响应并应用；即使该终态的投影行已经超出“最近 20 条终态”窗口，初始对象也会被覆盖为最终状态。测试中的作者初始约定在初始快照里是 proposed，历史事件里被取消；有界读取返回 cancelled，与完整读取一致，没有重新变成有效邀约。

### 3. 关键引用与事项证据不静默截断

- 调用方显式引用：上限 256；超过直接抛 `explicit-reference-limit` 回退，不截断。
- 人物 state 必需引用：上限 768；在范围内**全部精确读取**，不再按旧 256 截断；超过抛 `state-reference-limit` 回退。
- matter/choice 关联事件：上限 512；超过抛 `linked-evidence-limit` 回退。
- linked facts：按 `ordinal,id` 确定性排序，读取 `LIMIT 201` 探测；超过 200 条抛 `linked-evidence-limit` 回退，不静默漏掉结果。
- completeness 分别报告 `explicitRequested/Resolved/Unresolved`、`stateRequired/Resolved/Unresolved`、`deferredToExistingResolver`，不再只报告调用方显式引用。
- 测试：300 条 state 必需 message 引用全部取回；257 条显式引用回退；201 条额外事项关联事实触发 linked 回退。

## 接口真实性

- `ChatContextReadInput` 已删除未参与任何读取的 `inputText`。本读取**没有**实现“按本轮语义检索全部旧历史”；历史相关性仍由 `actorContext` 在有界候选窗口内排序，旧事项靠 durable state 与显式引用精准读取。
- `PrivateChatWorld` 不是完整 `WorldState`；省略的 facts/messages 不能由下游推断“从未发生”，completeness 与项目 prompt 都要求把省略视为未提供而非不存在。
- 媒体完成/失败/处理中不在本读取内，继续由原 `readActorMediaCompletionContext` 处理；显式 media/action 引用通过 `readPrivateAgentSnapshot` 的可选 `referencedSourceIds` 传入，不能绕过人物知情过滤。
- 其他人物私密 message/fact 在测试中既不出现在有界 world，也不通过显式引用泄露；不可见来源只报 unresolved。

## 主 Agent 接线方式

仅在聊天准备路径替换完整 hydrate；kernel commit、claim、流式、恢复继续使用原 `turnWorlds`/仓储。

```ts
import {
  readChatContextWorld,
} from '../modules/world/infrastructure/chat-context-read-repository.ts';
import {
  CHAT_CONTEXT_FULL_HYDRATE_REQUIRED,
} from '../modules/world/application/chat-context-read.ts';

let world: PrivateChatWorld;
let actor: ActorAgentState;
try {
  const contextRead = await readChatContextWorld(turnDb, ownerId, {
    worldId: command.worldId,
    actorId: command.actorId,
    // UI 明确回复/引用的旧消息、事实、约定、媒体/行动结果；可省略。
    referencedSourceIds: explicitReferencedSourceIds,
  });
  if (!contextRead.actorState)
    throw new NpcMessageError('INVALID_STATE', '人物状态尚未准备完成。', 409);
  world = contextRead.world;
  actor = contextRead.actorState;
  // 只把有界 world 用于 readPrivateAgentSnapshot 的准备阶段。
  const snapshot = await readPrivateAgentSnapshot(
    turnDb,
    ownerId,
    world,
    command.actorId,
    receipt,
    storyAt,
    actor,
    {
      referencedSourceIds:
        contextRead.completeness.referenced.deferredToExistingResolver,
    },
  );
  // 后续 claim/kernel.commit 仍使用原 turnWorlds 与完整状态重验。
} catch (error) {
  if ((error as { code?: string }).code === CHAT_CONTEXT_FULL_HYDRATE_REQUIRED) {
    // 历史 attendance 世界：回退原完整 hydrate + readPrivateAgentSnapshot。
  } else throw error;
}
```

接线要点：

1. 用 `contextRead.world.version` 作为 attempt 的 expected world version；用 `contextRead.actorState.revision` 作为 actor revision；不要再单独 `turnStore.read`（除非保留额外校验）。
2. `readPrivateAgentSnapshot` 新增可选的 `referencedSourceIds`，只用于把显式 media/action 引用交给原媒体 resolver；默认行为不变。
3. 捕获 `ChatContextFallbackError`（`code=CHAT_CONTEXT_FULL_HYDRATE_REQUIRED`）或该 code 时回退旧 `turnWorlds.get` 路径；`reason` 可用于日志，不要强行使用有界 world。
4. 不把有界 `PrivateChatWorld` 传给 kernel commit、recovery 或任何写路径。
5. `referencedSourceIds` 可由 UI 的回复目标、消息 ID、事实/约定/媒体结果 ID 构造；没有显式引用时省略。
6. 不需要新增队列、缓存或第二套状态源。

## 实际修改范围

新增：

- `src/modules/world/application/chat-context-read.ts`
- `src/modules/world/infrastructure/chat-context-read-repository.ts`
- `tests/integration/chat-context-bounded-read.test.ts`
- 本报告

类型/纯逻辑收窄：

- `src/modules/world/application/actor-context.ts`：`PrivateChatWorld` 类型 + 预算单次序列化；选择顺序/裁剪语义不变。
- `src/modules/world/infrastructure/agent-snapshot-repository.ts`：参数收窄为 `PrivateChatWorld`（`WorldState` 仍可直接传入），新增可选 `referencedSourceIds` 并传给媒体 resolver。
- `src/modules/world/domain/scene-matter-policy.ts`：`witnessedMatterResult` 参数收窄为 `Pick<WorldState,'id'|'facts'>`，行为不变。

未改：公共 SQL、迁移、服务入口、NPC 模型/协议、kernel、流式、claim/恢复、媒体生命周期、生产配置。

## 验证

- 新真实 PG 夹具：1/1 通过（含短对话、长历史、旧有效事项、旧引用、作者混合、他人隔离、媒体边界、缺失/不可见、旧邀约响应/初始约定终止、300 条持久引用、显式引用超限、事项证据超限、attendance 回退）。
- 代码提交：`8b99929f`（rebase 到 `551760f7` 后）；报告随后续 docs 提交冻结。
- `tests/actor-context.test.ts`：8/8 通过。
- 聚焦回归：`chat-latency-stage1`、`actor-media-result-context`、`actor-media-context-wiring`、`actor-situation` 及新增测试：**28/28 通过**。
- `npm test`：**3854/3854 通过，0 fail，0 skipped**。
- `npm run check:boundaries`：695 files 通过。
- `npm run typecheck`：0 errors。
- `npm run build`：通过。
- 0 真实付费模型、0 生产数据库写、0 部署。

## 风险、未完成与后续优化

1. **查询数在约定世界增加 1**：完整 hydrate 4 条；有界读取 5 条（多出邀约响应核对），无约定/短对话仍 4 条。减少的是行数/字节。若主 Agent 要进一步减往返，可把 messages/facts/appointments 用 JSON 聚合合并为 1–2 条，但会增加 SQL 复杂度，本批未做。
2. **本地耗时没有稳定下降**：单次夹具内 83–91ms vs 83–91ms，差异在噪声内。生产网络下 58% 字节减少可能有益，但本批不宣称延迟 SLA。
3. **媒体结果不在本读取内**：仍由原 `readActorMediaCompletionContext` 读取；接线需传 `referencedSourceIds`。现有媒体完成/失败/处理中测试保持通过。
4. **历史 attendance**：抛 `CHAT_CONTEXT_FULL_HYDRATE_REQUIRED`，必须回退完整 hydrate；这是有意的正确性保护，不是已完成优化。
5. **旧邀请响应**：已用原 `applyInvitationEvent` 逐条核对，并在无法一致应用时回退；真实旧档仍需主 Agent 验收，尤其是响应与 attendance/其他约定事件的交互。
6. **事实有界**：只读 genesis/legacy + 最近 80 + matter 关联 + 显式引用，不声称“世界中只有这些事实”。下游 prompt 已有“省略不代表不存在”约束；如发现某类旧事实对人物判断关键，应加入精确引用或专门关联，而不是把窗口调大。
7. **索引建议（公共 SQL 归主 Agent）**：
   - `world_messages(world_id,owner_id,actor_id,ordinal)` 支持按人物近期读取；
   - `world_appointments(world_id,owner_id)` 及必要时 `document->'participantIds'` GIN，支持人物约定筛选；
   - `world_facts(world_id,owner_id,ordinal)` 现有 `(world_id,ordinal)` 可覆盖大部分。
8. **Task B 进一步**：可做增量 JSON 长度跟踪，但需等价性测试；当前单次序列化已把 435 次降到约 290–294 次，剩余主要是每个候选的 `JSON.stringify(context)` 和 `append` 的数组上限检查。

## 接续点

- 当前：代码、测试、报告冻结，提交后主表标待验收。
- 主 Agent：审核契约/文件归属，切换 `npc-agent-services.ts` 准备阶段，保留 attendance fallback；跑真实模型私聊/长历史/索图验收，READY 与公网验证后部署。
- 未接线前，用户不会体验到本优化；不得宣称已上线。
