# WORLD-PUBLISH-02-INVITATION-CONTEXT / 后续真实邀约证据

负责人：codex-publication-story-followup-02-01a11a84-20261013。集成人：root 01a0c73b。
准确基线：b6bf769894af00a83899936e22c645dedbb7c7a0。
工作树：/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本；分支 codex/publication-story-followup-02。
状态：本地验证后待 root 集成/生产49/READY/公网，未称线上完成。

## 范围与结果

仅新增0049_publication_story_followups.sql、两项专属真实PG测试、本报告；修改publication-story-repository.ts。原46/48、domain、ports、server、planner和公共测试未改。root独占接口签名/普通玩家回合接线及真实模型额度。

1. invitationContext(ownerId,worldId,actorId)返回Promise<{title:string;placeName:string|null;earliestAt:string}|null>。仅读当前窗口/当前阶段、该角色已经实际回复的failed offer_invitation；原命令必须succeeded、原事件版本准确、assistant实际来源准确、存在no_matching_actual_invitation失败回执。无pending且唯一，排除resolved/skip/expire/exclusion/已有followup，歧义null。只返三字段，不赋知情、不输出完整plan/私有persona、不生成日程。调用只做内存投影和读取；tx沿现有入口仍可惰性初始化裁剪plan，已初始化读取不增加回执/事件。
2. 49新增owner FORCE RLS的immutable followups表，一节点最多一条，一实际邀约最多一个节点。仅app SELECT/INSERT；worker/publisher/PUBLIC无表访问。原claim/source/expectedVersion/失败回执原样保留。
3. INSERT SQL证明原已呈现failed节点、不可变绑定、原succeeded命令与原NPC来信；later同owner/world、晚于原事件的succeeded player turn，包含同NPC实际玩家消息、非空assistant、实际appointment.proposed及日历投影。精确title、唯一自己participant、原时间下限、实际未来邀约、原/后事件及当前合法窗口，无pending/互斥已解决，歧义拒绝。source是后来真实事件，而非原cmd。角色拒绝或口头承诺无effect不续接。
4. 仓储reconcile发现独立证据后以有效状态投影progress/阶段；接受/赴约只能来自实际invitation.responded，取消/错过/过期保持真实结果。原row仍failed，原失败审计不改。已followup机会skip返回INVALID_STATE，应对实际日程使用cancel；retry不新付费。
5. offer_context保持48的app身份、worker exact live task/lease owner/world，无app.user_id依赖；仅扩展独立证据的实际source。历史实际链接在取消/错过/过期后保留；现场brief仍受真实响应、窗口和active matching scene限制。不制造到场/参与/吃饭。

## 验证证据

- 本人local PG55478，独立dev/test、全部合成。四项真实PG联合60/60（新followups19、新context9、worker9、既有story23），0skip。真实PostgresTaskQueue.read/commit无app身份成功；wrong owner/world/token/expired拒，worker读followup表拒。
- 新正反例：原claim/source/完整row逐字段未变；反复progress只一条followup；wrong actor/title/earliest/currentwindow、无原source/claimed/unknown/另一个pending、director没有user消息、口头承诺、缺失user投影、额外participant、原事件/未succeeded/无实际effect、跨world/owner、跳过、多个实际邀约歧义均不产生关联；full transaction rollback无残留。
- 实际accept开启下一阶段；普通下一节点context读取使用有效前置结果。actualcancel后progress declined/brief null/历史later source仍留；未接受到期为expired、playerCompleted=false。
- npm run check：1743/1743、399边界、typecheck通过（最终接续已再核）。npm run build通过。格式与git diff检查通过。
- 原46/48文件未改；本地dev/test迁移checksum与文件一致（dev/test各49项收尾核验一致）。首次SQL49开发期CTE拼接错误已仅在本人本地未发布49夹具回滚重建，未改任何已发布迁移；测试初稿的runtime.load、player origin表达、clock倒退夹具和commands状态约束已修正，失败未计作通过。
- 0生产数据库/模型/图片/浏览器/部署。本次不使用root真实存档和收费额度。

## 集成接续

先应用49，再集成仓储与root的ports/server/planner。已有46/48函数与源不可放宽。新函数分类：publication_story_followup_valid仅app EXECUTE；publication_story_followup_outcome与publication_story_followup_source为内部函数，所有业务角色/PUBLIC均无EXECUTE；offer_context继续仅app/worker。表仅app SELECT/INSERT。若全库role分类测试列举函数，root适配这些明确权限；旧源码/旧历史断言本树无需改，联合回归已过。

只验证结构与数据库真实性；不保证真实模型每次会提出邀约。真实生成、迁移49生产核验、部署READY及公网体验仍由root在明确预算内完成，保留既有失败样本。

资源收尾：自有PG55478通过原启动session正常SIGINT结束、exit0；端口复核无监听。业务源冻结供root，不再并写。
