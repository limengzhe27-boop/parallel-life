# FLOW-CONTINUITY-AUDIT-28

只读基线88d9ce32，0模型/用户档写/运行进程改动；媒体后续修复已由root另授MEDIA-FAILURE-28。

## 确证1：媒体失败状态保存后没有进入人物知情与后续候选

actor-media-result-context-repository.ts约330将failed放pending；agent-source-resolver.ts原698–746只取recent.completed/exact.completed；agent-schedule-collectors.ts原1319–1358只接受phase completed。因此原worker保存明确failed后，读取只看到裸pending，没有人物result source/observation，独立失败后续候选不存在。不是成功入队等于生成完成。

最小复现：原NPC enqueue一次图→原handler确定性拒绝并由runOne.finish failed→readActorMediaCompletionContext返回无source→collect无该媒体候选。MEDIA-FAILURE-28新测试在只补source、尚未复制root collector时实际失败于“authenticated failed result creates its own continuation opportunity”；源与collector接通后原服务PG通过。修复只认证真实失败再沿原source/wake/receipt，不重生图。

## 确证2：一人的注意力延后回复会阻塞无关人物实际到达

npc-agent-advance-services.ts:406–453先恢复所有private response_received；若因EPISODE_DELIVERY_DEFERRED/NPC_DELIVERY_DEFERRED而continue，455–458仍因任何private response_received直接quiet。实际commitDueAgentArrival在464以后，因此本轮根本不会检查B的due journey。

最小复现条件：A有已付费完整response_received，本轮因业务attention不能呈现；B的合法npc_journey已经到ETA且时钟活动。advance先恢复A得到deferred，随后global quiet，B仍in_transit、不会join scene；重复相同检查保持此状态。代码早返回可确认阻断，尚未为该组合跑真实PG，不把只读推导称为实测。

建议：区分A回复实际read-set/提交依赖与B确定性到达；保留A已保存付费结果及原来源再授权，让不改变A相关事实的物理continuation继续，不能简单删除所有保护或重买A。本文件不改该公共服务，root协调其依赖准入。

## 已存在的正向链路

commitDueAgentArrival同事务保存actual position/journey/event并调用joinCurrentAgentScene；后者只加入玩家当前、同地点、已打开且有time_place entry的active scene。未知/仅口头到达不能入场。native scene task依据原input版本与当前presence交集选人物；无人分流respondToEmptyScene，非强造NPC。场景/行动结果仍由原内核与生命周期处理，未看到可额外确证的第三问题，审计不扩范围。
