# 44-114 人物承诺真实数据库连续旅程与导演重评接线验证报告

- **负责人**: `codex-ma44-114-journey-q` (独立工作树 `npc-commitment114-journey-q`，分支 `codex/npc-commitment114-journey-q`)
- **基线**: `44b10ce695e67efc04cc1916623b3aac1c2f0952` (已冻结的 44-113 提示词与协议交付)
- **独占范围**:
  - `tests/integration/npc-commitment-journey.test.ts`
  - `docs/task-reports/44-114-NPC-COMMITMENT-JOURNEY-Q.md`
- **公共约定**: 0 真实大模型调用，不修改公共调度、SQL、导演协议或生产数据库。

---

## 一、交付说明与证据边界区分

为纠正上一轮交付说明中可能造成的误解，特别明确不同层级测试所证明的真实边界：

### 1. 44-113 领域测试 (`tests/npc-commitment-state.test.ts`) 已证明什么
- **已证明**：
  - 纯领域层（Kernel / Parser / Awareness / Proposal）在接收到包含 `goals`、`plans`、`responsibilities`、`decisions` 的结构化提案时，能够严格通过合法来源校验（`sourceIds` 存在性）、`SOURCE_HISTORY_IMMUTABLE`（保留全部历史来源）、`AgentValidationError`（非法状态与未执行依赖拦截）；
  - `reduceActorAgentState` 正确将增量提案规约至人物内存状态 `ActorAgentState`；
  - `committedAwarenessDelta` 在计划发生变动时能够产出 `plan_changed` 语义原因，在后续无变动时产出空增量以防自循环唤醒。
- **未证明**：
  - 该测试使用受控手写提案，属于领域纯逻辑单测；**不能称为真实数据库持久化测试**，也**不能证明真实大模型在实际推理中会自动按规范输出完整提案**。

### 2. 本次真实数据库连续旅程 (`tests/integration/npc-commitment-journey.test.ts`) 已证明什么
- **已证明**：
  - 使用项目现有本地真实 PostgreSQL 测试设施（port 55432），通过原人物应用服务（`npcAgentServices.sendMessageIfEnabled`）、原真实仓储（`PostgresAgentRuntimeRepository`、`PostgresWorldRepository`）与原真实事务（`PostgresNpcAgentKernel`）：
    1. **真实落库**：玩家发送分工指令，受控模型适配器一次返回对白与结构化提案后，原事务原子写入：
       - `parallel_life.actor_agent_states`：目标、计划与责任持久化至 `document`，`revision` 递增；
       - `parallel_life.world_events`：`type = 'turn.resolved'`，`data.agentRuntime.stateAfter` 完整包含新计划；
       - `parallel_life.agent_input_receipts`：记录不透明玩家输入凭据与哈希；
       - `parallel_life.agent_attempts`：状态由 `reserved` 推进至 `committed`。
    2. **44-111 导演唤醒重评接线**：原 111 架构链路（`readDirectorNarrativeWakeInTransaction`）从真实提交的计划变化中精准捕获 `plan_changed` 语义原因，为原候选事件 `service_event` 产生带 `authored_eligibility` 的导演唤醒依据；
    3. **导演提议与人物独立参与**：原导演运行入口（`npcAgentAdvanceServices.advanceIfEnabled`）基于该依据提出事件机会，派发给对应参与 NPC，NPC 独立决定参与（`npc_episode_consideration` -> `choice: 'engage'`），成功创建活跃事件（`parallel_life.shared_episodes` 状态为 `active`）；
    4. **未伪造完成**：事件保持活跃状态，未直接在数据库中将事件标记为已演或完成；
    5. **幂等与防重买**：相同消息指令重放时，应用服务直接返回已有 `committed` 事件，0 模型调用，数据库未产生重复目标或责任；后续导演推进在无新唤醒依据时不重复购买模型调用。

### 3. 真实大模型尚未证明什么
- **尚未证明**：
  - 真实在线大模型在生产对话中，面对玩家商量分工时，是否一定会稳定遵循 v16 协议在同一次输出中给出完备的结构化 `goals` / `plans` / `responsibilities` 提案，仍待未来授权测试中以真实模型验收；
  - 大模型在面对复杂长对话时，对白用词与结构化计划语义的精细一致性（例如会不会出现对白答应了A但计划填了B）尚未经大量在线样本检验。

---

## 二、关键缺口检查：模型仅返回对白而无提案时的已有行为与边界限制

针对“如果模型只返回‘我会准备饮料’等对白，却没有状态提案，当前系统如何处理”的关键问题，通过本次真实库测试 Step 1 专门进行了实测验证，行为明确如下：

1. **当前系统实际处理过程**：
   - 玩家发送分工指令，模型仅返回口头对白 `"我会准备饮料并在门口接待你。"`，而 `goals: []`, `plans: []`, `responsibilities: []`；
   - 系统将该响应作为合法交谈对白提交入库，`actor_agent_states` 保持全空，`parallel_life.world_events` 记录了对白事件；
   - `readDirectorNarrativeWakeInTransaction` 评估时，由于计划无变化，返回 `cause: null`，未生成任何作者事件唤醒依据；
   - 导演不会被触发，作者事件不会被重评。
2. **已有严格边界与设计限制落实**：
   - **不能通过关键词扫描补计划**：系统不存在任何针对“我会……”、“愿意……”等未来时态正则扫描逻辑，绝对不将聊天对白自动伪造为状态对象；
   - **不能额外调用第二个模型抽取**：系统不开启旁路抽取模型，避免引入双重费用和非权威旁路逻辑；
   - **不能把口头承诺当作已执行**：口头台词绝不影响责任生命周期，未完成的计划绝不标记为完成；
   - **不能把未知付费结果自动重试**：保留原有 CAS 事务与恢复栅栏（`unknown_after_send`），不盲目重买；
   - **保持诚实状态**：提示词升级至 v16 强化了指导与示例，但无法消除大模型的概率随机性；当大模型出现口头答应但未提议状态时，系统诚实保持状态不变，不凭空补洞，也不产生虚假唤醒。
3. **架构与接线结论**：
   - 真实数据库连续旅程证明：现有人物应用服务、仓储、内核事务、感知差量以及 111 导演唤醒重评的**底层接线完全健全、闭环且正确**。
   - 本次无须修改公共内核、协议、调度或 SQL，避免为了增加代码而引入不必要的架构膨胀。

---

## 三、真实数据库连续旅程验证证据

- **测试文件**: `tests/integration/npc-commitment-journey.test.ts`
- **运行命令**:
  ```bash
  node --experimental-strip-types --test tests/integration/npc-commitment-journey.test.ts
  ```
- **运行结果**:
  ```
  ✔ NPC commitment journey: player division of labor -> real DB persistence -> 111 authored reconsideration -> director proposal -> NPC engagement (1721.845167ms)
  ℹ tests 1
  ℹ suites 0
  ℹ pass 1
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 2173.239416
  ```
- **静态检查**:
  - `npm run check:boundaries`: 600 文件全部通过，0 越界；
  - `npx tsc --noEmit`: 严格通过，0 错误。
- **环境安全**: 0 真实大模型调用（0 费用），0 生产数据库改动，0 生产配置影响。

---

## 四、接续与后续步骤 (OPEN)

1. **主 Agent 集成点**:
   - 建议主 Agent 集成独立分支 `codex/npc-commitment114-journey-q`；
   - 包含已验证的完整真实数据库端到端连续旅程测试。
2. **后续真实模型端到端验收**:
   - 后续获得正式调用授权后，可在生产或试演环境中，通过真实大模型完成玩家与 NPC 的多轮分工对话，检验真实大模型在实际推理中产出结构化状态提案的概率稳定性。
