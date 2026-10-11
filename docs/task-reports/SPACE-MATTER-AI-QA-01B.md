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
