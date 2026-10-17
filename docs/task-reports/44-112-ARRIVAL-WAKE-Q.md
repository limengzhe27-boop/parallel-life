# 44-112-ARRIVAL-WAKE-Q

负责人codex-ma44-112-arrival-q，集成人限定只读，待验收。全新arrival-wake112-q/codex/arrival-wake112-q自正式6514bd5e；仅本报告及本人主表/镜像。所有业务/契约/kernel/SQL/调度只读，0模型/生产/测试/环境操作，110继续冻结。

## 已有的真实证据

- world-awareness-repository.ts:25–65的projectCommittedWorldAwareness按world锁和原world_events/commands成功回执校验原event/version/owner，真实投影不是根据模型台词造状态。107起现场从真实scene_sessions读取，118起NPC到达绑定原journey。
- domain/world-awareness.ts:247–289的travel.completed核真实from/to/故事时间，写player实际position及new_condition(event ref)。离开观察只能证明从原地点离开，不暴露目的地。
- 同文件291–338的agent.arrival_committed核原journey/route/departure/arrival与稳定arrival_journey命令，写本人实际position；明确没有observerpacket，同地不授予其他NPC知情。agent-arrival-continuation.ts:199–223在同事务保存原command、world_event、成功回执、journey与awareness。
- 同文件342–369的scene.entered/opened/action_resolved根据匹配现场及joined/left版本区间投影实际presence；deterministic scene.opened只呈现既有在场视图，不当新移动。重复读取场景不等于再次到达。
- scene-repository.ts:480起enter/563起enterPlace校验原owner/version/暂停、实际玩家地点，创建scene.entered及真实scene；约520/605初始presence只有player，不从appointment名单/contactActorIds凭空派驻NPC。
- authored-event-eligibility-repository.ts读取真实player位置及初始位置证据，原at_place资格因此改变时可自然产生新qualification。nodeProgress来自真实episode outcome，作者列有地点不证明到达。

## 缺接线

111的新语义重考链仅接player_decision/plan_changed/action_result：authored-reconsideration-evidence.ts SQL只读这三种director_pending_reasons并核原生产者；domain/authored-reconsideration.ts过滤要求ref不是event且ref.actorId属于原作者participantRefs。因此上述new_condition/event ref实际位置变更不进入narrative-wake-repository.ts:91–109的evidenceFor/contextToken。

结果区分：若到达本来让at_place前提从blocked变eligible，已有qualification链可起作用；若事件已经eligible、只是相关人物刚真实到达或玩家进入相关现场，同qualification下目前不会仅凭这个来源形成新的语义context。不能说全部地点事件都不运行，也不能说已接通真实到达重新考虑。

npc-agent-advance-services.ts:305–314到达提交后立即返回changed=true/played0，新版本由后续获准advance重新读取。一次arrival成功不等于本次已调用导演、NPC已参与或剧情完成；不能把早返回本身直接当故障。新唤醒接线应由集成人决定沿原后续调度续接，不能绕活动/暂停/付费门槛强买下一轮。

## 最小接入建议（仅root实施）

1. 独立读取已成功提交的location语义证据，复用原owner/world/epoch/version、commands.status=succeeded且result_event_id匹配、event原payload和awareness来源校验。只接受真实travel.completed/agent.arrival_committed/有效scene.entered；scene.opened需区分新实际入场与deterministic只读环境，scene.action_resolved不能一概当新入场。玩家文字“到了”、locationReport、计划、邀约接受、route出发、contact列表均不算到达。
2. NPC到达按原journey.actorId及resolved participantRefs关联；地点维度按作者material.placeRefs中status=resolved的placeId匹配，保留多个scenePlaceKeys，不靠地点标题相似匹配。player实际到达/入场可按事件resolved地点命中，但不假造player在作者actor名单中，也不要求每个作者参与者都到场。无明确地点的事件如要关联player入场必须另外定义关联依据，不能泛化全库唤醒。
3. 以原eventId/version/subject/place/scene入场区间和作者sourceHash/nodeHash/qualificationKey构造稳定语义证据；参与者或地点无关则不重开。当前与历史已付费评估context必须按对应worldVersion重建，不能用“当前最新位置”回填历史token。新同地读取、世界版本增长、重复scene.opened、无关人物移动不能改变token；真实离开再返回是不同有来源动作，是否值得再评估需明确成本策略，不自动用时间解锁。
4. 沿111原contextToken及持久attempt/receipt去重，保留known失败显式恢复、unknown不自动重付、同原因paid quiet不循环调用。位置证据可触发重新考虑，不强迫bounded_opportunity，不把事件选中、NPCengage或到达改成整体完成。occupied proposed/active episode仍由现有逻辑处理，不借位置变化生成重复episode。
5. 导演全局实际位置与NPC知情分开。新location context只作导演依据，不能把原位置payload直接塞入nudge或参与请求。actor-scene-observation-sources.ts:98起仍需真实本人presence及entry.observableTo，原awareness知识仅合法观察者可得；NPC本人只可知道自己实际到达。若导演要以位置为依据让NPC考虑新机会，须分别裁剪可读材料，不把“全局可见”当“人物知道”。

## 建议文件归属与必要验收

root协调domain/authored-reconsideration.ts、infrastructure/authored-reconsideration-evidence.ts或NEWlocation证据reader、narrative-wake-repository.ts及必要原调度与真实PG专项；若新公共ref形状必须root统一契约，不由辅助扩大权限或迁移。保留现有全局位置/scene/内核事实投影，优先接读侧证据，不预设必须新增SQL。

后续真实PG最小矩阵：真实相关NPC到达/相关player入场会产生一个稳定新context；同命令/重复advance不重买；无关人/无关地点/纯player_report/出发/仅看环境不触发；多地点保留；跨owner拒绝；历史context稳定；unknown不重买；获准导演机会≠NPC知情/玩家到场/整段完成。纯源码审查未运行这些测试、未证明公网或模型体验；本报告不能作为实现已完成或已上线证据。

## 附：本人实质承诺与持续状态（仍为只读建议）

集成人新增观察：111线上NPC已不复述玩家，口头说安排接待/准备饮料，但本轮goals/plans/actions/responsibilities/decisions均空；这来自集成人验收转述，本报告未查生产原请求/输出，后续正常确认尚在进行，不把一次口头表态直接判成已执行或确定性bug。

当前npc-agent-model.ts协议已允许同一响应输出statements/goals/plans/actions/responsibilities/decisions，普通短回复示例全部状态数组为空；身份表达与结构通过不保证模型同时留下实质承诺的持续条目。内核能校验模型提出的条目，却不能仅靠台词可靠判定遗漏的承诺，原语义唤醒也不能从纯消息数补出plan。

最小后续建议只改同次NPC协议和对应adapter/真实内核专项：明确区分试探、愿望、转述、条件性设想，与“本人已经决定承担且有可执行下一步”的实质承诺。后者应在同次响应提出自身active goal及关联plan（按真实依赖为active/waiting/blocked）；确有待本人/玩家/世界承接的义务时才提responsibility，不强迫三者全造。已有同一事项时沿原id修改，避免每轮重复建计划。summary只写自己承诺的范围，不把玩家分工、第三人态度、地点知情或未获准能力补成事实；无需未来承诺的普通聊天仍允许空数组。

来源必须用本轮实际提供input.sourceId及本人有权读的现有目标/依据句柄，遵守原授权sourceIds，不引用尚未持久化的“自己未来消息id”，也不编造安排、deadline或resultId。deadline仅已有明确deadlineAt许可时填，未来时态不自动等于期限。状态条目是计划，不是行动成功；确实提议注册能力才填actions并按原能力/参数/结果回执验证，计划存储成功不证明接待已安排或饮料已备好；普通statement若声称动作成功仍必须按原dependsOnActionIds受实际结果约束。

不引入关键词/未来时态自动抽取、不加第二次模型补抽或后台偷偷补状态，不把所有“我想/可以/以后”变承诺。原单次proposal由runNpcAgent/原kernel/事务统一校验保存；不合来源/关联/权限就按原规则失败，不能为了唤醒导演擅自补plan或以台词为真实位置。建议真实验收分别核对：自然确认后的本人明确承担→同次原模型proposal带可追溯goal/plan→实际commit state→原语义重考一次；模糊愿望/条件提议/转述保持非承诺、无伪任务；重复确认复用条目、unknown不重付、fulfilled仍需可信结果。本报告不宣称这条链已实现，相关模型改动需新任务冻结，110仍冻结。
