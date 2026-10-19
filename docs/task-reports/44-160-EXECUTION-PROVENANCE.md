# 44-160-EXECUTION-PROVENANCE

状态：待root集成验收。执行者codex-execution-provenance160；root-runtime160唯一集成、真实模型、生产和部署负责人。
基线2eaf05e7，独立工作树execution-provenance160，分支codex/execution-provenance160。源码冻结0b4097c0。

## 经核实的断点

原compileNpcExecutionIntents的basis要求executions的新goal、plan和action各自sourceIds同时包含合法语义来源与当前input.sourceId。已存在v7 planIntents传输会机械附加当前input provenance，但executions没有此机制。因此人物明确选择参与、使用本人可见definition作为合法语义依据仍可能在落地实际行动前被NPC_EXECUTION_INTENT_SOURCE拒绝。此处是响应归因缺口，不是行动本身已经获得权限；后续能力、参数、依赖及内核执行资格检查不能删除。

## v10唯一改动边界

1. 当前新生成协议改为npc-wire-v10，保持原v9 focusChange形状和能力限制。
2. 以原immutable context.sources顺序精确解码全部短source ref。未知、错误、重号catalog与声明来源继续拒绝，不做模糊修复、不移除未知来源。
3. 当前input.sourceId必须唯一存在且kind为accepted_input。只对新协议executions的newgoal.sourceIds、plan.sourceIds、action.sourceIds，在原声明非空、唯一且全部可见合法时，保留顺序并机械附加当前input来源；已包含不重复。existing goal原记录不被修改。
4. 通过同一精确catalog编码回短ref，交固定v9→v8→v7→旧compiler/内核链继续解释。此往返只改传输来源归因，不改变capability、参数、意图、决定、对白、依赖或权限。
5. v1-v9受保护付费响应保留原解释，旧缺input executions仍拒绝；没有重写旧invalid或自动重试。原32k输入、人物与目标预算未改，无新SQL/数据库数据改动。

独占文件：npc-model-protocol.ts、npc-agent-model.ts；新增tests/npc-execution-provenance-wire.test.ts；原npc-agenda-review-wire及npc-focus-change-wire仅更新latest grammar版本断言。

## 必要验证

聚焦执行新provenance、focus、source、agenda、model-protocol、agent-model共90/90通过；tsc --noEmit 0错误；check:boundaries658通过；git diff --check通过。

新增9项包含：
- v10自动附加accepted input后，完整canonical提案与显式正确v9提案deepEqual；原wire/context不变。
- 已带input不重复；coordination保留本人engage与原request绑定；existing goal不改。
- 未知/重复/伪造长source拒绝，缺失/非accepted current source拒绝。
- capability、依赖、责任、重复参数、替换他人计划等守卫原样拒绝。
- v7-v9原缺input仍报NPC_EXECUTION_INTENT_SOURCE。
- schema仅生成v10，合法wake无动作时仍可quiet，不制造执行或消息。

首轮新测试误把普通player空回复作为合法quiet，原MISSING_REPLY正确拒绝；只将测试改为wake，未改业务守卫，最终90/90通过。此证据不是商业模型验收。

0 PG/生产查询写入/模型调用/部署/全量check/build。root接入后在原runtime进行必要PG、真实模型与正式部署验收；未宣称整个开场或持续自主系统已通过。
