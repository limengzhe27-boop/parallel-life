# 44-162-AGENT-CONTINUATION

进行中；只读方案阶段。复用 director-handoff161 工作树，新分支 codex/agent-continuation162，自 d538c049。root 独占公共契约、内核、SQL、生产、模型和部署。未修改公共NPC协议。

## 实际证据

仅读取root已有 .local/161-live-proof.json，不调用生产或模型。14个人物attempt包括：6个已提交事件考虑（5 quiet、1 engage）；6个自主议程复盘均quiet；1普通回复；1 response_received待提交。内部quiet理由多次重复，集中在等待玩家回应、没有紧急事项、观察后续。证据不支持“未调度人物”；确实调度了，但没有形成可执行后续。

## 当前结构断点

1. npc-model-protocol：consideration.quiet不需要followUp或明确状态去向，可只给reason并空计划。defer/need_information必须有waitingOn/missing，但编译后责任nextCheck固定为空。
2. 既有collectors明确拒绝空nextCheck，因此缺失条件的文字不产生条件唤醒；这是正确的权限保护，不能靠解析文字凭空造期限。
3. 自主复盘agendaReview只有decision/reason/basisSourceIds。quiet禁止实质议程变更，故不得要求quiet顺便伪造目标或责任。其原因保存在受保护输出，但不是可用来决定后续的结构化状态。
4. quiet成功提交仍是新私聊anchor，现有own-agenda机制按预算与退避再评估。因而不会永久没有候选，却可能反复付费得到同一句“继续观察”，缺少按相关变化唤醒的语义去向。
5. 当前NPC能力表有旅行、邀约、活动、朋友圈、媒体等通用能力，但实际可做什么必须以当前snapshot渠道能力及内核对象/地点/来源资格为准，不能把能力名称当行动已完成。

## 提议，待root确认接口与文件归属

独立ActorContinuation表示人物当前不联系时的安排，而不是玩家责任：
- existing_plan：引用本人已有计划；
- awaiting_response：引用本人尚未结清问题；
- awaiting_conditions：引用现有AgentCondition并说明缺项；
- no_current_intent：允许无新计划，下一次依据本人新可见信息/本人计划变化/新授权机会考虑。

所有选择带本人合法basisSourceIds。不能将缺项文字自动编成地点、时间或完成证据；没有真实答复窗口不增加硬期限。quiet保存这项内部决策不等于更改业务目标或发消息。

调度继续使用既有事实、计划、问题和事件来源，检查相对于该决策是否有相关新增依据。不能仅由这次quiet自身提交生成下一次付费授权。保留有预算的重新考虑机制，但不要求每次检查调用模型。

拟由本Agent新增纯domain策略与测试；公共NPC协议、状态存储、调度接线须与root明确分工后再写。此报告不宣称功能完成。

## 实现与交付（待root集成）

基线d538c049，独立分支codex/agent-continuation162；root批准公共文件后实现：

- 新npc-wire-v12要求continuation，四种个人决定act / await_response / await_condition / no_current_intent。字段reason/sourceIds/planIds/questionIds/conditions；不强造消息、目标、期限或玩家义务。v11原解析分支不改，旧已付费raw继续旧解释。
- 纯领域validateActorContinuation检查本人可见计划、开放问题、授权来源，条件只能复用已有计划/责任条件或权威期限、已授权观察；陌生地点、无依据两小时期限不可创建。
- 原PostgresNpcAgentKernel.parse及commit验证；原事务保存state.continuation，服务端附version/decidedAt/sourceInputId/basisHash。没有新表/旁路消息。
- basisHash取本人definition、knowledge、goals/plans/actions/responsibilities/decisions/questions/episodeParticipation语义状态，不包含worldVersion、revision、当前焦点或continuation本身。本人quiet不再创建下一次付费review理由。
- readOwnAgendaReviewWorkInTransaction在collect/accept/claim/send检查相同basis，commit继续原已付费帧边界；旧无continuation存档仍可一次原议程考虑。新本人观察、事件请求走既有高优先入口，不能被复盘gate冻结。
- 新事实packet可交给NPC：describeSuppliedContext仅纳入world_event+narrative前缀+private_strategy+authored_context观察，仍认证已实际提供sourceId/hash。不扩大普通world_event可见范围。
- previousContinuation仅在私聊且来源、计划、问题均仍在授权view中时提供，避免群聊注入私人判断。

### root剩余接线（不可宣称已完成）

本包不修改agent-schedule-collectors。continuation.conditions本身不是一个新调度器：已有plan.triggers/responsibility.nextCheck继续由原调度检查；纯时间到期而本人state未变时，own-agenda gate仍抑制泛化付费复盘。若需要独立continuation条件唤醒，应由root原collector建立带条件/本次continuation来源的稳定身份，并判断真正新增满足条件；不能每个tick重用已满足条件。新narrative observation入口由root/adapter负责。观察即便不发消息也应ACK防重复。真实自然表现、完整check/build、生产部署归root，未在此声称完成。

### 必要证据

- 41项领域与协议测试通过；60项现有模型/源绑定/focus兼容测试通过。
- 本地55587真实PostgreSQL原入口8项通过，新增v12 continuation从原runNpcAgent→内核事务持久化→own-agenda不再因自己quiet发起；旧v6计划、unknown隔离、v8保护响应恢复、零发送接续仍通过。
- TypeScript与边界检查通过（677模块）。0真实模型、0生产写入、0SQL迁移。未运行全量测试/构建，root统一执行。
