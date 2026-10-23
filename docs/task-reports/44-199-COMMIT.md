# 44-199-COMMIT：私聊并发的人物私有状态与事件依赖

状态：待集成验收。负责人 phone199。独占 agent-commit-version.ts、新聚焦测试；root 负责流式 callback 和调用方传入 snapshot。

## 修复

原提交位置判定把其他人物自己的计划/目标与共享世界变化一概拒绝，导致正常玩家回复因其他 NPC 执行而保存失败。

现在保留原输入、模型 snapshot 和 attempt 版本，仅选择实际追加位置：
- 仅另一人物 private 输入中的私有目标、计划、责任、决定允许跨越；当前输入也必须 private。
- 仍拒绝 actions、实际 results、worldResults、位置/离开变化、非本人消息 effects；群聊及现场私有状态变更不套用此放宽。
- episodeDecision 须 runtime/proposal 一致，并从原 snapshot 的 manifest、followUps、results、responsibilities、participations、sources 收集依赖。
- 用既有 episode_requests 确认人物、world/owner、engine epoch、consumed input 归属；共享 episode、未知请求或缺失 snapshot 均拒绝。
- 流式由调用方传既有 snapshot；完整结果恢复从 attempt.response.snapshot 读取。不新增表、字段、协议或付费调用。

## 必要验证

本地专用 PostgreSQL 55660：测试使用事务隔离 schema 的真实查询夹具，结束回滚。证明 resolver SQL 准入，不代表完整 service/RLS 或真实模型体验。

- 另一 private 人物计划允许；行动及 group 输入拒绝。
- 不相交 consumed episode 允许，snapshot/attempt 基线不变，保存 response 的恢复查询一致。
- 共享 episode、pending/missing request、缺少 snapshot 拒绝。
- 与已有 agent-commit-version 单测合计 7/7 通过。
- typecheck 通过（0 错误）。

## 交接

root 集成第 6 可选 snapshot 参数调用与 VERSION_CONFLICT 不主动 abort 付费流式的修改；公共提交仍需原 kernel 对当前 actor revision、来源、租约及执行依赖重验。本提交不改变这些保护。完整 check/build、真实页面验收、部署由 root 完成；本子任务没有生产写或模型调用。
