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
