# 44-44-HANDOFF-P｜世界导演评估与独立 NPC 交接方案

状态：只读方案冻结，待 root 决策；**所有新增接口、SQL81约束、状态与接线均为建议，未实现**。2026-10-15。

执行者 codex-ma44-handoff-p；线程01a11a84-9572-7ab0-92fb-967f963dfc20。独立 publication-story-02/人生剧本，codex/director-handoff44，精确基线 **87cf225eb04e4f76c22115686ed42113669f5091**。只新增本报告、主镜像和本人登记行，全部 source/SQL/tests只读；0PG启动、0模型、0生产、0check/build。root唯一公共契约/SQL81/集成人。已先向root发送主要接口与实际接线图，收到其关于初始basis和外在事件的补充并纳入本文。

## 1. 结论与实际断点

需要补齐两条相连的边界：**世界级评估资格 → 原导演决策**，**导演未发生的机会 → 各 NPC 自己的请求 → 实际回执驱动的共享事件**。继续单运行时、单世界时钟、原有限付费attempt和事务内核；不是再建一个按故事关键词驱动的引擎。

实际87cf225e：

|位置|现在的行为|需要接的最小变化|
|---|---|---|
|server/services.ts:196/226/254附近|advanceStoryOnly、advanceOpening、advanceWorld均先进入同一advanceIfEnabled，epoch2不回落旧导演|三个入口继续共用一个world gate/pump，不单独再启动旧开场|
|server/npc-agent-advance-services.ts:169/295/378|paused直接quiet；coordinate已有75 raw恢复/幂等；额外协调只看observed.needsEvaluation|在原coordinate前加world评估资格，恢复与新增付费资格分开|
|application/schedule-agents.ts:457|无eligible ActorCandidate时早退，不调用导演|世界级ticket不伪装成ActorCandidate；空actor计划时也可启动原导演|
|infrastructure/world-awareness-repository.ts:358|needsEvaluation仅由真实pending reasons的版本范围决定；genesis没有这种event|显式新世界bootstrap许可与一次评估资格，不能靠假event/假actor goal刺激pending|
|advance-services.ts:401/413|导演没selectedCandidateIds即quiet；只执行已选择的原actor candidate，opportunities未消费|即使selected=[]也持久交接opportunities；每次先处理已存在的真实actor请求|
|director-runtime-repository.ts:922–938与SQL75|写private proposed episode；CHECK只许revision0/proposed，UPDATE还被immutable trigger拒绝|81需要合法生命周期投影/回执；改domain枚举或赋status本身不够|
|advance-services.ts:440–458|wake输入仅npc_own_condition_ready，private channel，原source子集|增加真正已存EpisodeRequest来源的collector/typed coordination路径，不把global prose塞入wake|
|npc-agent-kernel.ts:35/69/500|已有同TX afterCommit钩子，重放也调用；native task已有完成回执用途|接episode投影时组合原回调，不能覆盖native task finish；receipt必须幂等|
|SQL0001 outbox_jobs / tasks.domain.outbox / task-repository.enqueue|现outbox必须FK真实world_event，executor只有image.generate；同world scope最多一个queued/running任务|decision不是world event，不能用decisionId冒充event；不能把BUSY的旧task当作所有actor请求已投递|

当前对coordination的NPC提示词说“应有自然回复”，但领域只要求origin=player必有statement。初版应把typed机会考虑也允许quiet/defer，避免强制车轱辘话；不改变玩家真实输入应答保障。

## 2. 世界级资格：有依据才评估，不因每次轮询重新购买

建议在现有组装内加入窄read port，名称由root定，不提前建空类：

`readDirectorEligibility(owner, {worldId,engineEpoch,worldVersion,storyAt}) → eligible(ticket) | quiet(reason) | blocked(protectedAttempt)`。

`DirectorEvaluationTicket`建议字段：`causeKey`、`kind`（bootstrap / authored_qualification_changed / material_global_change / candidate_conflict）、`sourceRefs`、`qualificationHash`、`createdFromVersion`。纳入原DirectorSnapshot保护/hash，claim/request_sent/commit同SQL重算资格；不能让客户端或模型自选ticket。

- **bootstrap**：新世界在明确epoch2创建/激活事务记录许可。绑定原稿时以真实origin/sourceHash/openingKey为依据；无原稿也可用经授权的虚构definition/setting初始观察作一次世界评估，不需actor先有plan。已存在v0或开启页面本身不是自动授权旧档重新开场。
- **authored资格变化**：同一纯资格解释器读取原前提、共享回执、stage/window/实际空间证据；只在blocked→eligible、明确到期、真实结果分支等变化时产生新cause。not_before/window/earliestAt的统一语义由root在此次handoff实现，44-42的原文目录本身不证明条件满足。
- **global change/conflict**：实际跨角色依赖、共享资源冲突、相关玩家拒绝/实际执行结果才可能触发；普通闲聊、自己的plan.record回声、阅读心跳、storyAt自然增加不自动购买新导演。导演一直能读取已提交状态，实时“了解”不等于每条消息都付费重新推理。
- 暂停/离线、未解决unknown、scope/source预算失败不得吞为“模型quiet成功”。恢复原paid raw优先；blocked只阻断其真实world/episode协调范围，保持现有独立actor合法动作继续的边界。

**幂等建议复用75，不新增付费attempt表。** ticket.causeKey由world/epoch、实际触发来源或资格签名、必要node与request revision构成，排除walltime、轮询次数和无关worldVersion。用它导出现有稳定commandId；75 attempt+immutable decision就是一次消费/quiet receipt。保留原full snapshot hash/CAS，不能用causeKey替代完整校验。已committed旧decision只能重放其不可变回执/继续未完成request，不能把旧worldVersion的selectedCandidate直接执行；actor候选须重新收集并校验。quiet后相同cause不重买；invalid/stale/known-expired不因改command名自动再买；unknown维持原slot，不能租约一过就新买。

`directorCoordinationFrameHash`仍做恢复/语义快照校验，但它现在含worldVersion、actorStates等，不能单独当“每次变化就可付费”的产品资格。candidate conflict与world ticket合并到同一次coordinate：一轮最多一次导演付费；不能bootstrap先叫一次、scheduler再叫一次。

不要仅为清掉needsEvaluation就伪造模型quiet或markDirectorEvaluated。可让gate用已有真实来源判断哪些reason已由本次episode事务处理、哪些无须协调；evaluated游标仍由真实DirectorDecision推进，未付费的cheap gate只返回eligibility，不声称完成导演推理。

## 3. NPC如何从零计划开始，且不获得全稿秘密

**有合法初始basis不等于必须有既存goal。** actual readPrivateAgentSnapshot已有`definition:<definitionRef>`、本人已授权历史、与玩家的虚构关系/人格、既有可见事实。这些足以让NPC考虑是否联系玩家、表达本人立场或提出需要获知的条件。不能因为没有script权限就让所有新世界永远awaiting_material。

建议首版`NpcCoordinationIntent`仅：

`{kind:'consider_opportunity'|'reassess_participation', activity:'conversation'|'meeting'|'follow_up', placeOptionIds:string[], basisSourceIds:string[]}`。

它表示**未来、可拒绝的舞台意图**，不是新事实、必须完成的目标或私人态度。placeOptionIds必须是该NPC实际可知的有限选项，不因在global worldBoundary/placeRefs里就有地址知识；允许空。默认不传其他参与人的名单。本人可基于definition/关系/历史提议goal/plan，表示engage/defer/decline/need_information，或不说话；导演不能指定“你已经爱上他/你必须答应/玩家马上来”。

原`AgentInputReceipt(origin='coordination')`可复用，text是严格canonical的typed JSON（requestId/revision/上述有限intent），不加自然语言audit/description/playerImpact。必须经服务端真实request查询和bodyHash核对，不能把玩家发来的相似JSON当coordination授权。输入来源仍是accepted_input；来源语义是“收到考虑请求”，不能当“事故确实发生/玩家答应”的证据。

**不可发送**：DirectorDecision.audit.reason、opportunity.description/playerImpact自由正文、完整script/editorialIntent、A私聊原句、其他actor plans、真实玩家authoritative position或私人访谈；`authored:<nodeHash>`仍只属于导演global audit/opportunity，不能偷塞候选basis再给NPC。父episode/author ref只作server谱系，不是NPC知识句柄。

如需要原稿片段，建议`ActorMaterialGrant`是明确作者准入的recipient/scope/fragmentRefs/sourceHash/contentHash记录，或已存在可见facts/messages的引用；不能仅因actorKeys/participantRefs提到A，就从global script自动摘一段授权A。grant必须标事实/意图/传闻等意义及channel使用范围；无明确知情依据的具体秘密保持未知。先用本人合法basis演绎/询问信息，而不是造假的开场事实。

private_strategy与channel_context继续分开。私聊中可用于本人推理的来源，不自动把原话或全文传入群聊/scene模型；复用44-41的metadata谱系和forget deny graph，新grant别名亦须能被撤销。验收检查整份NPC序列化payload，不只检查observations。

## 4. 最小持久请求、同一次NPC调用与接线图

建议`EpisodeActorRequest`不可变正文：

`{worldId,ownerId,id,engineEpoch,episodeId,originDecisionId,opportunityId,actorId,sequence,intent,basisRefs,materialGrantRefs,sourceRefHash,bodyHash,createdWorldVersion,createdStoryAt}`。

- 每个实际被选为考虑对象的actor一条，不按固定人数；participantRefs不能直接转为知情授权。请求只承诺“该NPC有机会考虑”，不会生成/覆盖ActorState目标。
- createdWorldVersion是谱系，**不是未来所有actor永久执行expectedVersion**。A从v0提交v1后，B原请求仍在；B执行需重读v1/worldclock、本人revision、当前episode revision和授权basis，再用原请求身份绑定本次fresh attempt。不能把v0快照广播给全部actor，也不能每次worldVersion变化都创建新语义请求。
- 后续需重评时sequence+1是新不可变请求；触发源/意图确实变化才允许创建。原unknown/未恢复paid raw不因新sequence被绕过。普通plan/拒绝原语义不改变则不重派。

实际调用接线建议（箭头表示调用/提交顺序，不是新服务）：

```
services.advanceOpening / advanceStoryOnly / advanceWorld
  → 原 npcAgentAdvanceServices.advanceIfEnabled
  → 暂停/epoch检查；恢复已有Director/NPC completion（不新买）
  → 同一世界read：world evaluation ticket + 原actor collectors + pending真实请求
  → 若需导演：原coordinate → actualDirectorSnapshot → 原75 claim/send/save/commit
       同TX：ticket消费receipt + immutable decision + proposed episode + actor request/outbox
  → 已存在request collector（至此才可有该actor候选）/有界pump
  → accept coordination receipt → actual actor/channel snapshot + 最小可见intent/basis
  → 原 runNpcAgent：claim/send/protectedraw → 原 NpcAgentModel 一次提案
  → 原 kernel事务：校验参与判断/能力；真实state/event/command/result
       + finishAgentCommit + world awareness
       + 组合原afterCommit：request receipt + episode CAS projection + 下一步durable工作
  → commit后当前请求完成；下一actor/下一步重读新world/clock
```

原DirectorOpportunity仍为global草案，原ActorNudge继续只操作既有候选。新增request collector的候选必须来自真实存储行和本人的授权sources；这不是拿fake actor candidate唤醒导演。初版可只走实际private channel；群/scene须接已有membership/presence/observableTo/native projection，不把私聊消息复制成群/scene来信。

建议同一NPC提案加可选`episodeResponses`：`{requestId,sequence,participation:'engage'|'defer'|'decline'|'need_information',basisSourceIds,goalIds,planIds,actionIds,responsibilityIds}`。模型仅提出本人判断和已提供/本轮提议ID，不写event/result/version。kernel绑定真实attempt/actor、重写局部ID、核验来源，产生append-only receipt；不用额外模型审查“是否愿意”。`coordination`不能新增PlayerDecision或假quote；拒绝是NPC本人参与判断，不冒充玩家拒绝。

engage不代表动作成功；defer没有真实时刻来源就不能编deadline；need_information可由本人合法提问、等待可见新消息/结果驱动。quiet也能保存request-considered receipt，不能因没有statement而反复派同一请求。现有questions、focus和appointment responsibility互相独立，不因考虑机会清掉未答问题或履行赴约。

## 5. SQL81建议契约：一个请求存储、一条共享回执链

仅root可实施，以下不是已存在对象/授权。

|对象|最小建议|不可放宽|
|---|---|---|
|agent_runtime_worlds新受保护activation元数据|bootstrap policy/sourceRef/activatedWorldVersion；旧行默认不重开场；新世界真实创建/激活事务显式许可|不能依据“v0/打开过页面/缺plan”推断旧档可重新开场；保持epoch单调和现busy fencing|
|75 shared_episodes现表|保immutable decision origin与机会原文；改81为revision单调CAS head及合法status，新增actor请求/receipt汇总需精确白名单|不能只撤immutable trigger就给随意UPDATE；保FK owner/world/origin，不能改旧75校验和|
|新episode_actor_requests|不可变上述typed body+hash；每(world,episode,actor,sequence)唯一；同actor/episode最多一条未完成同语义请求；有界delivery状态/lease/attempt/receipt引用|parent decision中精确opportunity存在且actor在合法consideration范围；body无audit/prose/秘密。请求本身不是事实事件|
|新episode_receipts|append-only，绑定world/episode/actor/request/attempt/event/version、参与判断、实际output/result refs及prev/next episode revision；精确唯一重放键|NPC回执只接受已committed agent attempt和succeeded command/result_event同一world/actor/版本；他人/private来源不能拿来结算；非actor生命周期原因也须明确真实来源|

不另建一套付费attempt、Director队列或全局空dispatcher。请求行同时承担**持久handoff outbox/inbox**：正文写入即durable pending，delivery lease/status为元数据，派发或NPC提交不丢任务；最小首版由已await的actual advance有界pump消费，不能HTTP返回后靠悬空Promise继续。需要后台时再接现有可靠task transport；仍是一份请求身份/原attempt，不能复制正文绕幂等。

**现有media outbox不适合强塞。** 其event_id为NOT NULL且FK world_events，而75 decision/proposed episode不产生world_event；不能伪造event满足FK，也不能把decisionId填event_id。后续真实NPC/event产出的媒体继续原Outbox，episode请求由decision FK承载。若root选择统一generic outbox origin，则必须完整改判别联合/约束/consumer/权限/测试，不是本次最小建议。

现tasks.enqueue同(world kind,worldId scope)有一个queued/running限制，不能同时为N个actor创建N个world任务或把BUSY现有task等同本请求提交。后台首版应单world drain、串行选择真实request；必须精确持久request→task/attempt receipt，没投递不能标submitted。

RLS/grant延续owner=app.user_id、FK包含owner/world。首版不扩大pl_worker/publisher权限；若复用现已租约native handler只能沿已有精确owner/task授权，不把app.user_id字符串当授权，也不给worker全表SELECT。request body、source/grant hashes和origin不可变；UPDATE仅有限delivery/CAS字段，token/lease fencing。episode_receipts禁止UPDATE/DELETE；head只在同TX核验新receipt/prevRevision后更新，禁止直接status赋值或跨episode复用receipt。

锁顺序延续现有：有leased task先遵守该入口task→world，再control/原attempt/actor，新增episode/request锁放在既有world保护后，跨actor/episode取稳定顺序；不能dispatcher先拿request锁再反向等world而与kernel死锁。root实现前以实际native/private UoW核实，所有model调用在短事务之外。

## 6. 共享事件生命周期：相同进度，不是所有人全知

建议保持现四status，但补明确projection语义：

- `proposed`：导演机会及待考虑请求已存。NPC engage/plan.record只是意愿或规划，可更新receipt/revision，不能因此宣称外部事件已经发生。
- `active`：至少有**与该请求实际相连的**已提交演绎贡献（真实message/scene item或注册能力效果），并符合本episode的起始证据政策。邀请发出了只证明邀约/对话阶段开始，绝不证明到场；导演原文引用/metadata lease、纯quiet都不是表现开始。
- `resolved`：明确的有限completion policy得到实际proof，且相关未完责任已正确处理。支持哪种proof先声明：实际invitation response、注册action_result、权威presence、指定question回答/参考词条件各自只证明自己的范围。问题答复可结束“询问信息”目标，不自动完成赴约/物理行动；NPC一句“做完了”不是result。没有可执行完成政策则诚实保持active/等待，不能用多聊几轮或超时沉默自动结案。
- `withdrawn`：明确终止此机会的合法来源/条件已满足并结算剩余请求。单个NPC declined/withdrawn只改自己请求/责任，不关闭其他NPC的事件；不制造对玩家的情绪惩罚。

active状态不自动等于所有作者前提里的after_presented_node；需单独基于真实玩家可见贡献与明确节点presentation proof投影。一般本人问候即使与该episode请求有关，也不能谎称“医院事故开场已呈现”。after_committed_node须依据本节点实际目标范围的committed outcome；不把75 DirectorDecision.status=committed当剧情committed。after_resolved_node依据可追溯实际outcome，不能借不相关NPC退出触发分支。

首次即冻结completion/参与政策及来源；参与引用不意味着人人必须接受。required/optional角色若需区分须明确政策，不能把作者actorKeys直接当全员强制任务。A拒绝后其他人的合法责任、分支与约定仍在；导演据实际receipt决定改机会/后续请求，但不能改旧decision/替NPC重写态度。

所有actor执行按同一world/story clock与最新worldVersion串行CAS；A推进后B重读最新公共进度，实际知情仍按自己audience。共享进度是server的真实receipt视图，不是把A私聊内容发给B。B没获得新观察时可以还不知道原因；其pending请求/已考虑/等待条件仍有明确状态，不能因A说得快就漏掉B或把B的计划直接推进。公平选择按因果依赖与未消费真实请求的稳定次序，不固定按演员数组首项；阅读/思考1x、暂停/约定停止边界继续有效。

## 7. 外在事件如何真的发生：分初始事实和未来发生，不从剧本复制真相

**已有初始情景优先现能力。** 例如“进入时母亲已住院、青青知道并在照料”若是编剧明确设置的开场状态，可由作者准入为该新世界的canonical初始history/facts，并用现initialKnowledge把合法事实明确分配给青青；玩家只有作者给定的已知部分。引用真实immutable genesis来源，保留原稿，不能自动fact.seed给全体NPC。后续NPC用自己的知识告诉玩家，实际消息/场景receipt才构成玩家获知；出生在同cast不等于知情。若当前稿只是未分范围的script，则需编导明确这种初始设置/知情范围，不能靠算法自动提升为既成事实。

**未来外在变故需要另一种明确授权。** 建议后续作者准入`AuthoredSceneOccurrenceSpec`：稳定key与精确immutable source/nodeHash、有限kind、可验证前提/窗口、允许的虚构实体/地点、可执行效果模板、明确observer/披露规则、幂等occurrenceKey。它是对特定虚构场景变更的作者许可，不是任意文字执行器。actor参与人列表不能替代observer规则；玩家实际位置只供runtime判观察范围，不能原样发NPC。

导演只可提出触发已准入spec的typed intent；实际registered capability/runtime executor在世界锁下验证source/hash/epoch/window/CAS/once key，写真实command/world_event/state/receipt和必要Outbox，之后依实际presence/membership/visible cue给合法观察者投影知识。尚无spec/能力就返回unsupported或继续未来考虑，不能假造事故/到场/新canonical fact，也不能让某NPC替全世界盖章。NPC本人行为仍由自己的Agent和原kernel执行，不把导演world intent当NPC已同意。

该层不是本报告偷偷添加incident capability；实际87cf225e private kernel注册执行仅plan.record与appointment.propose，NPC移动/事故/医疗结果等不因此存在。可把首版外在开场状态放在明确作者初始设定；未来变故单独完整实现和验收。保留“愿意演绎的人物”和“需要真实环境效果”的区分，不能因此让所有新世界失去自发联系能力。

## 8. 已知/未知、重放、旧档与验收分层

- Director/NPC原attempt状态与raw保护完整沿用。response_received恢复原snapshot/response零新调用；unknown不可租约过期自动重买；送达后版本/source/grant/forget变化是known stale、保raw/receipt。request lease到期只能转交同一请求的安全处理权，不能重新购买原已送模型请求。invalid/known-stale不改名字买替身。
- 初版不为每次actor世界版本落后自动重买：未发送的真实请求可在最新快照首次处理；已经发送且raw变stale必须保持已知结果/显式重评来源，不能同请求另起attempt隐式重试。
- NPC commit、request receipt、episode projection、awareness、下一durable工作同TX。事务失败后原raw可重放；afterCommit重放也按receipt唯一键无重复episode revision/Outbox。actor/episode/sourceHash改变不能重复消费或双重结案。
- epoch1继续旧runtime；epoch2绝不回旧opening/story表执行。既有proposed episode不批量改active，不补历史NPC态度；旧存档不自动重开scene/事件。显式adoption需要真实旧progress receipt映射及无inflight/unknown的epoch fencing；无法映射保留legacy/read-only状态，不能猜已完成。root当前未启用生产epoch2，本方案不构成启用授权。

建议分层交付，层层真实接线，不堆未使用类：

1. **world gate + own-basis交接**：新世界bootstrap ticket→原Director→原75机会→durable每actor请求→一次NPC自决/回应→真实receipt/episode head。quiet稳定零重复付费、A拒绝B仍可考虑；所有新port必须出现在actual advance调用链。
2. **作者前提与跨角色完整进度**：统一node/time/actor资格解释器，private/真实group/scene channel权限，有限presentation/completion proofs、全局分支与公平调度；才报告“指定开场→多角色持续演绎”验收。
3. **显式作者外在发生能力**：initialKnowledge准入优先，未来OccurrenceSpec及真实注册执行/观察投影另行实现；无能力保持诚实，不把1或2当3已存在。

root实现后真实PG/HTTP最低门槛：v0无plan仍只有一次Director且可独立NPC考虑；相同cause连轮询/闲聊无新增模型；quiet/need_information/defer/decline不饿死其他人、不清questions；opportunity only/bad refs不产生假NPC目标；整个NPC payload无director审计/他人私聊/全script/真实player位置；A v0→v1后B同请求新snapshot合法且共享clock，原raw重放0calls；unknown无隐式重买；source/forget/epoch/active audience/episode rev变化事务无半写；request→actual native message/result→episode revision/outcome精确可追溯；首次plan/邀请/收到答复均不能冒充物理完成；显式外在事实的observer与反例严格验证；跨owner/worker/SQL直写/重复receipt/越权grant/并发lease均拒绝。预算和真实调用需另沿用户/项目授权，本文0调用。

本报告没有运行测试或声称上述功能已完成；仅对87cf225e源码、75/相关现SQL和调用路径静态审查。后续root决定公共契约/SQL81、分配实施、统一check/build/数据库/公网验证及部署；用户世界保持未发布。
