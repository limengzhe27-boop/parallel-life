# COMPACT-REPLY-TARGETS-06

基线 ae0b889e；独立 codex/compact-reply-targets06。公共 npc-agent-model.ts、用户存档、端口、真实模型均未改动。主入口/载荷接线由 root 完成。

## 根因与实现

原4953拒绝消息 preflight 的实际 snapshot 有38个待答问题。原 response schema 对每个目标重复 questionId/questionSourceId/responsibilityId/responsibilityRevision 的完整对象，inputInterpretation 19,864字符、全schema38,319字符。

新增纯domain helper playerReplyTargetCatalog(scope)，基于原 playerReplyTargets 顺序与授权源，返回 `{ref:'reply:1',questionId,responsibilityId}`。别名仅存在本次原snapshot内，不持久化、不可重新基于最新状态映射。新生成 grammar 只要求 `{targetRef,relation,decision}`，无责任的问题 decision=null；有/无责任最多两类schema，避免按目标复制对象。

当前 v16 decoder 严格接受 compact 或原完整tuple，两类不能混写、不能混合字段。compact在原immutable snapshot中机械展开完整tuple，再走原 interpretCurrentPlayerInput/bindPlayerInputInterpretation；原source、quote、revision、关系/决策约束继续校验。旧v15完整tuple不自动修正、历史协议不变，因此已购买response的恢复语义保留。未增加持久字段/SQL。v16区分新的必填语义，历史v15原合法null/tuple继续严格恢复。

## 实测

同一原档snapshot只读离线生成schema（0模型）：38问保留，inputInterpretation **19,864→1,297**；全schema **38,319→20,282**，减少18,037字符。没有通过删问题、决策或放宽传输上限达成。

- 专属compact及原input/protocol unit：49/49。
- 新隔离真实PostgreSQL原runNpcAgent→kernel→store旅程：1/1；明确declined写入对应责任，问题answered，消息2条；重复原请求读回同event，模型仍1个受控调用、消息不增加。
- typecheck：0错误；boundaries：760 files。
- 未重复全量check/build，root统一执行。
- 0真实模型、0用户原档写、0生产写、0端口改动。PG55675仅专属隔离测试库。

## root接线

在模型payload中替换完整 playerReplyTargets：

`playerReplyTargetCatalog({state:snapshot.viewState??snapshot.state,input:snapshot.input,channel:snapshot.channel,authorizedSourceIds:new Set(snapshot.sources.map(s=>s.id))})`

prompt将related_reply.replies改为targetRef/relation/decision，别让模型再抄四项机械tuple。原questions保留文本及id供对应别名选择；不要按payload裁剪后的新数组重建ref。claim/恢复/内核继续原snapshot，不消费有界UI副本。

未接入口前不能称为用户可用/提速。原档真实浏览器重试、最终模型请求尺寸和主整体验收仍由root负责。

## 补充：拒绝/答应不再从必填语义缝隙溜走

仅有模型schema约束不足：原顶层changes:null可绕过待答事项解释。current版本升为npc-wire-v16；有合法replyTargets的player回合，schema要求changes对象、inputInterpretation非null，decoder同样强制。仍可选择new_request/topic_change/uncertain，不强行解释为接受/拒绝；uncertain没有decision或replyAssessment，原问题与责任仍未完成。无target闲聊可changes:null。历史v15的已付费null/完整tuple记录不追加新必填规则，避免破坏response_received恢复。

stream parser显式同时支持current16、历史15及14，recall marker同样保留15+16。未机械升级历史夹具。专属+原input/protocol/stream聚焦55/55通过；真实PG以v16完成原kernel持久化和无模型重放。root模型提示词CURRENT常量自动更新，pending player回合不得被expression-only shortcuts丢掉解释。
