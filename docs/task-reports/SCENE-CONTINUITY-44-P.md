# SCENE-CONTINUITY-44-P

基线3f873001，独立scene-protocol44；root唯一集成。

新增最小模型表达协议：scene或已认证sceneReplyContext请求使用npc-wire-v20；普通private/group继续v19，不新增输出负担。AgentStatement.kind可选speech/narration，历史省略仍speech；AgentProposal.replyChannel可选private/scene，只有co-present private的v20明确必选。没有数据库迁移。

v20复用v19现有增量编译，旧v19出现新kind拒绝，避免旧raw改变含义。narration只允许有效scene目标，不得requestsPlayerReply/sticker/questionForResponsibility；物理行动仍走executions，不靠旁白确认为完成。模型提示限定本人轻微动作与表情，root仍需内核校验直接proposal绕wire、提交前在场重验及实际投影。

模型sceneReplyContext进入本轮payload，system/responseContract/schema协议一致。co-presence私聊decideStream转同次decide，不在目的地确定前发微信prefix；普通private保持原stream。root定义并认证snapshot/context.sceneReplyContext，本分支用结构类型兼容以独立编译。

验证：typecheck通过；新4 + followup7 = 11/11。未模型、未用户库、未运行进程。root仍需联合提交/恢复/页面/真实PG及实际模型验收；不宣称跨渠道交付完成。
