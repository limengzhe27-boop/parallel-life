# SPACE-MATTER-AI-QA-01B · 真实模型验收前提示核对

负责人codex-matter-aiqa-b-01a11a84-20261011，目录.local/worktrees/nar-03；新分支codex/matter-ai-qa-b自origin/main/6016acd建立。旧codex/nar-03/90d22f6及所有原成果保留，开工树干净。状态进行中；0模型/生产账号/world/图片/上传/DB/HTTP/浏览器。根是唯一真实调用预算执行者（2官方world/12文字含纠错/0图）。仅本人代码静态读取及新测试使用mock模型。

## 确切路径与当前能力

- src/modules/world/infrastructure/scene-planner.ts ScenePlanner.propose构造worldMatterConditions：由sceneMatterId匹配当前world matter并调用matterCriterion，给模型actionAll/observationAll regex.source及completionAllowed；当前没提供world matter.description、requiresWitness、规则地点，也未区分opportunity受控开始。
- 同文件system明确not_started只能in_progress，user尾部重复要求not_started只提in_progress。03C运行时对可信opportunity的实际saved attempt允许同事务受控开始再成功完成；这个旧提示会令第一次完整后续行为只成in_progress，需要额外输入，真实预算可能因此浪费，且体验“做完仍未完成”。
- 同文件system写blocked可failed/partial，运行时world matter只接受failed建立blocked；partial应in_progress或无改变。这是prompt与可信域规则的不一致，不能改domain让partial被当失败。
- src/modules/world/infrastructure/turn-planner.ts已有精简授权context.matters、canonical matter_result/pursuit_result facts及私有acknowledgedResultFactIds方案。玩家和导演回合都收到事实，但可选后续目的/待开始与成果完结的分界只有facts.text；缺显式结果焦点和精确可ack ID列表，正文可能泛泛承接，或漏ack后重复。
- 两处都已要求不造人物到场/钱/图/完整长期目标、不复制幕后ID，域事务仍最终裁决。有限regex达成不是通用语义任务引擎，不能用提示要求模型凭空插入缺失证据以命中regex。

## 申请根批准的最小提示修复（尚未写业务）

1. ScenePlanner只为本次明确related事项提供规则清单；加公开description、rule placeId、requiresWitness与实际可见关联在场ID，以及仅可信已定义opportunity的successfulAttemptCanStartAndComplete。system/user统一：普通not_started只in_progress；已定义机会且本次完整saved attempt满足全部可信条件可completed，运行时受控开始；blocked只failed，partial只in_progress/无变更。不改criteria/合同/状态转移，不编观察来凑条件。
2. WorldTurnPlanner在私有payload加resultFocus，完全来自当前授权canonical actor-scoped matter_result/pursuit_result事实的精确factId/sourceEventId/text；不读取raw world/private records。prompt要求正文承接实际具体成果、玩家尚未开始的可选下一步，第二阶段只说已记录、不声称又有新机会或自动收入；仅明确承接才ack精确当前factId，不相关不ack。已有private解析/receipt不变，不增加public union。
3. 新tests/matter-ai-guidance.test.ts通过capture/mock TextModel验证上述payload/提示一致性、已定义not_started机会与普通未开始区别、partial无blocked指令、NPC只拿给定授权事实、无成功证据时不诱导生成fake completion。本测试不调用任何供应商，不声称真实模型已通过。

根看到方案确认后才改这两文件；本树check需要dev数据库的旧测试，若确需跑完整check将先申请/登记资源（当前本轮禁止DB）。现在先报告发现与批准点，保持其他业务文件只读。root整合prompt部署READY后再做真实预算测试，B不另调用。

## 根批准后的实现及自审

根已批准上述最小修复、候选观察未提交声明，以及独占fresh本地55471 dev/test（旧本人03C cluster完整保存在ignored .local目录，不删除/重置旧数据）。fresh迁移已应用。只修改两planner和新test，没有改domain/contract/actor-context/records/UI/旧测试。

- ScenePlanner版本scene-text-v3-matter-guidance：本次related且同世界player_visible条件才入模，附description、规则地点、实际scenePresent关联人物（不是邀约候选）、requiresWitness。新机会规则通过trustedOpportunity对当前可信snapshot验证；仅实际attempt的not_started机会标successfulAttemptCanStartAndComplete。普通未开始/plan/伪造机会不获此特例。明确partial不能blocked，不要求观察凭空加词凑条件，不强令成功。
- WorldTurnPlanner私有resultFocus只复用已经授权canonical actor-scoped精确source事实；保留私有可选ack规则，未改变解析或public effect。提示要求具体实际结果与尚未开始下一步，长期追求不速通，不发明重复后续/钱/合作/发行，正文不要ID，未承接不ack。
- 同场NPC observedNowSource标明这是尚未提交的候选观察，没有新解锁已保存；当前旧c.world知识不能假装知道新阶段。已保存机会承接在之后WorldTurnPlanner，根按真实样本评语义。
- 预算提醒已发根/Q：每次ScenePlanner任务有1次导演complete，加实际在场最多2人的独立complete；不是每HTTP=1文字。B本轮所有complete皆测试mock，供应商0/生产写0/world0/图0，所有真实预算仅根执行。

新capture测试4项+两个旧planner专项共13/13；完整check750/750（含typecheck/边界）已通过。首次typecheck发现新test的Action.kind误用intent枚举，已改合法operate，并按完整check复测；不修改真实运行类型绕过。build正在本树串行执行，未以编译中冒充成功。日志.local/matter-aiqa-b-{pure,check,build}.log。尚不能凭此宣称真实模型链路或生产已验收；待根集成/预算实测/READY公网。

## 最终冻结

业务c143cf4已发root/Q；独立check750/750、相关专项13/13、build exit0、diff check过，树干净。fresh55471已停止且无监听，无HTTP/浏览器。状态待验收，全部两planner与新test释放集成人；root再统一真实样本、语义审查、最终READY公网。B付费/生产world/写/图始终0，不自行重部署。旧03C数据cluster保留，不用于本轮测试。

## baseline真实样本14只读核对（0新增调用）

根提供14-action-saved。刘航是R17客户有明确来源：县城pack老周persona写车主刘航、约17:55取，repair_customer/repair可见事实及老周-刘航客户关系支持。因此不能把这个名字判为无来源错带入。实际14 storyAt10:02:23Z=18:02，旧约17:55已过，无actual arrival来源；一会儿来了的确定性仍超出了原计划。partial观察明确老周尚未检查，NPC我看看/行了没问题又模糊补成检查确认，不能视为验收签收证据。

拟仅scene-planner添加observedNow.outcome，并提示当前partial/failed与未检查不能被台词改成已检查签收；可提出我来核对。旧persona安排只表示计划，特别逾期须说明原约时间/当前未见，不肯定马上到场、不编迟到原因。根确认后再补相关capture，不改域、不替世界完成结果，预算仍由根独占。

## 根批准的两次partial连续性提示补充

只读16输入与18结果确认：本轮玩家交钥匙/维修单给老周、在交付验收栏签交车时间并留好记录；导演再次泛称记录未完成、老周未检查/签收。允许partial，但应清楚剩余真实缺项；author定义允许向车主或老周，不新增必须车主出现或其他人签名门槛。已有runtime observation条件含验收/签收词，B不改这些域条件，也不要求模型硬补文字或伪造第三方行为。

根已批准同文件最小修复：ScenePlanner版本scene-text-v4-action-continuity，past adjudicated_result在私有history保留outcome；导演明确保留过去已建立的核对、说明、交接、记录步骤，按原描述/可信条件判本次新增实际行为。partial/failed须具体未完成/不支持步骤与原因，不泛泛抹掉已完成记录；不移动可向当前允许接收人交付的门槛；请求对方检查仍只是请求。不复制含NPC行为/意图的环境段落、不为变换措辞造新环境事件。

现场NPC observedNow添加outcome；提示待检查/待确认不能由台词补成检查签收已通过，可以提出核对具体项。旧预约是计划，时点已过没有到场/新确认不能肯定马上来、编迟到原因或新增见证者。没有替14/18改partial或造inspection/signedreceipt。新capture回归覆盖具体剩余项/已有步骤连续/原接收人门槛与18:02的17:55旧计划；相关新旧planner专项14/14与typecheck已过，真实新效果未知，B仍0调用；完整check/build再次待复验。

## 连续性补丁最终冻结

业务553d51f，完整check751/751、相关专项14/14、build exit0、diff check通过。日志本树.local/matter-aiqa-b-continuity-{pure,typecheck,check,build}.log。源码再冻结释放I，55471已停止且无监听；没有HTTP/浏览器/生产写/供应商新增请求。主表回待验收。基线两次partial不能被新capture改写成成功，后续真实修复效果与剩余次数仅由根实账本及Q语义验收确认。

## v4真实修后25仍partial：只读根因分析（不写业务/不调用模型）

根提供20-input、24-task-result、25-retry-saved，unknown85s后根明确手动retry。24 task.status=succeeded/resultVersion10只证明proposal已保存，不等于事项成功；25实际SceneAction.resolution=partial，世界无stage/opp。20玩家明确检查启动、电源接头、填写验收栏检查项/交车时间、交钥匙与单据给老周，25却重复18的“记录尚未完成、老周尚未检查或签收”，NPC又要求把记录留好/以后检查。此处真实连续性验收失败，不能把此前纯750/751检查解释成真实闭环通过。10/12只是根保守账本，B无新增调用，不重试未知请求。

### 可以由代码确定的缺口

1. 裁决与NPC效果单向串行。scene-planner约159–165先导演定outcome/observation/matterUpdates，约259–313才独立NPC调用。NPC仅strict {text}，追加dialogues，不反向更新既有裁决。scene-repository约879–946依据先前p.outcome/observation决定world goal与progress；约1063只把dialogue存SceneEntry。对白确实持久，但没有结构化NPC验收/接收/检查行动及其source/effect，不能把“我检查过/我收了”可信转成完成条件。
2. 导演被禁止执行NPC动作，NPC又受partial不能补成已验收的护栏限制。若导演把NPC检查当必要前提，当前两个阶段都不能合法建立该效果：裁决等待检查，NPC只能说以后检查，下一轮再看到此前partial。这是当前接口对第三方效果的明确表达缺口；不意味着所有目标在当前架构数学上不可完成，独立玩家行为可由导演判succeeded，但对必须第三方动作的目标不能靠台词补足。
3. 没有运行时可累计的部分步骤。SceneAction只有一次整体resolution（succeeded/failed/partial+text），world goal evidence不是“已核对/已写记录/已交钥匙”的有来源步集合；旧history可见但只是自由文本。scene-matter-policy约18–21、218–221仅匹配当前action及observation，不聚合过去步骤。因而语义模型可以遗忘已经完成的记录并重复待做步骤，运行时不会识别“已写又称未写”的矛盾；真实20虽重复完整要素，模型仍未承认，不是ActionBoundary截断。
4. authored endpoint与实现含混。官方description允许向车主或老周说明并交付，没有指定客户必须在场、对方必须签字。当前registry observationAll要求“签收|验收”，未结构化区分玩家验收记录、接收人承接与另一次第三方检查；模型把“验收”理解成NPC检查/签名，容易擅加门槛。action候选又必须与已在场者完全一致，不会因旧persona17:55预约自动把客户加入现场；更不能用加人来绕过原允许老周接收的目标。

### 只能列为假设，不能由现有样本断言因果

- 格式示例attempt默认partial（scene-planner约159）会有先验偏向风险，旧历史两次partial也可能形成续写锚点。25与18多处近似措辞支持“重复旧欠项”的现象；本轮没有中立示例/无旧历史的受控对照，不能宣称这两点是唯一原因，也不能把示例改成succeeded来强过。
- 仅继续追加prompt已在v4正式样本失败；新的长指令是否被模型忽略、模型本身是否过度保守，不能凭纯capture判断。当前不能宣称NPC自然承接了stage/opportunity，因为两者根本没产生。

### 最小下一任务03D方案（本轮不实施）

A. 先冻结R17等具体目标的结构化必要步骤与允许接收人，明确“交给老周可成立”与“另行NPC检查是否真是必要”的产品标准；别按一次paid失败改关键词，也不默默重解释旧v3历史。规则有版本和来源，旧存档/事件不自动回填完成。
B. 给partial真实已完成子步骤建立有source的单调ledger（例如order_reviewed、connector_checked、record_written、handover_to_allowed_receiver）；每条绑定world/scene/action、真实执行主体/接收人、结果事件/version、actual witnesses。保存前校验AI提案与实际saved action/观察，不用自述、关键词或人物肯定语气充证据。后续基于这些步骤判固定endpoint，已经建立的记录不反复变成未写；缺项必须具体ID与理由。
C. 对确实需要人物行为的事项，扩NPC提案为text+有限typed action/effects（当前人物、实际在场、对应当前request/action、具体对象、outcome）；运行时赋id/source并校验知识/权限/目标，和scene事件事务一并持久。随后用运行时聚合已验证玩家步骤+该人物实际效果计算goal；对白只是结果呈现，不能代替typed effect，不引入额外“模型说成功就成功”的通道。可复用现有一导演+一NPC调用，不加盲目第三次裁定请求。具体domain/public contracts与evidence链归下一任务根冻结，不由B本轮改。
D. 把“玩家本次动作结果”和“整个多步骤事项结果”解耦：玩家完成写记录可succeeded而goal仍待真正必要的接收/检验；若原endpoint不需对方签名，不能因额外角色习惯让goal永远partial。stage/opp仍只在runtime确切goal completed后同事务触发，所有旧隐私/回放/回执/幂等护栏保留。
E. 明确验收：同一真实多轮步骤不会复活欠项；允许接收人可达，不必新增客户；需要NPC效果时有正式source可回放；没有该效果时诚实未完成；self report/无关动作/不同world/离场NPC不得credit；重放/重复只一次、Q独立语义审核后再确认真实闭环。下一次模型调用必须新授权，本轮B停止业务及模型尝试。

业务仍冻结553d51f，不新增源码/测试/DB/浏览器/模型/生产写；这里只更新报告及本人接续。此批prompt局部修复已验证静态路径，但真实体验闭环未通过，按根统一记录未通过及03D剩余。
