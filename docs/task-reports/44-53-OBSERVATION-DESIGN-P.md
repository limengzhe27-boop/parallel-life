# 44-53-OBSERVATION-DESIGN-P｜有范围的观察结果与一次评估

状态：只读方案冻结，待 root 契约/实现决策；下述新接口、能力、回执及SQL均未实现。2026-10-15。

执行者codex-ma44-observation-design-p，线程01a11a84-9572-7ab0-92fb-967f963dfc20；独立publication-story-02/人生剧本，codex/observation-design44，精确基线 **867cc7f6**。仅新增本报告/主镜像/本人主表行；ALL source/SQL/tests只读，0PG/model/生产/完整check/build。已先给root简短接口建议，再补报实际模型预算裁剪对ack的影响。root唯一契约/实现/迁移/集成人。

## 1. 最小结论

接普通 `observe.place` kernel action，输出可信**感知回执**，再沿原action result/73/角色snapshot/candidate/runAgent链路消费。不要新知识队列、第二观察Agent或全局playerActual推送。

当前只有粗place、无room/视线catalog时：合法“查看周围”的执行可成功，但结论只能 **inconclusive**；不生成absent/left事实。身份/自身位置/访问权限或参数不合法则执行failed/blocked，不能把未执行混成“没有看见”。observe.room在没有真实房间协议前不进入allowedCapabilities，不能仅因加枚举就宣称支持。

**执行成功≠发现无人；source已存/actor版本推进≠模型已评估；模型原snapshot里有source≠最终请求真的投喂过该结果。** 三个边界必须一起接，否则会产生假缺席、吞观察或重复叫醒。

## 2. 867cc7f6实际源码结论

|实际位置|已有/缺口|设计影响|
|---|---|---|
|domain/space.ts SpacePlace|只有id/name/description/source/contactActorIds/appointmentIds，无room/视区/遮挡|“家里”不是整屋可见；自然语言description不能签发complete coverage|
|B49、space-repository旅程离场与agent-scene-environment|同粗place可被自动列入presence，再把全presence当看见离开|观察新能力不能自动修好旧witness producer；有来源的在场不等于视线证明|
|domain/agent-capabilities.ts、infrastructure/npc-agent-kernel.ts|当前注册plan.record/appointment.propose/travel.begin，无observe执行者|不能用现kind=absent枚举冒充已有观察行为|
|kernel动作循环/AgentActionResult|执行result.outcome为succeeded或failed，completedGoalIds/handledResponsibilityIds由kernel证实|需要独立perception outcome，不能把absent塞failureCode或用scan成功结算找人目标|
|domain/agent-kernel.ts statements过滤|dependsOnActionIds只看动作status=succeeded|scan即使inconclusive也会放行预写“你不在家”；必须增加结果内容边界|
|domain/world-awareness.ts runtime.positionKnowledge|当前只接report/player_report+真实input引用，不接受direct absence|新增server感知receipt分支，不能冒用玩家位置报告通道|
|SQL73与readActorAwareness|知识归observer，source event/version严格；但PK/最新读取按subject+kind，无scope维度|粗place只投影确证place级知识，不能把房间结论上卷或塞无用areaId|
|application/agent-schedule-collectors.ts observations|source.worldVersion<=actor.projectedWorldVersion直接跳过|同次commit在模型之后新产生的观察会被吞；不能简单用版本当ack|
|kernel knowledgeSourceIds、domain/agent-external-projection.ts|会把当前snapshot知识追加；external projection还可在模型前追加source|此数组是已知/引用，不是“已实际评估”的可靠收据|
|npc-agent-model.ts prepare:266–280|按预算删非protected observations，omitted IDs只在实际模型payload里；runner保存原snapshot|单查committed attempt.snapshot.sources仍可能误ack被裁掉的结果；这是B49之外本次补充的实际消费风险|

本文依据B49报告及上述源码静态审查，不声称已运行真人/模型/PG复现。继续保留已有owner/world/epoch/CAS、source、forget、本人truth/observer knowledge隔离。

## 3. 最小能力与授权输入（建议）

模型普通action参数只允许有限原始值：`{placeId, subjectKey, scopeId?}`；subjectKey是player或本人已有合法身份依据的actor，不能按全cast探查陌生/隐藏人物。当前scopeId缺省可代表“这个粗place的有限查看意图”，不意味着完整扫描；显式未知room/scope引用返回安全失败，不由模型起新房间名。

可信执行frame建议：

`evaluateBoundedPerception({world/epoch/version/storyAt, observerActorId, ownPosition, subjectRef, scopeRef, localEvidence}) → rejected(reason) | executed(perception)`。

不是新runtime；domain纯判定，SqlClient在现kernel内提供经校验的scope/evidence。模型不得提交coverage、看见/无人结论、目标真实位置、观察时间、source event或receipt ID。

**PerceptionScopeRef**最少world/place/scope identity、source/version/hash、modality、observer/access许可、coverage（complete/partial/unknown）、有效条件。其来源只能是：

- 明确准入的作者结构化视区/小空间设置，经immutable seed/publication来源映射；
- 实际已提交的、明确表达共享观察范围/访问许可的runtime事件；
- root以后真正注册的有限系统观察政策。现default_travel_v1不是观察授权，不能按地点名或“家/客厅”关键词凑完整覆盖。

无结构scope时可构造**coverage=unknown**的粗place尝试frame，依据本人实际at位置和合法place引用；不能构造complete，也不能凭scene.presence或actorRefs授予房间/出口视线。自身unknown/in_transit、跨place、无访问许可、subject无合法依据、模态不支持是执行资格失败；不是一次可信的“扫描为空”。

kernel先核本人73 actual at、scope许可/版本/时间/source hash、目标身份、action能力与实际观察范围，再决定是否能够判定。没有这些权限/coverage时，不能先查询全局playerActual再包装一句“你不在这里”。

内部确需世界真值裁决时，只在授权有限scope内查询**目标是否可证实在所查范围**，不返回其其他地点/旅途/离开时间；可以只读取所需局部判定，不把整份target实际位置灌snapshot。目标位置本身只有coarse home而scope是某房间、无房间定位/视线时，即使room“声称看完”也不能确认人在房间或房间为空。无法判定就inconclusive。完整视区与真实目标空间分辨率都足够，才能产生肯定/否定知觉。

## 4. 回执与73投影：执行和认识分开

建议由server在原 `AgentActionResult.document` 增加有类型的perception结果（或精确outputRef关联同event的receipt），随 `agentRuntime.perceptions`保存同一真实事件；字段包含receipt/action/result/event/world/observer/sourceVersion、subject、scopeRef/hash、observedAt、coverage、outcome=seen/absent/inconclusive、有限reasonCode与证据引用。source/回执只有kernel生成，Proposal不能直接写。

|情况|action执行结果|感知结果|73知识|
|---|---|---|---|
|合法查看但粗place/覆盖或目标分辨率不够|succeeded|inconclusive|不写absent/left；保留原知识历史，不把不确定当新确定事实|
|真实完整可视范围内确证目标在场|succeeded|seen|observer-owned at，严格scope，learnedAt=观察时刻；不推目标到达时刻|
|真实完整范围内确证未见目标|succeeded|absent|observer-owned absent，仅所查范围，occurredAt=null、learnedAt=观察时刻、possiblyStale=true|
|无自身位置/权限/合法scope等，未执行|failed/blocked|无感知结论|不写知识，安全failureCode；不伪造一次成功查看|

“没在这次范围中发现”不等于“刚离家”“去了公园”“故意躲我”，更不等于世界位置变更。目标真实位置、约定/goal/episode状态、其他NPC知识都不因扫描自动改动；completedGoalIds/handledResponsibilityIds初版保持空，不把执行扫描当找到人/履约。

当前 `occurredAt`没有“目标被看见那一刻”和“目标何时到达”的细分类别。新at感知应采用保守语义：learnedAt说明观测时刻，occurredAt不填抵达时刻；如使用observedAt字段应显式类型，不让旧消费者把它当移动时间。新absent明确occurredAt=null。sourceKind=direct只认证这次有限感知，不赋全局真相范围。

`inconclusive`无需硬塞SQL73的kind；先留在原action结果/typed receipt，经observer自己的action_result source进入原snapshot.observations(kind=result)。保留之前at/absent为“过去的、有时效”的记录；本次不确定不能删除历史，也不能让UI把旧位置渲染成实时位置。

立即left是另一种事件：必须有实际离开crossing时、该observer的明确出口可视/见证证明。无证明时旧travel producer不能再生成“亲眼看见离开”的canonical fact。后来查空房不能回填离开时间或目的地。该producer修正可由B52独立小批交付，observe.place上线前至少联合验证两条路径，不能以新增扫描能力掩盖旧过度授权；对已存历史只做有来源的纠正/失效，不静默删玩家历史。

## 5. 防止succeeded放行错误对白

现 `dependsOnActionIds`只能证明动作执行，不证明感知内容；`result.outcome='succeeded'`和failureCode都不能代替perception.outcome。

推荐最小首版先采用**分阶段语义**：

1. 提议观察的这次模型尚未看到kernel结果，不能基于该新action发表发现结论。新observe相关结果对白不得仅通过旧succeeded门槛放行；可保留不宣称发现的本人意图表达，或合法wake quiet。不能把预写“房间空了”作为action succeeded的通用后果。
2. kernel保存实际perception后，在下一次**本来获准且有预算的**NPC评估中提供有限结果，NPC用自己的口吻考虑联系/继续查找/安静。不是每次scan自动再买一轮；未获准时结果保持未评估，而不是假装已知或编造固定问句。

若root要同一调用预写不同结果分支，则须显式 `requiresPerceptionResult` 等统一typed predicate（精确action/receipt、scope、subject、outcome），由kernel在真实结果后选择匹配对白；不能复用dependsOnActionIds。后续action触发器也不能把result.succeeded解释成absent，应复用同一结果条件解释器。此为更大的明确实施范围，不在首版偷偷加另一套语义解析。

运行时的typed guard可保证“回执支持哪种结果、哪个范围”，不能数学证明所有自然语言措辞无夸张；模型提示与验收仍须检查无依据离开时间/全屋缺席/去向。不要把普通自由对白自动升为canonical fact。若需要对外声称经过认证的发现，应以typed perception report与真实receipt绑定，而不是靠一句自然语言“我看到”。

玩家输入仍按现规则获得自然回应；若需要延迟到感知结果后才回答，必须明确接玩家请求的pending/结果返回，不能关闭MISSING_REPLY保护或冒充空成功。初版只开放真正可处理的wake/coordination路径也要在产品状态上诚实，不声明互动观察全部完成。

## 6. 不吞同commit新结果，也不因quiet无限醒来

新观察在模型调用后、同commit v+1生成，ActorState.projectedWorldVersion也到v+1；因此新typed receipt不能再用 `sourceVersion <= projectedWorldVersion`当已处理。但也不能对所有旧知识无条件去掉过滤，否则重放旧档/旧消息会制造付费循环。

建议只给新协议typed perception sources加入精确消费语义：

- 待处理来源在原action_result/event与73中，sourceId/receipt hash稳定，candidate由actor+receipt ID+scope/source hash构成，不含当前worldV、轮询时间或无关话题。
- 新receipt产生后**不立刻ack**，也不因写进知识表/角色版本/knowledgeSourceIds而ack。world更新、模型context裁剪或其他NPC说话不消耗它。
- 需要有**真实评估ack**，但不必新建ack表/队列。优先复用原已committed agent_attempt的protected completion和实际投喂manifest：同actor/世界/epoch的实际模型请求含完整指定receipt，parse+kernel提交成功（quiet也算）才是一次消费证据。
- 若仅查protected snapshot，必须先修预算选择证据：当前prepare会删observations，而runner保存原snapshot。建议同一个deterministic prepare输出实际request+selection manifest（投喂receipt IDs/hash、omitted IDs、request hash/version），随原protected completion保存。不能让模型在响应里自报“我看过了”。
- 首版把当前selected perception receipt作为server的requiredObservationSourceIds保护，不能budget裁掉，放不下则request_sent前明确拒。Manifest须对应最终payload，不是最初snapshot或仅在sources里保留一个ID。其他被省略的观察不ack。
- kernel同TX只消费本次调用前确实rendered的receipt；本次模型后新执行scan形成的receipt不在manifest中，必须留待处理。source/权限/forget/hash发生变化时沿原known-stale/raw保留，不计为已成功考虑。
- 实际committed wake command的稳定candidate身份可用于快速once检查；但一次正常玩家对话已看过结果时也应ack，不能只认wake command。若需效率缓存，可在现ActorState加server-only ack引用缓存，严格是上述不可变评估receipt的镜像；模型不能写、不能用knowledgeSourceIds混充，不增加独立知识队列。
- quiet提交会记录真正ack，下一collector不再产生该receipt候选；response_received/unknown/invalid/stale不等于ack，原attempt/range blocker保留，不能改ID再买。结果已投喂但事务失败，则恢复同一raw/manifest，成功时只消费一次。

只对已实际读取/授权/投喂的具体来源消费，不用一个worldVersion水位吞掉分页尾部/超预算项。现readActorAwareness有分页/最新投影；旧scope记录被更新也不应让尚未评估的typed action-result receipt消失。后续真正新观察可有新receipt，但需有自己的合法plan/输入/条件；不能“上次inconclusive”就每75秒自动生成新scan来规避once。重查需新的实际来源、等待条件或显式选择，不以无关聊天/空闲为触发。

## 7. 是否需要SQL81/82

**最小粗place版本可先不新建数据库队列或ack表。** 72 action_result的document已是有界JSON、FK到真实event/actor且不可变；新增typed receipt字段/严格domain与serializer、真实kernel producer、resolver/collector/manifest/消费证据均须完整接线。73只在真正支持place级seen/absent时使用现结构；当前无scope的正常尝试通常inconclusive，仅保存结果足够。没有新table不等于不用真实PG验证。

SQL81目前由root保留共享episode/导演handoff，不能为了观察偷偷占号。**真正room/多视区版本需要新的显式空间与知识协议**；若root分配82或后续空号，至少考虑：

- scope身份、immutable来源/hash、访问/覆盖许可实际保存与runtime准入，不只在JSON里放一个从来没读的areaId；
- 73当前PK `(world,observer,subject,event,kind)`不能区分同event同subject的两个房间；latest reader当前DISTINCT ON(subject,kind)也会把不同范围互相覆盖；
- typed knowledge增加scopeRef/observedAt意义，PK/latest/pagination/handle/resolver/forget aliases都带scope语义；legacy place行保留原语义，不能默认“覆盖所有房间”；
- 当前knowledge source handle为event+subject+kind，无scope会冲突；新opaque稳定handle须与原source谱系/撤销匹配，不能用房间ID跨owner或泄露陌生房间；
- RLS/owner/world/event/observer/epoch/CAS保持；任何新增完整覆盖或知识receipt CHECK/trigger只接受实际kernel来源，模型/worker不能自签许可。不得改已应用73校验和。

是否另加ack缓存字段/JSON约束由root定；**需要的是明确有来源的消费语义，不是第三套任务队列**。不要把未实现的room枚举、空scope表或未接消费字段当交付。

## 8. 实际接线图与最小实施层次

```
actual input / existing legal own plan candidate
 → existing runNpcAgent protected claim/request
 → actual clipped request + persisted selection manifest
 → NPC ordinary action proposal: observe.place
 → original kernel short UoW / fresh world+observer own position+scope/access hash
 → bounded perception executor (unknown/partial => inconclusive, never global feed)
 → actual action result + event.agentRuntime.perceptions + ActorState + receipt
 → original awareness projector: only warranted observer-owned place knowledge into73
 → own snapshot/source resolver: local typed result, no hidden actual whereabouts
 → existing collector: unack stable perception candidate, ignore projectedVersion as consumption
 → next already-authorized NPC evaluation (quiet allowed)
 → same kernel commit: rendered-source ack + normal state changes
 → same receipt no longer wakes; new lawful observation retains own identity
```

1. **先修权限与结果语义**：核定B49过度witness producer；实现只具真实资格的observe.place和inconclusive/有限结果回执，关闭succeeded⇒absence的错误放行；无room数据时不宣称room可用。
2. **一起闭合消费**：原result/source/73接线、实际render manifest与required result保护、一次评估ack、same-version新receipt候选、quiet去重；不先上线一个永不被读或反复唤醒的结果字段。
3. **有真空间再扩房间**：scope/视线/覆盖/访问事件和新迁移、scoped知识/别名/分页完整实施后，才注册observe.room与明确departure witness。沿同kernel/73/模型/collector，不另建感知引擎。

## 9. Root实施后的真实PG/模型验收门槛

- 当前coarse home、同place不同房/未知视线：合法查看inconclusive，无absent/left/canonical“看见离开”；没有room ID时不能生成虚构room。非法scope/target、in_transit/unknown own位置、无许可须失败，不伪造查看成功。
- 明确完整小空间scope与真实局部占用证据：seen/absent各有actual action/event/receipt/73同TX；partial/遮挡/目标空间分辨率不足为inconclusive，不能推离开时间/目的地。扫描不改target actual、不履约、不自动关goal/episode。
- 将预写“这里没人”只依赖action.succeeded而实际inconclusive/seen的反例必须不能被认证/放行；typed predicate或后续真实receipt路径正确，不擅自多买模型。
- 只观察者自己的完整模型payload能收到授权局部结果；其他NPC、跨owner、群/scene未授权受众、private strategy原话/实际player其他位置、时间轨迹均无泄露。
- 模型输入v，scan receipt和actor.projectedVersion同到v+1：下一合法collector仍看到一次新结果；quiet commit后不重复。先普通玩家对话消费后不再wake；只存source/被预算裁掉/分页未读项不ack；manifest/input hash验证及预算超限0付费。
- scope/access/hash/epoch/forget/位置在paid期间变化，known stale保raw且事务无半写；raw恢复与最终ack仅一次，unknown/invalid不改ID重买；跨actor/source回执不能消费。
- 同event多范围/最新读取/分页/别名若进入room阶段，必须有数据库约束和真实反例；不只测enum或纯函数。

本报告没有执行这些测试，也未实现任何observe能力。root应按独占契约分配源码/迁移，完成actual PG/必要独立授权真实调用、全check/build/受控部署与公网验证后才交付。所有旧用户历史/世界保持原状，用户世界未发布。
