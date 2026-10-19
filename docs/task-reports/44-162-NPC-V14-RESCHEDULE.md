# 44-162 NPC v14 改期参数结构与计划互斥

protocol162-tests；基线da20c44c；只改npc-model-protocol.ts及协议测试；root负责模型说明、运行时、真实验收和部署。

原李之之paid v13返回空wait missing数组、同时用planIntents和execution替换同一旧计划，并在appointment.reschedule缺appointmentId且多填title。原响应保持invalid，不修改、不重买。

新v14仅改变reschedule的输出参数为显式对象{appointmentId,at,placeId,reason}，后两字段可null；其它能力仍用原name/value数组。provider必填appointmentId及at，并从本人当前责任或已授权appointment来源列举已知ID；未具备ID不提供此能力分支。代码验证准确来源身份、ISO时间与固定键，然后机械编回旧参数数组进入原内核，不从对话推断ID、不填默认值、kernel约束不变。旧v13仍原参数数组解释。

空wait/blocked保持拒绝；provider恢复对应missing.minItems=1及reconsider.conditions.minItems=1，避免结构化输出grammar把领域非空约束全部剥除。新v14明确拒绝同plan在execution.supersedesPlanId和planIntents中重复被改变；不选择其中一个、不静默丢弃另一个。

37项聚焦协议测试、tsc通过；覆盖合法改期准确编译/无原raw改写、缺ID/外来ID/title/时间格式/错误数组拒绝、旧v13原数组语义、schema固定键及非空、重复计划替换拒绝。未改npc-agent-model.ts或其测试，0真实模型、0生产/SQL。
