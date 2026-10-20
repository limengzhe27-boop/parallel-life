# 44-168-COMPACT-SCHEMA-TEST-D

负责人 standalone-action168，root唯一集成。独立工作树standalone-action168；本项仅提交tests/npc-model-protocol.test.ts和本报告。root当前协议/编译/领域源码临时拷贝用于验证，不提交源码。

## 变更与证据

当前原生schema改为protocol/statements/executions/changes四字段，旧状态判断转入changes对象，允许无变化时null。测试按真实结构访问，不给生产增加兼容API，也不把历史v1/v2/v3/v4 fixture改成当前协议。

保持问题/来源/责任修订绑定、既有目标ID范围、禁止模型完成状态、必需事件选择内部结构等语义断言。即时图片执行分支仅ref/action，无goal/plan、无handlesResponsibilityIds，action闭合；持续计划执行分支保留goal/plan。顶层准确四字段。

本文件29/29通过。额外只读检查其他8份schema相关测试：60项中53通过、7项因旧schema路径或当前版本常量期待失败，已交root处理：capability-responsibility-policy、npc-agenda-review-wire、npc-condition-schema-sharing、npc-execution-provenance-wire、npc-focus-change-wire、npc-goal-update-provenance-wire、npc-plan-wire各1。未修改这些文件。

审查注意已报告root：required consideration的外层changes若仍允许null，schema会允许decoder拒绝的缺选择输出；agendaReview mandatory wake同理。修正归root，不在此测试迁移中隐藏。

无模型、生产、SQL或部署。整体check/build及真实验收由root完成。

## 追加7文件适配

经root授权，已将上列7文件的当前native schema检查迁移到v15及changes结构；历史v6/v7/v9/v11等输入fixture及对应语义仍不变。新增仅测试helper npcChangeObject，兼容changes明确object和nullable union两个合法外层形态。即时media不暴露handlesResponsibilityIds，并明确断言additionalProperties=false；不将“未找到能力”当通过。当前聚焦60/60通过（含未修改npc-source-reference）。待root修正required scope外层changes后补充外层非空断言。
