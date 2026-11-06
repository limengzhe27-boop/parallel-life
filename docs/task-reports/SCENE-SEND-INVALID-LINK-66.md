# SCENE-SEND-INVALID-LINK-66 现场发消息发不出去

## 现象

2026-11-06 15:15 前后，用户在世界 `d4fc15fc` 的现场（scene `559a30f3`）给刘胜男发消息，前端显示发送失败。任务 `a3cd2b8d` 状态 failed，`error_code=INVALID_AI_OUTPUT`，耗时 2832ms。

## 根因

模型在回复里把 `questionForResponsibilityId` 填成了一个这个世界不存在的 id：

- attempt `775daf3c`：`5c0c611b-6006-4679-9448-38a80053992b`
- attempt `59386bff`：`5c0c611b-6006-4679-9448-38a80053992b_question_0`

该角色实际只有 `resp-travel-answer` 一条责任。`validateAgentProposal` 对未知关联直接抛 `UNKNOWN_QUESTION_RESPONSIBILITY`，整个回复被判 `INVALID_AGENT_PROPOSAL`，连正常的台词一起丢掉。

这个字段只是“这个问题对应哪条责任”的可选标注，不是台词本身。

## 改动

`src/modules/world/infrastructure/npc-model-protocol.ts`：解码时先算出本人可见的责任 id（当前 state、viewState、本轮新建的 responsibilities），若语句里的 id 不在其中，只删掉这个字段，保留语句文本、`requestsPlayerReply` 和其余变更。玩家回合、场景/私聊两条协议都走同一段。

## 验证

- 用两次失败的真实快照 + 原始模型输出回放 `parseAgentProposal`：修复前都是 `UNKNOWN_QUESTION_RESPONSIBILITY`，修复后都通过。
- 新增 `tests/npc-model-protocol.test.ts`：未知 id 被丢弃但语句保留；已知 id 仍保留。
- `npm run check` 4320/4320，`npm run build` 通过；3218 已切到该构建（16:05 左右重启），现场读接口 200。

## 剩余

- 失败任务 `a3cd2b8d` 的“重试”会被恢复策略拒绝（同一任务存在两条 attempt，且都不是 `response_received`）。这类失败应在前端改成“重新发送”，不能指望重试；本轮没改前端。
- 玩家那一条现场动作已记录，只是 NPC 回复未生成；重新发一条即可继续。
