# 44-113 NPC 实质承诺与持久计划、责任的一致性修复报告

- **负责人**: `codex-ma44-113-commitment-q` (独立工作树 `npc-commitment113-i`，分支 `codex/npc-commitment113-i`)
- **基线**: `6514bd5ed1386fa528f15b1dc18dff4c366efb96` (前序 44-111 与 44-112 闭环)
- **独占范围**:
  - `src/modules/world/infrastructure/npc-agent-model.ts`
  - `tests/npc-agent-model.test.ts`
  - `tests/npc-commitment-state.test.ts`
  - `docs/task-reports/44-113-NPC-COMMITMENT-STATE-I.md`
- **公共约定**: 0 真实大模型调用，不修改公共调度、SQL、导演协议或生产数据库。

---

## 一、真实问题与根因

### 1. 真实问题
在上一轮真实大模型验收中，玩家与 NPC 商量分工：
- 玩家负责采购；
- NPC 回答应承负责准备饮料、在门口接待，并表示准备完成后会通知玩家；
- 玩家再次明确确认分工，NPC 也再次承诺；
- 但两轮提交后，该人物状态中的 `goals`、`plans`、`responsibilities`、`decisions` 仍全部为空。
- 导致系统只有口头对白，没有持续的执行责任；44-111 作者事件因缺少人物已确认的新计划语义依据而无法触发重新考虑，作者事件无法继续交由人物演绎。

### 2. 根因分析
- **底层流转完全健全**：
  - `agent-kernel.ts`（`validateAgentProposal`、`reduceActorAgentState`）具备完整的目标、计划、责任与玩家决定校验；
  - `agent-proposal-parser.ts` 具备完备的 JSON 反序列化及格式归一化；
  - `world-awareness.ts` 与 `authored-reconsideration-evidence.ts` 能够基于内核事件 `turn.resolved` 精准识别 `plan_changed` 与 `player_decision` 并作为 111 作者事件重评触发点；
- **缺失环节在 NPC 模型提示词指导协议**：
  - `npc-agent-model.ts`（旧 v15）在末尾仅给出了一个全空增量 `[]` 的短回复示例，缺乏对“作出实质承诺、分工安排”时的结构化输出协议约束；
  - 没有明确指导大模型在对话做出承诺时，必须在同一响应中输出带有明确状态的目标与计划；
  - 缺少玩家确认时将原话逐字引用（`quote`）记为 `PlayerDecision` 的强类型规范。

---

## 二、修复方案与实现

### 1. 升级 NPC Agent 提示词协议 (`npc-agent-model.ts`)
- **协议版本升级**：`NPC_AGENT_PROMPT_VERSION = 'npc-agent-v16-commitment-state'`；
- **明确愿望与承诺的严格界限**：
  - 闲聊、泛泛愿望、设想或未经商定的条件性建议（如“我想喝咖啡”、“或许我们可以……”）保持全空状态增量（`goals: []`, `plans: []`, `responsibilities: []`）；
  - 一旦作出明确承诺、答应分工或具体执行安排（如“我负责准备饮料并在门口接待”），必须在同一模型响应中提出：
    1. 本人的活跃目标（`goals`，`status: 'active'`，`sourceIds` 包含当前输入）；
    2. 关联执行计划（`plans`，`status: 'active' | 'waiting'`）；
    3. 若有交代事项或等待通知，提出明确的责任（`responsibilities`，`waitingOn: 'self' | 'player'`）；
- **玩家决定判断规范 (`PlayerDecision`)**：
  - 当且仅当玩家在当前输入原话中对分工/责任做出明确答复（确认、接受、拒绝、暂缓）时，才记录对应的 `PlayerDecision`；
  - 严禁脑补或篡改，`quote` 必须是玩家当前原话的逐字切片；
- **持久身份不可变性与历史延续 (`SOURCE_HISTORY_IMMUTABLE`)**：
  - 更新已有计划或责任时，必须沿用已有 `id`，且新 `sourceIds` 必须包含全部历史来源；
  - 未发生变动的历史对象不得重复输出；
- **对白与提案强一致性**：
  - 未执行成功的动作不得声称成功（受 `dependsOnActionIds` 约束）；
  - 不能把缺少有效计划的“已安排成功”当作完整成功，也不能伪造执行结果；
- **三场景标准示例**：在提示词中提供闲聊全空增量、承诺分工提议目标与计划、玩家确认后记录决定的标准合法 JSON 结构。

### 2. 专项测试与全链路回归
- `tests/npc-agent-model.test.ts` (27/27 pass):
  - 覆盖 v16 版本提示词语义、愿望与承诺区分、目标计划提示词规则、玩家决定逐字切片规范。
- `tests/npc-commitment-state.test.ts` (6/6 pass):
  - **测试 1**: 明确分工后 NPC 计划与责任持久保存并成功进入状态，验证 `reduceActorAgentState` 与 `committedAwarenessDelta` 正确记录状态增量；
  - **测试 2**: 普通闲聊与愿望保持空增量，不误建责任；
  - **测试 3**: 明确拒绝、暂缓和无关话题不误判为接受；
  - **测试 4**: 同一承诺复用已有 ID，违反 `SOURCE_HISTORY_IMMUTABLE`（遗漏历史 `sourceId`）被内核严格拒绝；
  - **测试 5**: 原入口产生的新计划能作为 44-111 作者事件重评依据（`plan_changed`），无新计划时不循环触发；
  - **测试 6**: 依赖未执行 action 报错 `UNKNOWN_STATEMENT_DEPENDENCY`，缺失结果的 goal fulfillment 报错 `GOAL_RESULT_REQUIRED`，未知调用结果（`unknown_after_send`）受恢复栅栏保护。
- `tests/agent-kernel.test.ts` (45/45 pass):
  - 全部内核与运行时回归用例保持全绿。
- **静态检查**:
  - `npm run check:boundaries`: 600 文件全部通过，无边界违规；
  - `npx tsc --noEmit`: 严格通过，0 类型错误。

---

## 三、真实调用链路径

```
玩家输入 ("你负责饮料，在门口接待，完成后告诉我")
  │
  ▼
npcAgentModel.generateProposal(context)
  │ (带 v16 协议约束，同次产出对白与结构化提案)
  ▼
parseAgentProposal(context, rawOutput)
  │ (校验 JSON 格式、规范化对象、保持未知调用安全)
  ▼
validateAgentProposal(context, proposal)
  │ (严格校验 sourceIds 来源、dependsOnActionIds、目标与责任状态约束)
  ▼
reduceActorAgentState(context, proposal, actionResults, worldVersion)
  │ (原子合并 goals/plans/responsibilities/decisions 到 ActorAgentState)
  ▼
AgentKernel.commitTurn() -> WorldEvent ('turn.resolved')
  │
  ▼
committedAwarenessDelta(world, event, ...)
  │ (产生 plan_changed / player_decision 语义原因)
  ▼
authored-reconsideration-evidence.ts (44-111 重新考虑依据解析)
  │
  ▼
让仍符合条件的未演作者事件重新获得一次评估机会，交由人物后续演绎
```

---

## 四、约束与交付状态

1. **未引入旁路引擎**：完全复用原 NPC Agent、Parser、Kernel、Awareness 与 44-111 链路；
2. **未引入未来时态正则表达式扫描**：不通过任何关键词将聊天自动升级为计划；
3. **未引入额外大模型调用**：一次调用同时输出对白与承诺状态增量；
4. **0 API 费用与 0 生产改动**：开发与测试全程使用本地受控断言与模拟，未调用真实大模型，未操作生产数据库；
5. **接续说明 (OPEN)**：
   - 当前已完成代码协议与本地全链路测试闭环，交付给主 Agent 集成；
   - 生产环境中需由主 Agent 在后续带有正式大模型额度的受控集成中，真实触发分工对白，核验端到端模型理解与状态落库表现。
