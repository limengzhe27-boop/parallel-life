# 44-158-K：显式计划替换的内核闭环

负责人 codex-plan-supersession158-k；root唯一集成。基线6f75ce76，独立plan-supersession158-k/codex/plan-supersession158-k。状态待验收。

仅修改 domain/agent-kernel.ts、新增 tests/agent-plan-supersession.test.ts 与本报告；无schema/SQL/配置/模型/生产/部署。

## 实现

新计划显式supersedesPlanId才启动替换。目标必须为已存在、本人可见、同goal且非终态的旧计划；拒绝同轮分叉、同轮改写旧目标、跨goal与自环/新计划环。已结束旧计划不可重开。既有替换计划允许正常修改，但不得改写/删除其替换来源历史，不重复执行历史替换。

原reduceActorAgentState中原子撤回旧计划，并在旧missingConditions保存新计划ID作为替换去向。保留旧actionIds、来源、目标、责任和已执行结果。旧动作仅在proposed/ready/waiting/blocked且没有其他非终态计划继续引用时撤回；共享动作及succeeded/failed/withdrawn动作保持原状。旧动作executing或本轮出现其真实执行result时拒绝整次替换；不伪装撤销在途执行。未知付费attempt仍由原runner/仓储围栏保护，本领域层未新建恢复机制。

## 必要验证

新6项聚焦测试与原agent-kernel18项共24/24通过；npm run typecheck通过，格式化通过。覆盖独占/共享动作、终态动作、执行中与本轮结果拒绝、分叉/环/跨goal/终态旧计划、历史回放与替换计划继续调整。测试确认不修改输入快照、目标与责任不误fulfilled。

没有真实数据库改动或新事务；生产事务仍使用原kernel提交。root需在最终协议集成版本执行必要门禁并部署；本提交不宣称线上已交付。
