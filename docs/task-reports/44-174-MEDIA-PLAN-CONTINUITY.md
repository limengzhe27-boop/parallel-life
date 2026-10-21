# 44-174 旧媒体计划与续接条件验收

## 基线与工作树

- 最新 main：`c00b19d2`
- 工作树：`.local/worktrees/media-continuity-174`
- 分支：`codex/media-continuity-174`
- 根目录 WIP：`npc-model-protocol.ts`、`agent-schedule-collectors.ts` 及其单测由 root 修改，本批只读
- 本批测试/报告提交：`e0690fe7`（无公共源码修改）
- 新增文件：
  - `tests/integration/media-pending174.test.ts`
  - `tests/integration/media-plan174.test.ts`
  - `tests/integration/continuation-conditions174.test.ts`
  - 本报告
- 未改公共协议、内核、调度、SQL、媒体、页面。

## 通过证据

### pending 旧 media plan

`media-pending174.test.ts` 使用原 `npcAgentServices` + 真实 PostgreSQL：

- 原 player 输入创建旧 goal/plan 和 `media.generate_image` action；
- action 真实 succeeded；
- `world_media_requests` 只剩 1 条，状态 pending/submitted；
- 调用原 `npcAgentAdvanceServices`；
- **root WIP：actorCalls 仍为 1，未重新 review 同一 media plan，goal 仍 active（1/1 通过）**；
- 当前已提交 main：actorCalls 变为 2（旧 bug），测试失败。

这验证了 root WIP 的 collector 修复方向；未手工改 action 状态或插消息。

### 续接条件

`continuation-conditions174.test.ts`：

- root WIP：2/2 通过；
- 已提交 main：1/2，schema 仍允许 `await_response/no_current_intent` 带地点条件。

覆盖：

- `await_response` 合法无 conditions；
- `await_response/no_current_intent` schema 的 conditions 必须为空；
- `await_condition` conditions 必须非空；
- 伪造 `at_place` 被 `INVALID_ACTOR_CONTINUATION` 拒绝；
- 无来源 `at_or_after` deadline 被拒绝；
- 其他人物 observation source 不被接受；
- 人物来源隔离保留。

这些是 schema/validator 层证据，不是完整调度旅程。

## 真实失败/阻断

### completed media 后续机会

`media-plan174.test.ts`：

- 在 committed main 上先因 pending review 重复失败（actorCalls 2）；
- 在 root WIP 上 pending 已通过，但把 media request 直改为 ready 后，advance 的 actorCalls 仍为 1，未产生一次 completed 后续机会（expected 2）。

说明：

- pending 不重复 review 的 collector 修复已生效；
- completed 后的“原媒体完成观察 → 一次后续机会”还没有被本夹具触发；
- 直接改 `world_media_requests.document` 不等于真实媒体 worker 完成，缺少真实 observation/result 写入和投递状态，因此不能证明 completed 后续链路。

需要主 Agent 提供/确认：

- 媒体完成时写入的真实 observation/result 字段；
- outbox/task 完成与 `world_media_requests` 状态的关系；
- 原 `actor-media-result-wake` 的完成观察是否需要在同一事务写入；
- 重复 advance 的幂等身份。

### 入队行动失败 / 生成失败

本批没有用原服务构造“media action 入队失败”和“入队成功但媒体生成失败”两种完整旅程：

- 入队失败需要真实 action 执行失败；
- 生成失败需要受控媒体 worker 写 failed；
- 现有 `actor-media-result-wake` 只覆盖 unknown 不重试、单个 completed cue 等，且当前 1/3 通过；
- 不能用改 document 状态冒充真实失败/完成。

这两项保留为阻断，不用新调度器补齐。

### 多人物 opening/director 旧夹具

`episode-defer-reconsideration`、`episode-action-outcome-awareness` 仍报：

```
OPENING_CONTEXT_AUTHORITY_CONFLICT
opening-context-repository.ts:208
→ director-snapshot-repository.ts:1072
→ npc-agent-advance-services.ts:458
```

这是旧 opening context 夹具与当前 director v14 authority 不一致；未在本批删断言或放宽生产校验。

## 分类

### 已通过（root WIP）

- pending 旧 media plan：1/1；
- continuation conditions：2/2。

### 已有但失败

- committed main 的 pending media：actorCalls 2；
- committed main 的 continuation schema：1/2；
- root WIP 的 completed media followup：actorCalls 1（未触发）；
- `actor-media-result-wake`：1/3，旧 observation/fixture 失败；
- multi-actor episode opening fixture：OPENING_CONTEXT_AUTHORITY_CONFLICT。

### 尚未验证

- 入队失败；
- 生成失败；
- 真实媒体 worker completed 后续；
- 重复 advance/refresh 不重复媒体任务；
- 用户原存档、真实模型、公网。

## 主 Agent 最小接线

1. 确认媒体完成 observation/result 的真实写入和 advance 身份；
2. 让 completed media 触发一次后续机会，重复 advance 不重复；
3. 补入队失败/生成失败的原始入口旅程；
4. 修 opening/director 旧夹具；
5. 全量门禁、真实模型验收、部署。

## 验证

- `npm run typecheck`：通过；
- root WIP 聚焦：media-pending 1/1、continuation 2/2；
- committed main：media-pending 0/1、continuation 1/2；
- media-plan completed：root WIP 0/1（pending 部分已通过）；
- 未跑全量；0 真实模型、0 生产写、0 部署。
