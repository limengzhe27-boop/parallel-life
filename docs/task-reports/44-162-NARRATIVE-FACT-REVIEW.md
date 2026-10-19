# 44-162-NARRATIVE-FACT-REVIEW

基线 d538c049；recovery161_audit，只读审查；root 唯一契约/内核/SQL/集成人。工作树 actor-opportunity161/codex/narrative-fact162。状态：待验收。本报告是设计建议，不代表代码已接通。

## 当前真实链路与缺口

1. `director-runtime.ts` 的 DirectorSnapshot 包含经范围限定的 authoredMaterials、资格、付费 deliberationWindow、已有事实/人物状态；DirectorOpportunity 只有机会、参与者、地点、本人话题、stagingIntents。没有可执行的“叙事事实确认”提案。
2. `director-runtime-repository.ts:commit` 验证原 attempt/hash/世界版本，保存 director_decisions、shared_episodes、requests 并推进导演观察游标。它不生成世界事实事件，不递增 world.version。直接在这里插 world_facts 会缺少成功 command→world_event 的事实权威链。
3. `actor-episode-intent-repository.ts` 明确只投影本人未来任务。161 已加入 v9 具体机会和已授权本人 topics；这些仍不是事实。NPC 不能据此知道母亲“已经住院”。
4. `world_facts` 是现有事实投影，主源是 world_events + commands；Fact 有 canonical/belief、visibility、sourceEventId。`actorContext` 过滤本人可见范围，`agent-source-resolver` 验证源事件与 succeeded command。可复用，不能建立平行故事事实库。
5. **旧 `fact.established` 不足以实现本功能**：reducer 475–488 没写 kind=canonical；NPC snapshot 180–193 会把非 canonical 当 belief。其通用自由文本也没有作者授权、事实类型和关系边界核验。不能直接放行。
6. 当前通用 Fact 没有 occurredAt、每个人 learnedAt、获知方式和获知依据。`actor_position_knowledge` 只负责位置，不应塞入住院等非位置知识。
7. `actor-observation-inbox.ts`、`actor-observation-consumption-repository.ts`、`actor-observation-candidate.ts` 当前认证 scene_entry/group_message，原消费要求真实 suppliedContext+成功 commit、sourceId+contentHash。新增 world_facts **不会自动获得这一套精确唤醒与核销**。
8. `agent-schedule-collectors.ts:observations` 目前覆盖位置认知、邀约结果、媒体结果及scene/group inbox。仅新增事实到上下文不等于会主动醒来。

## 可复用／需修改／需新增

|职责|复用|最小变化|
|---|---|---|
|作者原稿资格|readAuthoredAgentMaterialCatalog、nodeHash/ref、当前资格、deliberationWindow、原response/hash|提案绑定 exact nodeKey/nodeHash/字段与原文范围；只允许当前合格窗口内事件|
|导演持久回执|原 Director attempt/decision、租约、版本、响应恢复|新增有版本的可选事实提案；旧保护响应保持原解释，不重买旧quiet|
|事实执行|world_events、commands、world_facts、world CAS、Outbox|由原世界事务执行受限事实确认，成功结果成为唯一证据；原子绑定decision/episode/proposal key|
|人物知情|actorContext/来源认证、忘记来源过滤|增加通用事实获知证明：actor、fact/source event、occurredAt、learnedAt、方式、依据；不复用位置表|
|主动唤醒|现inbox、候选、预算、公平执行、suppliedContext ACK|扩展受认证 narrative fact packet及消费适配，不伪装成scene/group，不靠消息计数或revision猜已读|
|渠道|现私聊/群聊/现场可见范围|私密获知不自动成为群聊公开内容；回忆与当前新事实分开|

## 最小契约建议（由 root 决定最终名称）

导演在一次现有调用中提出事实候选，包含：原作者节点引用及原文证据、有限事实种类/对象、已有地点（若适用）、本次发生或已有来源确认、建议获知者与获知方式/依据。导演只能建议，不能模型自签“合法”。

内核必须分别核验三层：

1. **可创作的变化**：作者合格事件确实包含该起因/环境变化，且在当前世界授权能力内。事件原稿的可选结果、玩家选择后的后果不能当作当前起因。文字在原稿出现≠已经发生；原文span只证明来源，不能证明时机和语义类型。
2. **真实确认**：有限类型的执行器确定主体/地点、时间、依赖和冲突，记录 immutable world_event/command/结果；幂等业务key绑定世界+作者事件+事实槽位/提案。不得凭free-text或模型自报kind就容许任意canonical。
3. **合法获知**：每名NPC需明确观察/既有作者授权的开场知情/实际告知渠道来源。参与该事件、是亲属/恋人、被导演选中均不是全知授权。人物只得到本人那份事实+获知证明。

最小闭环应有明确有限类型和允许字段，而非开放 `assert_any_fact(text)`。若首版仅支持作者显式给定的外部状况确认，明确将玩家行为、NPC私人决定、到场/移动、支付/物品交付及新增重要人物地点排除。现能力已有执行器的行为继续调用原执行器。

母亲等配角若目前只是原稿提及而非已有实体，不能临时给她编一个可行动NPC。可将“收到有关母亲的消息”作为有来源的报告，但那只证明消息/报告存在，不自动证明事故属实；真正canonical状况需有产品授权的受限背景主体能力。

## 事务与时序

原Director原响应→验证新提案→同一世界锁下执行确认并保存事件、事实、获知记录、Outbox及请求绑定。然后NPC snapshot依据新事实版本构建；不能把确认前snapshot当确认后材料使用，也不能由Director commit后旁路SQL塞消息。

若事实确认改 world.version，需让原导演决策与随后人物请求的版本关联仍可追溯；事务回滚不能留下“请求已消费而事实未确认”。Director机会提出/事实确认/人物参与/整体完成保持四种状态。生成NPC消息仍走原NPC模型和内核。

获知packet复用原候选机制，id由actor+epoch+factId+knowledge proof/hash构造，时间推进/刷新不生成新身份。实际传给模型且原响应成功提交才ACK；quiet可ACK本次材料但必须保留已有后续条件。失败/unknown不消费，protected response走原恢复，不自动再次付费。

## 最小必要验收

- 一个合法开场外部状况经原Director响应→内核确认→获准NPC看到fact，另一个NPC无此内容。
- 仅作者原稿/未来task不能产生canonical；被拒绝/未满足前提/旧nodeHash/非本窗口提案不执行。
- 玩家承诺、已到场、私人态度、未授权地点/人物均不能借事实接口写入。
- occurredAt与learnedAt区分；转述保持report身份，不晋升直接目击。
- 双标签/重放/原响应恢复只产生一个事实和每人一个获知来源；成功处理后不反复唤醒。
- 人物先据事实独立选择是否联系；自然对白不能是后台计划复述；不要求所有人都发消息。
- 原SQL权限/RLS、CAS、Outbox与已有存档内容保留。生产与真实模型验收由root执行。

## 本次边界

没有源码、SQL、模型、生产查询或部署；未读取真实用户存档。161既有报告与第二档合成证据说明“机会送达但缺少经确认的当前事件事实”确为能力缺口；不能据报告把所有人物quiet归因于这一点，自身意愿/邀请仍已有能力可自然表达。

## 人物获知 packet／唤醒／ACK 开发交付

实现范围：NEW actor-narrative-observation-sources.ts；原 inbox/consumption/source-resolver新增叙事来源分支；domain observation candidate新增认证类型；ports仅 narrativeKnowledgeIds 与 authored_context；NEW actor-narrative-observation.test.ts。

- 来源为 `world_event` + `narrative:<knowledge.id>`，仅 private_strategy。读取 actor_narrative_knowledge JOIN事实/事件/成功command；核验owner、actor、版本、canonical单人visibility、事件类型和原premises逐项一致、发生/获知时间。按root指定 narrative-knowledge-v1 canonical内容重算hash，不信单独表中hash。
- 模型只收到确认文本、occurredAt、learnedAt、authored_initial_context，不收到原稿/模块quote或其他人的证明材料。遗忘链保守过滤knowledge/fact/event/decision/nodeHash/sourceHash；knowledge可选contentHash/sourceId也过滤。当前约定未含完整模块hash，不能把quote hash冒充模块hash。
- 原inbox纳入新packet，原每轮12项/16KB限制与遗漏记录继续生效；新增可选narrativeKnowledgeIds为版本界线。旧保护snapshot无该字段时，验证显式排除新narrative读取，原scene/group语义不变。
- 原候选身份以actor/world/epoch/sourceId/contentHash构建，普通revision/时间不重复；generic world_event或无authored_context正文不能冒充。仍由现调度统一执行，允许人物quiet，不插入消息。
- ACK只接受原committed completion实际suppliedContext所列来源，额外重算原completion response_hash、重新认证源packet；未实际提供/遗漏不核销。原scene/group不改变字节语义。strategy引用只回填源handle/hash，不转为群聊公开授权。

必要验证：4项新聚焦覆盖合法投影/时间/不泄漏原稿、错误actor/visibility/kind/command/premise/time/hash、稳定唤醒/精确ACK、原committed response证明；连原candidate 10项共14项通过。tsc通过，boundaries677文件通过，diff/format通过。没有真实模型或生产。PG待root0098事实写入一起验收；本分支不自造数据库事实。

集成依赖：root需0098 actor_narrative_knowledge及事实事务；NPCmodel需在实际suppliedContext.observations中纳入private inbox合法narrative来源（root已协调）。通用Fact本身的群/现场投影是否绕开private packet限制由root同步核对。整体真实主动开场仍未以本地单测声称完成。

## 开场信息授权与原事务提交仓储（44-162-OPENING-CONTEXT-REPOSITORY）

基线603a9dca；新增opening-context-repository.ts与opening-context-authority.test.ts。root负责原Director hook、领域协议、0098迁移、集成与上线；本提交不改公共契约。

readOpeningContextAuthority复用原作者资格目录、人物授权模块reader、不可变initial snapshot与narrative admission。仅唯一合格opening提供权限；occupied不冒充已完成，blocked不给权限。reviewKey绑定world/epoch/nodeHash/sourceHash不随world version漂移。原review或携带同authority的已发送/已有结果尝试阻止重买；原认证zero-send sentinel例外，commit仅排除自己attempt。没有授权module的角色不会被补造背景。

commitOpeningContextInTransaction在调用方现有Director事务内验证保护authority与当前目录一致，defer仅落review；confirm产生确定command/event、每个角色独立fact/knowledge、世界CAS和既有投影，并保存review。无嵌套模型、直接消息、媒体job或旁路调度。旧响应无openingContext时完全不查询新表。

语义已按集成人最新约定收窄：代码把quote编码为received_opening_information，assertion为report、executionEvidence为false。确认的是人物取得作者允许的开场信息，不确认信息内容中的住院、事故、玩家行动、同意或到场已经客观完成。外部背景状态/事故执行器仍未实现，不能拿此能力当任意事实写入。basis保留源码与本人module引用/hash供服务端认证；模型收到的packet不包括全局原稿或他人秘密。definitionSourceId与moduleHash亦已纳入前一packet补丁的遗忘过滤。

必要验证：3项controlled SQL聚焦测试通过，覆盖合格occupied开场/稳定reviewKey、blocked/已review/unknown付费禁止重买、旧响应零新读取；boundaries680通过，diff检查通过。本基线tsc被公共narrative-opening-context.ts的9个TS18048 narrowing错误阻断，已交root修复，新增helper没有类型错误。尚未跑真实PG原Director事务，须由root与0098/原hook一起验收；未调用模型/查询生产/部署，未声称自然开场质量已通过。

## 原入口真实 PostgreSQL 聚焦旅程与 ACK 修正

新增tests/integration/opening-information.test.ts，在本地55587经真实发布编译/玩家实例化/Director v10原runner执行：受控适配器一次返回开场信息确认、作者机会暂缓；产生world version+1、单个本人knowledge；确认内容是report/executionEvidence:false，不改变角色实际状态；另一人物未知，group inbox不给私有packet；Director原请求再次读取不再调用受控适配器，已review authority不会重买。随后NPC真实accept/claim/saveResponse/recover事务提交，实际suppliedContext中的来源被ACK，Director写入本身不构成NPC ACK。未使用商业模型或生产数据。

旅程发现并修正两个实际断点：0095 decision文档白名单未纳入openingContext，由root新0099迁移修复；本人先前新增ACK额外canonical重算与原saveResponse的JSON.stringify hash算法不同，JSONB回读又丢原键顺序，导致合法提交下一轮被误拒。经root授权仅删除这个不成立的额外重算。保留原response_hash合法摘要、committed attempt、实际输入/command/event/版本、原supplied声明及重新认证的knowledge source证明。纯测试改为无效摘要拒绝；不会改变原保护响应或存储hash协议。

聚焦5项（4纯+1真实PG连续旅程）通过。未加入独立故障注入的整事务回滚案例；未声称真实人物自然表达或长期自主推进已通过。集成人继续负责check/build、生产迁移与真实模型体验验收。
本轮tsc通过；boundaries681通过；git diff --check通过。

## 同次主动调度批次接续（1e826a04 基线）

在同一个新PG测试追加新发布fixture，直接调用npcAgentAdvanceServices.advanceIfEnabled一次：受控Director v10确认本人开场信息并安排一个可选机会；同一bounded batch下一步重读worldVersion=1，目标NPC v12收到private presentationContext.internalContext中的report，实际保存回复并完成suppliedContext ACK。该batch精确1次Director与1次NPC受控调用，无额外窗口、无重复购买；公开observations不含私有report。模型载荷检查须包含internalContext，不能误把其不在公开observations当作丢失。完整聚焦PG旅程通过（约2秒）；未改公共源码。

## ACK 后持续私有知情

实际读取确认：原generic fact跳过narrative标记，inbox核销后剔除已消费来源，strategy原仅按已有计划引用返回无正文handle，普通下一轮可能丢失开场信息。修复复用actor_narrative_knowledge认证reader提供本人持久strategy来源，private snapshot合并同source/hash报告正文，不重新放入inbox、不生成新唤醒。群/现场没有获得该正文授权。原validateActorObservationInbox额外对private inbox外的narrative recall逐项认证source和正文，旧无此source不增加此验证依赖；内核现有strategy重新比对继续成立。

原PG追加ACK后下一次普通私聊：原report仍存在、来源不在新inbox，正文篡改与source hash篡改均被原提交校验拒绝。完整聚焦旅程通过；root同步将模型suppliedContext ACK范围限定当前inbox，避免把回忆再次当新通知核销。未扩展事实能力或重写已存记录。
