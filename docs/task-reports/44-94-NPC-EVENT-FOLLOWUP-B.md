# 44-94-NPC-EVENT-FOLLOWUP-B 任务报告：NPC 计划与责任后续维护（审查修复）

- 任务 ID：`44-94-NPC-EVENT-FOLLOWUP-B`
- 角色：`codex-npc-followup94-b`（NPC 计划与责任后续 B）
- 状态：`[ ] 待验收`
- 工作树：`/Users/limengzhe/.codex/worktrees/npc-followup94/人生剧本`
- 分支：`codex/npc-followup94`
- 基准提交：`81c0719f874fa627bcfd9d0f902316b6a278fbf9`
- 修复代码提交：`208d63295b93f77df34a2e87c0410ff0a45e7f60`
- 强化测试提交：`5185d08b1a8d05e55e0be880ebcbbe50efd02ce3`
- 合规范围：全新领域模块与聚焦测试，0 公共核心修改，0 生产世界切换，0 真实模型付费调用，0 用户数据修改。

---

## 1. 本轮审查反例与修复说明

本次修复严格基于审查意见，先补充针对性反例回归测试，再完成纯领域实现修复：

### 1.1 矛盾 1：travel 与到达证据不能推导现场执行与事件完成
- **问题**：原代码在 `travel.begin` 成功且存在 `arrived` 记录时，结合 actionResult 自动将 `incidentStatus` 推导为 `completed` 并置 `canFulfillGoal = true`。
- **修复**：
  - 到达现场与路程开始仅代表到达证据，**绝不能判定现场已执行、整段事件完成或目标完成**（`sceneExecuted = false`，`canFulfillGoal = false`）；
  - 在缺少明确的整体结果规则时，状态保持为 **“整体结果未知”**（`incidentStatus: 'unknown'`），绝不自行推导完成；
  - 即使 trustedResults 中包含 `travel.begin` 成功结果，也绝不将其当作 sceneExecuted；
  - 只有当外部运行时提供明确授权的整体事件决议（`overallResolution.resolved && outcome === 'succeeded'`）时才允许完成；目前内核尚无整体完成规则，因此一律保持未知与不可完成。

### 1.2 矛盾 2：玩家旧决定与请求版本不一致时不得沿用
- **问题**：原代码依据文本或旧 decision 判定接受，未核验 `responsibilityRevision` 与当前请求版本及来源。
- **修复**：
  - 严格复用原内核当前决定规则：核验 `(playerDecision.responsibilityRevision ?? 0) === (responsibility.revision ?? 0)`；
  - 若旧决定的版本与当前责任版本不一致（例如邀约已改期或参数已更新），即使本次玩家文本输入包含“好”，也**绝对不能沿用旧接受**，返回 `unrelated`，责任保持不被错误核销；
  - 严格校验 `playerDecision.sourceId === inputSourceId`，保证必须由本次玩家输入产生；
  - 支持传入 `context` 与 `proposal`，直接委托给原内核权威的 `currentPlayerDecision` 纯函数，彻底废除任何 ad-hoc 文本正则推导。

### 1.3 核心边界校正
- **真正的 episodeId**：`subject.kind === 'episode'` 时严格校验必须传入真正的 `episodeId`，若填入 `requestId` 则抛出 `INVALID_EPISODE_ID` 异常。
- **邀请计划不循环等待**：发出邀请的计划（`appointment.propose`）不再将“玩家接受邀请”作为发送邀请的前提条件，避免 NPC 尚未发出邀请却先死等玩家接受的循环依赖。
- **engage 不自动发明计划**：NPC 作出 `engage` 决策时，若提案中没有明确的计划或行动，坚决不自动编造计划，明确保留为“尚无可执行安排”（`plans: []`, `actions: []`，责任标明 `尚无可执行安排`）。
- **禁止自行增版本与复活已结束责任**：
  - 移除自行 `revision + 1` 逻辑，版本号严格由内核统一分配；
  - 尝试调整已处于终态（`fulfilled` / `withdrawn` / `expired`）的责任时抛出 `CANNOT_REVIVE_ENDED_RESPONSIBILITY`；
  - 移除任何耐性、等待轮数等统一模板化情绪反应，严格遵循人物明确提出并经内核授权的内容。
- **与 44-94-Q 职责划分**：
  - 44-94-Q（`projectEpisodeParticipationLifecycle`）为**只读生命周期视图**，负责在事务已提交后投影当前态势与重查依据；
  - 本模块（44-94-B `episode-followup.ts`）为**决策与响应推进时的纯领域状态规划辅助**，两者语义对齐（如 `engage` 无安排对应 `followUp: none`，`subject.kind='episode'` 对应 `episodeId`），杜绝第二套调度器或状态解释。

---

## 2. “纯组件已实现” 与 “运行时已接入” 对照

| 领域能力 | 纯组件已实现（44-94-B） | 运行时已接入（需主 Agent 接线） |
|---|---|---|
| **暂缓等待无硬期限** | ✅ 已实现：无合法授权 deadline 时保持 undefined，保留 missingConditions 与 triggers | ⏳ 待接线：NPC 评估后随事务保存至数据库 |
| **安静保存计划去向** | ✅ 已实现：quiet 决策不发台词但保存责任与触发钩子 | ⏳ 待接线：内核调度器收集候选时唤醒 |
| **engage 尚无可执行安排** | ✅ 已实现：无提案时 plans 为空，明确标明无安排 | ⏳ 待接线：后续导演/NPC 生成具体提案后挂接 |
| **邀请计划无循环等待** | ✅ 已实现：移除发送邀请前提中对玩家接受的循环依赖 | ⏳ 待接线：appointment.propose 执行链路 |
| **版本核验与防旧接受冒充** | ✅ 已实现：严格要求 responsibilityRevision 与 inputSourceId 一致，否则不消耗责任 | ⏳ 待接线：私聊/现场收到玩家消息时传入 context 校验 |
| **禁止复活终态责任** | ✅ 已实现：withdrawn/fulfilled/expired 责任拒绝再调整 | ⏳ 待接线：应用层服务拦截非法调用 |
| **子步骤不等于事件完成** | ✅ 已实现：travel 与 arrived 保持 unknown，canFulfillGoal 严格为 false | ⏳ 待接线：SharedEpisode 真实生命周期状态流转规则 |
| **真实模型自然演绎** | ❌ 未接入（纯领域纯测试，0 真实模型） | ⏳ 待全链路贯通后统一验收 |
| **生产世界切换** | ❌ 未启用（生产仍保留旧引擎 epoch2=0） | ⏳ 待主 Agent 全面集成后统一发布 |

---

## 3. 验证证据（17 项聚焦测试全绿）

在独立工作树中执行 `node --experimental-strip-types --test tests/episode-followup.test.ts`：
```
✔ subject.kind="episode" references genuine episodeId and rejects requestId
✔ deferral saves missing conditions, waiting targets, and does not invent hard deadlines without source authority
✔ deferral preserves authorized deadline when provided explicitly in source
✔ need_information creates responsibility waiting on player with explicit missing condition
✔ quiet decision emits no statements but preserves durable plan and responsibility
✔ explicit decline withdraws responsibility and goals to avoid repeated invitations
✔ engage without explicit actor proposal does NOT invent plans or actions, retains no executable arrangement
✔ invitation proposal plan does not require player acceptance as precondition to propose
✔ player acceptance on matching revision transitions responsibility to open, NOT fulfilled
✔ player decision with mismatched responsibilityRevision cannot be applied even if text says "好"
✔ player refusal withdraws responsibility and disallows repeated invitation
✔ cannot revive or modify already-ended responsibilities
✔ travel.begin success and arrival evidence DO NOT prove scene executed, incident completed, or goal fulfilled
✔ declined invitation marks incident as terminated_declined and blocks goal fulfillment
✔ re-evaluation triggers candidate when deferred condition is satisfied
✔ travel.begin action result success plus arrived record DOES NOT set sceneExecuted or complete incident
✔ currentPlayerDecision kernel rule integration: revision mismatch in context rejects old decision, matching proposal decision is accepted
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
```

- `npm run check:boundaries`：579 文件全部合规；
- `npm run typecheck`：TypeScript 严格类型检查 0 错误；
- `npx prettier`：格式化通过。

---

## 4. 仍需主 Agent 完成的接线清单

主 Agent 在集成修复提交 `208d6329` 与测试提交 `5185d08b` 时，需完成以下接线：
1. **NPC 考虑后事务提交**（`npc-agent-kernel.ts`）：
   ```ts
   import { planEpisodeFollowup } from '../domain/episode-followup.js';
   // 传入 genuine episodeId 与 actorProposal（若无提案则为 null）
   const followup = planEpisodeFollowup({
     state,
     decision,
     intent,
     episodeId: request.episodeId, // 必须是 genuine episodeId
     proposal: proposal,           // 若无提案，plans 为空，责任记录“尚无可执行安排”
     sources,
     storyAt,
     worldVersion,
   });
   ```
2. **玩家消息消费与责任核销**（私聊/群聊接收处）：
   ```ts
   import { evaluatePlayerResponse } from '../domain/episode-followup.js';
   // 传入当前 turn 的 inputSourceId 以及 context/proposal，严格核验版本
   const evalResult = evaluatePlayerResponse({
     responsibility: resp,
     playerDecision: decision,
     inputSourceId: incomingMessage.sourceId,
     sources: authorizedSources,
     context: validationContext,
     proposal: incomingProposal,
   });
   if (evalResult.effect !== 'unrelated') {
     // 仅在匹配当前版本与来源时更新责任
   }
   ```
3. **整体事件结果规则**：
   当前架构下尚未存在 SharedEpisode 整体完成并提交的事务规则；主 Agent 在未来实施整体事件决议时，再提供 `overallResolution`，在此之前保持到达不等于完成。
