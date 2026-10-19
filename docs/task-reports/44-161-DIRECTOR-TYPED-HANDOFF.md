# 44-161-DIRECTOR-TYPED-HANDOFF

待集成；director-handoff161，自02a669dc。root唯一集成与真实模型/部署。

## 改动

真实窗口验收已产生作者机会并派发6人，但自由task全是“考虑如何/准备/适时”等元计划。v9将每个非null actorTasks值改为三个必填字段：topic、personalObjective、proposedInteraction，各1–140字。分别表达本人的具体交流议题、想了解/表达/争取的目标、向玩家提出的信息/请求/可拒绝选择。仍可null不参与，不预制对白、不强制engage、不授予额外知情。

新传输对象机械编译到现有stagingIntents.task：

`JSON.stringify({protocol:'actor-interaction-opportunity-v1',topic,personalObjective,proposedInteraction})`

编译后沿用原600字符边界，转义导致超限时明确拒绝而不截断。原domain/内核/任务持久结构不变。recovery161负责已认证本人topic与新结构投影，双方文件无冲突。投影必须验证源Director确为v9，不能仅凭历史task字符串猜协议版本。

v8作为PreviousActorTaskWire保留；已付费v8解析仍逐字task，不重写或重买。v1–v7原兼容保持。新provider schema只输出v9。

## 验证

55聚焦协议/模型测试通过，涵盖v9字段必填、人物映射、null排除、原raw不变、v8task逐字不变、旧协议解析和schema引用。TypeScript及边界检查通过。仅更新旧latest schema断言为v9；旧paid格式夹具仍保留v8。

0真实模型、0生产、0SQL。typed结构不等同于已验证自然演绎质量，仍需root真实验收与recovery161已授权本人context投影共同闭环。
