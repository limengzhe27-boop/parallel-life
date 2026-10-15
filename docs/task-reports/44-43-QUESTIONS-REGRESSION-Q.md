# 44-43-QUESTIONS-REGRESSION-Q：真实问题承接回归方案

状态：待验收。负责人 `codex-ma-arch44-43-question-regression-q-20261015`，root唯一源码/契约/SQL/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-43-question-regression-q`，登记时基线 `0cd589ad`。先完成下面的只读方案；随后root冻结并授权专属新测试，已按短锁扩登记。本轮实际范围为新增 `tests/integration/agent-question-entry.test.ts` 和更新本报告/镜像/本人登记行。接收源码仅为父依赖：root `2dd71297`、B41 `2bdb68cf`、root后续 `11d17a1a`，没有自行修改这些源文件或其它测试。

## 实际结果

- 真实PostgreSQL18.4 / 自有55565，使用既有schema迁移和真实pl_app/leased worker权限。初轮root2dd+B41源，实际父测试+5组 **6/6通过**；默认无react-server启动的wrapper **外层1通过、实际子进程6/6通过且0skip**，检查了子进程真实计数，未继承NODE_TEST_CONTEXT而静默跳过。
- root补充sourceHandles/Director来源改动 `11d17a1a` 后，再跑相同专属实际PG/HTTP五组，最终 **6/6通过，0skip**。没有为通过而删除私聊模型输入隔离或权威state保留断言。
- A实际speech产生的问题来源能反查真实group message；B普通插话不消掉A题；无@“Tea”任务成功，实际native attempt/command/event都归A，原题source/text不变，resolution引用当前输入source和逐字Tea。B状态不因短答变化。
- weather/unrelated和Later/defer_answer各正常对白，原题完全保持open；事件questionChanges明确未结清。
- 实际appointment.propose能力先产生appointment及服务器创建的waiting责任，再在真实私聊speech用questionForResponsibilityId关联。answer仅使Question answered，责任全文不变、calendar仍proposed、没有decision和已履约goal，也无handledResponsibility结果。没有手造result或责任来替代能力链。
- 私聊sentinel问题与群聊问题在权威state同时存在；群聊回答不动private题，之后private答复完成另一题。群聊实际网关payload全JSON（包括state.questions）均不含private sentinel。未通过删除权威private问题达到隔离。
- 错误quote=Coffee对应玩家Tea，真实任务INVALID_AI_OUTPUT，NPC状态/Question不变、没有半份NPC回复，只有已经接受的真实玩家输入留下。再次run已成功任务，模型调用总数0增量、state无重复题/答复。
- 所有group/private轮次都核全局fetch总数（包括可能被断言拒绝的调用）恰好1，并核实际promptVersion为NPC；不是只数返回played或允许导演额外调用。测试网关不转发任何请求，语义输出全部是明确受控raw，**真实模型0**。
- typecheck、专属新测试Prettier、边界检查（551文件）和git diff检查按最终源码执行，均通过；不运行fullcheck/build。初次child env推断类型报错已仅在新测试明确NodeJS.ProcessEnv后通过，不改业务源代码。

这些通过证明该本地真实链路处理指定模型输出时已满足五组行为，不代表真实模型理解准确率、recent80边界、现场链路或公网已验收。没有修改原“渣男体验”草稿或发布它。root仍负责最终集成check/build、生产迁移、部署READY和公网验收。

以下保留最初方案与夹具依据，供接续审查。

## 最小实际链路

拟新文件 `tests/integration/agent-question-entry.test.ts`，须root另行确认独占范围后才创建。不开PG、不修改既有测试或源码，不运行全量检查/构建，不调用真实模型。

复用已验证的夹具位置与限制：

- 旧复现 `.local/question-audit.test.ts:924`起：实际双人物世界、GroupRepository.create/send、实际tasks/run HTTP、实际NPC kernel形成的A/B发言和Question来源。此前缺陷复现通过，不复制旧的失败期望作为新验收。
- 现 `tests/integration/agent-phone-entry.test.ts:30–125`：react-server子进程、真实Next模块解析、小范围env快照/恢复、真实数据库池、最终暂停本人世界与关闭资源。若使用子进程，去掉NODE_TEST_CONTEXT且核对子进程实际测试数/0skip，不能只看子进程退出0。
- 同文件`:165–200`：仅拦截模型网关、检查NPC promptVersion、保存收到的真实请求payload并返回明确合成raw；任何未预期fetch立即失败，永不转发网络。新增按当前payload构造replyAssessments的回调，不能提前猜Question ID。
- 同文件`fixture`/`switchRuntime`：既有PostgresWorldRepository.initialize、真实身份与定义引用、可信epoch2初始化及版本迁移。增加第二actor时仍走同一初始化函数，不直接UPDATE questions/state伪造问句。
- 同文件`quiet appointment.propose`与44-37私聊段：用实际能力结果创建appointment及服务器生成的waiting责任；私聊走实际svc.npcAgents.sendMessageIfEnabled。群聊走真实signed-session/CSRF HTTP run→lease→native adapter→模型→kernel→事务。没有内存Repository、手写group事件或模拟admission。

不把旧940行测试整份导入执行再声称是专项。新文件只保留必要初始化和本次问题链路，不同时跑无关试演/恢复大批量场景。旧测试不导出fixture，不为复用去改它。

## 五组验收（同一新文件，隔离合成世界）

|组|实际操作|必须看到的证据|
|---|---|---|
|1 A问→B插话→短答|@A触发实际NPC speech且requestsPlayerReply；@B普通陈述；玩家无@短答。当前一次NPC响应同时输出对白与该真实Question的answer assessment。|任务succeeded；attempt.actorId=A；B状态不因短答变化；原A问题answered并有当前输入sourceId、连续原话、原问题source；实际group投影/事件/command/attempt一致。短答新增模型请求恰好1，不再DIRECTOR_COORDINATION_REQUIRED，也没有导演额外调用。|
|2 天气和暂缓|同一未答问题后，玩家@A聊天气；输出unrelated或省略assessment。再说“稍后再答”，输出defer_answer。|每轮正常对白但Question仍open，无resolution；旧问题source/text/askedAt不被改写；若有questionChanges receipt，明确open→open。两轮各仅1个NPC请求。不能仅根据focus变了判已答。|
|3 回答≠赴约|实际appointment.propose成功产生真实appointment与waiting责任；实际A问邀约问题，statement通过root确认的关联字段指向该责任。玩家回答，在同一次NPC调用中评估该问题。|Question可answered；实际responsibility仍waiting、calendar仍proposed，没有伪造fulfilled goal/action result、handledResponsibility或玩家到场。拒绝回答也不变成declined appointment。回执与持久状态分开核对。|
|4 private/group并存与不泄漏|A私聊提出含唯一PRIVATE_QUESTION_SENTINEL的真实问题；A群聊再问公开问题；玩家分别在群/私聊回答。|两个Question均持久保留各自channel/thread/source，回答仅关闭本人当前会话那题。捕获并检查群聊模型payload的state.questions、observations及完整串行化文本，不能含私聊sentinel/题目原文；不只检查玩家可见群聊结果。私聊Question仍存在权威state中，不能通过删除它达到“无泄漏”。|
|5 来源与重放最小守卫|对一轮已真实存在的问题，受控raw给错question/source/非连续quote之一；随后重放一个已成功的实际task/run或对应既有幂等入口。|非法提案不改变Question/责任且没有半份NPC回复；成功命令重放不多一条Question/答复、不多一次模型调用。选一个代表性失败，避免为本小批重复全套权限/队列测试。|

组3若实际能力快照与待执行任务无法在同一独立文件直接复用，先向root报告最小夹具需求；不退化成手塞waiting责任或假result。关联字段与replyAssessments等以root冻结版本为准，不按当前未提交文件猜公共接口。

## 证据与调用计数

实际读`actor_agent_states.document.questions`、agent_attempts的input_receipt_id/actor_id/response/event_id、world_events.data.agentRuntime.stateAfter和问题变更回执、world_group_messages真实投影、commands和原agent_input_receipts。用实际owner/RLS Repository读取为主，必要admin只读核对本人合成记录，不越权读别的任务数据。

网关拦截器逐请求保存当前输入sourceId、NPC identity、channel/thread与完整payload；关键轮前后比较总调用数。group short-answer每次1，重放0，所有payload必须NPC模型协议；这样才证明没有额外串行director模型调用，而非仅检查返回played或HTTP200。每条Question必须从真实speech事件反查实际message ID，不能用人为造source证明持久成功。

语义分类是受控raw结果，因此这些测试证明给定单次模型输出后的原话核对、归属、状态和事务行为，不证明真实模型理解率。0真实模型与0生产；公网验收仍由root最终部署后执行。跨频道原文隔离需要明确断言模型完整payload，而不是把“NPC有自己的私有strategy handle”误当作允许在群聊携带私聊原话。

## 资源与后续

最初方案阶段没有开PG或写新测试。root随后授权，已按本文顶部实际范围和结果实施。最终仅跑该新文件的实际PG/HTTP专项、typecheck/format/boundaries/diff，0fullsuite/build；未自行修公共代码。日志 `/tmp/44-43-final.log`（最终source direct6）及 `/tmp/44-43-wrapper.log`（wrapper外1/子6）。

当前已实际通过，标待验收；root集成/READY/公网门槛后再标完成。“渣男体验”原稿不动不发布。

资源收尾：自有PostgreSQL正常停止，55565核无监听；未停止其它Agent服务。
