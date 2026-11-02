# NPC-TASK-CONTEXT-18：任务上下文与表达范围分离

负责人 root-task-context18；基线 7de1b344。只读审查 task_context_review18；公共实现由 root 集成。记忆压缩、persona、actor-context、数据库和调度不在本批修改范围。

## 已实现

- 保留既有状态投影：纯表情也携带有效 goals/plans/responsibilities/questions/focus/continuation、planNextSteps 和 conversationProgress，不再清空任务输入。
- expression-only 仅约束输出；带服务器 episodeManifest 的回合保留 required consideration，不能被表情快捷路径覆盖。
- 正常玩家输入裁掉服务器 planReview/agenda-only 指令；没有服务器事件授权不带协调指令；伪造玩家 JSON 不构成协调授权的规则仍保留。
- 活跃 episodeFollowUps 不再作为超预算可删除项。预算不足明确失败，不静默遗忘任务。
- 人格、记忆读取、人物知情、执行来源和保存链路不变；无新增业务字段、表、路由或模型调用阶段。
- 系统说明明确任务是持续背景，回应先结合当前用户内容，仅相关时承接任务；不以换话题/表情认定接受拒绝或完成。

## 请求对比（真实原存档已保存 snapshot，只读重建）

UTF-8 bytes = messages.content 合计 + JSON schema；不是 token，也不是账单。相同输入、相同人格。最后一次全文聊天 81,516 → 78,428 bytes；三次表情由约 63,929–64,268 → 66,314–66,771 bytes。表情增加约 2.4KB 是恢复此前被清空的任务/问题/来源，不宣称所有请求变小。未采用恢复全历史状态与扩大目录的尝试，该尝试会额外增长约11KB。

## 真实模型有限验证

1次 grok-4.3 使用原存档最新已保存 snapshot 只读回放，不向存档写消息或改变进度。23,686ms，npc-wire-v16 JSON有效；inputInterpretation=topic_change，旧任务没有被当作接受/拒绝。模型仍回复“发完该回工作的事了”，说明人物表达自然度尚未证实改善；不将本次回放称为实际手机端发送/保存或持续主动推进验收。没有重试。

## 验证与交付

聚焦 NPC 输入测试58/58通过（任务保留、表情不授予变更、无关聊天、活动事件超预算不丢、跨渠道边界等）。check/build和本地运行状态见下方最终记录。

## 未完成与接续

- system/schema 仍较大，继续按实际能力拆分重复规则及无变化字段；本批没有改变公共输出协议。
- 表情目录仍沿用原 compact/full 策略，未以丢语气含义换取缩短。
- 现存 stateContextWithFallback 对损坏旧投影的降级需独立审查；本批没有扩大或取消它。
- 人物自然度、20秒延迟、长期自主推进尚未证明解决；需要对应服务链和场景验收。
- 另一会话负责记忆压缩；本批没有修改记忆、persona。对接时不得再次从表情输入清除任务。

## 最终本地交付记录

2026-11-02：npm run check 4165/4165，最终聚焦58/58，npm run build通过。本地3218 PID78940、3219 PID78941均health200；queue78942 ready，proactive78943运行。仅本地更新，未推送生产。

启动后主动调度日志仍有原档 no_candidates，以及另一请求 COMMAND_CONFLICT（expected535对stored533）；此项归PROACTIVE-ROOT15接续，不能把worker ready说成自主推进已跑通。本批真实模型只读回放不改变存档。
