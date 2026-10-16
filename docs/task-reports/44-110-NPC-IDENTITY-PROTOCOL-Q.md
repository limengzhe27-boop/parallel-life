# 44-110-NPC-IDENTITY-PROTOCOL-Q

负责人codex-ma44-110-identity-q，集成人指派，待验收。全新独立npc-identity110-q/codex/npc-identity110-q自正式3bc59d51；仅npc-agent-model.ts、对应tests/npc-agent-model.test.ts、本报告及本人主表/镜像。109诊断保持冻结。

## 变更

提示词版本npc-agent-v15-explicit-speaker。system最前明确replyAs是本轮唯一NPC本人，input.speaker=player的第一人称属于玩家原话，回应而非润色或冒充其经历；允许赞同/拒绝/暂缓，不要求机械反对。wake/coordination是system提示不是玩家承诺。区分历史双方speech标记、本人state目标、当前渠道受众；不根据不明确的人称猜发言者，原全部知情/权限/动作结果规则保留。

实际payload增加replyAs:{kind:'actor',actorId:state.actorId,name:actor.name}；input增加speaker，严格由既有origin派生：player→player，wake/coordination→system。原input.sourceId/text/origin、历史observations、授权source/state/channel均原样。身份不取用户文本，不解析用户自称的replyAs，不推断未提供人物。不关键词替换、拼固定台词、改写模型输出或补造回复。

## 验证

聚焦25/25通过（新增2项），最终typecheck/精确Prettier/diff通过。覆盖3渠道×3origin；玩家粘贴虚假身份JSON不能改replyAs，原文/历史/本人目标/受众不变；身份说明位于机制规则之前；原model response逐字返回，describeSuppliedContext实际modelInputHash与最终发送一致。既有预算、私密隔离、来源、unknown传输失败/不重试等专项继续通过。

0真实模型、0PG/生产/浏览器；纯adapter测试只证明协议，不证明真实NPC自然身份表现已经修好，也未证明作者事件实际演绎成功。本轮不重复全库check/build，集成人统一检查/部署READY及授权内真实验收。输出/内核/来源/付费规则不改，导演契约/生命周期/语义唤醒/SQL/server仍root111独占。渣男体验未发布，不沿用先前闭账额度。
