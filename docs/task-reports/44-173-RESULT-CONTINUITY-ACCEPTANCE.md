# 44-173 结果续接、多人连续旅程与安静停滞验收

## 基线、工作树、范围

- 任务：`44-173-RESULT-CONTINUITY-ACCEPTANCE`
- Agent：`dsh-continuity173-20261020`
- 最新 main：`1bb270d6`
- 工作树：`.local/worktrees/result-continuity-173`
- 分支：`codex/result-continuity-173`
- 本批测试/报告提交：`7bb9d800`（无公共源码修改）
- 新增：
  - `tests/integration/result-reconsideration173.test.ts`
  - 本报告
- 只读复用：
  - `tests/agent-schedule-collectors.test.ts`
  - `tests/integration/actor-plan-next-step.test.ts`
  - `tests/integration/episode-defer-reconsideration.test.ts`
  - `tests/integration/episode-journey-evidence.test.ts`
  - `tests/integration/episode-action-outcome-awareness.test.ts`
- 公共协议、内核、调度、SQL、页面、部署未修改。

## 已集成基线

- `1bb270d6` 已集成 44-171/172 测试与报告，不再重复提交。
- `922f8d06`：player episodeManifest 与 coordination 共用 required consideration；真实 action result 的 plan review；旧 execution trigger 与结果重评分离。
- `3985b554`/`0103`：group/scene 实际 append admission；`1e1c6698` 仅 membership 查询认证优化。
- 44-171/172 的文件已进入 main，无需再列未集成清单。

## 1. 真实 action result 触发下一步

新增 `result-reconsideration173.test.ts`，两条独立旅程：

- 成功：原 `npcAgentServices` 提交一个 `plan.record` action，真实结果为 succeeded；
- 失败：同一个原入口提交一个不存在的 `appointment.cancel`，真实结果为 failed；
- 两者都由真实 `npcAgentAdvanceServices` 在之后唤醒同一个人物；
- 断言：
  - action result 真实写入 `agent_action_results`；
  - 只发生 1 次后续 actor 模型调用（总 actorCalls 2）；
  - 第二次 advance 不再调用模型；
  - goal 仍 active、`resultIds=[]`，没有把子步骤当成整个事件完成；
  - action 最终状态保持 succeeded/failed。

结果：**2/2 通过**。

现有 `tests/agent-schedule-collectors.test.ts`：**34/34 通过**，其中新增用例直接覆盖：

- real terminal next action（succeeded/failed）只唤醒一次 plan review；
- completed action receipt 不被重复执行；
- 旧执行地点失效不阻止结果后的反思；
- terminal label 没有真实 result 时不授予资格；
- goal 不因 action result 自动 done。

所以“result 驱动重排、成功/失败、旧执行条件失效、重复检查不重复”已有实现证据。尚未完成的是**跨多人物、连续多轮的完整业务旅程**，不是当前单人物 result 入口。

## 2. 多人物连续旅程

复用 `episode-defer-reconsideration.test.ts`，它设计上覆盖：

- 两个人物分别 defer/decline；
- A 等待玩家时，B 拒绝不阻断 A；
- 无关聊天不唤醒；
- 条件成熟后只唤醒 A；
- 重复 advance 不重复骚扰；
- 全员 decline 后干净 withdrawal。

但当前 main `1bb270d6` 下运行失败：

```
OPENING_CONTEXT_AUTHORITY_CONFLICT
at readOpeningContextAuthority (opening-context-repository.ts:208)
at PostgresDirectorSnapshotRepository.readOnly (~1072)
at coordinate (npc-agent-advance-services.ts:458)
```

根因证据：测试夹具的 opening context / authored materials 与当前 director v14 的 opening authority 形状不一致，不是本批测试新增逻辑。需要主 Agent 更新夹具后再判断连续旅程。

`episode-action-outcome-awareness` 同样因 `OPENING_CONTEXT_AUTHORITY_CONFLICT` 失败；`episode-journey-evidence` 需要独立测试集群端口且当前不可用。

## 3. 全员 quiet / no_current_intent 停滞审计

### 当前实际路径

- `agent-schedule-collectors.ts` 生成 candidate 时包含 plan/action result 证据；
- `npc-agent-advance-services.ts` 每次 `consumedCandidateIds: []`，并通过 `read.prior` 按 `wakeCandidateId`/确定性 commandId 找到历史 attempt；
- 已 committed 的 quiet attempt 在 `wrap` 中 `prior?.status === 'committed'` 后 `continue`，该 candidate 不再被选中；
- candidate 的 commandId 由 `agentWakeCommandId(worldId, candidate.id)` 或 prior wakeCandidateId 决定；candidate.id 是否随新 result/条件变化，决定了是否会永久 quiet。

### 判断

- **确实没有可执行事项**：collector 不应产生 candidate；这是合法安静。
- **已有合格 result/条件，但旧 quiet 记录压住**：风险在 `npc-agent-advance-services.ts` 的 committed→continue 跳过逻辑，以及 candidate identity 未把新 result proof 纳入稳定身份时。
- 当前 `922f8d06` 已让 completedStep 替换 plan trigger 并生成 result proof，collector 单元测试证明新 result 会重新产生 candidate；但真实 advance 的持久 attempt 身份和 `consumedCandidateIds` 空数组仍需用真实 PG 连续旅程确认。
- 需要主 Agent 检查的最小位置：
  1. `agentWakeCommandId` / `wakeCandidateId` 是否包含 result/evidence identity；
  2. committed quiet attempt 是否只对**同一 candidate identity** 幂等；
  3. `read.prior` 是否会把旧 quiet 记录错误匹配到新 result；
  4. 下一唤醒依据/待办是否可观察输出。

本批没有直接修改状态制造“已重排”；上述作为真实阻断清单。

## 4. 重复确认

现有 `episode-defer-reconsideration` 设计验证：

- 同人物 decline 后不被重复邀请；
- 同一条件 mature 后只唤醒一次；
- 全员 decline 后进入 withdrawal；
- 无关聊天不产生新 wake。

但该测试当前被 opening context 阻断，不能算通过。需要主 Agent 更新夹具后，按以下业务身份重跑：

- 同一 invitation/request 的 `requestId`/episode id，不是文字相似度；
- 同一 actor 的已答复 receipt；
- 同一 question 的 questionId/responsibilityId；
- 不同事件来源提出相同文字时，仍按业务身份判断。

## 5. 导演结果与人物选择

已读 `922f8d06` 和 `episode-journey-evidence.test.ts`：

- 导演结果观察来自真实 episode result/source；
- 人物选择通过 `episodeDecision`/episode receipt 持久化；
- `knownByActorIds` 控制知情，不把导演观察广播；
- 现有测试设计已覆盖“导演 intent 不是 action result”“人物拒绝是独立里程碑”“子步骤不等于整体完成”。

当前阻断仍是 opening context fixture 冲突（上述），不是新的导演状态表缺失。不能在没有真实测试的情况下声称导演已可靠控场。

## 6. 通过 / 失败 / 未验证

### 已通过

- `result-reconsideration173.test.ts`：2/2；
- `tests/agent-schedule-collectors.test.ts`：34/34（真实 result 成功/失败、旧执行地点失效、不重复、不完成 goal）。

### 实现/夹具问题

- `episode-defer-reconsideration.test.ts`：OPENING_CONTEXT_AUTHORITY_CONFLICT；
- `episode-action-outcome-awareness.test.ts`：同一 opening authority 冲突；
- `episode-journey-evidence.test.ts`：需要专用本地集群，当前 55432 不可用；
- `actor-plan-next-step.test.ts`：硬编码 55600 独立集群，当前未启动；
- 这些不是本批新增测试的失败，但不能算连续旅程通过。

### 尚未验证

- 多人物 A 等待/B 推进的完整真实 PG 旅程；
- 全员 quiet 后新 result 能否突破旧 quiet；
- 同一邀请/问题按业务身份去重；
- 导演 next-wake 与真实结果反馈的页面/公网体验；
- 长期主动推进。

## 7. 主 Agent 最小接线

1. 修复 director opening context 测试夹具（episode-defer/action-outcome）；
2. 在真实 advance 中用 result proof 身份重跑连续旅程；
3. 检查 committed quiet 与 candidate identity 的幂等匹配，避免旧 quiet 永久压住新 result；
4. 补 A 等待/B 推进、拒绝/暂缓/无关聊天区分；
5. 补 next-wake/待办去向可观察输出；
6. 全量门禁、真实模型、部署。

## 验证

- `npm run typecheck`：通过；
- result-reconsideration：2/2；
- schedule collectors：34/34；
- 其他旅程因夹具/独立集群阻断，未计入通过；
- 0 真实模型、0 生产写、0 部署。
