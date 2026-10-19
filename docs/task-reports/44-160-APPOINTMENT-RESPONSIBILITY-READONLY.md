# 44-160-APPOINTMENT-RESPONSIBILITY-READONLY

执行者codex-appointment-responsibility160-readonly；root-runtime160唯一源修改、生产、模型和部署。范围：root指定忽略文件160-live-proof的attempt964a186d-f65e-412d-832e-bded62470350，只读源与纯函数。

## 可确定证据

- 指定attempt属于351fa7ef合成档，status invalid_output，expected worldVersion7，proof world亦7，actorRevision2；snapshot.storyAt为2026-10-14T00:28:22.217Z。
- wrapper内snapshot与response经当前parseAgentProposal成功，canonical proposal二次parse也成功；不是一般wire/schema不合格。
- action为appointment.propose，参数仅title/at/placeId，title长度12，at为2026-10-14T09:00:00+08:00；在snapshot时刻仍为未来。place在snapshot边界且proof world恰有1项。
- action无前提/依赖，来源含当前input；原evaluateAgentActionEligibility在snapshot时刻返回ready/missing=[]。
- action.handlesResponsibilityIds非空，唯一引用已有episode_request:…:followup责任，subject.kind=request，status=waiting。
- 原npc-agent-kernel在动作ready后、appointment参数分支之前，检查非空handles仅允许指定具有核销能力的操作（fulfill/cancel/accept/reschedule/item/activity/relationship/moment等）。appointment.propose不在该白名单，故必将抛CAPABILITY_CANNOT_HANDLE_EXTERNAL_RESPONSIBILITY。

## 根因和最小建议

发出邀请仅产生提议，不代表处理完旧请求或事件责任。原npcResponseFormat只对media分支限制handles为空，而immediate分支包括appointment.propose，仍给出可填已有责任ID的空间，生成协议与实际执行能力不一致。

建议按统一的“该能力是否可由真实结果核销责任”契约裁剪原生grammar：appointment.propose等仅允许handles=[]，已有请求与行动的关联保留在目标、计划、来源和明确责任状态中。不要删除内核守卫，不对已付费响应自动删handles，不把邀请提议当整体完成。本报告未修改任何源码。

## 证据不足

缓存proof没有当时事务的live clock、source重验/授权查询结果与具体异常receipt，故不能排除事务更早校验先发生。上述是这份合法parse提案中确定存在、到该分支必拒绝的能力断点，不声称已凭缓存复现完整事务或知道唯一实际exception。生产精确reason应由root沿原诊断边界核实。

0生产查询/写入、0模型、0paid重试、0源码/SQL改动、0测试/部署。仅调用原纯parse和eligibility检查，不将此报告视为修复或真实验收通过。
