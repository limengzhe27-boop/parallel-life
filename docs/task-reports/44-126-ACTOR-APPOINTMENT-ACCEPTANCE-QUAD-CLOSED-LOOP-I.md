# 任务报告：44-126 约定接受能力与履约四元全生命周期闭环

- 任务 ID：`44-126`
- 工作包关联：`R2` / `承诺与履约后续链路`
- 执行负责人：`集成人（Agent ID: 44-126-appointment-quad-integrator）`
- 工作目录：`/Users/limengzhe/Desktop/projects/demo/人生剧本`
- 关联测试：`tests/integration/actor-appointment-acceptance.test.ts`
- 交付范围：
  - `src/modules/world/domain/agent-capabilities.ts`（注册 `appointment.accept` 能力）
  - `src/modules/world/domain/agent-state-event.ts`（领域事件支持 `appointment.confirmed`）
  - `src/modules/world/domain/reducer.ts`（WorldState 增量 reducer 状态推进）
  - `src/modules/world/domain/types.ts`（WorldEffect 增加 `appointment.confirmed`）
  - `src/modules/world/domain/validation.ts`（提案格式解析校验）
  - `src/modules/world/infrastructure/npc-agent-kernel.ts`（内核执行器、前置条件校验、责任与目标推进、数据库落库）
  - `src/modules/world/infrastructure/npc-agent-model.ts`（模型提示词约定能力指引）
  - `src/modules/world/infrastructure/postgres-world-repository.ts`（`parallel_life.world_appointments` status 字段原子更新）
  - `src/modules/world/infrastructure/agent-channel-projector.ts`（原生/群聊/现场通道事件投影支持约定状态更新）
  - `tests/integration/actor-appointment-acceptance.test.ts`（4/4 真实 PostgreSQL 集成测试）

---

## 一、问题背景与需求

在人物叙事与约定机制中，之前已具备 `appointment.propose`（发起邀约）、`appointment.fulfill`（现场到达履约）与 `appointment.cancel`（撤销/取消约定）。
但当玩家或其他人物向 NPC 发起邀约时，NPC 缺少内核级的原子 `appointment.accept` 能力，导致在对话中 NPC 虽然作出了答应与承诺（对白层面答应），但在内核与数据库层面约定仍处于 `proposed` 待回应状态，责任未能推进为 `open`，目标未能激活，容易造成“口头承诺但持久状态为空或状态停滞”的虚假成功。

---

## 二、架构设计与核心实现

1. **能力注册与领域契约**：
   - 在 `NPC_AGENT_CAPABILITIES` 中追加 `appointment.accept`。
   - `WorldEffect` 增加 `appointment.confirmed` 效果，包含 `appointmentId`、`actorId`、`at`。
   - `AgentStateCommittedEvent` 与 `applyAgentStateEvent` 支持 `appointment.confirmed`，原子更新目标约定的 `status = 'confirmed'`、`responseAt = event.storyAt`、`responseVersion = event.version`。

2. **前置条件与权限校验（Kernel Preconditions）**：
   - 约定必须存在于 `parallel_life.world_appointments` 或当前 `WorldState.appointments` 中，否则报错 `APPOINTMENT_NOT_FOUND`。
   - 约定必须处于 `proposed` 状态，已确认、已撤销或已履行的不可重复接受（报错 `APPOINTMENT_NOT_PROPOSED`）。
   - 当前故事时刻不能晚于约定时刻（过期不可接受，报错 `APPOINTMENT_EXPIRED`）。
   - 响应角色必须为该约定的参与人之一（`participantIds` 包含该角色或为 `proposerId`），否则报错 `ACTOR_NOT_APPOINTMENT_PARTICIPANT`。

3. **责任与目标推进闭环**：
   - 当 NPC 接受约定时，内核自动将对应责任状态由 `waiting` 推进为 `open`，清空 `waitingOn`。
   - 若角色已有关联目标，将其激活为 `active`；若无则自动建立并激活对应赴约目标。
   - 在数据库中生成 `agent_action_results`（记录 `outcome: 'succeeded'`，`handledResponsibilityIds`，`outputRefs: [{ kind: 'appointment', id: appointmentId }]`）。

4. **履约四元全生命周期闭环（Quad Lifecycle: propose -> accept -> fulfill）**：
   - 经实测验证：发起邀约（`proposed`）→ NPC 接受（`confirmed`，责任 open）→ 时间到达且角色到达会面地点（权威位置验证）→ NPC 履行约定（`appointment.fulfill`，状态推进为 `attended`，责任和目标双双标记为 `fulfilled`），全链路环环相扣。

---

## 三、真实 PostgreSQL 集成验证

执行命令：
`node --experimental-strip-types --test tests/integration/actor-appointment-acceptance.test.ts`

结果：
```
▶ actor capability chain: appointment.accept end-to-end execution, precondition enforcement, durable outcome and state resolution
  ✔ 1. Precondition enforcement: rejects appointment.accept when appointment does not exist, not proposed, or expired (64.649375ms)
  ✔ 2. End-to-end appointment.accept execution: transitions appointment to confirmed, updates responsibilities and goals, records action result (97.194166ms)
  ✔ 3. Appointment quad full lifecycle: propose -> accept -> fulfill closed loop (122.572625ms)
✔ actor capability chain: appointment.accept end-to-end execution, precondition enforcement, durable outcome and state resolution (337.060667ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
```

执行全量单元测试与类型校验：
- `npm run check:boundaries`：616 个文件边界检查通过
- `npm run typecheck`：0 TypeScript 报错
- `npm test`：3277/3277 单元测试全部通过
- `npm run build`：Next.js webpack 构建成功（27/27 静态页面及所有 API 路由生成完成）
