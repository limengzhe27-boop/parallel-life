# 44-165-CONTINUATION-LIVENESS

状态：待集成。负责人 autonomy-runtime-audit165；root 唯一集成/部署。独立工作树 continuation-liveness165，基线 145b2ab3。

## 问题与修复

原 own-agenda-review-authority 在读取原预算和复盘时间窗口之前，将同一语义 basis 的所有非 act continuation 直接排除。await_response、await_condition、no_current_intent 因此无法使用已有的有界个人议程复盘；时钟不会改变 basis，可能永久沉默。

现在明确区分执行等待与本人安排复盘。复用原 family、真实承诺 anchor、原接受/claim/send/commit、故事与现实窗口、预算、优先候选、未知调用隔离。所有 continuation 决策均可在满足原条件后获得同 basis 至多一次复盘；已付费考虑过的 basis（包括 unknown/invalid）仍不可重买。只改变 quiet 理由、回执、时钟或版本不产生新资格。真正更新本人目标/计划等语义状态，才可能有下一次资格。

不修改计划执行条件，不把沉默当答应，不产生固定来信，不要求人物发消息，不绕过任何执行内核。

## 文件

- src/modules/world/domain/continuation-review-admission.ts：纯资格判定，不维护第二套时间/预算/调度。
- src/modules/world/infrastructure/own-agenda-review-authority.ts：同一原权限入口调用上述资格判定。
- tests/continuation-review-admission.test.ts：四种 continuation、改写理由不越过同 basis fence。
- tests/integration/act-continuation-review.test.ts：沿用原测试并增加等待/空议程旅程。

## 必要验证

- 2 项纯测试通过。
- 原真实 PostgreSQL 55587 连续旅程通过：act、await_response、无 goals/plans 的 no_current_intent 均经原事务获得一次 review；未到时间仍拒绝；quiet 后同 basis 不再购买；实际玩家输入和原内核提交的新目标可产生新资格。没有直接编辑 actor 状态。
- TypeScript 无错误（最新测试追加后再检查）。
- 0 真实模型、0 生产修改、0 部署。root 负责原手机真实自动触发与上线验收，不能用该数据库测试声称主动体验已完成。

## 限制

本项让等待后可自主调整一次，并保留反复 quiet 的成本保护。不能承诺模型一定调整、一定发消息，或在相同语义情况下无限产生新事件。事件机会与真实新结果仍由原导演及事实链路提供。

## 给 root 的其他只读发现

1. 前端每个 idle 时间桶创建不同 operation，但多个 operation 可引用同一 pending Director。各回执被判 unknown 并按 client key 累积，达到 30 条非 failed 后 useAdvanceRecovery.advance 直接返回，能封死所有新工作。应以原 work 身份汇聚恢复观察，而非清空 unknown。
2. 多候选触发 scheduleAgents.coordinate，Director pending/invalid 异常被 scheduleAgents 吞为 coordination_failed；server 已设置 coordinated=true，故跳过后面的独立人物 fallback。单人物可继续、多人物反而全 quiet。应在统一调度边界区分需协调候选与独立候选、保护尚有原响应待提交的 frame。
