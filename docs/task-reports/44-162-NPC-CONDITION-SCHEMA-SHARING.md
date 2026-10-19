# 44-162 NPC 条件schema纯结构共享

protocol162-tests；基线bced66ce；独占npc-model-protocol.ts、NEW聚焦测试与本报告。root模型输入/权限/内核/56K上限不改，wire仍v14。

## 实际长度证据

舒雅婷candidate19原完整hydrate帧在零发送preflight失败：payload18238、messages36087、responseFormat19981，总56068，超过56K。相邻林白语schema19957，仅差24，不是不同goal导致schema突然翻倍。实际state与来源增长使原固定20K grammar失去空间。

结构统计显示完全相同AgentCondition union(1107字符)重复7次：责任nextCheck、个人续行conditions、计划nextStep两处、行动preconditions三处。新增shareNpcConditionSchema仅对byte-identical union共享$defs/npc_condition；任何不同source enum或其它限制不共享，保留来源作用域。已存在保留名或缺模板时不改语法，不覆盖定义。

在同一原舒雅婷snapshot，本地真实格式长度19981→13580，净减6401字符；不删人物设定、输入、消息、责任或private信息。原付费输出与decoder完全不变。

## 语义与provider依据

官方OpenAI文档已实际检索/打开确认definitions及$ref支持：
https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat#definitions-are-supported

本项目已在真实成功调用使用现有$defs/$ref。官方OpenAI文档不能单独证明Yibu转发层所有实现细节；此处只使用原流程已采用的同一引用形式，不新增JSON schema特性。

40项聚焦协议测试、tsc通过。测试对共享前/后schema展开所有引用后逐深完全相等，检查更窄source约束保持、原输入schema不变、已共享稳定、保留名不覆盖，并确认真实NPC schema仍保留v14与改期ID/参数限制。0模型/生产操作；root继续真实请求验收和部署。
