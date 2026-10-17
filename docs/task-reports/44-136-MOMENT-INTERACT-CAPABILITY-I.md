# 交付报告：44-136-MOMENT-INTERACT-CAPABILITY-I 角色朋友圈点赞互动与评论流完整闭环

## 1. 任务概述与交付目标
- **任务编号**：`44-136-MOMENT-INTERACT-CAPABILITY-I`
- **任务名称**：角色朋友圈点赞互动与评论流完整闭环（`moment.interact`）
- **核心契约**：
  1. 遵循模块化单体架构规范，领域层（domain）零框架依赖，严格由事务/内核保证原子状态迁移。
  2. 注册并开放 NPC 原生行动能力 `'moment.interact'`，支持角色对已有动态（无论是创世设定动态还是运行期动态）进行点赞或发表评论。
  3. 严格前置参数格式校验与业务防重校验：
     - `momentKey`：必填，非空且修剪后不超过 64 字符；
     - `kind`：必填，枚举 `'like' | 'comment'`；
     - `comment`：当 `kind === 'comment'` 时必填，非空且修剪后长度 1-600 字；
     - 点赞防重校验：同一角色不可对同一动态重复点赞（`MOMENT_ALREADY_LIKED`）；
     - 动态存在性校验：目标动态必须存在于创世设定动态或世界运行态动态集合中（`MOMENT_NOT_FOUND`）。
  4. 原子状态机变更与权威存证：
     - 领域效果 `WorldEffect` 新增 `moment.interacted` 联合类型。
     - 世界状态 `WorldState.momentInteractions` 原子追加互动记录（`WorldMomentInteraction`）。
     - 内核产物引用 `outputRefs` 精准记录 `{ kind: 'moment_interaction', id: interactionId }`。
  5. 责任与目标闭环：
     - 关联的动态互动责任（`handlesResponsibilityIds`）与目标（`goalId`）原子收敛为 `fulfilled`。
  6. 手机朋友圈社交流投影聚合与界面渲染：
     - 统一社交流仓储函数 `mergeSocialMoments` 将点赞与评论按 `momentKey` 分组聚合至对应的动态对象（`likes` 与 `comments` 列表），并通过角色名关联展示真实点赞人与评论者姓名。
     - 手机端朋友圈组件 `MomentsApp` 完整渲染点赞列表与评论列表。
  7. 0 付费模型调用，0 越权生产写，本地真实 PostgreSQL 55432 集成测试端到端闭环验证。

---

## 2. 核心架构变更与实现

### 2.1 Domain 领域层扩展
- **`src/modules/world/domain/agent-capabilities.ts`**：
  在 `NPC_AGENT_CAPABILITIES` 中注册 `'moment.interact'`。
- **`src/modules/world/domain/types.ts`**：
  - 新增 `WorldMomentInteraction` 领域类型：
    ```ts
    export interface WorldMomentInteraction {
      id: Id;
      momentKey: string;
      actorId: Id;
      kind: 'like' | 'comment';
      comment?: string;
      at: string;
      note?: string;
    }
    ```
  - 在 `WorldState` 中新增可选字段 `momentInteractions?: WorldMomentInteraction[]`。
  - 扩展 `WorldEffect` 新增 `'moment.interacted'` 联合类型：
    ```ts
    | {
        type: 'moment.interacted';
        id: Id;
        momentKey: string;
        actorId: Id;
        kind: 'like' | 'comment';
        comment?: string;
        at: string;
        note?: string;
      }
    ```
- **`src/modules/world/domain/validation.ts`**：
  在 `parseProposal` 校验管道中增加 `case 'moment.interacted'` 字段校验与类型约束。
- **`src/modules/world/domain/agent-runtime.ts`**：
  在 `AgentActionResult.outputRefs` 的 kind 联合类型中增加 `'moment_interaction'`。
- **`src/modules/world/domain/agent-state-event.ts`**：
  - 在 `AgentStateCommittedEvent` 的 effects 联合中增加 `moment.interacted`。
  - 在 `applyAgentStateEvent` 中将互动条目追加至 `state.momentInteractions`。
- **`src/modules/world/domain/reducer.ts`**：
  在主世界事件还原器 `applyEvent` 中增加 `case 'moment.interacted'` 状态归约。

### 2.2 Infrastructure 与 Presentation 层扩展
- **`src/modules/world/infrastructure/agent-channel-projector.ts`**：
  放行 `moment.interacted`，强校验 `effect.actorId === attempt.actorId`。
- **`src/modules/world/infrastructure/npc-agent-model.ts`**：
  在 NPC Prompt 规划指令中注入 `moment.interact` 规范及点赞/评论参数说明。
- **`src/modules/world/infrastructure/npc-agent-kernel.ts`**：
  - 在外部责任核销白名单中加入 `moment.interact`；
  - 动态存在性检查（检索 `executionWorld.moments` 或设定开场动态）；
  - 点赞去重守卫（校验已有点赞记录，若已赞则报错 `MOMENT_ALREADY_LIKED`）；
  - 评论非空守卫；
  - 原子生成 `moment.interacted` 效果，关联责任核销与目标完成标记；
  - 精准记录产物 `outputRefs: [{ kind: 'moment_interaction', id: interactionId }]`。
- **`src/contracts/authored-social.ts`**：
  在动态条目契约中补充可选 `likes` 与 `comments` 结构定义。
- **`src/modules/settings/infrastructure/publication-social-repository.ts`**：
  在 `mergeSocialMoments` 中接收 `interactions` 与 `actors`，将点赞与评论归约到对应动态中。
- **`src/server/publication-social-http.ts`**：
  传入 `world.momentInteractions` 与 `world.actors`，返回包含点赞与评论的完整社交流数据。
- **`src/features/phone/apps/moments.tsx` & `moments.module.css`**：
  手机朋友圈组件中增加点赞头像/姓名展示区以及评论列表展示区。

---

## 3. 测试与质量门禁证据

### 3.1 真实 PostgreSQL 55432 端到端集成测试
- **测试文件**：`tests/integration/actor-moment-interact.test.ts`
- **执行命令**：`TEST_PGPORT=55432 node --experimental-strip-types --test tests/integration/actor-moment-interact.test.ts`
- **结果**：**5/5 项测试 100% 全部通过（耗时 695ms）**：
  1. `1. Rejects invalid parameters and non-existent moment`
  2. `2. Successfully likes a moment, persists to state, fulfills goal & responsibility, rejects duplicate like`
  3. `3. Successfully comments on a moment, persists comment text, fulfills goal & responsibility`
  4. `4. Dynamic social feed projection cleanly integrates likes and comments`

### 3.2 全量工程门禁与构建
- `npm run check:boundaries`：**620 个文件零架构越界**
- `npm run typecheck`：**零 TypeScript 类型错误**
- `npm test`：**3,293 / 3,293 项测试 100% 全部通过**
- `npm run build`：**27/27 条路由构建与静态优化 100% 成功**
