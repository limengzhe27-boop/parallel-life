# 44-88-ARCH-VERIFY-01-Q 多 Agent 架构重构独立验证与问题定位报告

- **任务 ID**: `44-88-ARCH-VERIFY-01-Q`
- **Agent ID**: `codex-ma44-arch-verify88-q` (验收 Q)
- **检查基准提交**: `f351e221fe25fa4a57daf09ecd8629d2cf966ffd`
- **已部署业务代码**: `35ac28540b9355e930bdc8796bebf85b08e0fea6` (Vercel 部署 `dpl_4fJ7HthK3Tr9gMDH4mWZjVTve9mN`)
- **工作树与分支**:
  - 主登记目录: `/Users/limengzhe/Desktop/projects/demo/人生剧本` (分支 `main`)
  - 集成工作树: `/Users/limengzhe/.codex/worktrees/history-chat-media/人生剧本` (分支 `codex/ma-arch44-integration`)
- **权限边界与约束**: 公共核心代码、生产数据库、公共 SQL/配置保持只读；0 生产世界切换，0 真实模型付费调用，0 用户存档修改。

---

## 一、实际检查的提交、工作树与入口对照

### 1. 提交与工作树核验
- **基线版本**: `origin/main` 位于 `f351e221`，已部署业务代码为 `35ac2854`。
- **集成工作树**: `/Users/limengzhe/.codex/worktrees/history-chat-media/人生剧本` 处于 `codex/ma-arch44-integration`，代码与 `f351e221` 对齐。
- **关联并行分支**:
  - `codex/episode-evidence88` (44-88A)
  - `codex/knowledge88` (44-88B)
  - `codex/phone-continuation86` (44-86)
  - `codex/phone-ui-fixture87` (44-87)

### 2. 四种状态对照表（源码存在 / 入口接通 / 本地验证 / 生产启用）

| 功能链路 | 源码存在 | 真实入口接通 | 本地验证状态 | 生产启用状态 | 说明与回退条件 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **私聊入口** (`POST /api/v1/worlds/[id]/messages`) | ✅ 是 | ✅ 是 | ✅ 通过（本地 Mock） | ❌ 未启用 (`epoch < 2`) | `epoch=1` 回退至 `resolveTurn` + 旧版 `publicationCharacterPlanner`；仅 `epoch>=2` 走 `npcAgentServices.sendMessageIfEnabled`。生产正式世界数严格为 0。 |
| **群聊入口** (`POST /api/v1/worlds/[id]/groups/[id]/messages`) | ✅ 是 | ✅ 是 | ⚠️ 部分通过 | ❌ 未启用 (`epoch < 2`) | 由 `runGroupOwnedTask` 执行 `nativeNpcTaskHandler`，但多 NPC 且无 `@`/无问题时会崩溃抛出 `DIRECTOR_COORDINATION_REQUIRED`。 |
| **现场入口** (`POST /api/v1/worlds/[id]/scenes/[id]/actions`) | ✅ 是 | ✅ 是 | ⚠️ 部分通过 | ❌ 未启用 (`epoch < 2`) | `SceneTaskInput` 驱动 `nativeNpcTaskHandler`，现场在场由 `scenePresent` 判定，但地点授权与历史到场记录缺少出版稿完备衔接。 |
| **统一推进** (`POST /api/v1/worlds/[id]/advance`) | ✅ 是 | ✅ 是 | ✅ 通过（本地 Mock） | ❌ 未启用 (`epoch < 2`) | `advanceWorld` 优先调用 `agentAdvance.advanceIfEnabled`。若返回 null 则降级回旧开场/推进。 |
| **开场接管** (`POST /api/v1/worlds/[id]/opening`) | ✅ 是 | ⚠️ 局部 | ⚠️ 部分通过 | ❌ 未启用 | `readNpcAgentOpeningStatusIfEnabled` 返回 `runtime: 'agents'`，但开场剧本尚未接入原生导演推进（诚实返回 `unplanned`）。 |

---

## 二、已实现且验证通过的能力

结合代码审查及本地自动化单元/集成测试证据（如 `agent-kernel.test.ts`、`agent-questions.test.ts`、`agent-travel.test.ts`、`clock-activity.test.ts`）：

1. **确定性状态与责任持久隔离**（场景 2 核心）
   - **事实**: NPC 拥有全局统一且唯一的持久状态记录 `parallel_life.actor_agent_states`，由 `(world_id, owner_id, actor_id)` 唯一索引，私聊、群聊、现场均读写同一状态。
   - **证据**: `src/modules/world/infrastructure/agent-runtime-repository.ts` 与 `src/modules/world/domain/agent-kernel.ts` 严格通过 `reduceActorAgentState` 进行 CAS 校验，跨渠道目标与责任完全持久化。

2. **严格知情边界与隐私防泄漏**（场景 6）
   - **事实**: 角色无法读取其他人的私聊原话，也无法读取玩家在地图上的全量真实坐标。
   - **代码证据**:
     - `src/modules/world/infrastructure/agent-source-resolver.ts:69`: `private_strategy` 来源仅保留不透明 ID 与状态摘要，剥离原始对话原文。
     - `src/modules/world/infrastructure/world-awareness-repository.ts:298`: 位置感知严格依赖 `actor_position_knowledge` 中 `observer_actor_id=$3`，只有同地点亲眼目击或玩家在对话中直接告知（`player_report`）才具备感知来源。

3. **内核级防伪造与责任消耗保护**（场景 4）
   - **事实**: NPC 无法单凭对话宣称“我去处理了”来闭环责任，无关闲聊（如天气、问候）绝不会错误消耗邀约或完成目标。
   - **代码证据**:
     - `src/modules/world/domain/agent-kernel.ts:418-420`: `responsibility.status === 'fulfilled'` 强制要求 `resolutionResultId`，且对应能力结果必须由可信内核执行器返回 `succeeded`。
     - `src/modules/world/domain/agent-kernel.ts:430-437`: `PlayerDecision` 强制校验 `context.input.text.includes(decision.quote)`，杜绝无据判定。

4. **决策分支精细记录**（场景 5）
   - **事实**: 系统在数据结构与内核校验中已区分 `accepted`、`declined`、`negotiating`、`deferred`、`undecided`，以及责任的 `open`、`waiting`、`expired` 等生命周期。
   - **测试证据**: `tests/agent-questions.test.ts` 30 项全通；明确拒答（`decline_to_answer`）不等于拒绝邀约，暂缓（`defer_answer`）保持问题处于 `open`。

5. **幂等性、并发防护与防重付保护**（场景 7）
   - **事实**: 消息入库通过 `(world_id, owner_id, command_id)` 强幂等；一旦 attempt 标记 `paid`（`sent_at != null` 或 `response_hash != null`），绝不重买或重跑；已成功的 attempt 重复调用直接重放。
   - **代码证据**: `src/modules/world/infrastructure/agent-runtime-repository.ts:270-273`。

6. **业务时钟流速与离开暂停机制**（场景 8）
   - **事实**: 手机端浏览时为 12 倍速（`BROWSING_SPEED = 12`），进入会话时放缓为 1 倍速（`CONVERSATION_SPEED = 1`），离开或失活后租约到期自动暂停（`active_until = NULL`, `paused = true`）。
   - **验证证据**: `src/modules/world/infrastructure/clock-activity-repository.ts:281-302`；Ego203 浏览器留存凭据 `phone84-ui-browser-proof.json` 显示切后台真实触发暂停。

---

## 三、已实现但验证失败的问题（附最小复现与代码位置）

### ❌ 问题 1：群聊多 NPC 场景下无提问/无点名时任务直接崩溃抛错，缺少导演协调兜底
- **代码位置**:
  - `src/server/npc-agent-channel-services.ts:88-90`
  - `src/server/group-services.ts:55-63`
- **问题根因**:
  在群聊包含 2 位及以上 NPC 时，若玩家发出的短答或普通闲聊既不包含 `@NPC`，也不属于任何已知问题的答案，且没有绑定唯一的 matter 负责人，`nativeResponder` 直接执行：
  ```ts
  const actors = unique(input.actorIds);
  if (actors.length === 1) return actors[0]!;
  throw new DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED');
  ```
  在 `runGroupOwnedTask` 中，执行器未捕获此异常，也尚未接线群聊导演协调器，导致该队列任务直接以异常失败退出，群聊所有 NPC 均陷入沉默并卡死。
- **最小复现**:
  1. 创建包含 NPC 甲、NPC 乙和玩家的群聊；
  2. 既没有挂起问题，玩家也不带 `@`，直接在群内发送“大家好”或“有人在吗”；
  3. 执行 `POST /api/v1/worlds/[id]/groups/[groupId]/messages` 后 worker 调度 `runGroupOwnedTask`；
  4. **结果**: 抛出 `DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED')`，任务状态变为失败，没有任何 NPC 回复。

### ❌ 问题 2：群聊/现场责任承接人筛选仅识别 `matter`，遗漏 `appointment` 与 `request`
- **代码位置**:
  - `src/server/npc-agent-channel-services.ts:75-87`
- **问题根因**:
  `nativeResponder` 在无显式提及和提问时，试图通过未完成责任挑选响应者，但代码中硬编码为：
  ```ts
  const responsible = unique(
    input.states
      .filter((state) =>
        state.responsibilities.some(
          (r) =>
            !['fulfilled', 'withdrawn', 'expired'].includes(r.status) &&
            r.subject.kind === 'matter' &&
            input.relatedMatterIds.includes(r.subject.id),
        ),
      )
      .map((state) => state.actorId),
  );
  ```
  多 Agent 交互中，最核心的人际责任是 `appointment`（私聊达成的见面/邀约）与 `request`（请求协助）。此处由于过滤了除 `matter` 以外的所有责任，导致玩家在群里跟进约定（例如“我们待会儿在咖啡馆见”）时，本应承接该邀约的 NPC 无法被识别，直接跌入上述问题 1 的异常中。
- **最小复现**:
  1. NPC 甲在私聊中与玩家达成邀约，甲身上存在 `status: 'open'`, `subject: { kind: 'appointment', id: 'app-1' }` 的责任；
  2. 玩家在有甲和乙的群里发送关于该见面的询问；
  3. **结果**: `r.subject.kind === 'matter'` 条件不成立，`responsible` 为空，系统抛错未能由甲承接。

### ❌ 问题 3：开场未全部呈现时玩家主动私聊，未同步注销待投递项导致开场与对话时序冲突
- **代码位置**:
  - `src/modules/settings/application/advance-publication-opening.ts:77-140`
  - `src/server/npc-agent-advance-services.ts:101-115`
- **问题根因**:
  开场阶段剧本可能为 NPC 乙排队了一条开场问候（记录于 `publication_opening_deliveries` 中，状态为 `queued`）。若玩家在乙发信前抢先主动在私聊中给乙发送消息：
  1. 玩家私聊以更高版本提交并生成了新的对话上下文；
  2. 后续时钟推进触发 `advancePublicationOpening` 时，乙的 `queued` 条目仍会被 `claimNext` 认领并执行；
  3. 导致乙在已经与玩家产生真实对话后，又莫名其妙向玩家投递了一条预设的“初次开场来信”，上下文前后矛盾；
  4. 在 `epoch2` 下，开场状态目前仅为直通探针（`npc-agent-advance-services.ts` 诚实标注 `runtime: 'agents'`, `phase: 'unplanned'`），尚未与原生多 Agent 事件闭环。
- **最小复现**:
  1. 初始新世界开场包含甲、乙两人，甲已发出开场白，乙处于 `queued`；
  2. 玩家直接在微信中主动给乙发送私聊“你在忙什么”并获得回复；
  3. 随后触发自动推进或后台开场推进；
  4. **结果**: 乙的旧开场任务依然被唤醒并发送，产生时序倒错的开场白。

---

## 四、明确尚未实现的能力（对应各架构门槛）

根据总表与规范，以下核心模块属于**明确未实现**，不应在本次当作已完成测试：

1. **普通自然语言事件的逐人语义交接（门槛 67）**：
   目前普通事件的生命周期尚未闭环，依赖特定来源或旧 handled 拦截，缺乏自然语言事件向各受影响 NPC 的定向知情分发。
2. **事件实际发生、结果、结束及重新考虑的生命周期（门槛 68）**：
   目前仅有局部 `appointment` 和 `journey` 的结果认证，通用物理事件、现场事件从“提议→进行→实际产生外部结果→各方知情→关闭责任”的全生命周期未完备。
3. **旧存档迁移与旧入口彻底退役（门槛 53）**：
   生产环境目前仍运行 `epoch=1` 的旧引擎，旧版 `publicationCharacterPlanner` 和旧版 `advanceWorld` 仍保留为生产兜底，新旧存档双向兼容与无感平滑迁移尚未就绪。
4. **知情传播与可观察性系统（门槛 88B）**：
   跨场景事件的目击者认知与耳闻传播（`codex/knowledge88`）仍在独立分支构建中，尚未合入主线。

---

## 五、未验证及原因

1. **真实大模型自然语言演绎质量**:
   - **原因**: 本次排查严格遵循零新授权模型额度约束，所有自动化测试与探针均采用确定性本地替身（Mock / Deterministic Stub）。因此，未验证真实 LLM 在长文本上下文下的角色人设保持度、指令遵循度与对白拟真度。
2. **生产环境正式世界的跨渠道端到端链路**:
   - **原因**: 生产数据库中所有正式世界的 `engine_epoch` 严格保持为 `1`（生产正式启用数为 0），新引擎未在生产开放，严禁擅自修改生产数据进行不可逆验证。

---

## 六、推荐主 Agent 优先修复的三项问题

针对上述排查出的阻碍新引擎推进的关键缺陷，建议主集成人按以下优先级安排修复：

1. **【优先级 P0】为群聊 `nativeResponder` 补齐导演协调分发或兜底降级，防止多 NPC 群聊崩溃**
   - **范围**: `src/server/npc-agent-channel-services.ts` & `src/server/group-services.ts`
   - **目标**: 当多 NPC 群聊无法通过 `@` 或挂起问题确定单一发言人时，不直接抛出未捕获的 `DIRECTOR_COORDINATION_REQUIRED`，而是交由导演 Agent 评估“谁最有发言动机”或“是否全员保持安静”，确保任务平稳返回。

2. **【优先级 P1】扩展 `nativeResponder` 的责任识别范围，涵盖 `appointment` 与 `request`**
   - **范围**: `src/server/npc-agent-channel-services.ts:75-87`
   - **目标**: 将 `r.subject.kind === 'matter'` 放宽为支持 `['matter', 'appointment', 'request']`，使私聊达成的约定与委托能够在群聊和现场被对应责任 NPC 自然承接。

3. **【优先级 P2】实现开场待投递项的主动会话对冲机制（开场与私聊互斥闭环）**
   - **范围**: `src/modules/settings/application/advance-publication-opening.ts` 与 `src/modules/settings/infrastructure/publication-opening-repository.ts`
   - **目标**: 当玩家主动与某位尚有开场待发信任务的 NPC 建立私聊时，自动将该 NPC 在 `publication_opening_deliveries` 中的条目标记为已满足或已对冲（superseded），防止后续重复吐出生硬开场白。
