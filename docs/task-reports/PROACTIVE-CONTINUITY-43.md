# PROACTIVE-CONTINUITY-43

root统一集成；proactive43独立工作树，基线1af2ce12。

## 根因与最小修复

原档2fb只读查证：欣欣、舒雅婷、青青、林白语、李之之各有一条unknown_after_send；lease全部过期，response/event均空。此前episode与claim已允许不同合法工作继续，但own-agenda的actorBlockers仍把所有unknown永久挡住，authority第376行直接return null。

仅改own-agenda-review-repository：读取已有lease_until/event_id，调用现有episodeActorAttemptBlocks。无新业务字段/表、无新调度器、无提示词改动。原family unknown仍留在attempts，evaluateOwnAgendaReview仍返回unknown，不能因过期重买原调用。其他family仍须原anchor、时间、预算、来源及claim全部通过；释放人物锁不等于强制来信。

## 必要验证

独立PG55743，专用parallel_life_test：own-agenda-review-evidence 13/13；新增验证过期无response/event释放actor fence、同family付费记录不丢、已有response即使过期仍阻塞。原live unknown、跨epoch、来源和native路径仍覆盖。boundaries767、typecheck通过。

修两处旧夹具：初始化输入hash按现行world/actor/candidate/text计算；malformed envelope用reserved进入当前有界active读取，避免invalid_output且伪anchor未被选中时错误期待抛错。未改生产扩大历史读取。测试端口可由AGENDA_EVIDENCE_TEST_PORT显式指定，默认55588。

## 限制和接续

0模型、0原档写、0运行进程修改（仅独立PG），未做原service实际领取或真实主动来信验收；root统一check/build及3218更新。该修复解决永久人物锁，不能证明已有等待责任自然产生新行动。导演重复旧事项、已派事件实际承接、长时间无新依据时的合理安排仍需按41/37清单核验；不抹去原未接受状态，不强制调用求非空。

## root集成及原档核验

集成866c44bf；check4201/4201、build-proactive43成功，子任务独立PG13/13。3218已切新构建，queue85243、proactive85161健康，未动3219/生产。恢复proactive前确认旧PID26936已不存在，仅归档其旧锁，没有同时运行两个调度器。

一次正常原服务advance因已有调度占用返回scheduler_busy，0新attempt，未重复手动调用。恢复原调度进程后正常领取原2fb：no_candidates，导演原unknown_after_send仍待核对，scheduler报UNKNOWN；0新主动消息。不能把执行进程恢复/阻塞规则修复当作主动剧情已跑通。

后续已交proactive43继续：逐人定位解除actor fence后的family/anchor/责任条件，以及导演旧unknown对独立合法机会的具体影响。禁止重新购买同请求，保留未接受状态。
