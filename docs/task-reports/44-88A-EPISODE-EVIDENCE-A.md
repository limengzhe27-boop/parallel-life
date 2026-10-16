# 44-88A 真实事件证据分类

Agent `codex-episode-evidence88-a`；root唯一公共协议/SQL/集成人。独立工作树 episode-evidence88，基线 f351e221。

新增纯 domain `episode-evidence.ts` 与专属测试，不改已有入口、SQL或共享状态。`verifyEpisodeEvidence(binding, source, priorRecords)` 返回明确 typed record 或 null；无新SharedEpisode状态、无完成推断、无模型调用。binding包含world/epoch/episode/actor/action/appointment或journey；记录包含真实source/result/event/version/story time。expected revision、CAS、去重、付费与事实权限均由原事务和root SQL83维护；类型本身不构成来源认证。

支持证据分别为 invitation_proposed、invitation_accepted、invitation_declined、travel_started、arrived。plan.record/对白/Director自称发生不支持。accepted不是arrived，travel.begin不是到达，任何一项都不自动认证整个作者事件成功。取消已接受预约不能偷换为拒绝未接受邀请。既有真实proposal证据是response前提；真实departure证据是arrival前提，拒绝跨world/epoch/episode和主体、来源/action/output不匹配、非成功result、过早arrival。

实际接线建议：
- `npc-agent-kernel.ts`中finishAgentCommit后，projectEpisodeRequest后，同事务已有agent_episode_receipt精确request→episode/actor/attempt/sourceEvent。结果表真实AgentActionResult包含actionId/eventId/outputRefs；仅同一次attempt仍不足以绑定全部行动，需核原action.sourceIds含当前inputReceiptId或经授权source resolver证明episode归属。
- 邀约后续：按actual appointment outputRef与已保存action→episode binding回溯，再核InvitationEvent及其beforeAppointment。不要从自由台词寻找“答应”。
- arrival：实际AgentJourney beginActionId/departure.id/eventId回溯相同binding，原arrival内核先验路线/位置/时间。helper只分类已认证源，不验证数据库提交与owner。
- root新SQL83需将evidence和原world event/command/attempt/result/request同事务约束，唯一键包含episode/actor/source/kind，支持同一个world event中不同action results。append-only记录本身不可自动向所有NPC传播。

验证：专属6项通过、TypeScript通过、Prettier通过、diff check通过。未重复fullcheck/build；root集成后统一执行。0模型/数据库/浏览器/生产写入。尚未接线、尚未部署，不宣称事件结果整体完成。父事项44-68仍有结果政策、真正事件结束和再考虑生命周期缺口。
