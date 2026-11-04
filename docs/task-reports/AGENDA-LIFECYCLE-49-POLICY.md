# AGENDA-LIFECYCLE-49 政策子任务

负责人 proactive43；基线32419a4e；独占application/own-agenda-review-policy.ts及其单测。root负责仓储/authority/预算接线/PG/原档验收。

## 完成

- ownAgendaReviewFamilyId增加可选reviewAt，未传时v1原始hash逐字保持；传入时按UTC固定60秒窗口计算v2 hash与`:w{minuteBase36}`后缀。窗口粒度不受配置gap或policyVersion变化影响。
- OwnAgendaReviewInput增加仅内存计算参数reviewAt；v2身份使用reviewAt ?? realAt，时间门槛与预算仍使用真实realAt，不用历史时间伪造当前准入。
- ownAgendaReviewGrantTime解析并验证原receivedAt所在分钟或紧邻前一分钟，用于collect尾秒跨accept分钟；返回窗口开始ISO。原hash仍须由authority按身份、anchor重新认证，后缀本身不授权。
- 同窗口unknown/raw/paid继续拒绝重新购买；后续窗口可以独立审视，但只返回consideration，绝不生成消息、事实、玩家承诺或预算预留。
- 保持anchor、优先工作、故事/真实时间、quiet退避及owner/world/actor预算检查。

## 验证

46/46政策单测通过；typecheck通过。覆盖v1完全兼容、同分钟稳定、跨分钟不同、配置gap变化不制造同分钟新grant、各类paid状态保护原窗口、原receivedAt用于后续恢复、无效/未来/过旧窗口拒绝，以及reviewAt不替代live realAt预算/时间检查。

0数据库变更、0真实模型、0原档写、0运行进程改动。不是完整生命周期或原档主动推进验收。

## 集成边界

root须在所有阶段使用原receipt冻结的reviewAt；collect用当前服务器时间。近期全窗口lastReviewRealAt与连续失败退避必须在authority实现，不能将60秒身份粒度当成每分钟付费计划。旧v1原调用仍保持旧策略恢复；新窗口不重试旧unknown。saved response优先恢复、晚到结果的revision/依赖保护仍归原内核。失败/unknown要继续计入已有预算。不得补跑离线历史窗口。

## 旧runtime夹具现代化接续

按root交接独占更新`tests/integration/own-agenda-runtime.test.ts`，基于785bd2ad复制root的49 authority/repository WIP仅用于验证（公共源码不提交）。端口支持原root提供的OWN_AGENDA_RUNTIME_TEST_PORT；使用隔离55743。

修复夹具的compact输入路由：promptVersion可省略，人物身份用replyAs.actorId；明确现有initialPlaceId与space，避免本套议程测试先进入initial_position工作；来源使用本轮合法inputSourceRef，不假设已裁剪的authored来源目录仍在。当前quiet回合改v19 changes:null，验证不创建计划或已退休continuation，继续严格检查successor时间、原请求不重复模型。历史v8/v9显式计划与raw恢复样例保留兼容验证。

结果8/8通过，typecheck通过。默认v2没有回退v1。保留unknown同窗口不重买/独立人物继续、预算竞争、CAS/零发送恢复、raw恢复零新调用和零新预算断言。本套为受控adapter+真实PG，不等于原档自然主动验收。

## 历史位置来源导致有效计划消失：聚焦回归

接管原`tests/integration/agent-initial-position.test.ts`，新增no_scene分支，复用真实内核建立初始位置、v19创建引用该位置来源的独立计划、随后真实kernel travel.begin。在移动成为in_transit后，断言历史self-position来源以private_strategy保留，计划仍进入viewState，worldContext.selfPosition仍为in_transit。其他人物不能借用该来源；成功的非位置plan事件不能冒充位置；现有forgotten元数据登记原event后来源/相关计划不可重现，独立当前位置保持有效。

复制root resolver WIP验证：原套件5/5通过，typecheck通过。还原基线resolver做对照，no_scene在历史来源断言失败，证明测试确实覆盖此回归；随后恢复测试用WIP。无公共源码提交、无原档/付费调用。隔离PG55743。

范围说明与纠正：首次fixture错误沿用position.establish的parameters对象简写，漏掉travel通用执行的sourceIds，导致RESPONSE_WIRE_SHAPE，不能据此推断产品不支持native travel。已改用现有v19独立执行语法：action.parameters=[{name:"routeId",value:"home_cafe"}]，action.sourceIds为合法历史位置和当前输入的sourceRef。聚焦no_scene原parseAgentProposal→runNpcAgent→kernel旅程再次通过，实际出发成功且计划保留。无需goal/plan机械包装。参与回执历史恢复由root原档只读证据覆盖，本子任务证明同源持久计划的完整读取链；受控模型不等于自然模型主动选择旅行。
