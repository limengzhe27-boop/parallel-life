# AUTHORED-CAST-SCOPE-05 · 作者事件参与人物范围

负责人 authored-cast-scope05-20261027 /root/empty_scene_runtime，独立tree `.local/worktrees/authored-cast-scope05` / `codex/authored-cast-scope05`，基线f59e0d0f。root唯一集成及build/本地运行。本批0模型、0原档、0SQL迁移/表列、0端口/部署。

## 确切断点

只读QA看到作者event_780…的绑定参与者是青青/李之之/舒雅婷，导演却派给舒雅婷/欣欣/刘胜男/林白语；另一作者事件绑定青青/欣欣，派给舒雅婷/欣欣。normal parser/repo只有世界cast范围校验，schema author.actorTasks也默认整个cast。历史意图读取仅核nodeHash相同，没核本次任务参与者是否属于原作者节点。故错误task可经正式director_intent进入非参与人物私有上下文。

## 实施

- NEW纯领域authored-opportunity-cast：显式actorKeys/participantRefs/intent人物绑定时，只能用resolved作者参与者∩实际world cast；真正未配置任何人物范围的旧节点仍按world cast兼容。显式但未解析/不可用人物不能扩大为全世界。
- directorResponseFormat：按各event的作者范围把非参与者actorTasks固定null；无可用参与者只允许defer。同scope共用schema定义。emergent维持既有世界边界，不借作者label任意分派。
- parseDirectorDecision和repo.validateDecision复用同一纯校验；即使绕过parser直接提交canonical决定也不能为作者事件派范围外人物。不按姓名关键词/数组顺序猜角色。
- actor-episode-intent-repository：原/当前绑定双重核验；历史非法任务从可见结果删除，不暴露本人task、不伪造quiet/consumed、不修改原receipt。当前非法request会在snapshot准备前拒绝，不进入模型。
- NEW只读authored-episode-scope-read：JOIN原committed decision/attempt、原input hash重核及当前合法作者材料ref，认证哪些旧安排真的违反作者参与范围。未知/变更来源不冒充非法scope；DB/权限错误原样传播。仅查询cast IDs，不额外传persona；同一immutable attempt帧只核hash一次。
- 原pending request收集和hasPendingEpisodeWork在任何新reserve前过滤认证非法安排，保证一个坏项不阻塞其他合法人物工作。
- narrative-wake仅对未实际参与/执行的非法proposed过滤outstanding；active、已产生非quiet参与/消息/evidence/outcome保留。拒绝旧非法排程首次释放一个未评估的有限窗口：仅当最新paid snapshot尚未观察该episodeId；下一次snapshot已有该ID便不再释放。旧paidReviewContexts仍防同节点/同依据重买。没有事件完成、玩家同意或人物quiet被伪造。

## 验证

相关unit60/60（新3项+原wire/parser57项）：schema按node互斥人物、合法参与通过/错派拒绝、未配置兼容、显式unknown_key不扩大、DB错误不被吞为invalid。

真实独立PG55685/parallel_life_test一条完整旅程通过：真实publisher绑定与开场review后产生两个窗口；利用隔离fixture的旧SQL合法插入一坏一好历史决定（没有关闭trigger或修改现有历史）。新parser和正常commit都拒绝同一坏raw/canonical。旧bad pending仍在库中，但原pending读只返回good，bad actor无pending工作、good仍有；bad任务不进私有context、good意图正常读取，未reserve任何NPC attempt。

认证旧bad proposed后首次实际窗口为c/d，重复读稳定；正式提交一次受控quiet评估后不再释放相同原因，后续evaluationCause为空。两个原pending/两个原proposed均保持原样，不用假consumed/withdrawn求绿。原消息/事实/位置无手工补充。测试受控模型/历史fixture不作为真实AI体验成功。

边界检查758文件通过，typecheck最终结果冻结时追加。按root要求不重复全check/build，由root统一运行。

## 保留限制

本批修复角色范围，不自动抽取自由原稿前提。无结构化前提的后半段仍可能被导演过早作为未来议题；root另处理真实状态证据/预算与语义阶段。已进入历史对白的错误表达不删除；active或已有真实参与/执行的旧非法安排不静默抹掉，仍需后续明确接续策略。纯提案无执行时的一次容量释放不会为未知/数据库错误授权新模型调用。

最终门禁：typecheck0、boundary758通过，相关unit60/60、新真实PG1/1最终通过，diff-check通过。新helper原始帧hash在同attempt内复用，提案仅无resultIds、无非quiet参与消息、无evidence/outcome或本人活跃计划/责任/问题时才可一次释放；原active和有实际工作者继续保留。PG fixture的角色选择绑定作者participantRefs对应actorId，不按随机cast数组位置，避免测试本身复现错派。共享预算/真实模型和本地构建由root接管。
