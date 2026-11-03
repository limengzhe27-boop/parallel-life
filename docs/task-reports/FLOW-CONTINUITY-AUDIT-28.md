# FLOW-CONTINUITY-AUDIT-28

只读基线88d9ce32，0模型/用户档写/运行进程改动；媒体后续修复已由root另授MEDIA-FAILURE-28。

## 确证1：媒体失败状态保存后没有进入人物知情与后续候选

actor-media-result-context-repository.ts约330将failed放pending；agent-source-resolver.ts原698–746只取recent.completed/exact.completed；agent-schedule-collectors.ts原1319–1358只接受phase completed。因此原worker保存明确failed后，读取只看到裸pending，没有人物result source/observation，独立失败后续候选不存在。不是成功入队等于生成完成。

最小复现：原NPC enqueue一次图→原handler确定性拒绝并由runOne.finish failed→readActorMediaCompletionContext返回无source→collect无该媒体候选。MEDIA-FAILURE-28新测试在只补source、尚未复制root collector时实际失败于“authenticated failed result creates its own continuation opportunity”；源与collector接通后原服务PG通过。修复只认证真实失败再沿原source/wake/receipt，不重生图。

## 假设2已排除：当前无“活跃时被交谈注意力延后”的分支

首次报告把npc-agent-advance-services.ts:455–458的全局quiet推导为“某人物因业务attention延后时，会长期冻结其他人物到达”，这个结论不成立，现撤回。进一步核对d9f988e9的真实抛出路径后，没有发现可支撑该场景的业务attention分支。

- agent-episode-attention.ts:27–28：EPISODE_DELIVERY_DEFERRED只在storedClockStopped(clock, realNow)时抛出；没有按当前交谈focus、人物或事件注意力阻挡。
- agent-delivery-activity.ts:31–35：NPC_DELIVERY_DEFERRED同样仅来自storedClockStopped。
- clock-activity-repository.ts:40–46：stopped表示明确paused，或presence-only managed lease过期/缺失；continuous且未paused不因离开停止。
- agent-arrival-continuation.ts:108–123：到达在同一时钟暂停条件下同样应quiet。故在当前语义下，把到达提前也无法合法推进，不能据此新增一套无必要的依赖框架或放宽版本准入。

advance先恢复已保存回复，发生真实deferred就继续，若private response仍保留则quiet，之后才检查物理到达。这种代码顺序当前与暂停约束一致。用户恢复世界后，原回复可用原response继续，随后其他步骤再处理到达；不需要重新买模型。

### 两种保守单批次早退

- 恢复for会跳过batch.handledActorIds已有的人物；这个集合只在runAgentAdvanceBatch本次请求内创建，不跨请求持久化。若同一批次内时钟状态恰改变，旧received可能本轮被跳过，但下一次新请求会重新读取并恢复。
- lookup已因并发提交/退役而不再response_received时，for直接continue，read.prior仍是旧状态，后续global check可能多quiet一次。下一轮重新查库，不形成永久屏障；无证据需要扩大修复。

### 可复用已有测试与证据边界

- tests/integration/npc-agent-delivery.test.ts:711起：“final commit SQL crosses actual activity expiry ... resumes exact protected raw free”验证原response_received、原hash/token/身份不变，恢复后committed且calls仍1。
- tests/integration/agent-arrival-continuation.test.ts:673起验证paused/presence-only expired/away均quiet；650起验证continuous离线仍真实到达一次。

本次仅只读重核上述源码和已有测试，没有重新运行这些未修改的PG套件；不声称已实测“A注意力阻断B到达”，因为当前不存在该前提。不改advance、commit版本或到达仓储，关闭这一假设，root已同步纠正。

## 已存在的正向链路

commitDueAgentArrival同事务保存actual position/journey/event并调用joinCurrentAgentScene；后者只加入玩家当前、同地点、已打开且有time_place entry的active scene。未知/仅口头到达不能入场。native scene task依据原input版本与当前presence交集选人物；无人分流respondToEmptyScene，非强造NPC。场景/行动结果仍由原内核与生命周期处理，未看到可额外确证的第三问题，审计不扩范围。
