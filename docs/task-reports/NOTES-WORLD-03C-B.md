# NOTES-WORLD-03C-B · 长期追求阶段成果与有限机会

负责人 codex-notes03cb-01a11a84-20261011；工作树 .local/worktrees/nar-03；唯一集成人主对话。状态进行中，未交付。已安全 fast-forward 51f753f，旧 NAR-03/checkpoint 与 clean 分支均保留，未重置 WIP。

## 待 root 冻结的最小协议

WorldMatter 可选字段：
- pursuitProgress={milestones:[{matterId,title,eventId,eventVersion,at}],nextOpportunityIds:string[]}，只用于 pursuit，最多四条；本批每个追求一个起始里程碑、最多一次后续里程碑，一个机会。milestone.matterId 指真实世界 near_term ID（不是 scene item ID）。pursuit 原 status 保持 in_progress/blocked，不 completed；新增阶段时自身 version+1，updatedAt=结果事件时间。题目标题是来自可信原始事项的快照。
- opportunity={pursuitId,triggerMatterId,key}，仅用于运行时生成的 near_term；key 为可信精确 preset/version3 路由中的有限 follow-up key，无客户端或模型自定义。
- 新机会 source={kind:director_proposal,eventId,eventVersion,at} 指触发它的实际 scene.action_resolved，evidence world_event 指同源，status=not_started；prerequisites=[triggerMatterId]、visibility=player_visible、relatedPlaceId=可信规则地点、relatedActorIds=实际见证者与该规则角色的交集。assertion=world_verified 只表示机会确已开放，不代表事项已完成；rewardClaimed 保持 false，无金钱/好感赠送。

scene.worldResults 公共形状不扩展。纯 reducer 在现有 validated matter updates 后，根据精确官方 v3 规则生成 progress/opportunity（稳定 UUID derived from world/pursuit/follow-up key），重放以同一 event 重新推导同一结果，不储存模型声称的 reward。事务层写 event/state/command receipt；没有第二个奖励任务、没有读取回填。机会完成仍要求真实 saved action、指定目标、地点、可信行动和裁决观察、真实 source；不能用机会标题或自称达成通过。

## 四官方 v3 有限规则候选

|preset|实际已验证触发|追求|一次具体可选后续事项|地点与知情角色|
|---|---|---|---|---|
|county-yellow-hair|deliver_r17|own_workshop|r17_review：整理并复核 R17 交接记录，记录接头检查与验收信息|repair_shop；只有实际在场老周知情|
|only-child|meet_guyao|independent_project|book_project_brief：写出以封底讨论为依据的文化项目初稿，列出内容方向与预算边界|lake；只有实际在场顾遥知情|
|returned-daughter|visit_chenyu|handcraft_binding|binding_memory_note：整理一份装帧手艺记录，写下工序与旧店记忆|chen_home；只有实际在场陈玉知情|
|retired-star|meet_lusheng|quiet_music_life|quiet_song_brief：写出新歌创作小稿，明确署名与不公开演出的边界|old_venue；只有实际在场陆声知情|

完成起始事项只增加一项有来源成果和一个未开始机会，不完成长期目标、不自动宣称已付预算/已营业/已发行。不生成新 NPC 邀约或强行出现人物；后续对象事项允许玩家独立完成，若无人见证则无 NPC 反馈。后续成功增加第二个阶段成果，nextOpportunityIds 不再生成下一任务，保留可追溯历史。agenda 只沿用 actual witness matter_result 的有来源策略，自然回复仍交已有真实模型，不预写台词。

## 边界与验收计划

root独占 src/contracts/world-matters.ts、player-records/其仓储、UI，后端独占主表已列范围；root先确认协议并提供contract提交，再接类型。可先写独立纯规则与测试，不编辑root公共文件。根报告目前尚未出现在主目录/集成树，出现后补读，不能另立任务总表。

负例：self report/failed/partial/blocked/外世界或账号/旧版本/变更原始定义/伪造机会元数据不得奖励；重复任务与回放只得一次，长期目标不完成；事实与事件被屏蔽时上下文不泄露。真实 PG 验证同源事务、回执重放、原子回滚、源事件历史和 RLS；先迁移独占55471 dev/test再 check/build。0供应商/图片/生产写，上线与UI最终验收归集成人。

## root 冻结后实现接口

已读主目录03C根报告，采用root 10/10上限（替代上方候选4上限）。不改preset初始内容。B已实现独立纯规则初稿，导出：pursuitRules、opportunityId(worldId,pursuitId,key)、trustedOpportunity(world,initial,matter)、progressSceneMatters(previous,initial,validatedMatters,event:{id,version,at},witnessIds) -> {matters,observerFacts}。同一scene世界reducer校验原updates后调用；来源事实新增pursuit_result:<eventId>:<pursuitId>，actor visibility仅实际现场witness。供root/Q验证既有worldResults，不扩event负载API。后续机会第一次真实attempt可启动并达成；解锁时只not_started，不自动接受。预计机会成功写入第二里程碑，保留nextOpportunityIds用于可追溯历史，不继续解锁。

## 首稳定与反馈收据补丁

首稳定12d4f27，root/Q已接线；root合同c051a36在本树cherry-pick为fad521a。已读03C-Q负例并补后续完成、not_started受控开始与精确ack。私有planner acknowledgedResultFactIds仅在当前actor本轮有实际回复、ID精确属于授权canonical result事实时，转换既有belief凭证；模型不能直接伪造marker belief。prefix为[scene-result-ack:，actorContext排除凭证及其遗留memory；经root精确批准postgres-world-repository storeTurnMemories排除该内部belief，因此不写角色印象。ack只证明结构化承接声明，不证明自然台词质量。

本轮专项14/14：四官方真实定义纯reducer成功→有限后续→实际第二阶段；精确来源/隐私ack两组；真实PG八项含正常包、同场景未开始投影、第二阶段、history/repeat/immutable initial以及真实WorldRepository commit确认marker来源fact存在但memory_records为0。旧本人NAR03测试已按新精确ack要求更新；完整check/build尚待。

## 最终后端验收接续

业务最终5197adb（首12d4f27→隐私/真库7c950a8→有限历史证明5197adb），全部业务文件冻结。root/Q已收到三个提交。合同fad521a是root c051a36等价cherry-pick，不重复发布两份合同。

最终独立复验：check719/719（边界与类型通过），build成功exit0，真实PG/纯规则/ack/长历史专项15/15，diff check通过；日志本树.local/notes03cb-{check-final,build-final,special-final}.log。早期check718/build与专项14仅作为历史；最终以上述新日志为准。专属55471已退出且lsof无监听，无HTTP/浏览器；0供应商/图片/生产世界写。当前仅待验收，不标已完成，不代替root READY公网结论。

world-history新补丁仅保留当前明确里程碑所需、同世界player_visible、真实成功完成且event/version匹配的canonical证明及每actor/source精确ack；不保留全部泛事实、不引入未来proof，仍沿用96k generic snapshot预算。40轮大belief历史后可实际完成第二阶段，through0不含未来机会，第一期无第二成果/未来ack。

nextOpportunityIds保留已创建的唯一机会ID以便追溯，第二阶段不再创建下一个机会；UI/records请结合该事项已完成状态呈现，不能把已完成事项写成又有一个新的待选机会。完整NPC自然语义/台词质量未调用模型验收，结构化ack不是这项证据。通用自由事项/互斥失效/钱款好感/无限长线引擎不在本批。

根集成人负责records source投影与UI、Q负例合并、全库/双端/生产迁移/READY公网。收到实质审查失败时只修本任务范围；否则保持业务冻结，释放全部独占文件给root。

## Q隐私负例修复接续

独立Q在冻结源码发现实际缺陷：blockedSources包含trigger/pursuit ID时，facts已过滤，但机会matters用raw state.facts授权，仍泄露机会标题/说明。已改用本轮真正授权且已入预算的context.facts，要求canonical精确pursuit_result:event:pursuit绑定，同时父追求与trigger同世界player_visible且未屏蔽。新增回归覆盖阻断trigger/pursuit/fact/event/机会ID、隐藏父事项、belief冒充canonical均不带出机会。纯相关8/8已过；check/build与真库再次待复验，旧最终结论暂停用于这次补丁，不能先标交付。

## 隐私补丁最终复验

运行时代码补丁8ede4e4已发root/Q；追加真实PG stored-world上下文回归（父trigger/追求屏蔽后没有机会）与最终收尾提交。该回合最终check720/720、build exit0、专项16/16、diff check通过；日志 .local/notes03cb-privacy-{check,build,special}.log。dev/test已迁移后运行，PG55471已关闭再核无监听。0供应商/图/生产写、无HTTP/浏览器。此项重新待验收，业务文件再冻结释放root，Q独立复验与最终上线仍归根。


## 集成发布验收

业务5ff3c09，production jwoouortv/dpl_CgoRiUNdjKdPiowYHL8Tu37xvN7F READY，正式https://parallel-life-nu.vercel.app；746check、237真实PG通过/5真实模型opt-in skip、build0、41生产迁移一致无SQL；公网8组只读验收、旧存档paused/版本/权限保持，0新增模型/图/世界/上传/业务写；390长短/1440PC420本机合成UI通过非真机/模型台词验收。PG55452/55471/55458及HTTP3268均已停，Ego141 finish；有限四v3近期成果→单后续→最多两里程碑，旧已完成无回填、自创/通用长线/兑现/真实模型留03D与AI-QA。
