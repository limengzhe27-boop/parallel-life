# 44-67-EDITORIAL-HANDOFF-REVIEW-D

2026-10-16，codex-ma44-editorial-handoff67-review-d，待根验收。只读基线 `f73858b00e7fdcc247031e7d4802ed4110a2c4bf`（核对当前 root history-chat-media 与本人独立树一致）；分支 codex/editorial-handoff67-review。仅本报告/主镜像/主表本人行。0 DB、模型、生产、纯测试、fullcheck/build、产品契约或源码改动。下列接口全部是**待根选择的设计草案，不是现有导出/已冻结契约**。

## 结论

沿既有 Director decision → opportunity → 81 actor request → private snapshot → runNpcAgent/source gate → kernel/receipt 即可补具体交接。不要把 description、audit、script 摘要当 NPC 任务发下去，也不要把 participantActorIds 当知情授权。建议在 opportunity 内增加逐角色结构化 intent：一类引用作者明确允许该人物读取的 perspective；一类只选择该人物当时已经获准读取的主题来源，由代码生成固定“可考虑”任务。已有 message/invitation 桥保留。

这一切片可以使机会有具体主题，仍不能声称能自动安全演绎任意自由原稿。任意导演自由文本即使引用正确 fact ID，也可能把全局秘密写进文本；结构校验/哈希/模型二次审核都不能证明其没有泄漏或完全由证据蕴含。

## 当前真实断点

- `domain/director-runtime.ts:51` 的 opportunity 只有全局 title/description/playerImpact/participants/places/activity/basisSourceIds/authoredEventKey，没有逐角色具体任务。nudge 在同文件81行只是 enum kind + 该 candidate 已有 source IDs；这层限制应保留。
- `infrastructure/director-agent-model.ts` 的 parse 校验 opportunity basis 是否在导演来源全集，**不证明每个 basis 都可给每个参与角色**；全局 audit/机会描述保持导演专用。observations.knownByActorIds 是重要标记，但不是给任意 raw record 整体下传的许可。
- `server/npc-agent-episode-dispatch.ts:129` 实际输入仍为六键 npc_episode_consideration，placeOptionIds=[]、basisSourceIds=[definition:...]。81 的 checkedInput 与 SQL guard 都固化这条边界，不能塞 prose/intent 文本到 request 输入旁路。
- `actor-episode-intent-repository.ts:80` 对无 authoredEventKey 的机会直接保留 null；有 key 时仅 projectActorEpisodeDirective 的明确 offer_message/单人 offer_invitation 可形成 plan observation。editorial_only/director_event/script 没有交接，角色可能确实不知道要考虑什么，不能把 quiet/need_information 当“已理解并演绎原稿”。
- `agent-snapshot-repository.ts:438` 已有一个 request 解析后的附加位置，以及发送前、最终 kernel、private_strategy/forget/budget 的同一来源门槛。扩此处即可，无需第二调度器或新 NPC 执行器。

## 最小建议接口

保持六键 81 input 和 request/receipt 表不变。仅在 DirectorOpportunity 内增加可选 actorIntents，旧 decision 缺字段仍按旧行为读取；新具体机会要求有唯一对应项才给该 actor 下传具体任务。

```ts
// Director 输出只能选引用/枚举；没有可自由生成的 text、quote、actorKnowledge。
type ActorOpportunityIntent =
  | { actorId: string; kind: 'author_perspective'; perspectiveKey: string }
  | { actorId: string; kind: 'consider_known_topic'; topicSourceIds: string[] };
// DirectorOpportunity.actorIntents?: ActorOpportunityIntent[]

// 原稿节点的显式补充；发布时成为不可变内容的一部分。
type AuthorPerspective = {
  key: string;
  actorKey: string;
  futureIntent: { kind: 'task_suggestion'; text: string };
};
// AuthoredMaterialNode.perspectives?: AuthorPerspective[]

// server 构建并存入原 DirectorSnapshot，模型不能提交/扩大权限。
type ActorOpportunityBasis = {
  actorId: string;
  actorRevision: number;
  projections: { sourceId: string; kind: 'fact'|'speech'|'belief'|'plan'|'result'; projectionHash: string }[];
};
// DirectorSnapshot.actorOpportunityBasis?: ActorOpportunityBasis[]
```

建议初片上限：每机会每 actor 最多一项 intent，topic 1–8 个稳定来源，perspective 文本最多500字符；整体仍执行现有字节预算。这些数字只是建议。author_perspective 必须与 opportunity.authoredEventKey 对应真实 node、唯一 actor 映射且 actor 在该机会名单；topic refs 必须全部属于**该 actor**的 server manifest，不能只属于全局 opportunity.basisSourceIds。没有满足边界的具体 intent 时，保留无具体交接并由 Director quiet/defer；不能自动把全局 prose 填补进去。

### 作者 perspective 的准确权限含义

普通自由文本若要下传，确实需要作者明确划出给谁读的部分；不能从 actorKeys、台词人物名、场景参与名单、同段落或“你应该知道”推断。perspective 是授权该 actor 读取这段**未来建议**，不是证明其中任何过去事实为真，也不是直接改写其目标/私有态度。作者需要把角色建议与已有事实分开表达；已知事实仍只能引用已绑定历史/真实事件并通过该角色可见性。

例如“甲可以考虑询问合伙人今天的安排”可作为明确给甲的未来建议；“父亲其实偷了钱，所以你去试探他”包含新事实泄漏，不能因外层标 plan 就自动变安全。程序能验证这段原话确为作者明确给甲的原文，**不能理解并证明它不含幕后秘密**。要接受任意自然语言 perspective，必须把作者/现有发布审核对该段内容的语义责任明确记录；无法确定时不消费该段，不将 LLM 摘要/正则命中冒充已验证。缺此内容授权的旧 editorial_only 原稿仍是未覆盖，不静默解释。

此字段应加入真实 publication contract、内容支持能力、compiler/immutable story source/catalog/hash；不能只加 Director prompt。已有已绑定世界不能从当前 draft 补读 perspective，也不能未经显式迁移接管旧档。

### 导演即兴内容的首片边界

consider_known_topic 不接受导演生成任务 prose。Director 只选“考虑围绕这些你已知的材料继续交流/跟进”及该 actor 已知来源；代码生成固定提示，NPC 自己决定目标、对象、是否参与、何时说和最终台词。这能具体到真实已知事项，例如此前本人收到的安排问题；不能制造一段“他突然知道父亲偷钱”的新语义。

当前片先不把 participant IDs/placeIds 转成角色目标人物/地点知识；也不从 title/description/time window 提取时间、地点、紧迫性或 deadline。既有 typed invitation 仍按明确地点与 earliestAt 下限运行。后续若加 target/place 必须另有该 actor 的已知人物/地点证明；world boundary 中存在该 ID 不等于该人物认识它、人在那里或答应见面。

## 精确接线与来源方案

1. **同一 actor 权限投影**：从私聊 snapshot 当前实际可读的 sources+observations/忘记门槛提取 server manifest；topic 使用实际已获准的 observation 文本和 kind。private_strategy handle 只保留本人历史来源，不授权重新读取/引用原私聊；不能用“handle 在 state 中”恢复原话。通用 genesis/event receipt、导演 private raw JSON、其他人的私有计划、没有 actual observation 的 source 不作为可下发 topic。
2. **同一事务帧**：建议提取一个 `readActorOpportunityBasisInTransaction(sql,owner,frame,actorId,sourceIds)`，与现有 private snapshot/source authorization 共用底层查询。它是 server/infrastructure 内部 helper，不是新执行协议。不要在已锁 world 的 Director commit 中调用会另开多个 db.transaction 的整个 readPrivateAgentSnapshot/readEvidence 公共方法，避免快照不一致和自等锁。`PostgresDirectorSnapshotRepository.readEvidence`（916行）是导演 raw 证据接口，不是 NPC 授权器；其 record 可能比 NPC 可读字段更宽。
3. **同一次 Director 购买**：DirectorSnapshot.read 捕获逐 actor manifest；parseDirectorDecision 校验 actorIntents 的 actor/引用/枚举与该快照匹配；Director store 的 current/send/commit 重新核 actor revision、真实来源 projection hash、忘记、worldV/epoch/attention/qualification。intent 与原 decision/opportunity 一起持久化。不得在 paid 结果解析后再调用另一个模型“拆角色”，也不得为了获得新正文换 Director attempt ID。
4. **原81 request 引用**：createEpisodeRequests 保留现状；actor-episode-intent reader 仍从真实 request→decision/opportunity→committed Director attempt/snapshot 联查取得本人 intent。authored 路径锁原 source/contentHash/nodeHash/perspectiveKey；即兴路径锁 decision ID/inputHash/actor/manifest/projectionHash。不要把未提交的模型原始提案当已授权来源。
5. **同一来源 handle**：继续 `episode-intent:<requestId>`，稳定 recordId=requestId、同一个保护/忘记/预算通道。保留现有 authored source；Director 派生意图建议显式新增 `AgentSource.kind='director_intent'`，并同步 NPC model 白名单，不能伪称世界事实、真实 world_event 或作者原稿。没有新 source ID 调度规则或第二任务队列。
6. **两类材料分开**：建议 observation 永远 kind=plan，包装为可拒绝的未来建议；已知 topic 原话由服务端逐字段读出，作为独立原 source/kind observation，不能把 speech/belief/plan 升成 fact。模型只选 source IDs，原话/格式/哈希均由服务端生成；没有模型自报 quote、任意 JSONPath 或可隐藏秘密的新 text 字段。hash 证明字节/来源一致，不证明语义正确。
7. **发送与最终 commit**：扩原 validateActorEpisodeIntentSnapshot，精确比对本人 intent/hash/观察 kind/text、所引 topic 投影及实际 state。继续按不可变 canonical accepted body 强制 source gate，不能剥离全部 source/obs 或换 input.type 绕过。最终仍复核忘记和通道权限；过去 consumed 来源可供本人 private_strategy 读取，但 send-only pending/prior-paid fence 不可移除。
8. **角色自主与回执**：NPC 自己产出 episodeDecision、goal/plan/action/台词；quiet/decline/need_information 都合法。具体 task suggestion 不直接插入 actor state、actual position、canonical fact、player decision、incident progress 或 episode 完成证明。后续私聊/群/scene 只保留本人实际保存的策略与通用来源说明，不复播作者/导演意图原话。protected raw 恢复使用原快照，不重算新 prose；unknown/invalid/paid stale 不换命令重买。新字段不能变成独立 heartbeat 评估原因。

## SQL与兼容性

SQL75 DirectorSnapshot 是必需头字段+字节预算，未禁止额外 snapshot 键；DirectorDecision 顶层键严格，但 opportunities 元素没有相同的逐字段 SQL 白名单。因此把 actorIntents 放在 existing opportunity 内、manifest 放 snapshot 内，在现有 JSON 容器上**结构上可容纳**，无需为这两个字段另建表或改81六键 input。SharedEpisode SQL/TS 顶层严格，**不要**把 actorIntents 复制进去；由 originDecisionId 联查。

这不表示当前代码已接受：director-runtime-repository 的 Snapshot/Opportunity/Decision Zod strict、director-agent-model Output、domain types/投影/budget 都要根同步修改；source shape 与 publication author perspective 契约也需同步。现 SQL 不验证新 nested 语义，真实授权仍必须由同一运行时事务重核；若根要求数据库独立防伪，应另评估明确迁移，不能声称旧SQL已验证perspective。老 raw/decision 与 typed bridge 需向后可读；不要修改已应用75/81/82或把历史旧记录补造新 intent。

## 不能靠函数证明的语义与验收边界

不能机械证明：任务文本是否暗含幕后秘密；某个自由文本任务是否由所引 fact 蕴含；“甲会喜欢/已经决定/主动知道”是否属于该 NPC 的真实私有态度；改写文本是否仍忠于原稿；“尽快/合适时”是否是硬 deadline；角色实际说出了建议是否等于事件完成。格式合法/含 source ID/同一个 node/hash/模型说已去敏，都不足以证明这些命题。

所以首片只承诺明确作者授权的逐角色未来提示与可机械核对的已知主题引用，不承诺任意剧本自动降密。作者未标 perspective 且没有合法 known topic 的自由剧情仍是诚实缺口；导演可以安静，不伪造“已理解原稿”。如果产品坚持允许导演自由生成每人 task.text，则必须承认这是新增语义生成/审核能力，需要独立评估与不确定处理；不能把它包装成本提案内的确定性 validator。

后续实现的最小验收矩阵：A/B 同事件不同 perspective，秘密哨兵只在授权原文；即兴含全局秘密但无合法 topic 拒绝；正确 ID 配错误原话/hash/actor/epoch 拒绝；speech/belief 不升 fact；private_strategy 不回放原文；移除来源/换 type/缺 gate/超预算零付费；forget 前后与 draft/binding 隔离；unknown/late raw 恢复不重买；consumed/paid-invalid 新命令拒；普通 quiet/decline 不自动完成事件。这里只列验收计划，**没有执行这些新测试、模型或数据库操作**。
