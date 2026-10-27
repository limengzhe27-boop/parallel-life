# SCENE-RESPONSE-AUDIT-08

只读审查，基线ad1714e2。两原档均使用root忽略配置的应用角色连接，显式SET TRANSACTION READ ONLY。未调用模型、运行任务、修改源码/原档或端口。先前专属55676测试库已按root要求停机，55432未停止。

## 原4953

取证时版本506。当前scene 8fe236dc…，城市街边，active，仅玩家presence。唯一scene任务4ebe9c1f…是2026-10-26旧开场环境任务，status=succeeded；scene.entered v291、scene.opened v292均succeeded。

无scene action任务、无scene.input_recorded、无user_action entry。故这份原档没有“已接受现场输入但无模型结果”的数据库证据；不能声称其现场发送已跑通，也不能从缺任务推断用户操作方式。若用户此档仍按发送，需root检查真实页面是否发出POST actions以及前端拒绝原因。

该唯一旧任务在410排除清单中，但已经成功完成，不是需要恢复的失败任务；不应解除全部旧任务排除。

## 原2fb

取证时版本107。共有3个scene：街边ended、刘胜男办公室ended、李之之出租屋active；三者presence均只有玩家，没有经证明在场的NPC。

- 办公室旧任务1ec305b1…（action d2159fde…，expectedVersion36）于2026-10-26 16:58失败INVALID_COMMAND，18ms。后来相同地点任务16af5e1e…、1c7b56d4…、af33c8c5…均真实成功，prompt=scene-environment-response-v1，约2.0—2.4秒，分别有scene.action_resolved及环境旁白。旧无人错误不是当前代码的唯一结论。
- 出租屋环境开场419f6611…成功；随后用户“有人吗”两次已真实202接受，产生scene.input_recorded v104/v105、user_action/action条目。
- 对应任务af9ae5dd…、f513f0e2…均UNKNOWN，attempts=1；分别耗时2524ms/2360ms，未保存环境回应。不是未提交，也不是没有执行任务。
- 两个UNKNOWN任务和办公室旧失败任务均不在410 excludedTaskIds中。当前没有这两任务queued/running可领取，未知结果按原保护不自动重发；不应该擅自解除排除或重跑原任务。

## 两个UNKNOWN的准确日志原因

来源root .local/local-play/server3218-build35.log，原taskId对应日志（约376—402行）：

1. af9ae5dd…：native_agent_phase完成control/world/routing_context，随后MODEL_REQUEST_REJECTED HTTP429，网关报“当前分组上游负载已饱和”；run-worker记录detail=UPSTREAM_FAILED、stage=response、httpStatus=429。
2. f513f0e2…：同样通过routing_context，HTTP429，网关报“模型grok-4.3的可用渠道不存在”，code=model_not_found；同样被记为UNKNOWN。

没有进入responder/actor_context/agent_run是合理的：此时没有NPC，执行的是respondToEmptyScene环境分流。上游拒绝导致未进入commitSceneProposal，不存在人物回复已产生却被scene版本拒收的证据。

## 实际调用链与最小建议

POST scenes/:sceneId/actions →原scene input事务保存行动/任务→ worldTaskDispatcher → sceneEnvironmentTaskHandler（仅开场）→ nativeNpcTaskHandler →真实位置/可观察性确定actorIds →无actor时respondToEmptyScene →createSceneTextModel → emptySceneProposal →原commitSceneProposal与task成功原子保存。有人时才走coordinateNativeResponder/readNativeAgentSnapshot/原NPC内核。

环境模型配置是sceneGatewayConfig：YIBU_SCENE_MODEL优先，否则gateway base.model。createSceneTextModel复用同网关/transport，不必新建旁路。此次出租屋失败与office成功同为空场链路，日志已经区分为上游负载/模型渠道错误；root应核对现行场景模型配置与可用渠道，而非把未知NPC放入屋内来绕过空场。

GatewayError目前只有response阶段400/401/403/404/413/415/422被标为rejected；明确429网关拒绝仍无responseOutcome。run-worker将UPSTREAM_FAILED且非definite归unknown，导致已明确限流/无模型渠道也显示“结果不能确认”。建议root在共享模型适配层区分可确认的HTTP拒绝和真正已受理但丢响应，补必要受控测试，不简单把所有unknown改失败，不自动重买已有unknown任务。现task台账model/prompt为null也使用户难理解；成功空场写prompt版本，但失败只能靠网关日志证明阶段，后续可复用既有诊断字段改善，不必新增业务字段。

4953没有action的前端接线问题需root另行真实页面定位；2fb当前无回应已明确是两次上游HTTP429拒绝与错误分类。两个结论不能混称为“NPC都没跑通”。本审查不做真实模型/页面验收，不宣称问题已修复。
