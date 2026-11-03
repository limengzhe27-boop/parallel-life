# ACTOR-CONTINUITY-33 人物任务接续与资料归属

负责人 root-continuity33；主目录 main。子任务 EPISODE-CONTEXT-33 负责已承接材料，ACTOR-DEFINITION-29 负责资料修订及原来源保护。原存档写入、真实调用和集成由 root 串行执行。

## 原存档证据

目标是原“渣男体验” `2fb97a4a-7282-4d75-8a5c-67faf44a3188`，本地克隆库。核对基线 v381：140条消息、381条事件、378次人物attempt、24个共享事件；六人当前goals/plans均为空，continuation为no_current_intent。这是状态证据，不把quiet解释成有剧情进展。

- 林白语、李之之没有收到任何历史agent_episode_requests；两人最近snapshot也没有episodeFollowUps/episode-intent。无法把这两人的沉默归因于“已派任务被忘记”。
- 同学聚会、合同、喝酒邀请等材料在当前资格检查中为eligible，prerequisites为空；资格代码没有把原稿叙述自动变成硬条件。历史导演把尚未提出的喝酒邀请按“玩家尚未接受”延后，并把其他事件挂起作为同学聚会的等待理由。
- 绑定作者版中的青青/林白语五类lifeModules内容确实相反。按稳定actorId/actorKey核对完整维度；不是按数组顺序或同名推测。历史首次错误录入证据见PERSONA-LINEAGE-01。

## 本批处理

1. `6da97e02` 集成：已认证episode-intent允许原authored fallback；未结束参与记录不再在分类前截断为最近24条。旧付费快照只接受原精确24条投影，不能任意删项恢复。
2. 导演原作者材料段落明确邀请入口与接受后阶段，其他事件挂起只限制依赖步骤；不改资格、不给固定台词、不强制人物参与。prompt版本v35。
3. 资料修订走同一事件与状态仓储，旧作者发布版保持不变；修订后的材料供私聊、导演和现场共用，历史选择、计划和来源继续有效。相关作者事件凭真实资料修订获得重评依据；不清空旧评估、不改paid请求身份。

## 验证与接续

集成：6da97e02（事件上下文）、21237652（资料修订）、d2ac0593（修订重评与导演入口语义）、0f3f46f3（测试端口可配置）。

- `npm run check`：4176/4176；boundaries766、typecheck通过。
- 集成真实本地PG：actor-definition29/actor-definition-agenda29合计4/4；player-episode-manifest 11/11。第一次manifest因子任务固定个人端口失败，改为仅显式设置时核对端口后通过，未改业务断言。
- 隔离生产构建 `.local/build-continuity33` 成功，避免覆盖运行中的旧构建。
- 本地clone应用0121。原档青青修订事件c2257ed8…在v384、林白语1a536e7d…在v385；修订前后逐项比对人物状态，只有definitionRef/revision/projectedWorldVersion改变。原消息、计划、问题、选择保留。
- 原作品50faae30…通过PublicationRepository.save将草稿1更新为2，只纠正这两人的lifeModules归属；不可变发布版1未改。修订及草稿原值备份在忽略的.local/continuity33，不含于Git。
- 现有3218更新到本构建，健康检查200；同地址play.localhost:3218，3219未重启。队列和主动worker更新为本源码。不是生产发布。

## 原存档真实结果：尚未通过

2026-11-03 07:23:17 UTC开始：先经原advanceIfEnabled有界入口执行，再恢复正常worker，未发送玩家台词、未重试已消费的同一材料、未手工补消息。截至读取v396，本批原档4次导演、11次人物真实调用；消息仍140，六人goals/plans仍为0。ego-browser打开原档锁屏，显示世界当地04:12且通知为空；没有伪造通知。

导演原始结果：
1. f88aea6a… v385，第一窗口暂缓；三个自主人物静默提交。
2. b1b3d1b1… v388，喝酒邀请仍以“需玩家先主动参与”延后。用保存snapshot和受控模型捕获实际payload，确认event:1对应喝酒、event:2对应出租屋，引用未错配、邀请入口全文未丢失。
3. 下一窗口v391仍将假扮男友邀请等按等待玩家回应暂缓。
4. v393输出consider，但人物任务/actorTopics归属不一致，decodeDirectorWire报DIRECTOR_GROUP_TASK_SCOPE，attempt保留invalid_output，没有重买或假装已交接。

因此资料修订、历史材料保留与正常调度入口已完成，但“人物持续主动推动剧情”仍不合格。不能把changed=true、committed quiet或worker存活当成功。

## 未完成与接续点

- 导演的事件阶段理解：已提供邀请入口，模型仍把邀请与赴约/后续结果混为一体。不能靠强制consider或删除玩家选择保护解决。
- 导演输出协议的人物任务/主题引用一致性：v393真实失败保留在原director_runtime_attempts。应审查actorTasks与actorTopics重复引用能否合并为单一归属，从源头减少填错，保留授权与玩家主语区分；尚未修改协议。
- 没有正式派发就没有人物事件任务；本轮人物quiet不能证明任务演绎正常。需先完成上述交接，再验证自然消息、明确下一步、后续正常调度。
- 当前旧unknown/invalid付费请求原样保留，不以修订资料或改提示词为由重试。
- 原档长期主动演绎仍未通过；生产未部署。本批没有新增业务表/列，没有手动补剧情消息。
