# 交付报告：44-134-RELATIONSHIP-BOND-CAPABILITY-I 人际关系羁绊深化与认知评价行动能力完整 6 步闭环

## 1. 任务概述与交付目标
- **任务编号**：`44-134-RELATIONSHIP-BOND-CAPABILITY-I`
- **任务名称**：人际关系羁绊深化与认知评价行动能力完整 6 步闭环（`relationship.bond`）
- **核心契约**：
  1. 遵循模块化单体架构规范，领域层（domain）零框架依赖，严格由事务/内核保证原子状态迁移。
  2. 注册并开放 NPC 原生行动能力 `'relationship.bond'`，支持角色根据共同经历、合作、赴约或深谈提议深化/确立人际羁绊与认知评价（如合伙人、知己、挚友、引路人等）。
  3. 严格前置自绑拦截与目标存在性校验：
     - 自绑拦截（`ACTOR_CANNOT_BOND_SELF`）：角色不得向自身提议羁绊。
     - 目标角色存在性校验（`TARGET_ACTOR_NOT_FOUND`）：提议对象必须存在于当前世界角色列表中。
     - 严格参数格式校验（`RELATIONSHIP_BOND_PARAMETERS`）：`targetActorId`, `relationship`, `mayShare?`, `reason?`, `note?`。
  4. 原子状态机变更与权威存证：
     - 领域效果 `WorldEffect` 新增 `relationship.bonded` 联合类型。
     - 世界状态 `WorldState.actorTies` 原子更新或新增双向/单向社交连接（`ActorTie`），并更新目标角色公开名片关系 `actor.relationship`。
     - `ActorAgentState.relationshipIds` 权威记录已确立的羁绊键（`tieKey`）。
  5. 责任与目标闭环：
     - 关联的羁绊与关系推进责任（`handlesResponsibilityIds`）与目标（`goalId`）原子收敛为 `fulfilled`。
     - `outputRefs` 精准记录 `{ kind: 'relationship', id: tieKey }`。
  6. 0 付费模型调用，0 越权生产写，本地真实 PostgreSQL 55432 集成测试端到端闭环验证。

---

## 2. 核心架构变更与实现

### 2.1 Domain 领域层扩展
- **`src/modules/world/domain/agent-capabilities.ts`**：
  在 `NPC_AGENT_CAPABILITIES` 中注册 `'relationship.bond'`。
- **`src/modules/world/domain/types.ts`**：
  - 扩展 `WorldEffect` 新增 `'relationship.bonded'` 联合类型：
    ```ts
    | {
        type: 'relationship.bonded';
        id: Id;
        fromActorId: Id;
        toActorId: Id;
        relationship: string;
        mayShare?: boolean;
        at: string;
        reason?: string;
        note?: string;
      }
    ```
- **`src/modules/world/domain/validation.ts`**：
  在 `parseProposal` 校验管道中增加 `case 'relationship.bonded'` 严格字段校验。
- **`src/modules/world/domain/agent-runtime.ts`**：
  在 `AgentActionResult.outputRefs` 的 kind 联合类型中增加 `'relationship'`。
- **`src/modules/world/domain/agent-state-event.ts`**：
  - 在 `AgentStateCommittedEvent` 的 effects 联合中增加 `relationship.bonded`。
  - 在 `applyAgentStateEvent` 状态机还原器中将羁绊原子更新至 `state.actorTies`，并更新 `targetActor.relationship`。
- **`src/modules/world/domain/reducer.ts`**：
  在主世界事件还原器 `applyEvent` 中增加 `case 'relationship.bonded'` 幂等状态归约。

### 2.2 Infrastructure 基础设施层扩展
- **`src/modules/world/infrastructure/agent-channel-projector.ts`**：
  在原生发言者校验通道中放行 `relationship.bonded`，并强校验 `effect.fromActorId === attempt.actorId`。
- **`src/modules/world/infrastructure/npc-agent-model.ts`**：
  在 NPC 决策 Prompt 指令中注入 `relationship.bond` 规范定义与参数说明，明确前置条件与结果映射。
- **`src/modules/world/infrastructure/npc-agent-kernel.ts`**：
  - 在外部责任核销白名单中加入 `relationship.bond`。
  - 实现 `relationship.bond` 核心执行器：
    - 参数严格白名单过滤（`RELATIONSHIP_BOND_PARAMETERS`）。
    - 自绑拦截（`ACTOR_CANNOT_BOND_SELF`）。
    - 目标角色存在性校验（`TARGET_ACTOR_NOT_FOUND`）。
    - 组装 `relationship.bonded` 事件，原子更新 `accepted.state.relationshipIds`，推进 `outputRefs`、`handlesResponsibilityIds` 与 `completedGoalIds`。

---

## 3. 测试验证与质量门禁

### 3.1 真实 PostgreSQL 集成测试（端口 55432）
- 新建测试文件：`tests/integration/actor-relationship-bond.test.ts`
- 覆盖 3 大核心场景：
  1. **自绑拦截校验**：
     - 林白语向自身提议确立羁绊，内核判定失败并记录 `ACTOR_CANNOT_BOND_SELF`。
  2. **未知目标角色拦截校验**：
     - 林白语向不存在的角色 ID 提议确立关系，内核判定失败并记录 `TARGET_ACTOR_NOT_FOUND`。
  3. **端到端羁绊确立执行与履约闭环**：
     - 林白语与青青确立“手作工坊合伙人”羁绊，成功产出 `relationship.bonded` 事件。
     - `WorldState.actorTies` 原子更新并继承 `mayShare: true`。
     - 林白语 `ActorAgentState.relationshipIds` 持久化记录该羁绊条目。
     - 关联责任（`resp_bond_partner`）与目标（`goal_bond_partner`）原子收敛为 `fulfilled`。
- 测试结果：4/4 测试（1 根套件 + 3 子测试）全部通过。

### 3.2 回归验证
- 历史能力集成回归测试：
  - `tests/integration/actor-scene-activity.test.ts`（3/3 通过）
  - `tests/integration/actor-item-use.test.ts`（3/3 通过）
  - `tests/integration/actor-item-delivery.test.ts`（2/2 通过）
  - `tests/integration/actor-appointment-fulfillment.test.ts`（2/2 通过）
  - `tests/integration/actor-appointment-cancellation.test.ts`（2/2 通过）
  - `tests/integration/actor-appointment-acceptance.test.ts`（3/3 通过）
  - `tests/integration/actor-appointment-reschedule.test.ts`（3/3 通过）
- 模块边界检查：`npm run check:boundaries`（620 files clean 通过）。
- 类型检查：`npm run typecheck`（0 errors）。
- 生产构建：`npm run build`（27/27 路由构建优化通过）。

---

## 4. 交付文件清单
1. `src/modules/world/domain/agent-capabilities.ts`
2. `src/modules/world/domain/types.ts`
3. `src/modules/world/domain/validation.ts`
4. `src/modules/world/domain/agent-runtime.ts`
5. `src/modules/world/domain/agent-state-event.ts`
6. `src/modules/world/domain/reducer.ts`
7. `src/modules/world/infrastructure/agent-channel-projector.ts`
8. `src/modules/world/infrastructure/npc-agent-model.ts`
9. `src/modules/world/infrastructure/npc-agent-kernel.ts`
10. `tests/integration/actor-relationship-bond.test.ts`
11. `docs/task-reports/44-134-RELATIONSHIP-BOND-CAPABILITY-I.md`
12. `docs/DEVELOPMENT.md`
13. `docs/DEPLOYMENT.md`
