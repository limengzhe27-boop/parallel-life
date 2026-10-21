# 44-175 媒体真实生命周期与旧夹具验收

## 基线、工作树、文件

- 最新 main：`d79705a1`
- 工作树：`.local/worktrees/media-lifecycle-175`
- 分支：`codex/media-lifecycle-175-final`
- 本批测试/报告提交：`136b4b94`（无公共源码修改）
- 新增：
  - `tests/integration/media-pipeline175.test.ts`
  - `tests/integration/media-pending175.test.ts`
  - `tests/integration/media-lifecycle175.test.ts`
  - 本报告
- 只读复用：
  - `tests/integration/media-pipeline-cancellation.test.ts`
  - `tests/integration/actor-media-result-context.test.ts`
- 公共协议、调度、媒体、SQL、页面只读。

## 已通过

### 真实媒体完整链路：1/1

`media-pipeline175.test.ts` 使用：

- 原 `npcAgentServices` / `PostgresNpcAgentKernel`；
- 真实 `PostgresOutbox` + `dispatchOutbox`；
- 真实 `PostgresTaskQueue`；
- `createMediaPipelineHandler` + 受控生成适配器；
- 原媒体结果上下文读取；
- `npcAgentAdvanceServices`。

验证：

- 原输入创建旧 goal/plan + `media.generate_image` action；
- action 成功入队，媒体请求 1 条 pending；
- pending 时 advance 不重复复盘/生图，actorCalls 仍 1，goal active；
- 真实 outbox/task/media handler 完成后 request ready、assetId 真实、outbox/task succeeded；
- advance 后 actorCalls=2，只有一次后续机会；
- 模型确实收到 `own_media_completion`；
- 再 advance actorCalls 仍 2，媒体请求仍 1 条；
- goal 仍 active，不把图片或子步骤当整体完成。

### pending 旧计划：1/1

`media-pending175.test.ts` 确认 pending 媒体不重复 review、不重生图、goal active。

### 旧媒体完成观察夹具：3/3

`media-lifecycle175.test.ts` 从 `actor-media-result-wake` 复制并修正：

- 当前完成观察在 `payload.presentationContext.internalContext[].observation`；
- 旧夹具只查 `payload.observations` 顶层，导致误报；
- 更新后 3/3 通过；
- 未放宽生产校验、未删负向断言。

### 失败/unknown/隔离复用

- `media-pipeline-cancellation.test.ts`：1/1，真实 failed/unknown 保存，不伪造完成、不自动重试；
- `actor-media-result-context.test.ts`：5/5，other actor / other world 不可读，真实 source/asset 隔离。

### 实测结果

聚焦真实 PG **11/11 通过**；typecheck 通过。

## 未完成/阻断

### media action 执行失败、未创建媒体请求

本批仍未构造“action executor 失败且完全没有 media request”的原入口旅程：

- `media-pipeline-cancellation` 覆盖的是已入队后的 provider/worker failed/unknown；
- 不是 action 入队前失败；
- 需要主 Agent 提供 action executor 的真实失败路径或明确断言位置。

### 多人媒体完成后的重复 advance/refresh

当前 `media-pipeline175` 是单人物旅程；没有在多人同时有事项时验证 completed media 重复 advance/refresh 不重复生成、不重复唤醒。需要补一条多人旅程，不能把单人物通过冒充多人。

### 旧 opening/director 夹具

`episode-defer-reconsideration.test.ts`、`episode-action-outcome-awareness.test.ts` 仍报：

```
OPENING_CONTEXT_AUTHORITY_CONFLICT
opening-context-repository.ts:208
→ director-snapshot-repository.ts:1072
→ npc-agent-advance-services.ts:458
```

进一步复制 `episode-action-outcome-awareness` 后，把 opening candidate 从空 actorKeys 改为一个 actor，冲突消失，但下一个旧 director 输出仍是 v0 `mode/selectedCandidateIds`，在 `episode-outcome175.test.ts` 的 model helper 处读到不存在的 `m.sourceId` 失败。说明这两条测试还叠加了旧 director 协议夹具，不能只改 opening actorKeys。需要按当前 director-wire-v14 重写这两条测试的导演输出，不能用放宽断言解决。

## 分类

### 已通过

- media-pipeline175：1/1；
- media-pending175：1/1；
- media-lifecycle175：3/3；
- media-pipeline-cancellation：1/1；
- actor-media-result-context：5/5；
- 合计 11/11，typecheck 0。

### 未实现/未验证

- media action 入队前失败；
- 多人媒体完成重复 advance/refresh；
- 旧 opening + director v14 夹具；
- 用户原存档、真实生图、生产部署。

## 主 Agent 最小接线

1. 补 action executor 失败且无媒体请求的真实入口；
2. 按 director-wire-v14 重写 episode-defer/action-outcome 两条旧夹具；
3. 补多人媒体完成后的重复 advance/refresh；
4. 全量门禁、真实生图/用户存档验收、部署。

受控适配器通过不等于真实生图体验验收；0 真实模型、0 生产写、0 部署。
