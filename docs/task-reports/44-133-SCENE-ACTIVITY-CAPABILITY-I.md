# 交付报告：44-133-SCENE-ACTIVITY-CAPABILITY-I 现场共同活动、互动与特定调查行动能力完整 6 步闭环

## 1. 任务概述与交付目标
- **任务编号**：`44-133-SCENE-ACTIVITY-CAPABILITY-I`
- **任务名称**：现场共同活动、互动与特定调查行动能力完整 6 步闭环（`activity.participate`）
- **核心契约**：
  1. 遵循模块化单体架构规范，领域层（domain）零框架依赖，严格由事务/内核保证原子状态迁移。
  2. 注册并开放 NPC 原生行动能力 `'activity.participate'`，支持角色提议在同场物理空间开展现场互动与共同活动（如品茶、现场研讨、协作实验、实地勘验、手工制作等）。
  3. 严格前置物理与同场校验：
     - 主角在场性校验（`ACTOR_NOT_AT_ANY_PLACE` / `ACTOR_NOT_AT_SPECIFIED_PLACE`）：发起角色必须身处有效权威位置，且与提议指定地点严格一致。
     - 共同参与者在场性校验（`PARTICIPANT_NOT_CO_LOCATED`）：声明的共同参与人必须同场处于同一物理空间，缺席者严格拒绝同场活动。
     - 参与人存在性校验（`PARTICIPANT_NOT_FOUND`）。
  4. 原子状态机变更与权威存证：
     - 领域效果 `WorldEffect` 新增 `activity.participated` 联合类型。
     - 世界状态 `WorldState` 新增权威活动历史 `activities?: WorldActivity[]`，记录 `activityId`, `title`, `initiatorActorId`, `participantActorIds`, `placeId`, `occurredAt`, `outcome`, `note`。
  5. 责任与目标闭环：
     - 关联的活动责任（`handlesResponsibilityIds`）与目标（`goalId`）原子收敛为 `fulfilled`。
     - `outputRefs` 精准记录 `{ kind: 'activity', id: activityId }`。
  6. 0 付费模型调用，0 越权生产写，本地真实 PostgreSQL 55432 集成测试端到端闭环验证。

---

## 2. 核心架构变更与实现

### 2.1 Domain 领域层扩展
- **`src/modules/world/domain/agent-capabilities.ts`**：
  在 `NPC_AGENT_CAPABILITIES` 中注册 `'activity.participate'`。
- **`src/modules/world/domain/types.ts`**：
  - 定义 `WorldActivity` 接口与 `WorldState.activities?: WorldActivity[]` 字段。
  - 扩展 `WorldEffect` 新增 `'activity.participated'` 联合类型：
    ```ts
    | {
        type: 'activity.participated';
        id: Id;
        activityId: string;
        title: string;
        actorId: Id;
        participantActorIds: Id[];
        placeId: string;
        at: string;
        outcome?: string;
        note?: string;
      }
    ```
- **`src/modules/world/domain/validation.ts`**：
  在 `parseProposal` 校验管道中增加 `case 'activity.participated'` 严格字段校验（校验 `id`, `activityId`, `title`, `actorId`, `participantActorIds`, `placeId`, `at`, `outcome`, `note`）。
- **`src/modules/world/domain/agent-runtime.ts`**：
  在 `AgentActionResult.outputRefs` 的 kind 联合类型中增加 `'activity'`。
- **`src/modules/world/domain/agent-state-event.ts`**：
  - 在 `AgentStateCommittedEvent` 的 effects 联合中增加 `activity.participated`。
  - 在 `applyAgentStateEvent` 状态机还原器中将完成的活动原子写入 `state.activities`。
- **`src/modules/world/domain/reducer.ts`**：
  在主世界事件还原器 `applyTurnEvent` 中增加 `case 'activity.participated'` 幂等状态归约。

### 2.2 Infrastructure 基础设施层扩展
- **`src/modules/world/infrastructure/agent-channel-projector.ts`**：
  在原生发言者校验通道中放行 `activity.participated`，并强校验 `effect.actorId === attempt.actorId`。
- **`src/modules/world/infrastructure/npc-agent-model.ts`**：
  在 NPC 决策 Prompt 指令中注入 `activity.participate` 规范定义与参数说明，明确前置条件与结果映射。
- **`src/modules/world/infrastructure/npc-agent-kernel.ts`**：
  - 在外部责任核销白名单中加入 `activity.participate`。
  - 实现 `activity.participate` 核心执行器：
    - 参数严格白名单过滤（`ACTIVITY_PARTICIPATE_PARAMETERS`）。
    - 自身物理位置与指定地点匹配校验（`ACTOR_NOT_AT_ANY_PLACE` / `ACTOR_NOT_AT_SPECIFIED_PLACE`）。
    - 所有共同参与人的权威位置核验（`PARTICIPANT_NOT_CO_LOCATED` / `PARTICIPANT_NOT_FOUND`）。
    - 组装 `activity.participated` 事件并原子推进 `outputRefs`、`handlesResponsibilityIds` 与 `completedGoalIds`。

---

## 3. 测试验证与质量门禁

### 3.1 真实 PostgreSQL 集成测试（端口 55432）
- 新建测试文件：`tests/integration/actor-scene-activity.test.ts`
- 覆盖 2 大核心场景共 3 项严格子测试：
  1. **前置条件严格拦截**：
     - 测试非同场参与人（林白语在茶馆，提议与远在美术馆的王馆长开展现场研讨），内核判定失败并记录 `PARTICIPANT_NOT_CO_LOCATED`。
     - 测试地点不匹配（林白语在茶馆，提议在美术馆品茶），内核判定失败并记录 `ACTOR_NOT_AT_SPECIFIED_PLACE`。
  2. **端到端现场共同活动执行与履约闭环**：
     - 林白语与青青在茶馆同场开展明前龙井品鉴研讨，成功产出 `activity.participated` 事件。
     - 关联责任（`resp_tea_tasting`）与目标（`goal_tea_tasting`）原子收敛为 `fulfilled`。
     - 产出凭据 `outputRefs: [{ kind: 'activity', id: 'act_tea_tasting' }]`。
     - 世界状态权威数组 `world.activities` 准确记录活动详情、组织者与共同参与人。
- **测试结果**：`tests/integration/actor-scene-activity.test.ts` 3/3 测试用例 100% 通过（耗时 255ms）。
- **回归测试**：`actor-item-use.test.ts` 4/4 与 `actor-item-delivery.test.ts` 3/3 全部通过。

### 3.2 架构与类型规范
- `npm run check:boundaries`：620 个文件通过模块边界检查。
- `npx tsc --noEmit` / `npm run typecheck`：通过，0 类型错误。
- `npm run build`：生产构建成功。
