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

## 接续：导演unknown与独立新变化（基线3f873001）

只读原档正常readOwnAgendaReviewWork确认：五个人物当前family本身已有unknown付费记录，authority paid围栏仍应保留，不能解锁重买。刘胜男有新anchor、预算有余，短时检查落在原quiet退避窗口。原档脚本仅只读，无模型/原档写。

导演prepareRecovery已先认证当前完整snapshot及独立来源，但directorFrameRetirementEvidence仅接受作者事件资格；合法非作者关联人物新计划/决定/行动结果即使进入changes，也无法越过旧unknown。现在该纯函数复用authenticatedReasons与current.changes，允许旧帧之后、当前范围内、未出现在旧changes的业务ref（计划/决定/行动结果/有actor归属的问题进展）作为独立依据。普通speech、时间、版本、同旧ref改id不获得资格。原作者事件条件通道保留。无新增字段/表/协议。

隔离PG55743 director-frame-lifecycle 4/4：两条原作者旅程及一条非作者参与NPC新计划；最后一条changed.evaluationCause明确undefined。真实NPC kernel写入计划→原unknown执行帧退休→新frame可claim；旧snapshot/inputHash/sent_at不变，原模型仅1次；迟到raw仍保存但旧frame不能重新执行；无关note版本变化不解锁。纯域3/3、typecheck和boundaries通过。

未修改emptyDirectorRecoveryDue：无新依据时仍可能重复只读查询unknown，需复用现有nextReviewAt后续处理，不新增调度字段。未运行真实模型/原档写/本地切换，root集成门禁和原档验收。整体主动剧情仍待验证。

## 44验收期间只读复核（基线20d9344f，2026-11-04）

`.local/scene44/worker-v88.log`记录10次同一`SCENE_OBSERVATION_CONSUMPTION_PROOF_INVALID`，没有证据表明这些失败是导演unknown或新付费调用。memory44已独立确认：suppliedContext含private_strategy scene recall，旧消费reader按inbox来源检查而失败；recall-only还可能先在context检查失败。该源码归memory44，本任务不重复修改。

调用影响：snapshot→actorObservationInbox→readConsumedSceneObservationSources；主动narrative候选reader也调用同一消费reader。认证异常会在候选/模型执行之前抛出，因此worker活着不代表推进成功。应先修消费证明，再核失败计数；不通过吞异常、假ACK或强制消息处理。

### 下一批明确接续，当前不改

1. `agent-observation-schedule-read.ts`第46–52行仍将人物任何unknown_after_send永久continue，SQL没有lease字段。这是43已修agenda/episode准入规则的另一个消费者遗漏；对真正新narrative knowledge会过度阻断。拟复用episodeActorAttemptBlocks，同时保留同candidate已付费历史围栏，不通过改candidateID重买。需独立PG验证live/expired/raw/event及同candidate/不同新来源边界。
2. unknown重复只读扫描有三个入口：`emptyDirectorRecoveryDue`不看时间；`wake.hasPendingDirector`包括unknown；`observed.needsEvaluation`可能仍指旧帧已带入但未确认的变化。仅改第一个函数不能解决完整链路。后续优先复用原attempt.snapshot的已观察范围及既有nextReviewAt，区分有已存response可恢复、真实新认证变化、原unknown无新依据；不新增缓存或状态字段。新证据仍交原prepareRecovery认证，普通时间/世界版本不授予新购买。

本次仅报告，不改业务/原档/模型/运行进程，避免干扰root的44真实验收。既有43PG证据不当成这两项已修，也不称长期主动剧情已通过。

## 44现场投递后的主动证据读取遗漏（2026-11-04，只读诊断）

原档 `2fb97a4a` v685，`.local/scene44/worker-delivery.log` 持续出现 `INVALID_OWN_AGENDA_REVIEW_EVIDENCE`。通过应用角色只读事务逐人物调用原 `readOwnAgendaReviewEvidenceInTransaction`：青青、林白语、李之之、舒雅婷、欣欣均通过；刘胜男在 repository 第423行报 `reason=committed_source`。

明确断点：输入 receipt.channel 仍为 private，而44允许回复正式投递到 scene。该读取者的 projectionCount 仍按输入渠道只计 world_messages，随后要求等于 proposal.statements 数。因此实际合法现场回复被当作缺失投影。

| attempt | 实际版本 | statements | 当前reader计数 | 原scene_items同源同人物计数 |
|---|---:|---:|---:|---:|
|70f7b6fe-5795-4f2f-9631-02b64562f092|676|2|0|2|
|77e2690b-554d-41a2-a649-35058a640a38|682|3|0|3|
|60f3eef6-71ac-475a-809b-7e968fb576f0|684|2|0|2|

读取计数依据：sceneReply.sceneId、world/owner、source_event_id、speaker.actorId、sourceVersion。现场事件与entries存在，不能归因模型未回复，也不能通过重新生成或改历史补齐。

调用影响：npc-agent-advance-services.ts 879行人物循环直接await readOwnAgendaReviewWorkInTransaction → own-agenda-review-authority.ts 309行证据读取；错误发生在候选包装为actor scope之前，导致这一轮world调度抛错，后面的导演观察和候选执行到不了。修好此处只解除明确异常，不能据此声称其他quiet人物已经主动推进。

下一批最小文件范围：own-agenda-review-repository.ts 与现有 own-agenda PG测试。按已提交输出的实际目的地认证投影：sceneReply分支使用现有scene_items，与原event.sceneReply.entries逐项核对来源/ID/人物/文本/版本，普通微信保持原认证，原生scene/group保持原路径。复用已有结构，不增加字段，不删除完整性检查，不跳过坏记录。必要PG覆盖私聊→现场完整提交成为合法anchor/presentation、普通私聊/原生现场不回归、丢失/伪造现场投影仍拒绝。同源认证修好后由root在原档验证调度不再报此错误，长期主动消息及计划仍须单独实测。

本轮未修改业务源码/原档/运行配置，未调用模型。只读诊断脚本与输出在忽略目录 `.local/proactive43/scene-evidence.*`；既有unknown无lease消费者及重复扫描两项继续保留。

## 45接续修复：依据实际投递读取已提交讲话（待集成）

基线9a48ae02；独占own-agenda-review-repository.ts、原own-agenda-review-evidence PG测试与本报告。私聊输入的已提交event含sceneReply时，projectionCount改用真实scene_items与event.sceneReply.entries逐项相等匹配；校验world/owner/scene、speaker、sourceEventId/sourceVersion，并按不同条目ID计数。普通私聊、原生群聊/现场继续原路径。不增加业务字段/查询往返，不吞异常、不删历史。

隔离PG55743原入口回归14/14：真实旧现场开场建立合法presence→原awareness建立位置→同一NPC runner/kernel实际提交replyChannel=scene→议程reader得到anchor和lastPresentedRealAt；篡改scene条目正文即拒绝，恢复后可读，删除投影再次拒绝。其他原微信、原生群聊、unknown支付围栏、伪造来源测试通过。typecheck 0、boundaries768通过。没有调用真实模型、没有写原档或修改运行进程。独立PG测试结束后停止；完整check/build及原档运行验收由root集成处理。

同类消费者定向复核：own-agenda-budget只读取既有预算凭据，不另行按输入渠道认证消息；own-agenda-review-authority消费本reader返回的anchor/presentation，本次修正直接覆盖。agent-observation-schedule-read永久unknown过滤与导演unknown重复扫描仍是此前未完项，本批不改。此结论仅针对以上邻近消费者，不声称全仓已无遗漏；修复读取不代表已经生成主动消息。
