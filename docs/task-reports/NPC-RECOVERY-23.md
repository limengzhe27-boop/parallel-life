# NPC-RECOVERY-23：普通等待接话误拒绝

负责人 root-recovery23；partial23_diagnosis 只读复现与消费者审查；基线5701bcaa。本批仅本地，不部署生产。

## 实际断点

原渣男体验2fb97a4a的请求58902e97-f050-4f5d-82a4-7bc648570f74，模型完整响应已保存，parseAgentProposal成功；validateActorContinuation抛INVALID_ACTOR_CONTINUATION。响应continuation.decision=await_response，questionIds/planIds为空，statements.requestsPlayerReply=false。因此文字前缀已保存，最终状态校验失败，封存partial_interrupted。此例不是网络断流。

## 修改

- 删除await_response必须引用问题/计划或新建提问的不必要限制。这是等待自然接话的意图，不代表玩家承担义务。
- 保留来源、显式问题/计划引用、实际行动、条件/地点/期限校验。没有自动填requestsPlayerReply，没有清除已有问题或责任。
- 调度消费者仅对await_condition读取条件，普通await_response放宽不会生成新的定时任务或强制模型调用。
- partial封存优先记录具体reason并输出不含正文的attempt/command诊断，保留原付费response，防止再将语义错误误判为网络问题。
- 不新增表/业务字段，不改写旧partial事件，不重发历史文字。

## 验证

- 原失败快照及完整输出重新解析+校验通过，0模型、0数据写入。
- domain 4/4；真实PostgreSQL append-unit旅程1/1，包括普通等待、并发插入、媒体一次、中断及重放。
- npm run check 4165/4165；npm run build通过。
- 原存档正常HTTP真实聊天1次，command 42bc6021-105e-48f9-aee6-6dda20dc3c5e：首段9093ms、整轮12059ms，completed 3/3；刷新三条消息各一次。保留真实模型输出，无预写回复。
- 3218 PID13735、3219 PID13736，health200；queue13737、proactive13738启动，410任务/251outbox排除保持。接口实测不等于浏览器绘制验收。

## 未完成/接续

- 历史已封存partial提示仍反映当时真实结果；不在后续状态变化后强行补写旧决定。
- 首段仍有9秒波动，未宣称耗时优化全部完成。
- PROACTIVE-ROOT-15长期无人输入推进仍未通过：当前原档调度no_candidates，另一世界出现COMMAND_CONFLICT，需按原请求及业务身份继续追踪，不能用本次聊天成功证明主动成功。
- 页面绘制计时与复杂事件表达质量仍待验证。
