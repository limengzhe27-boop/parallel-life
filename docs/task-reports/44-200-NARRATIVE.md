# 44-200-NARRATIVE：人物任务归属与重复等待诊断

负责人 narrative200；独立工作树 `.local/worktrees/narrative200`，基线 6ef53179。0 模型调用、0 生产写、0 部署。仅查询用户明确授权的现有渣男体验 4953ca0f-56c4-4e92-9279-324031142356；原始快照存主目录忽略的 `.local/narrative200`，不提交私人原文。

## 已确认根因

- 导演 attempt 23f20844-849a-4a59-b812-d4d512a045a9 的原始 `actorTasks` 已错配，非解码索引交换：actor:2 正确绑定李之之，却输出见父亲任务；actor:5 正确绑定青青，却输出孩子交接照护任务。actor:3 林白语收到出差任务，actor:1 刘胜男收到母亲住院任务。
- v95 青青的 NPC snapshot 同时收到错误导演照护机会与正确作者初始“医院看母亲”信息；v97 李之之同时收到错误见父亲机会与正确照片邀约信息。NPC遂按错误任务建立blocked计划。
- 后续导演又将错误李之之消息作为依据生成独立见父亲episode（origin 125779c7-2584-46bd-8bb4-2276de1e9673:decision），形成错误历史强化。
- 纠正初次诊断：原导演snapshot通过world_facts已有6条正确opening report及knownByActorIds，无需新增查询。真正断点是预算裁剪仅保护speech，删掉了全部6条结构化opening report。原snapshot捕获请求（0模型）：45原观察→34请求观察、opening=0、57748字符；修复后40请求观察、opening=6、59335字符。
- 重复等待不是问题全丢：实际李之之v153 snapshot有10个open questions，viewState同样10个，continuation=no_current_intent；现有计划blocked等待玩家。多个回合创建相似问题与同目标计划。不能把“收到新消息”算作进展。

## 最小实现

- director-model-protocol.ts：原有actorTasks每个键schema description直接绑定该ref的真实姓名/身份，不增加输出字段或额外审批。
- director-agent-model.ts：把原顶层cast的人设/关系移动到现有taskParticipants.performer，按actorId关联，避免模型跨数组猜对应关系；删除顶层重复cast，预算裁剪同步移到performer，prompt版本v29。
- 不改已保存历史、episode归属，不强制消息，不关键词拦截，不新增表/字段/模型调用。

## 验证

- director-agent-model + director-actor-task-wire：56/56通过。
- typecheck：0错误。
- 既有虚构材料白名单测试保留；身份数组反序仍按ID绑定；schema各actor键绑定对应姓名。
- 未运行全量check/build，交root合并后一次运行；未真实模型验收，不宣称串线质量已经解决。

## 必须保留的后续

1. 已修复作者资格评估中结构化opening report的裁剪保护，保留sourceId/knownByActorIds；未增加查询/字段，不保留所有fact。真实模型归属效果仍须验收。
2. 对旧错误机会提供基于合法来源的重新判断；不能直接手工改归属或伪造已修复历史。
3. 重复问题需要业务身份承接与NPC自主调整，不能新增统一冷却/强制撤回或靠文本相似度替NPC决策。
4. 用现有存档验证真实效果；本批只改善身份/人设与任务键的上下文局部性。

## 一次真实模型只读复验

使用4953现有档已保存director snapshot，当前适配器 + 原生产同类模型配置调用1次，9.081秒；先前一次配置预检缺少key在发出前失败，未调用。结果通过原parseDirectorDecision，0生产提交、0新增世界。李之之/青青此次任务均null，没有再错派见父亲/照护。只选择刘胜男既有见面安排。

但输出同时以作者机会和即兴机会给出相同标题/参与人的刘胜男主题，原解析器允许两条。因此只证明本次身份错配未复现，不证明整体剧情质量完成；不反复抽样。此为历史真实snapshot离线模型验收，不等于在线连续旅程。

重复等待补充纠正：最新agentConditionsReady对空条件返回false，并无“空trigger自动通过”的当前漏洞。现有李之之v145→151时间02:29→03:29相隔一故事小时，符合bounded review；舒雅婷有两条近似计划。真实v153已有10个open questions并送入viewState，wakeCue也有不复述指示。需要解决计划业务身份与自主复盘结果，而非再加统一冷却或只修缺失提示词。
