# AGENDA-GAP-27

基线 88d9ce32，独立 codex/agenda-gap27；root 已明确交接 collectors，本任务不改其他公共模块。

## 实际断点

1. `planReconsiderations` 的 pendingQuestion 只检查线程，任何未答问题都冻结该线程所有无 action/trigger 计划。基线确定性复现普通计划候选从 1 降为 0，问题责任与计划无关。
2. 事件计划并非绕过 cadence：`!refs.length` 排除第一分支，第二分支 `agentConditionsReady([])` 返回 false，因此无 trigger 的事件计划永久无候选。初始复现假设被测试否定，已纠正，未将假设当事实。

## 改动

所有无 action/trigger 且无 missingConditions 的有效计划共用持久 planReviews cadence。候选保留 episodeIds、requestId/episodeId/choice，不丢事件关联。窗口语义移除 summary，文字改写不重新购买同一窗口。

未答问题只在存在明确关系时阻断：episodeFollowUps 中同计划的责任 ID、计划动作 handlesResponsibilityIds、或者计划/目标明确引用问题的 private_message/group_message/scene_entry 来源。共享作者材料、同线程、文字相似均不构成关联；不新增字段或语义判断。

保留 missingConditions、媒体完成专属唤醒、实际结果证明、unknown、既有条件触发路径。

## 验证

collector 原测试 + 新专项 53/53，通过；boundaries 763 files，通过；typecheck 结果见交付消息。
新测试覆盖无关未答问题、事件计划统一 cadence、missingConditions、同窗口改写去重、同事件责任问题阻断。
0 模型调用、0 用户档读写、0 生产部署。完整 check/build 与真实用户路径由 root 统一执行，单测不等于整体持续演绎已完成。
