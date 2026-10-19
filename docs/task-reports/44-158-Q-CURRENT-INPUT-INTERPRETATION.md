# 44-158-Q 当前玩家输入语义与责任承接统一

状态：待 root 集成。负责人 codex-decision-scope158-p，独立工作树 decision-scope158-p/codex/decision-scope158-p，基线 bf9f2140。

## 修复问题与原入口

真实验收中，玩家提出照片请求，NPC 自己拒绝，但输出却把旧预算责任记成玩家 declined。另一次新设计请求被记成旧责任 accepted。原 replyAssessments 和 decisions 都可独立猜测，互相一致也不能证明语义正确。

本交付在原 npcResponseFormat → decodeNpcWire → parseAgentProposal → validateAgentProposal 入口中实现 npc-wire-v5，不增加模型调用或旁路调度：

- inputInterpretation 是当前玩家输入的一次语义判断，明确 new_request / topic_change / uncertain / related_reply。前三者不能携带 replies，不产生旧问题承接或玩家决定。
- related_reply 只选择服务器提供的原问题/责任配对，一处判断机械编译为原有 QuestionReplyAssessment 与可选 AgentPlayerDecision，不让模型分别生成两套判断。
- 原责任必须 waitingOn=player 且 open/waiting/deferred，来自当前渠道/会话的原问题，或已存在的明确同渠道焦点。题外旧责任、本人执行责任、终态责任不提供决定槽位。
- 绑定原 questionSourceId、责任 revision、当前玩家 sourceId 和逐字 quote；内核领域函数重验，不信模型拼接。拒绝提供信息不等于拒绝底层邀约；暂缓答复保持问题未解且可记录 deferred。
- NPC 自己拒绝/答应新的请求属于人物表达和本人计划，不是玩家对旧责任的决定。
- 原 v4/v3/v2/v1 解码保留；不改写历史输出、历史错误决定或执行回执。没有对旧保存响应追补 v5 字段。
- 提示词 v34 明确 NPC 可依据人设/已知事实自行规划本人议程，不能把“玩家没有新承诺”误解成禁止 NPC 产生自己的目标；允许 quiet，不强制新目标或消息。

## 文件范围

- NEW domain/agent-input-interpretation.ts：纯函数候选资格与单一语义绑定。
- domain/agent-kernel.ts：授权 viewState/sources 进入领域绑定的公开函数。
- infrastructure/npc-model-protocol.ts：v5 原生语法、当前目标绑定、旧 codec 保留。
- infrastructure/npc-agent-model.ts：同一协议提示与当前授权目标投影。
- NEW tests/agent-input-interpretation.test.ts、原 npc-model-protocol/npc-agent-model 聚焦测试。

## 验证与限制

聚焦69/69、tsc无错误、模块边界642文件、Prettier及diff检查通过。聚焦测试覆盖真实预算接受、索图+NPC拒绝不消费旧责任、换话题、不确定、暂缓、过时修订、错误来源、跨渠道、不可见原问题、责任等待对象、focus-only 与非玩家唤醒。旧 v4 codec 仍通过原测试。类型与模块边界检查；不改 SQL、生产配置或生产数据，0 真实模型调用、0 部署。

本交付不能声称结构协议彻底解决自然语言误判：模型仍需正确选择 new_request 与 related_reply。请 root 在新候选上用原手机入口进行必要真实语义验收；全量 check/build 和部署由唯一集成人统一进行，避免重复耗时。旧错误决定未直接修正；新协议只约束今后的评估。
