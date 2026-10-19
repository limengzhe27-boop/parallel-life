# 44-161-NPC-PRESENTATION-CONTEXT

状态：代码冻结待集成验收。负责人 codex-presentation161；唯一集成人 root-runtime161。基线 79bddd601df0c83278cd9195c4b266b5250f41d4，分支 codex/npc-presentation161，工作树 author-eligibility63/人生剧本。仅模型输入投影及聚焦测试；不改协议、内核、HTTP、SQL或付费恢复。

## 已有成果与本批范围

- 已有且复用：服务器绑定人物/渠道/当前输入、正式执行 ID、v11 输入来源绑定、focus keep/clear/set、source 短引用、已裁剪本人视图、输入预算、suppliedContext 最终素材清单、原 paid snapshot/raw 恢复。
- 待集成/验收：本包；根另持有 161 HTTP 诊断、消息恢复及持续调度包，不在本树重复开发。
- 尚未证明：真实模型主动消息自然度、事件紧扣度；replyTargetRef/sparse 输出减负的必要性与收益。没有把字符量当延迟/成本结论。
- 本批修改：原 observations 中混放计划、导演建议、私密回忆的结构问题。不是已证明所有线上报错的根因，不删除内核检查。

## 实现

新增纯投影 npcPresentationContext，按真实 source.kind、source.usage、observation.kind 与已授权 private inbox 分类；不按文本关键词、姓名、人称或猜测的发言者分类。

模型实际输入中，普通证据留 observations；internalContext 分 director_future_suggestion、authored_future_suggestion、reported_plan、private_historical_recall、private_result、private_evidence。每条素材出现一次，原 text/sourceId/kind/evidenceKind/时间完整保留。私密结果仍是结果，不降级为计划；对白并不保证属于本人；分层不授予跨渠道披露权。

投影发生在原有预算挑选之后的序列化视图中。预算仍以原有顺序删除整条非保护素材；当前输入、导演 intent、focus 与未完责任原保护不变。suppliedContext 从两个最终素材池联合生成，实际遗漏的私密回忆不 ACK；source 短引用映射同时作用于两池。

promptVersion 升为 npc-agent-v43-presentation-context；输出仍 npc-wire-v11。增加有限解释，要求以本人动机选择具体新信息/提议/分歧，不将导演任务作为玩家台词；不硬编码开场、不改写模型输出、不添加模型调用。身份先行的原开头保持。

## 兼容与边界

原 AgentSnapshot 不变、原 paid raw 不变。run-agent 的 response_received/committed 路径读取原保护 snapshot/response，不重新 prepare/请求模型；unknown/invalid/stale 原语义保持。未重解释旧协议或洗白旧失败。

NPC 当前仅获得本人已认证 director task，不能假定能看到事件全稿、playerImpact、其他人物任务或秘密。若需更具体的事件交接，根应另设计并认证按人物裁剪的“本事件可知背景、当前可考虑机会、参与理由/已发生证据”字段及原来源。这里没有补全缺失内容或广播全局剧情。单纯分层不能保证原本泛化的 task 自动变具体。

## 验证

- node --experimental-strip-types --test tests/npc-presentation-context.test.ts tests/npc-agent-model.test.ts tests/run-agent.test.ts：54/54，无跳过。
- npm run typecheck：通过。
- 改动四份源码/测试 Prettier 检查与 git diff --check：通过。
- 覆盖同文不同来源、计划不混成对白、私密结果保真、跨渠道回忆区分、预算遗漏与 suppliedContext 一致、快照不变、原 raw 不改写、三渠道身份及旧保护响应恢复无再付费。
- 0 新文字/图片模型调用，0 数据库/生产世界/浏览器操作；未运行全量 check/build，依根明确分工留统一集成执行。无 UI/事务/SQL/权限变更。

## 集成与发布接续

本包未合入统一基线、未部署、未完成真实体验验收。根合并后执行完整 npm run check/build，并结合自己的错误恢复/调度包进行授权范围内真实模型与公网验收。当前已知生产代码 3d888c65 / dpl_3n5XNR1gpN3txYnUjLzAgzFLZkbv READY；该信息来自根 160 交付及主表，不冒充本包线上版本。

用户最新附件要求先定位真实失败，本包仅对应已确认的上下文混放；协议/机械字段错误、并发、上游、unknown、回执丢失仍由根按实际证据分项诊断。不以本包 54 项可控测试宣称“渣男体验”完整稳定。
