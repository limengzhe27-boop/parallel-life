# SCENE-CONSUMERS-45-M：实际现场投递消费者审查

基线9a48ae02，2026-11-04。root唯一集成；本任务仅只读审查及报告，不修改公共源码、原档、模型或进程。未新增重复测试。

## 结论

没有发现新的、已复现的同步聊天阻塞。44批真实PG已覆盖sceneReply来源、重复请求、下一轮私聊准备、现场回忆私人输入及跨渠道回答；本轮未把这些重测一遍。own-agenda的实际发言读取由proactive43独占，UI/model由root独占。

找到一项确定的消费者覆盖缺口：长期摘要仍只处理phone消息。它影响长时间后的回忆完整性，不等于当前现场消息没保存、不能回答。

## 消费者逐项

|消费者|实际路径|判断|
|---|---|---|
|场景来源认证|actor-scene-observation-sources.ts识别turn.resolved.data.sceneReply.entries，匹配完整entry及presence|已接；不是按input.channel直接拒绝|
|本人计划/主题来源|agent-source-resolver.ts读取sceneReply严格entry；本人private attempt的scene发言经ownEvents认证；actor-known-topic-repository.ts调用同一来源读取|44已有实际来源测试；本轮未发现新断点|
|通知消费与历史召回|actor-observation-consumption-repository.ts先认证历史recall并排除ACK，inbox选中来源才ACK|44连续3轮PG已覆盖；保留旧completion兼容|
|私聊重复请求/回执|npc-agent-services.ts lookup与committed重放均读取真实event.sceneReply回传sceneId|44重复请求已验证，不会要求phone必须有NPC对白|
|群聊/现场任务恢复|agent-task-recovery.ts按原input receipt.channel与task身份匹配|这是输入身份认证；private发起scene投递仍走private恢复，不应将其篡改成scene任务|
|事件参与/退出|episode-lifecycle-repository.ts基于consumed request、participation receipt、attempt/event以及实际状态，不按phone消息数量结清|未发现scene投递导致事件重开或丢参与的直接证据|
|长期对话摘要|npc-agent-kernel.ts约2257按snapshot.channel.kind==='private'调用enqueueConversationSummary；conversation-summary.ts候选和readBatch均只读world_messages|sceneReply只有用户输入在phone表，NPC现场回应不进入这一摘要|
|旧现场记忆写入|sceneConversationMemory仅由scene-repository.ts legacy commitSceneProposal调用|native kernel与private→scene均不走此写入；不能把旧能力当成新入口已覆盖|

## 长期记忆缺口的准确范围

1. 实际sceneReply speech/narration保存在scene_items，phone world_messages不保存对应NPC对白，这是正确投递。
2. 现有摘要候选、读取都只查world_messages。入队虽发生于private输入回合，却看不到场景回应。
3. 近期回忆由readActorSceneRecall读取最近3个现场、最多12条/16KB，短期连续性已可用；更旧未进入结构化计划/事实的现场对白，没有上述摘要路径兜底。
4. 现场长对话经native kernel同样没有phone摘要调用。该缺口涵盖native，并非仅本次sceneReply。

建议后续由记忆任务负责人统一扩展现有摘要候选/批次认证，按本人观察权限读取已有scene_items；不能复制一份现场私聊、把私聊原文广播给所有在场者，或给每个现场另建记忆队列/状态。是否现在实施由root安排；本轮未扩大源码归属。

## 证据等级与遗留

上述摘要缺口依据生产调用点和两段实际SQL确认；未新增付费模型或生产数据修改。没有声称已经观察到原档忘记某句对白。长期记忆超窗的真实质量验收未做，仍为未完成。无新增已确认同步阻断需要阻塞root当前现场验收。
