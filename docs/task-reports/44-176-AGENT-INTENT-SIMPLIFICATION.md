# 44-176 Agent 意图减法：第一阶段

## 基线

- main：`d79705a1`
- 工作树：`.local/worktrees/intent-simplification-176`
- 分支：`codex/intent-simplification-176`
- 本阶段提交：`607f99b5` + `a82b2410` + `f3e9fd65` + `91a1fa52`
- 范围：模型协议、内核 plan 校验、调度 plan 候选、提示词；旧存档解码保留。

## 本阶段已完成

### 1. 未完成 plan 可以成为主动候选

`agent-schedule-collectors.ts` 新增 actionless plan 分支：

- `nextActionId = null`；
- `triggers = []`；
- 没有 completedStep / episode refs；
- plan 为 `active/waiting/blocked`；
- plan 与 goal 的 source 已授权；
- 不会和已有同 plan 候选重复。

候选带 `planReview`，并在 semantic 中加入 `reviewAt = storyAt`，使同一 plan 在时间推进后获得新的复查机会；同一 storyAt 且已消费时不重复。

这是“未完成 plan 驱动主动”，不再要求 trigger/action 先成熟。

### 2. plan intent 的 nextStep 可选

`npc-plan-intent.ts`：

- create/replace/update 的 `nextStep` 改为可选；
- 缺省时 plan 为 `active`，`nextActionId=null`，`triggers=[]`，`missingConditions=[]`；
- 旧 nextStep 输出继续解码。

`npc-model-protocol.ts`：

- JSON schema 不再把 `nextStep` 放进必填；
- 修正 nextStep 条件分支的 minItems 投影；
- 新协议可以只写 summary/status/sourceIds 表达未完成意图。

### 3. 内核允许 actionless plan

`agent-kernel.ts`：

- active/waiting plan 只有在 `nextActionId` 存在时才要求合法可执行 action；
- 没有 action 的 plan 可以是稳定沟通/复查意图；
- 有 nextAction 但 capability/action 不合法仍然拒绝；
- blocked 仍要求 missing reason。

### 4. 模型空集合和可选字段

`agent-proposal-schema.ts`：

- `statements/goals/plans/actions/responsibilities/decisions` 默认空数组；
- 解析时可省略这些集合。

`npc-model-protocol.ts`：

- v15 普通消息可省略 `executions` 和 `changes`；
- JSON schema 根节点不再要求这些集合；
- `changes` 对象中的集合也不再全部必填。

`npc-execution-intent.ts`：

- execution action 的 `targetIds/preconditions/dependsOnActionIds/handlesResponsibilityIds` 默认空，模型可省略；
- action graph 的执行校验仍保留。

### 5. 提示词同步

`npc-agent-model.ts`：

- 明确 plan 可以没有 nextStep；
- 空 active plan 不再被描述为非法；
- 普通消息可省略 executions/changes；
- execution action 可省略默认空字段；
- 仍要求真实 action 走原内核，不伪造完成。

### 6. plan/goal/responsibility 空字段默认

`agent-proposal-schema.ts` + `npc-plan-intent.ts`：

- plan `actionIds/triggers/missingConditions` 默认空，`nextActionId` 默认 null；
- goal `resultIds` 默认空；
- responsibility `nextCheck` 默认空；
- JSON schema 不再要求这些空集合；
- 有真实 action 时仍由内核验证。

### 7. action 空执行图字段默认

`agent-proposal-schema.ts`：

- action 的 `targetIds/preconditions/dependsOnActionIds/handlesResponsibilityIds` 默认空；
- 缺省 `status` 为 `proposed`；
- `resultId/failureCode` 仍由内核写；
- 有真实能力/参数/source 才进入内核校验。

## 验证

- `npm run check:boundaries`：通过（698 files）；
- `npm run typecheck`：通过；
- 聚焦单测：88/88；真实 PG：1/1；合计 89/89。
  - `npc-model-protocol`：35/35；
  - `npc-execution-provenance-wire`：12/12；
  - `npc-execution-contract`：5/5；
  - `agent-schedule-collectors`：36/36。

除专属 actionless-plan 旅程外未跑全量真实 PG；未调用真实模型。
- 已用 v15 planIntent 建出 actionless plan，并通过真实 `npcAgentAdvanceServices` 完成一次 actor wake；重复 immediate advance 不再调用模型。根因是 `scheduleAgents` 的 candidate 校验白名单缺少 `planReview`，把整条 `actor_plan` collection 判为 `invalid_collection`；已补白名单，并把 plan review identity 从 storyAt 改为 summary/status，避免每次时钟推进重复购买。
- 新增真实 PG 旅程 `tests/integration/plan-advance176.test.ts`，1/1 通过。
## 已知边界

- 这是第一阶段，不是全部字段删除。
- plan review identity 使用 plan summary/status，不再用 storyAt；同一 plan immediate advance 不重复，但还没有持久 nextReviewAt 来安排未来复查。
- integration 已覆盖 advance 到 actor wake，不包含页面锁屏通知/真实浏览器刷新。
- plan-only 候选已完成真实 PG 的模型输出 → plan → advance → actor wake；页面锁屏通知仍未验证。
- action 的 `status/resultId/targetIds/preconditions` 等运行时字段仍主要在内核侧；模型侧已减少 required，但旧协议仍兼容。
- goal.resultIds、continuation、question/responsibility/decision 的重叠尚未删除。
- 旧存档仍可读；没有重写历史。

## 后续（按减法方案）

1. 增加 actionless plan 的页面锁屏/刷新旅程（在现有 advance 旅程上补 UI 投影）。
2. 让 action execution 的模型 DTO 进一步只保留 capability/parameters/source。
3. 把 goal result、question resolution、continuation 的重复表达收敛。
4. 调度使用持久 nextReviewAt，而不是仅 storyAt。
5. 清理旧 writer/prompt；保留旧 decoder 和存档兼容。

## 未验证

- 用户原存档；
- 真实模型；
- 生产部署。
