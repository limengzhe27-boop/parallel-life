# 44-200-NARRATIVE：人物任务归属与重复等待诊断

负责人 narrative200；独立工作树 `.local/worktrees/narrative200`，基线 6ef53179。0 模型调用、0 生产写、0 部署。仅查询用户明确授权的现有渣男体验 4953ca0f-56c4-4e92-9279-324031142356；原始快照存主目录忽略的 `.local/narrative200`，不提交私人原文。

## 已确认根因

- 导演 attempt 23f20844-849a-4a59-b812-d4d512a045a9 的原始 `actorTasks` 已错配，非解码索引交换：actor:2 正确绑定李之之，却输出见父亲任务；actor:5 正确绑定青青，却输出孩子交接照护任务。actor:3 林白语收到出差任务，actor:1 刘胜男收到母亲住院任务。
- v95 青青的 NPC snapshot 同时收到错误导演照护机会与正确作者初始“医院看母亲”信息；v97 李之之同时收到错误见父亲机会与正确照片邀约信息。NPC遂按错误任务建立blocked计划。
- 后续导演又将错误李之之消息作为依据生成独立见父亲episode（origin 125779c7-2584-46bd-8bb4-2276de1e9673:decision），形成错误历史强化。
- 导演来源读取未纳入 `actor_narrative_knowledge`；`actorKnownTopics`只读取目标/计划/责任，不是初始事实视图。当次该列表为空，正确初始归属没有就近作为任务绑定材料。
- 重复等待不是问题全丢：实际李之之v153 snapshot有10个open questions，viewState同样10个，continuation=no_current_intent；现有计划blocked等待玩家。多个回合创建相似问题与同目标计划。不能把“收到新消息”算作进展。

## 最小实现

- director-model-protocol.ts：原有actorTasks每个键schema description直接绑定该ref的真实姓名/身份，不增加输出字段或额外审批。
- director-agent-model.ts：把原顶层cast的人设/关系移动到现有taskParticipants.performer，按actorId关联，避免模型跨数组猜对应关系；删除顶层重复cast，预算裁剪同步移到performer，prompt版本v29。
- 不改已保存历史、episode归属，不强制消息，不关键词拦截，不新增表/字段/模型调用。

## 验证

- director-agent-model + director-actor-task-wire：55/55通过。
- typecheck：0错误。
- 既有虚构材料白名单测试保留；身份数组反序仍按ID绑定；schema各actor键绑定对应姓名。
- 未运行全量check/build，交root合并后一次运行；未真实模型验收，不宣称串线质量已经解决。

## 必须保留的后续

1. 将已有初始知情通过原导演observations/source机制纳入，不把作者未发生情节当世界事实。
2. 对旧错误机会提供基于合法来源的重新判断；不能直接手工改归属或伪造已修复历史。
3. 重复问题需要业务身份承接与NPC自主调整，不能新增统一冷却/强制撤回或靠文本相似度替NPC决策。
4. 用现有存档验证真实效果；本批只改善身份/人设与任务键的上下文局部性。
