# 37-R3-C 当前工作与历史分离

- 执行：current-work39；集成：root。
- 基线：d46a9076；独立分支 codex/current-work39。
- 范围：agent-state-context.ts、npc-agent-model.ts、专属 current-actor-work39.test.ts。

## 实现

`currentActorWorkState(state, referencedSourceIds?: ReadonlySet<string>)` 是只读投影。当前活跃目标、计划、行动、责任为根；未答问题、拒答及焦点问题保留。玩家 decisions 全部保留，并保留对应责任 subject/summary/endReason，避免只剩“拒绝”却不知道拒绝哪件事。显式来源可以选回相关终态。

通过索引和队列闭包保留：plan.goalId/actionIds/nextActionId/supersedesPlanId、action.goalId/dependsOnActionIds/handlesResponsibilityIds/preconditions、responsibility.nextCheck、question.responsibilityId、legacy continuation 的实际依赖。结果条件保留其原行动及 resultId。循环依赖不无限遍历。

NPC 组包在预算与人格裁剪前调用该视图；planNextSteps 与 state 使用同一组计划/行动。移除末尾预算失败才进行的另一套终态删除分支。已有 stateDetailsWithheld 标记省略，没有新增字段、表、模型调用或存储账。

人物完整 state、snapshot 基线、提交和恢复不变。不删除任何持久历史。episodeParticipations 原样传递，父任务负责其读取投影。

## 验证

新测试 3/3；TypeScript 检查通过。

|无关终态计划数|原 state JSON 字符|选后 state JSON 字符|实际模型 messages JSON 字符|
|---|---:|---:|---:|
|0|828|828|16043|
|100|18018|828|16042|
|10000|1739718|828|16042|

差1字符来自现有 withheld 布尔值。数据来自实际 NpcAgentModel 组包，传输使用受控 capture，不调用真实模型。不是 token、成本或延迟测量。

现有 npc-agent-model.test.ts：60项中59通过。剩余旧用例 `long-lived terminal history is compacted before preflight fails the send` 要求删120条责任但保留其120条玩家决定；新实现保留决定对应责任语义，总量超预算，明确 NPC_AGENT_SNAPSHOT_LIMIT。root 已知并接管旧断言；不能为过测试去掉拒绝范围。该测试文件未改。

## root 接线与剩余

source-resolver / chat-context-read 读取所需来源前可复用 `currentActorWorkState`，不要先解析所有终态来源再过滤。传入本轮已验证观察/既有 work source 引用。返回仍为 ActorAgentState，只用于读视图，不能替换落库 state 或 kernel recovery。

NPC 当前会传已验证 wake basis 和 actorObservationInbox sources；普通玩家文本不靠关键词伪造引用。源读取层尚未接线，本批不声称减少数据库查询。

全部历史决定及其责任仍可能达到输入上限；本轮优先正确性，未引入有损截断。需要后续以明确事项关联建立可追溯历史取回，再优化这部分。knowledgeSourceIds 与 episode receipt 读取由原链路/父任务维护。未做数据库写、模型调用、用户原档验收、全量 check/build、服务重启或部署，均由 root 集成后执行。
