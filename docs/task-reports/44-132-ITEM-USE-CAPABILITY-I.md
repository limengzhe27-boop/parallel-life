# 交付报告：44-132-ITEM-USE-CAPABILITY-I 实体物品/道具/钥匙使用与消耗完整 6 步闭环

## 1. 任务概述与交付目标
- **任务编号**：`44-132-ITEM-USE-CAPABILITY-I`
- **任务名称**：实体物品/钥匙/道具使用与消耗完整 6 步闭环（`item.use`）
- **核心契约**：
  1. 遵循模块化单体架构规范，领域层（domain）零框架依赖，严格由事务/内核保证原子状态迁移。
  2. 注册并开放 NPC 原生能力 `'item.use'`，支持角色使用或消耗持有的道具、钥匙、凭证、信物或材料。
  3. 严格前置校验：
     - 物品持有权校验（`ITEM_NOT_OWNED_BY_ACTOR`）：仅能使用当前角色持有的实体物品。
     - 消耗品防二次使用校验（`ITEM_ALREADY_CONSUMED`）：已消耗道具禁止再次使用。
     - 物理环境校验（`ACTOR_NOT_AT_SPECIFIED_PLACE`）：提议使用地点必须与世界权威位置相符。
  4. 原子状态机变更：
     - 物品状态变更为 `used` 或 `consumed`。
     - 准确持久化 `usedAt`、`usedPlaceId`、`purpose`、`note`。
  5. 责任与目标闭环：
     - 关联的使用责任（`handlesResponsibilityIds`）与目标（`goalId`）原子收敛为 `fulfilled`。
     - `outputRefs` 精准记录 `{ kind: 'item', id: itemId }`。
  6. 0 付费模型调用，0 越权生产写，本地真实 PostgreSQL 55432 集成测试端到端闭环验证。

---

## 2. 核心架构变更与实现

### 2.1 Domain 领域层扩展
- **`src/modules/world/domain/agent-capabilities.ts`**：
  在 `NPC_AGENT_CAPABILITIES` 中注册 `'item.use'`。
- **`src/modules/world/domain/types.ts`**：
  - 扩展 `WorldItem` 实体字段：`status?: 'held' | 'used' | 'consumed'`, `usedAt?: string`, `usedPlaceId?: string`, `purpose?: string`。
  - 扩展 `WorldEffect` 新增 `'item.used'` 联合类型：
    ```ts
    | {
        type: 'item.used';
        id: Id;
        itemId: Id;
        title?: string;
        actorId: Id;
        placeId?: string;
        at: string;
        purpose?: string;
        consumed?: boolean;
        note?: string;
      }
    ```
- **`src/modules/world/domain/validation.ts`**：
  在 `parseProposal` 校验管道中增加 `case 'item.used'` 严格字段校验（校验 `id`, `itemId`, `actorId`, `at`, `purpose`, `consumed`, `note`, `placeId`）。
- **`src/modules/world/domain/agent-state-event.ts`**：
  - 在 `AgentStateCommittedEvent` 的 effects 联合中增加 `item.used`。
  - 在 `applyAgentStateEvent` 状态机还原器中更新物品状态、`usedAt`、`usedPlaceId`、`purpose`、`note`。
- **`src/modules/world/domain/reducer.ts`**：
  在主世界事件还原器 `applyTurnEvent` 中增加 `case 'item.used'` 幂等状态归约。

### 2.2 Infrastructure 基础设施层扩展
- **`src/modules/world/infrastructure/agent-channel-projector.ts`**：
  在原生发言者校验通道中放行 `item.used`，并强校验 `effect.actorId === attempt.actorId`（防冒用执行）。
- **`src/modules/world/infrastructure/npc-agent-model.ts`**：
  在 NPC 决策 Prompt 指令中注入 `item.use` 规范定义与参数规范，明确前置条件与结果映射。
- **`src/modules/world/infrastructure/npc-agent-kernel.ts`**：
  - 在外部责任核销白名单中加入 `item.use`。
  - 实现 `item.use` 核心执行器：
    - 完整参数合法性过滤（`ITEM_USE_PARAMETERS`）。
    - 实体物品持有权校验（`ITEM_NOT_OWNED_BY_ACTOR`）。
    - 消耗品重复使用拦截（`ITEM_ALREADY_CONSUMED`）。
    - 地点环境匹配校验（`ACTOR_NOT_AT_SPECIFIED_PLACE`）。
    - 组装 `item.used` 事件并原子推进 `outputRefs`、`handlesResponsibilityIds` 与 `completedGoalIds`。

---

## 3. 测试验证与质量门禁

### 3.1 真实 PostgreSQL 集成测试（端口 55432）
- 新建测试文件：`tests/integration/actor-item-use.test.ts`
- 覆盖 3 大核心场景共 4 项严格子测试：
  1. **前置条件严格拦截**：
     - 测试非本人持有道具（试图使用他人日记本），内核判定失败并记录 `ITEM_NOT_OWNED_BY_ACTOR`。
     - 测试不在场地点（角色在实验室，提议在植物园刷门禁），内核判定失败并记录 `ACTOR_NOT_AT_SPECIFIED_PLACE`。
  2. **标准道具使用闭环（非消耗品）**：
     - 使用高权限门禁卡，成功标记 `status: 'used'`，持久化 `usedPlaceId`、`purpose`、`note`、`usedAt`。
     - 关联责任（`resp_unlock_lab`）与目标（`goal_unlock_lab`）原子收敛为 `fulfilled`。
     - 产出凭据 `outputRefs: [{ kind: 'item', id: 'item_lab_keycard' }]`。
  3. **消耗性道具使用与防二次使用**：
     - 使用一次性生物酶试剂并标记 `consumed: true`，世界状态中试剂状态更新为 `consumed`。
     - 角色试图对已消耗的试剂发起二次提取/使用，内核严格拦截并标记 `failureCode: 'ITEM_ALREADY_CONSUMED'`。
- **测试结果**：`tests/integration/actor-item-use.test.ts` 4/4 测试用例 100% 通过（耗时 285ms）。
- **回归测试**：`tests/integration/actor-item-delivery.test.ts` 3/3 测试用例 100% 通过，无破坏性破坏。

### 3.2 架构与类型规范
- `npm run check:boundaries`：619 个文件通过模块边界检查。
- `npx tsc --noEmit` / `npm run typecheck`：通过，0 类型错误。
- `npm run build`：生产构建成功。
