# 任务交付报告：44-131-ITEM-DELIVERY-CAPABILITY-I

- **任务 ID**：`44-131-ITEM-DELIVERY-CAPABILITY-I`
- **任务名称**：实体物品/资料交付与信物交接完整 6 步闭环（`item.deliver`）
- **交付负责人**：新架构交付负责人（Agent ID: `codex-ma44-item-delivery-i`）
- **交付日期**：2026-10-18
- **执行环境**：本地真实 PostgreSQL (端口 `55432`，库 `parallel_life_test`)，Next.js App Router 生产环境
- **所属状态**：已完成本地集成验证与质量门禁，待生产部署上线

---

## 一、需求背景与业务架构设计

在《人生剧本》的多角色互动与现实交错剧情体系中，角色之间的道具、合同、学术资料、机密蓝图以及信物转移是驱动关键剧情里程碑与责任履约的重要机制。此前模型或剧情容易退化为“仅在口头对话中提及给出了某物，但权威世界状态无物品实体，也未校验人物是否身处同一物理场所”，造成剧情虚浮和认知脱节。

本任务实现了严格符合**模块化单体架构**与**确定性事务原子性**的实体交接完整 6 步闭环：
1. **NPC 提案（Proposal）**：NPC 智能体根据任务目标发起 `item.deliver` 行动能力，包含 `itemId`、`recipientActorId`、`title`、`note` 等结构化参数；
2. **权限前提检查（Preconditions）**：
   - 禁止交给自己（`CANNOT_DELIVER_TO_SELF`）；
   - 接收人必须为世界在籍合法角色（`RECIPIENT_NOT_FOUND`）；
   - **双人物理同场强校验**（`RECIPIENT_NOT_CO_LOCATED`）：基于 PostgreSQL `world_authoritative_positions` 权威位置表，比对发送者与接收者的最新物理位置 `placeId`，仅当两者处于同一物理场所时方可执行实体交接；
   - **物品持有权强校验**（`ITEM_NOT_OWNED_BY_ACTOR`）：校验世界物品实体状态 `world.items`，发送者必须持有该物品，他人或已被交出的物品严禁再次转交；
3. **真实事务执行（Transaction）**：在单个 UoW / PostgreSQL 事务中原子执行，无外部网络与外部模型阻塞；
4. **权威结果存盘（Authoritative Persistence）**：生成 `item.delivered` 领域效果，记录到 `world_events` 与 `agent_action_results`（标准输出引用 `outputRefs: [{ kind: 'item', id: itemId }]`）；
5. **在场与知情认知同步（Awareness Sync）**：通过纯领域函数 `applyAgentStateEvent` / `reducer` 将物品 `holderActorId` 原子变更为接收人，记录 `transferredAt` 与 `note`；
6. **后续剧情推进与履约联动（Responsibility & Goal Fulfillment）**：将该动作关联的承诺责任（`handlesResponsibilityIds`）和目标（`goalId`）状态原子变更为 `fulfilled`（`已按约履行` / `目标已达成`）。

---

## 二、架构变更明细

### 1. 领域模型（Domain Layer）
- `src/modules/world/domain/agent-capabilities.ts`：
  - 在 `NPC_AGENT_CAPABILITIES` 常量中正式注册 `'item.deliver'`。
- `src/modules/world/domain/types.ts`：
  - 定义 `WorldItem` 接口：`{ id: Id; title: string; kind?: string; holderActorId: Id; sourceEventId: Id; transferredAt?: string; note?: string; }`；
  - 扩展 `WorldState`：新增 `items?: WorldItem[]`；
  - 扩展 `WorldEffect`：新增 `{ type: 'item.delivered'; id: Id; itemId: Id; title?: string; fromActorId: Id; toActorId: Id; placeId?: string; at: string; note?: string; }`。
- `src/modules/world/domain/validation.ts`：
  - 在 `validateWorldEffect` 中添加 `case 'item.delivered'` 结构校验规则。
- `src/modules/world/domain/agent-state-event.ts`：
  - 在 `AgentStateCommittedEvent['data']['effects']` 增加 `Extract<WorldEffect, { type: 'item.delivered' }>`；
  - 在 `applyAgentStateEvent` 中实现物品持有权转移：若世界中已存在该物品，更新 `holderActorId`、`transferredAt` 与 `note`；若为首次生成，则新增该物品记录。
- `src/modules/world/domain/reducer.ts`：
  - 在 `usedIds` 收集逻辑中纳入 `state.items`；
  - 在 `applyTurnEvent` 中对 `item.delivered` 产生状态更新。
- `src/modules/world/domain/agent-runtime.ts`：
  - 在 `AgentActionResult['outputRefs']` 中允许 `kind: 'item'`。

### 2. 基础设施与内核（Infrastructure & Kernel Layer）
- `src/modules/world/infrastructure/npc-agent-model.ts`：
  - 在 NPC 模型能力规范中添加 `item.deliver` 提示词指引，强调物理同场与信物/资料交接前置条件。
- `src/modules/world/infrastructure/agent-channel-projector.ts`：
  - 在原生信道发言人合法性判定中支持 `item.delivered` 效果。
- `src/modules/world/infrastructure/npc-agent-kernel.ts`：
  - 允许 `item.deliver` 动作处理外部责任（`handlesResponsibilityIds`）；
  - 核心执行链路：
    1. 校验参数（`itemId`, `recipientActorId`, `title?`, `note?`）；
    2. 禁止交给自己（`CANNOT_DELIVER_TO_SELF`）；
    3. 校验接收人在籍（`RECIPIENT_NOT_FOUND`）；
    4. 权威位置查询 `world_authoritative_positions` 校验同场在场（`RECIPIENT_NOT_CO_LOCATED`）；
    5. 校验发送方物品所有权（`ITEM_NOT_OWNED_BY_ACTOR`）；
    6. 生成 `item.delivered` 效果，组装 `outputRefs: [{ kind: 'item', id: itemId }]`；
    7. 自动收敛责任（`fulfilled`）与关联目标（`fulfilled`）。

---

## 三、真实数据库集成测试（PostgreSQL 55432）

编写端到端真实数据库集成测试：`tests/integration/actor-item-delivery.test.ts`。

1. **子测试 1：前置条件强拦截验证（Precondition enforcement）**：
   - 尝试交给自己：被严格识别为失败，记录 `failureCode: 'CANNOT_DELIVER_TO_SELF'`；
   - 接收人不在同一场所（发送人在档案室，接收人在咖啡馆）：被严格识别为失败，记录 `failureCode: 'RECIPIENT_NOT_CO_LOCATED'`；
   - 验证无假成功、无虚假持有权流转。
2. **子测试 2：端到端实体交付完整闭环（End-to-end item.deliver execution）**：
   - 发送方（林白语）在档案室现场向接收方（青青）递交“绝密项目设计蓝图”；
   - 事务提交后，世界版本从 1 推进到 2；
   - 验证世界物品实体状态 `world.items`：`holderActorId` 成功由发送方变更转移为接收方 `f.actorRecipientId`，并记录交接时间戳与交接备注；
   - 验证发送方责任状态：`status` 变更为 `fulfilled`，`endReason` 为 `已按约履行`；
   - 验证发送方目标状态：`status` 变更为 `fulfilled`，`endReason` 为 `目标已达成`；
   - 验证权威执行结果 `agent_action_results`：`outcome: 'succeeded'`，`outputRefs: [{ kind: 'item', id: f.itemId }]`；
   - **防重复转交拦截验证**：当发送方再次尝试转交该已被送出的物品时，被内核准确识别并拒绝，记录 `failureCode: 'ITEM_NOT_OWNED_BY_ACTOR'`。

---

## 四、代码与质量门禁证据

1. **真实 PG 集成测试**：
   `node --test tests/integration/actor-item-delivery.test.ts`
   - 结果：`pass 3, fail 0`（全量通过）。
2. **架构边界校验**：
   `npm run check:boundaries`
   - 结果：`Module boundary checks passed (619 files)`。
3. **静态类型检查**：
   `npx tsc --noEmit`
   - 结果：`0 errors`。
4. **全量单元测试套件**：
   `npm test`
   - 结果：`3,293 / 3,293 passed`（100% 通过，耗时 27.8 秒）。
5. **付费模型调用**：
   - 严格 0 paid tokens consumed，0 unapproved writes。
