# AGENDA-WIRE-29

基线 de3021f0。root负责npc-agent-model说明和真实验收，本任务独占npc-model-protocol、stream parser、proposal parser机械版本兼容和专属测试。

## 确定缺口

旧agendaReview三分类是重复的行为决策：quiet禁止任何实质改变，update_plan必须goal/plan/responsibility改变且禁止文字，contact必须文字。合法的无台词standalone自身动作无法落入任何分类。静默计划调整同时要输出update_plan和真实planIntents，错误分类使有效提案失败。

## 实现

当前wire升级v17。agendaReview只保留内部reason+basisSourceIds；是否说话由statements表达，做什么由executions/planIntents表达，不再要求额外分类。保持review范围、必需报告及来源认证，原编译/内核/依赖/权限校验不变。v17不接受decision旧字段。

v16/v15及更旧历史保留原解析语义；v16 inputInterpretation仍强制，不因升级变成v15宽松行为。stream execution envelope与expression normalization同时加入v16明确版本，原付费响应不升级不改写。

不修改调度窗口、付费budget、unknown，也不强制每个engage创建计划。engage只有态度但无计划时仍可能缺接续依据：本批只消除表达互斥，不能宣称已解决全部长期自主。

## 验证

25/25聚焦通过，typecheck通过：新v17六项（quiet、静默standalone、静默plan/文字+plan、scope/来源/能力/旧decision拒绝、v16分类兼容、v17/v16/v15流式）、原agenda九项、compact-player-reply-targets六项、stream-media四项。

0真实模型/用户档/生产。root负责完整门禁、模型说明配套、真实模型行为与部署。未把解析通过当作自主推进已经改善。
