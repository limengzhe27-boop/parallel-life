# 39：事件派发与过期 unknown 准入统一

基线 7facf70b；wake-recovery39；root集成；codex/episode-unknown39。

## 原存档只读证据

原 2fb97a4a 世界5个 pending 请求中4个已付费终态、1个 available。available 的人物4d924028存在42dbfaa6 unknown_after_send：lease截至2026-11-02T12:49:07.733Z，sent=true，response=false。

`eligibleEpisodeDispatches` 原来按人物存在任何 unknown 就过滤，即使租约早已过期。`PostgresAgentRuntimeRepository.claim` 却已经支持退役过期、无响应的 unknown 来接收另一合法输入。前置过滤让请求永远到不了原 claim。派发在actor_local之前，并非自由联系优先级抢占。

## 修改

- episodeDispatchAttempt读取已有lease/response/event的只读布尔查询结果，不新增业务字段/表。
- episodeActorAttemptBlocks作为dispatch与phone probe共用判断：只有unknown+sent+明确expired+无response/event，才放开人物槽；缺任何证据保持阻塞。
- 同一request的unknown仍由episodeRequestWorkState禁止再次派发。付费历史不删除，不用新ID重买。
- episode-pending-work与phone-entry查询补齐同样证明。

## root公共接线

`npc-agent-episode-dispatch.ts` 现SELECT a.actor_id,...,a.response_hash之后添加：

```sql
(a.lease_until<=clock_timestamp()) AS lease_expired,
(a.response IS NOT NULL) AS has_response,
(a.event_id IS NOT NULL) AS has_event,
```

`agent-runtime-repository.ts` claim现有退役unknown SQL在 `sent_at IS NOT NULL AND response IS NULL AND response_hash IS NULL` 后补 `AND event_id IS NULL`，与消费者严格一致。无须新恢复状态。

## 验证

67条领域/契约测试 + 1条隔离PG旅程，68/68通过；boundaries766通过。PG55684/parallel_life_test，不触及原用户档。原accept/claim/mark创建真实unknown，等待真实租约过期（未改immutable lease），eligible新request得到机会，原claim退役旧unknown并领取新command。原request始终不可再派发，旧command重放仍replay=true，没有多买模型。

范围限制：PG旅程使用原wake accepted input验证claim槽退役，并结合episode纯资格判断；没有伪称已经跑通导演创建→episode原dispatch→人物真实回复。该原入口及真实模型验收由root接线后完成。

独立分支typecheck仍仅因root未提交公共advance接线而引用已删orphanedWakeCandidateIds失败（与本批无关）。无真实模型调用。

## quiet循环诊断

连续3份原档保存snapshot对比，仅localInitiativeContext.observations改变，人物goals/plans/actions/questions一致。两条媒体result的text中observedAtStory每次换成读取时刻，导致同一结果被哈希为新candidate，绕开已消费quiet。root已在媒体context生产端移除机械时间并修对应collector；没有在hash层做字符串特判。

own_agenda是带quiet退避的定期考虑；actor_local是依据变化的考虑。advance通过priorityActors互斥单批，但上述伪变化不断制造local优先候选。先修来源稳定性和过期unknown，不新增第三套调度。
