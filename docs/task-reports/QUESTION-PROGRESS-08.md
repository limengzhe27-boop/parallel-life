# QUESTION-PROGRESS-08

基线3d7fcd2e；独立codex/question-progress08。解决真实玩家回答已保存、开放问题已answered，但不存在正式responsibility/decision时，等待计划无法获得导演重评原因的断点。未改用户原档、原history、模型、端口或SQL迁移。

## 实现与权威

- 新纯questionProgressReason验证：final canonical event，原actor snapshot之前有有效waiting/blocked plan或等玩家责任，原player input同world/收件人/channel/thread，quote包含于真实原文，原proposal.replyAssessments与questionChanges精确对应，open→answered、replayed=false，stateAfter的resolution/source/time一致。
- world-awareness仅对该证明产出既有cross_impact/event reason。不产生accepted/declined正式承诺，不伪造实际行动或整体事件完成。
- awareness仓储从真实committed attempt关联的原input读取，不靠台词提取；原question/proposal不能自己担任事实权威。
- authored-reconsideration读取从真实event+succeeded command/result_event_id+committed attempt+input独立重证，返回既有optional actorId。领域cast过滤仅该人物所属事件获得新context，不全局广播。
- 显式repairQuestionProgressReasonsInTransaction(sql,ownerId,worldId,worldVersion)由root的advance前置调用。固定world→director观察游标锁顺序，扫描evaluated之后、throughVersion以内最多64条相关questionChanges事件，验证原snapshot/input/实际结果后ON CONFLICT补原pending reasons表。无读context副作用，不改原事件/消息，不重放模型，不扫描全部历史。
- 数据库0073原pl_app owner INSERT/FK已支持历史reason修复；未放宽任何权限或改schema。

## 验证

专属真实隔离PG55676原runNpcAgent→kernel→world-awareness旅程通过：无正式responsibility、decisions=[]，等待计划原样；真实答复产生一个cross_impact，可被原authored-reconsideration读取/cast匹配；原请求重放不增消息/调用。仅删除合成夹具reason模拟旧投影遗漏后repair返回1，再次0；原markDirectorEvaluated之后删除夹具reason，repair返回0（不重新开启已评估窗口）。

专属unit+真实PG+原awareness/authored领域回归15/15通过；typecheck0，boundaries762。0真实模型/原档写/生产写。

额外尝试旧director-semantic-wake全文件存在大量旧fixture协议失配，例如预期npc_episode_consideration而实际npc_own_condition_ready、旧Director拒绝。未修改或弱化断言，未把此套件称为通过。新reason→完整导演unknown权限退休→真实重评的端到端付费旅程未由本子任务证明；root负责实际advance接线和原档真实验收。既有unknown记录不修改、不重购原cause。

## root接线

`await repairQuestionProgressReasonsInTransaction(sql,ownerId,world.id,world.version)`

在显式advance准备事务、读导演wake前执行，保持同一world transaction顺序。只读snapshot/context函数不得调用repair。新产生的canonical final事件原awareness自动生成，无需repair正常路径。
