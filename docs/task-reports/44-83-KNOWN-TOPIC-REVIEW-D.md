# 44-83-KNOWN-TOPIC-REVIEW-D

状态：待 root 选择与集成；这是设计审查任务 83，**不是 SQL migration83**。Owner `codex-ma44-known-topic83-d`，session `/root/authored_eligibility_63`。独立树 `author-eligibility63/人生剧本`，branch `codex/known-topic83`；只读基线 **`3ddcbf6d4c7ad1da1b915e897b29cea289ed3745`**。只新增本报告/主目录镜像并短锁更新本人主表行；0 DB、模型、生产、UI、纯测试、fullcheck/build。下列类型/helper 名都是建议，当前未实现。

## 最小可交付结论

不要求作者再填任何块。沿同一个 Director opportunity → committed decision → SQL81 request → private NPC snapshot → runner/source gate → kernel/receipt，增加可选的 **逐角色已知主题引用**。导演只从服务器实际渲染的授权目录选 ref/hash，不能提交新的 task.text、quote、目标人物、私有态度或执行参数；内核把固定“可自行考虑跟进”意图与原本获准的条目分开投影。首片只覆盖本人已有 goal/plan/responsibility 与真正可读的 canonical fact，不包含导演自由摘要、他人任务、泛化 raw event、private transcript 或新背景事实。

这能让即兴机会具体到已有事项；不能凭函数证明任意剧情文本蕴含于这些事项。没有合法条目时仍应 quiet/defer/普通无具体交接，不能把全局 description/audit 补作正文。旧 typed offer/message/invitation、79显式首段提示各走原路；不得借 known-topic 省略 authoredEventKey 绕作者资格。

## 当前可复用的精确来源与不足

|现有对象/位置|可复用的身份/完整性|仍缺什么|
|---|---|---|
|`director-runtime-repository.ts:394` `directorSnapshotInputHash`|完整 canonical snapshot SHA256，受75 immutable attempt snapshot 与 decision(inputHash,attemptId,epoch,V)约束|绑定整次输入，不是逐角色阅读许可，也不是每个 topic 的稳定内容哈希|
|`director-snapshot-repository.ts:665`|`plan:<encodeURIComponent(actorId)>:<encodeURIComponent(plan.id)>`，真实 state plan、knownBy=[actor]；raw evidence 有 worldV/sourceEventId/at/timeMeaning|plan 的 at 是 as-of story time，不能当计划起点或 deadline；无 goal/responsibility 同类 source；无逐项 contentHash|
|`DirectorSnapshot.actorStates` + `actorStateContextPayload`|world/actor/revision/projectedV/definitionRef 和稳定 item.id；白名单显示 summary/status/sourceIds 等|Director 目前读取完整持久 state；白名单函数**不是授权器**，不能把其 raw item 直接称为该 NPC 当前可读|
|`agent-kernel.ts:20` `authorizedAgentState`|按已准 source 集合递归裁剪目标、计划、行动、责任及条件依赖，返回 viewState/redacted IDs|只能接收已经真正解析并过 forget/owner/actor/channel 的 source 集合；不能拿导演全局 source 集合作输入|
|`agent-source-resolver.ts:9` `readActorStrategyBasis`|本人结构化策略所用 source 的真实历史、forget、版本、原生群/scene committed receipt；结果 usage=private_strategy|是历史策略依据，**不是恢复原私聊正文的许可**；通常没有原话观察，不能作为 fact 文本下传|
|`fact:<factId>` + 私聊实际 fact observation|角色 visibility、believedBy 过滤、committed event/genesis来历；NPC已区分 fact/belief|通用 AgentSource 多数没有 contentHash；recordId 常为 eventId，不能把它当 factId。需为选中的精确 rendered fact 新算投影哈希，仍查 raw/prefixed/事件 forget aliases|
|`AgentSource.contentHash`|已有 memory.text SHA256；`episode-intent:<requestId>` 哈希绑定 world/actor/request/ref/path/directive；79 path 含 field/start/end/protocol|不是所有来源都有 hash；authored nodeHash 与 manuscript byte offset 不能冒充即兴 topic 许可；新 topic hash 必须明确新增|
|`agent-snapshot-repository.ts:438`、`actor-episode-intent-repository.ts:55`|原81 request→origin decision→committed attempt/snapshot→opportunity→actor 的精确联查；现 private snapshot 已有插入点|无 authoredEventKey 目前返回 null。应在同 reader 结构中加独立 known-topic 分支，不改 request input 格式、不读未 committed Director raw|

特别注意：Director observations.knownByActorIds 不足以成为新目录。当前 `director-snapshot-repository.evidence` 按 source 类型给 knownBy，但没有使用 forgottenAgentSourceIds；原 raw record 也可能比模型观察正文更宽。其 `readEvidence()` 是导演审计接口，不能转作 NPC 授权器。`genesis:`/`setting:`/`event:` 的合法导演 ref、参与名单、world boundary IDs、当前群成员、场景人物名均不自动授予事实正文或位置知识。

## 建议的最小 schema

```ts
// 服务器生成；id 是命名空间内的稳定 opaque ref，模型不得自行推导路径。
type TopicSelector =
  | { kind: 'goal' | 'plan' | 'responsibility'; itemId: string }
  | { kind: 'fact'; sourceId: string }; // 只接受真实 fact:<id>
type KnownTopic = {
  id: string;
  actorId: string;
  selector: TopicSelector;
  projection:
    | { kind: 'goal'; summary: string; status: 'active' | 'deferred' }
    | { kind: 'plan'; summary: string; status: 'active' | 'waiting' | 'blocked' }
    | { kind: 'responsibility'; summary: string; status: 'open' | 'waiting' | 'deferred' }
    | { kind: 'fact'; text: string };
  contentHash: string; // mandatory SHA256, not model-authored
  // server-only capture also pins exact source identities/hashes/usage + dependency IDs.
};
// DirectorSnapshot.actorKnownTopics?: KnownTopic[]
// server capture stores authorization/proof metadata; model whitelist exposes only
// id,actorId,selector,projection,contentHash, never extra source rows/private transcripts.

// Optional nested member of existing DirectorOpportunity, not SharedEpisode.
type ActorTopicSelection = {
  actorId: string;
  refs: { id: string; contentHash: string }[];
};
// DirectorOpportunity.actorTopics?: ActorTopicSelection[]

// Kernel-projected ActorEpisodeDirective new union member, NOT Director output:
type KnownTopicSuggestion = {
  kind: 'known_topic_suggestion';
  topics: TopicSelector[];
};
```

首片可以限制每 actor 1–4 refs、每机会每 actor 恰好一项且 actor 集合与 participantActorIds 完全相同（只在 actorTopics 存在的新具体机会要求，旧机会兼容）；空数组、重复ID/actor、无目录项、跨actor、错误hash一律拒绝。也可先限单 actor 减小验收范围，不能把同一公开事实 ref 自动复制给参与者。上限是建议，不是当前已冻结契约。

ref selector 只使用 union kind+稳定 itemId/sourceId；不允许数组下标、用户/模型自报任意 JSONPath、任意对象字段路径、字符串切片。确需保留内部 path 时仅由服务器生成如 `(actorId, collection:'goals', itemId, field:'summary')`，字段是枚举，不接受通用 JSONPath。

新 id 建议 SHA256(protocol/worldId/engineEpoch/actorId/selector) 的 namespace handle。contentHash 绑定 protocol、actor/selector、**实际渲染的投影正文和状态**、原 source IDs/record IDs/权威source版本/内容hash/usage、依赖项的稳定值；canonical 排序沿现有字节序实现。捕获 worldV、actorRevision、definitionRef 记录在 server capture header 中供 Director CAS 和原请求来历核对，不塞进“内容已变化”的判定；普通 clock seconds、as-of storyAt、当前全局V不得进入稳定 topic 内容hash。否则甲的真实 receipt 将 worldV+1，乙即使条目未变也永远匹配不了原目录。原条目的状态、正文、依据或授权真变时必须变hash/拒绝；不能只比摘要而省掉 conditions/deadline/proof 变化。

目录必须来自与**实际 NPC 模型输入同一个授权/白名单/预算投影**。先用本人真实 sources、forget 与 authorizedAgentState 生成 viewState，再选该模型确实能看到的 summary/status；fact只取经过本人授权的精确 fact observation。raw state、仅有 source handle 而没有事实正文、会在模型预算阶段被删掉的 observation 均不能假称已渲染。建议提取共享纯 payload 投影及 `readActorKnownTopicsInTransaction(sql,owner,frame,actor)`，让 Director capture 与私聊 reader/发送/提交 gate 共用同一 resolver；避免写第二套“看名字/knownBy就可以”的授予规则。

首片不引入 speech/belief/result 任意 raw topic；以后扩展必须保留原 kind，不能变 fact。own goal/plan/responsibility 是本人将来意图，不能因目录收录而变为已承诺/达成；waiting/blocked 可以考虑，不表示条件已满足；已 fulfilled/withdrawn/expired/finished 的条目不作为新继续执行机会。projection.kind必须与selector.kind相同。deadline 仍只由现有带授权来源的显式 deadline 提供，不能从 summary、导演标题或时间检查推导新期限。

## 真实接线与事务门槛

1. **捕获同一帧**：在 DirectorSnapshotRepository.read 的 RR 只读帧建立 actorKnownTopics，固定 owner/world/epoch/V/revision/definition/forget/来源与渲染正文。现 readPrivateAgentSnapshot/readEvidence 会独立开事务，不能在已锁 world 的 Director事务里直接套整个方法；应抽共享底层 resolver 接收当前 SqlClient。目录字节纳入现1MB snapshot与64K Director模型预算，超限明确拒绝，不静默截断再允许猜ref。
2. **同一次 Director**：domain type、director-agent-model.Output、request whitelist、runtime Snapshot/Opportunity strict schemas 与 validateDecision 都同步接 actorTopics。parse 和持久化验证都要求逐actor的ref/hash确在该次输入已渲染目录中；全局 basisSourceIds 仍仅是导演依据。runtime.current 的发送前与commit复核实际目录/forget；目前只比较 actorStates/cast/authored等，不足以发现不改worldV的 memory forget。不得加一个付费“分解机会为角色指令”模型。
3. **保持81六键输入**：createEpisodeRequests 和 request稳定ID沿用原decision/opportunity/actor。dispatch仍发送现有 npc_episode_consideration 六键、placeOptionIds=[]、basisSourceIds=[definition:...]。topic selection只从 immutable committed decision.opportunity 与 captured DirectorSnapshot 联查，绝不塞input.text新字段来绕SQL81白名单。SharedEpisode只存既有全局摘要；NPC reader不转发其中title/description/playerImpact。
4. **本人可见材料投影**：扩 readActorEpisodeIntentsInTransaction（或内部共享分支）对无authoredEventKey且存在actorTopics读本人的选择，复核原 attempt.id/decisionId/inputHash/epoch/V及request身份。派发允许当前worldV≥createdV，但在当前本人claim帧重新解析所选条目、权限/forget并逐项精确匹配原投影hash；甲提交导致普通全局V变化不会凭空撤掉乙的有效主题。条目真变/撤权则不再使用原主题，不能用新正文替换原请求或靠改名补源。
5. **分离意图与事实**：仍用 `episode-intent:<requestId>` 保护handle、recordId=requestId，绑定 committed decision/attempt/inputHash、actor与refs/hashes。建议新增明确 `AgentSource.kind='director_intent'`（同步所有union/白名单），不要谎称authored/world_event。观察kind=plan，内容仅固定 enum selector 指向本人 viewState；fact原文以原fact source与kind=fact独立提供。固定提示不写NPC最终对白/态度/行动。新fact hash可以存服务器manifest，由统一gate核对，即使原AgentSource本身无hash也不能跳过。
6. **预算必须保护所选主题**：现 NpcAgentModel 只默认保护input、episode-intent prefix、当前question/open责任来源；不能假定它保护任意被选 fact。扩 protectedSources 包括所选实际fact/依赖；被选state条目也必须实际存在于渲染viewState。超预算 fail before claim/send，不能删正文只留ref、也不能仅保存提示而以为NPC看过主题。
7. **不可绕发送门**：延用runNpcAgent canonical episode输入强制markRequestSentWithSources；actual store从不可变accepted receipt认定episode，snapshot被换type/剥光sources也必须失败。validateActorEpisodeIntentSnapshotInTransaction扩确切refs/hash/directive与独立fact观察；private_strategy不得伪装成这次channel_context。沿原 world→clock 锁、requireUnpaidEpisodeRequest(真实pending/nullreceipt/无其他paid attempt)、owner/actor/epoch/V/token/lease/定义/状态CAS，再实际request_sent；最终kernel同事务重核。普通 nudge 保持 enum+候选本人basis，不能拿 actorTopics 去放开旧 nudge自由text。

## 历史策略与恢复必须分两种读取

- **delivery read**：当前request仍pending、输入确切匹配、所选topic当前正文/状态/授权hash与原capture相同，才能新发送。已有paid/unknown/invalid/stale的request不能换command来重买；source失效不能映射成“临时activity延后”伪造可重新派发资格。暂停导致0sent的cancelled恢复仍走现有已证明sent/raw皆NULL的身份恢复，不另建重试协议。
- **strategy read**：NPC实际已提交自己的选择/目标后，历史选择可以继续作为本人的策略依据。不能要求原goal/plan永远active且正文永不变化，否则它正常完成后反而抹去本人已形成策略。应核对原committed Director capture+该NPC真实committed attempt/receipt里的已授权refs/hash、当前forget/权限，再仅给private_strategy handle和现有通用说明；不重新展开原提示/事实私聊正文。原topic的新状态不追溯改写原raw，也不自动转作新任务。

底层topic被遗忘的raw/prefixed/event aliases也须穿透历史proof检查，不能只查新episode-intent handle；原committed capture不构成绕forget重获原话的权限。若未付费request的topic已经变化/撤权，当前81没有“未评估撤销”状态，必须诚实保持pending/失败，不伪造consumed/quiet receipt，也不能自动删actorTopics退回无门槛泛任务；是否增加显式撤销属于root另行契约决定。

这两类读取建议显式参数或内部独立函数，不拿 send-only requireUnpaid... 当历史读取器。当前actor-episode-intent reader依靠作者不可变内容，扩为可变known-topic后必须设计这一分离；否则会出现已消费来源不再可用或历史权限被当新发送授权两个相反问题。

私聊以外继续走 readNativeAgentSnapshot、readActorStrategyBasis 与历史 group/scene perception receipt；同群曾见过某条消息不等于其他群也获原话授权，当前成员不等于历史在场。新intent handle在后续private/group/scene只支持本人结构化策略，不重播导演选题、他人任务或原私聊。scene实际presence/position仍按原机制验证，本片不借参与者清单创建在场。

现 advance `npc-agent-advance-services.ts:224` 优先恢复 private response_received（同worldV/actorRevision），runNpcAgent使用原protected saved snapshot/raw；不要因为增加目录而先构建新主题导致合法raw无法恢复。仅暂停/失活/深聊暂缓保留response_received，恢复零模型重进原kernel；forget/版本/真实来源冲突仍按现规则终止stale。unknown仍保留不确定，invalid/paid-stale不换新身份。late SQL失败保留raw、原attempt免费重试；committed replay先查真实回执，不能重新投影当前世界假造第二个结果。目录本身不新增evaluationCause、不按每tick过时钟重评；重复投递依赖原request/attempt稳定身份，不开第二调度器。

## 生命周期：每一步实际意味着什么

|阶段|可记录的含义|不能声称|
|---|---|---|
|Director committed opportunity + captured topics|可考虑的主题与逐actor引用，原shared episode=proposed|任务已指派给NPC、NPC知晓了全局剧情、玩家已同意|
|81 request pending|该角色有一次待评估机会|已调用模型/已考虑/已发话|
|request_sent|原attempt已发送付费请求|模型收到/行为成功/取消可退款|
|response_received|保存了可恢复原raw|业务事件、目标、receipt已提交|
|kernel committed receipt + quiet/decline/defer/need_information|本人实际作了该次评估，request consumed|事件被展示/共同达成/未来必再次提醒|
|engage且实际presentedMessageIds非空|原81实际presented证据，episode可以active|所有参与者同意、到场、行动完成、目标完成|
|受支持capability实际结果/位置/玩家决定|只承认原内核有证据的相应结果|凭topic、对白或plan.record虚构actual事实|

当前81 SQL允许proposed/active，无resolved/withdrawn通路，本片不能顺便发明“完成”。新主题重复机会也不能只靠旧occupiedAuthoredEventKeys（它只按作者event key）；若要防多次全局变化重复同主题，应在同现有decision/episode/request历史上按actor+refs/hashes查pending/occupied与已实际考虑记录，明确什么真实变化才允许再考虑，不加时间deadline/独立队列。本方案不承诺旧机制已具备即兴主题历史去重。

## SQL形状与实施验收边界

75 snapshot SQL只限制必需header/预算，未禁止新nested manifest；decision顶层严格，但 opportunity元素未逐键限制，所以actorTopics放现有opportunity里、manifest放snapshot里结构可容纳。81 request/accepted input仍六键，SharedEpisode SQL/TS顶层严格，不应复制actorTopics过去。**现SQL只容纳JSON，不独立验证这些新refs授权**；runtime strict schemas/current/source gate必须同步；若要求数据库也独立防伪，root另评估未来迁移，不改已应用75/81/82，更不把本任务83视为迁移号。

仍无法机械证明：选中主题是否对人物有戏剧吸引力；一个goal.summary是否真实反映心理；多个正确事实是否足以支持导演脑中的新剧情；人物最终对白是否适合公开；原稿自由意图是否被忠实演绎。hash只能证明来源字节和范围相同，不能证明语义蕴含、秘密去除或真实同意。首片用无自由正文的选题enum去限制新增传输，不宣称验证任意prose。

后续最小真实验收应覆盖：本人私有goal被选而B不能读；fact正确ID/错误正文/hash/path/actor拒；forget不改worldV仍发送/最终拒；甲提交后乙未变topic仍有效；private_strategy不得恢复原话；预算不能删被选fact；删sources/换input.type/直接regular mark拒；缺catalog旧decision保留旧行为；真实private→group策略；unknown/paid-invalid新命令围栏；late SQL同raw恢复；quiet不active、engage无台词不presented、无capability不完成。这里只读列出未运行的验收计划，root负责下一步公共契约、实现、SQL决定和部署。
