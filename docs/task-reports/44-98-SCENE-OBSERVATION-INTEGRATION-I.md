# 44-98 实际现场来源接入原人物入口

负责人 codex-root-ma-arch44-i；基线357be91d，唯一公共集成。小安97冻结1ae682ed集成为f37bc463，后续公共修改由root完成。文件归属已在唯一主表登记。

## 实际运行路径

原native scene task/accepted input → readNativeAgentSnapshot → 97真实scene来源适配 → 原attachWorldContext/授权state → 原NpcAgentModel → 原runNpcAgent发送门 → 原NPC kernel提交。替换当前scene读取中旧sceneContextEntries先截断再认证循环，不引入第二套观察/模型/调度。

新可选sceneObservationContext记录同一scene及实际选择、省略的来源；sources带稳定canonical hash，发送前和最终效果提交前同事务重新读取原producer及historical audience，再核source/hash/observation元数据。旧已保护付费snapshot没有新字段仍保留原协议，unknown不重试。新来源冲突走已知冲突，不把来源错误当支付结果未知。

模型实际收到evidenceKind及eventOccurredAt/storyAt/learnedAt/retrievedAt，前者是记录现实时间，后者区分原故事获知与本次读取。玩家声称不成为真实位置，人物话语不证明完成；旧内容读取不成为新发生。所有这些只来自当前现场，未把旧场景材料灌入新群聊或私聊。

## 额外修正

97单独组件未核历史presence对应的真实入场producer。root补原成功command/event、world/scene/精确joined/source版本及actor归属；legacy proposal必须实际列出该actor，原deterministic native环境必须具有该actor的独立位置proof。scene.entered仅玩家，不能给NPC发入场权。伪造derived presence和observableTo的反例已拒绝；hash不混当前检索时间、后来的leftVersion或新worldVersion。

## 验证与部署接续

- 97集成后聚焦真实PG最终10/10（含父测试）：原现场writer及实际leased native NPC入口，模型替身实际收到metadata；canonical hash篡改拒绝；真实forget、晚加入、私密thought、裁定来源、预算及伪造presence拒绝。
- 原native渠道和deterministic environment真实PG19/19，实际跨渠道私密策略及空环境/合法位置/暂停/租约/回滚保护保持。
- check3148、最终build通过；独立源码复核未见新增阻断，selectedSourceIds不得用作消费ACK已明确。READY证据接续主表。无新SQL，0真实模型/生产存档修改。生产只读2026-10-16T06:51:59.513Z核实84/84、保护数据未变及epoch2=0，随后部署。

## 明确未完成

这不是完整“观察→持久认知→唤醒”交付。当前是同现场真实记录的授权输入接线，不新增房间、视线推断、全局位置传播、模型消费ACK或后台唤醒。省略字段不证明模型已经读过全部来源；不能用人物projectedWorldVersion代替消费ACK。

整体事件发生/终局认证、结果专属持久消费与新cause/revision、完整自由原稿逐人物交接、旧档接管/退役、生产epoch2启用与自然模型连续旅程仍待实现/验收。97 source complete只是容量状态，不代表所有producer都支持；无精确producer映射继续省略，不伪造观察。

回滚本接线恢复旧原入口，无schema变更，不删除原事件/历史/时间或回执。已付费结果不重买。
