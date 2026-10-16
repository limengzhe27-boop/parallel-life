# 44-108-DIRECTOR-REFERENCES-Q

负责人 codex-ma44-108-director-q，集成人指派，待验收。全新独立director-references108-q/codex/director-references108-q从7912f6f9；仅director-agent-model.ts、tests/director-agent-model.test.ts、本报告与本人主表/镜像。

## 修正

提示词版本v8-reference-catalog。实际模型payload增加outputReferenceCatalog：原候选id、边界actorIds/placeIds、经原authoredView校验并由原canConsiderAuthoredEvent过滤的eligibleAuthoredEvents（原nodeKey作为authoredEventKey与对应sourceId成对）。不改变资格，不额外公开人物私聊、全文或权限；目录计入原64000上下文限制，超限仍明确失败不截断。

system明确candidateId/actorId/authoredEventKey命名空间不能混用；空候选时selectedCandidateIds/deferred/nudges必须全[]，不阻止合法作者机会。引用作者依据的机会必须同时填写同条原authoredEventKey/sourceId，不把hash、姓名、标题或人物id当事件key。原Output、parse、权限、quiet/资格校验原样，无自动补key或修复响应。

## 验证

对应纯专项22/22通过（新增2），最终typecheck、精确Prettier/diff通过。新增真实adapter payload核对：候选id非actorid；空候选+作者目录仍可通过有依据bounded_opportunity；blocked/occupied作者事件不进目录；演员id误填selected/deferred、漏作者key和actorid假key均拒绝。纯合成测试没有调用真实模型，不声称真实格式稳定性已验证。

未重复全库/PG/build，未改SQL/server/恢复/环境，0生产操作与付费调用。线上两次失败与显式付费恢复、部署READY及授权内真实验收由集成人负责，不沿用之前额度；渣男体验未发布。本补丁独立交付后冻结原文件。
