# 44-38-QUESTIONS-Q：待答问题纯领域规则

状态：待验收。负责人 `codex-ma-arch44-38-questions-q-20261015`；root 唯一公共契约、运行时接线、SQL、集成和部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-38-questions-q`，基线 root `4ae4f591`。开工前按主表短锁登记，先发送接口，root确认后实现。范围仅新增下述三个文件；未改任何现有源码、公共契约、kernel、services、SQL、CI或原测试。

## 文件与能力

- `src/modules/world/domain/agent-questions.ts`：类型、纯应用函数、纯待答人选择函数。
- `tests/agent-questions.test.ts`：行为与隔离边界测试。
- 本报告及主目录镜像/本人登记状态。

`AgentQuestion`按确认协议保存id/channel/threadId/sourceId/text/askedAt/status与可选resolution/responsibilityId。状态只有open/answered/withdrawn；与focus分开，没有修改现ActorAgentState。`QuestionReplyAssessment`含questionId/sourceId/quote/relation；`QuestionWithdrawal`独立含questionId/sourceIds/reason。

`applyQuestionChanges(state, context, changes)`输入身份集合`{worldId, actorId, questions}`与可信caller上下文，输出`{state, applied}`。返回完整脱离输入引用的副本和本轮来源回执。一个失败会抛错，没有修改调用方原对象或返回半份结果。

- 仅当前player input可评估答复；sourceId必须匹配当前输入，quote必须非空且逐字连续包含于原文，不删否定词、不拼接多处原话。
- 必须有caller提供的本人可见Question来源证明，逐题匹配questionId/sourceId/channel/threadId。身份、来源、状态、重复修改、严格UTC毫秒时间、未来问题/未来resolution等不满足时拒绝。
- 默认同channel/thread；跨渠道需逐题、逐原问题source、逐本次input source、精确from/to会话的grant。没有万能布尔放行，也不把来源真伪认证包装成纯函数能力。
- answer或decline_to_answer将问题标answered，resolution.kind区分“回答”与“拒绝回答”。不生成玩家赴约决定、不生成goal/action result、不把关联responsibility标fulfilled。
- defer_answer、unrelated、uncertain保持原状态open，回执明确open→open；仅有后来消息或时间流逝也不关闭问题。
- 本人withdrawal须有独立许可的来源和非空原因，记录withdrawn/withdrawal，不冒充玩家拒绝。
- 终态只有同一source、同一kind、同一quote（撤回则同一主来源、同一reason）可幂等重放；保留原resolution.at，回执replayed=true。另一输入或另一结果拒绝，禁止answer与withdrawal同轮碰同一题。
- context.storyAt仅为本次评估时刻；没有补造原输入实际发生时间，root仍从真实input receipt溯源。初次状态resolve.at记录本次评估；重放不重写它。

`selectQuestionResponder({channel?, threadId?, questions})`输入只允许server已经核对实际消息、来源版本和成员权限的`{actorId, question, sourceWorldVersion}`集合。只看open问题，不看普通插话，所以B陈述不会遮蔽A问题；按最新实际sourceWorldVersion选唯一actor。同actor同版本可返回多个questionIds；同版本多actor返回ambiguous。未限定会话而存在多会话则返回multiple_threads歧义，不按数组第一个猜人。返回id排序只为输出稳定，不是发言优先级。

错误为`AgentQuestionError`，`code='INVALID_QUESTION_CHANGE'`，`reason`提供具体失败位置类别。主函数不声称验证数据库身份、source签名、epoch、成员/在场资格、world版本与CAS；这些必须由root可信kernel在最终事务认证。

## 验证

- `node --experimental-strip-types --test tests/agent-questions.test.ts`：**30/30通过，0skip**。
- `npm run typecheck`通过。
- `npm run check:boundaries`通过（550个源码文件）。
- 新源码/测试Prettier检查与git diff检查通过。
- 覆盖双方会话问题保留、逐字多段原话、拒绝回答与本人撤回区分、延期/不相关/不确定保留、world/actor隔离、错来源/错线程/伪造引用拒绝、精确跨渠道grant、终态重放/防改、整批失败无部分写入、非法日期/未来状态、多问题与多人/跨线程歧义、顺序独立、重复id与无效来源版本。

这些是纯领域测试，**不是PostgreSQL验证，也不是运行时已修复**。0模型、0PG、0生产、0浏览器、0fullsuite/build。未修改或发布原“渣男体验”草稿。root集成后再运行最终check/build、真实数据库入口验证、READY与公网验收。

## root接续与尚未完成

1. root扩现ActorAgentState.questions兼容默认空及Proposal.replyAssessments/withdrawals，更新共享序列化、模型输入预算与原话来源授权/遗忘裁剪；不能只加types就称完成。
2. root在实际投影后生成Question id与真实消息source，将当前身份的集合交本函数；模型不能自造未来sourceId。问题创建与普通focus切换分离，删除原无条件清questionSourceId的消费逻辑。
3. root提供可信context.questionSources、精确跨渠道grant及独立withdrawalSourceIds，再把返回state/applied和原NPC对白、world_event、command receipt、Outbox等放同一事务提交。来源发生时间从原receipt取，不能把本次storyAt当过去输入时间。
4. root实际responder从当前可见成员的已认证open questions组成选择集合。显式@与明确回复引用仍由现入口优先处理；复杂歧义仍走统一协调，不增加每条普通消息的导演前置模型调用。
5. root把同一次NPC模型输出的语义答复归属接入该纯函数，保留真实履约result守卫。原话存在不等于语义判断绝对正确，这一层仍依赖真实模型评测和明确关联证据，不能由纯函数凭文字规则证明“真的答了该题”。
6. root完成44-37列出的实际群聊A问/B插话/短答、跨会话双问题、无关聊天不消题、答应与到场分离、重试/unknown/并发/越权和旧epoch兼容的真实PG入口验收。现有72 JSONB是否需新迁移由root统一裁定，本人无SQL变更。

本次状态仅待验收；不宣称此前问题丢失和短答任务失败已经在线上修复。
