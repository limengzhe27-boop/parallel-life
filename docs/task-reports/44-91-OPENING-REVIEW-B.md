# 44-91｜先私聊后开场的两代引擎审查

执行者 `codex-knowledge88-b`；独立knowledge88树，只读精确root提交 `1bc7cd0e`（所有业务结论通过git show该提交读取），仅本报告／主镜像／本人登记。root唯一源码集成。0数据库、模型、浏览器、源码修改、完整check/build。结论是源码路径审查，不冒充真实复现。

## 结论

不能按“玩家给某NPC发过消息，就注销此人queued开场”修复。普通问候／天气／无关话题不是作者意图得到承接的证据，直接注销会吞剧情责任；有付费未定结果时还可能破坏原attempt恢复。

### Epoch1：queued存在本身不是重复开场证明

`services.ts:advanceOpening/advanceWorld`在native未接管时才调用`advancePublicationOpening`。后者先从opening存储claim一条queued，claimNext把expectedVersion固定到当前world版本，而非原规划版本。随后`resolveTurn`构造最新人物context、回忆，并通过当前publicationCharacterPlanner生成。

`advance-publication-opening.ts`明确提示“先承接本人最新真实对话和已明确的决定，已回应或拒绝的事情不要重发催问；简报仅为联系意图，不证明其中事情已经发生”。它没有把原规划台词直接发送。其finish/reconcile只凭原导演command对应实际非历史assistant消息／成功event确认delivered，不凭任意后来消息冒充开场完成。

因此可能存在模型仍重复问询的实际质量问题，但仅看到queued仍存在不足以证明状态机bug。最小复现需原意图、玩家具体回应、NPC已承接的真实证据、之后实际重复内容，不能仅凭“先发消息了”。

### Epoch2：不走旧opening；真正缺口是玩家回合尚未承接pending交接

`services.ts:232–276`先`agentAdvance.advanceIfEnabled`，非null立即return（quiet同样已处理），不落入旧PublicationOpeningRepository。`readNpcAgentOpeningStatusIfEnabled`的旧phase仅诚实显示未规划，不表示旧queued正在驱动人物。不能用清旧opening表修native事件交接。

实际native路径：Director提交机会→`agent_episode_requests(status=pending)`→`dispatchPendingAgentEpisode`选择资格→origin=coordination私聊输入（JSON npc_episode_consideration）→`readPrivateAgentSnapshot`→同一runNpcAgent/kernel→`projectEpisodeRequestInTransaction`收据消费。

玩家先私聊时走`npc-agent-services.ts`真实player输入与同一人物状态；但：

1. `agent-snapshot-repository.ts:438`只有isEpisodeConsiderationInput才加载待交接事件意图来源，普通player私聊没有这条来源。
2. `actor-episode-intent-repository.ts:308`新事件意图channel_context来源硬限定private+coordination，并校验原JSON requestId。
3. `agent-kernel.ts:231–260`episodeDecision也硬限定coordination＋JSON意图＋输入source。
4. `agent-narrative-repository.ts:398–423`投影对非coordination直接return null；checkedInput还核原JSON与definition basis。

因此在player私聊之后，仍保留pending并由后续coordination评估，符合当前实现的职责边界；它可能造成话题晚到或重复呈现风险，但不能把未消费意图无条件标完成。后续coordination会重新读最新本人状态与对话，亦不能断言它必然重问。

## 最小正确后继建议（未实施）

将“本轮有权考虑的pending事件”作为server-only、可重验的有界manifest附入本人player私聊快照，先最多1条，使用原作者/导演有范围来源；不要改写玩家原text为机器JSON，也不把全部后台事件灌给人物。

允许该人物在回答玩家的同一次调用中，以明确episodeDecision及真实来源表明engage／decline／defer／need_information／quiet；没有相关来源和判断则保持pending。原事务中的投影用这份实际输入／manifest／当前request／持久模型请求证据核验后生成原episode receipt，消费对应request。消费仅代表此人已考虑，不是作者大事件已经发生或完成。

同一修改必须贯穿snapshot、来源验证、领域判定、实际request投喂、kernel及receipt投影，不能只放宽单个origin检查。现有已发paid／unknown request须继续原attempt恢复或明确暂缓，不允许借player新command改ID重买。版本、epoch、owner/actor、forget与原source权限仍逐项检查。

原事件的地点／前提不自动删，玩家聊过其他话题不结算责任；同一事件已有真正决定时应沿原决定调整表达和计划。具体“该意图已承接”需真实episodeDecision／呈现记录及来源关联，不能靠人物发过几条消息判断。

本报告不建议本批root正在做的群语义协调插入临时旧opening注销逻辑。后继应单独登记一项native玩家回合事件交接任务，沿同一人物内核实现，不另建开场旁路。
