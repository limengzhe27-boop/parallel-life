# 44-199 主动联系与事件推进精简

状态：进行中，未上线。集成人 root-proactive199；开工 main 0e42a2e4（并行文档随后推进至51be078f）。主目录其他登记/RECORDS-NOTES报告由原负责人保留。

## 实际调用链与断点

手机 time-experience-policy 5秒轻量检查 → world-phone-app checkForWorldNews → 原 advance / advance operation → npc-agent-advance-services → 调度来源与 scheduleAgents(selectAllIndependent:true) → 既有 batch → NPC snapshot/model → run-agent → kernel短事务保存事件/消息/回执 → 原消息轮询/未读/通知。

后台 pg_cron → /api/cron/proactive → 既有 run-proactive-scheduler → claim_proactive_worlds → 同一 advance。生产只读核对2026-10-23：job3每30分钟，目标新域，108迁移校验一致；最后08:00/07:30/07:00成功。

仍存在的旧阻断：localInitiative统一30分钟且只选最久一人；batch额外只放一个actor_local；前台sending与每次对话刷新活动时间阻断；后台4小时+错误六租约行全局日限；未知请求SQL整世界排除；主观正则过滤人物文字及锁屏通知。

## 复用 / 待集成 / 修改 / 新增

- 复用：人物状态/可见上下文、事件目录、导演、独立候选selectAllIndependent、handledActorIds、batch限额、attempt/lease/unknown、原内核与Outbox、通知队列。
- 待集成：phone199前台检查，attention199焦点/通知，scheduler199后台领取/容量。
- 修改：删除上述业务阻断；自主候选使用每现实分钟稳定工作身份，同一窗口刷新/世界快进不新购；跨窗口unknown仍由人物锁阻挡。不是每分钟强制发言。
- 删除：专用单人物batch状态、30分钟冷却及其额外数据库查询、无用userInactiveMs输入、主观台词过滤模块。
- 新增：仅增量数据库函数迁移与必要测试/报告；无字段/表/审批/评分/第二套调度。

## 文件职责

- agent-schedule-collectors.ts：全部独立人物获得考虑机会，稳定身份，不以正式任务为资格。
- agent-advance-batch.ts / npc-agent-advance-services.ts：移除local专用单人限制，原预算/人物互斥保留，删冷却专用查询。
- run-agent.ts / proactive-quality.ts：移除主观删词；原parse及kernel真实动作结果/依赖校验仍在。
- npc-agent-model.ts：现有提示允许人格/情绪/关系表达，不新增协议字段。
- phone199/attention199/scheduler199具体文件由各自报告记录，统一集成部署。

## 验收

必要纯测试、真实PG多人物/unknown与100世界容量，check/build；正式渣男体验作为主验收（无输入60–90秒、持续五分钟、与A聊天B来信、返回与未读），不复制重发作品、不手工插消息。真实模型与受控测试分别统计。部署新账号parallel-world-eosin，旧项目不删。

当前证据：73/73纯测试通过，含无任务双人物、真实分钟稳定身份/消费去重、跨窗口unknown仅挡本人、情绪对白不被静默删除。不能据此宣称真实人物主动推进已通过。

## 接续

并行包尚未集成；真实PG/旧档体验/手机PC/部署未完成。旧项目cron未停仍是44-198遗留风险，本任务不伪称已消除。
