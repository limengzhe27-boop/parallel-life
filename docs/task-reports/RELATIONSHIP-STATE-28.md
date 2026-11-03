# RELATIONSHIP-STATE-28

基线 d9f988e9，agenda_gap_review27 独立 agenda-gap27，root唯一集成。独占 reducer.ts、agent-state-event.ts、新 relationship-state28 PG测试。

## 根因与修复

relationship.bonded 既写 A→B 的 actorTies，又把 B.actor.relationship（作者定义的与玩家关系）覆盖成 A 所称的关系。agentDefinitionRef 包含 actor.relationship，所以 B 后续 snapshot 严格校验失败。同时语义上把私人有向关系误当人物身份。

两条原事件投影均删除 targetActor.relationship 赋值，只更新 actorTies；没有放宽 snapshot 校验、没有新增同步入口、没有改 kernel/advance。

## 实际PG证据

基线红：合成 A=玩家同学、B=玩家邻居；A声明B是工作伙伴后实际人物关系数组变为 [玩家同学,工作伙伴]。修复后相同PG通过：

1. B当前聊天模型挂起，A关系动作经正常service执行并产生真实 actorTies(A→B,工作伙伴,mayShare=false)。
2. 双方与玩家关系原文、definitionRef不变；双方private snapshot和调度collector可读取。
3. 放行B旧并发响应，旧基线按现有依赖校验安全VERSION_CONFLICT，未覆盖新关系。
4. 双方随后正常聊天均committed；总受控模型4次，未自动重买。

PG1/1通过，typecheck通过。0真实模型、0用户档写、0生产部署。完整check/build由root集成执行。

## 旧档处置

compact worlds.state 中已被旧代码覆盖的 actor.relationship 不会因本次代码删除自动恢复。若发现受影响档，应只读对照immutable initial snapshot、世界效果与合法定义修改历史，重放本次正确语义后比较；只有可完整溯源的错误字段才走单独迁移，保留事件原文与actorTies，不直接覆盖为猜测原值或放宽definitionRef。

root报告原2fb用户档 world_events data.effects 中 relationship.bonded计数0（未扫描其他编码）；本批不对该用户档实施恢复，不自动回写任何旧档。
