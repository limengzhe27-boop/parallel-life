# 44-89C 原生渠道协调独立复核

执行者 codex-ma44-89c-independent-q，辅助线程 01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。基线 ef40606ecea2ead212f7b76739bc88330e280861；独立 core-handoff88-q/codex/native-coordination89-q。2026-10-16。主表短锁登记后只写本报告、本人行与报告镜像。公共代码、测试、SQL只读，集成人负责修复与部署。

## 限定结论

本批确已把多人物歧义交给同一个持久导演，再将零或一个人物交给原NPC执行入口。源码核查支持以下边界：不默认数组首人、不由导演代写人物对白、不生成新事件机会、不消费全局剧情评估游标、不把quiet记为虚构NPC行动。发布目录冲突和晚加入首人认证问题已在本基线修正，独立报告91所描述的旧缺陷不能原样当作新基线缺陷。

还需核定一处恢复分支的优先顺序，下面单列为静态待验证项；没有真实库复现，不冒充确认缺陷或现网事故。生产新引擎仍未启用，报告不是启用许可。

## 具体检查

- native handler对群候选先检查当前成员及原消息历史可见性；现场取当前在场、原在场及原entry.observableTo交集，然后认证准确原受众。没有可用人物时不回落旧引擎或凭空选人。
- 快速承接优先明确点名、经真实事件核验的开放问题、准确matter负责人及唯一候选；其他歧义调用coordinateNativeResponder。责任支持仍以现有matter为限，不据此宣称appointment/request任意语义都已落地。
- routing command绑定原task；nativeTurn绑定原input receipt/channel/thread。模型和持久提交均限制0或1候选、无opportunity/nudge；提交不调用markDirectorEvaluated。
- validateNativeDirectorTurn验证实际运行中任务、原持久player input、原成功事件、渠道和历史受众；真正付款/保存使用withLeasedAgentDatabase，其每次事务前后校验准确lease token、任务input、owner、期限及epoch，无模型调用期间长期持有数据库事务。
- quiet标记任务前须有原task/input的已提交导演decision及准确运行租约；selected则继续原NPC snapshot、runNpcAgent、kernel和finishNativeAgentTask，没有把全局导演描述转成NPC台词。

核查文件：npc-agent-channel-services.ts、npc-agent-native-coordination.ts、native-director-turn.ts、director-runtime.ts、director-runtime-repository.ts、director-snapshot-repository.ts、run-director-agent.ts、leased-agent-database.ts及已有native/正式出版专项。

## 恢复优先级待核定

native handler先查本input的NPC agent_attempts，再运行nativeResponder；只有仍存在歧义才进入coordinateNativeResponder查询native-routing:<task>的旧导演attempt。

潜在路径：首次歧义协调已付费unknown；若原task恢复前群成员或开放问题/责任变化，使快速分支可确定人物，入口可能不再查询旧导演attempt而直接启动人物调用。类似地，导演已提交但NPC尚未保留attempt的间隙，快速分支可能不再使用原选择。这不等于已证明重复购买导演请求，也不等于一定有实际重试入口；需结合任务unknown的显式恢复政策核对。

已把精确位置回报集成人：npc-agent-channel-services.ts约325–383；旧routing lookup在npc-agent-native-coordination.ts约32。建议核定是否应将同一task已存在的routing身份恢复/阻断置于快速选人之前；若确有可达恢复入口，再做“unknown后候选变为唯一”的聚焦真实库反例。未自行放宽unknown、改公共代码或新增未授权测试。

## 验证与证据归属

本人实际运行native-director-turn.test.ts，1/1纯领域测试通过，0skip；不是数据库或真实模型证据。未启动PG、浏览器或服务器，0模型、0生产写；没有重复整批check/build。

此前88C提出的新子账本真实库缺口已有新增episode-journey-evidence.test.ts及44-90报告：实际拒绝、同episode出发到达和导演读取已补，未将子步骤算整事件完成。这里是核对新增源码断言和他人报告，没有冒充本人重新执行PG；不能继续把“完全没有相关集成断言”当成当前事实。该用例经合法旧现场历史迁移准备NPC位置，不证明新genesis已经建立初始NPC位置。

集成人本批报告check3127/build、native PG9、正式出版目录PG3、事件子旅程PG3为其实际执行证据，不与本人1项累加覆盖。初次交接时部署dpl_7tXcPLPsXcKZdB7CwVsjZ2mRbYcj的READY尚在核对；最终部署结论以主登记及集成人后续证据为准。

仍未实现的player回合同次pending事件manifest、显式episodeDecision、原收据消费及付费unknown fence由集成人后继负责；不能用任意玩家消息注销queued事件。自由原稿完整交接、整体结果政策、完整观察与旧档迁移仍开放。“渣男体验”原稿不发布，不修改玩家存档。
