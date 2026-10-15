# MA-ARCH-44 · 阶段七集成

负责人 codex-root-ma-arch44-i；源码独立 history-chat-media/codex/ma-arch44-integration，主登记目录唯一 DEVELOPMENT.md。本阶段不是完整重构完成声明。

同一人物 kernel 接入有限 travel.begin，仅允许现有路线、本人有来源的实际起点及已授权能力。一次人物调用可提出台词、判断和出发；内核在同事务保存行动结果、0080行程、本人在途位置及旧现场退出。出发不等于到达、赴约或目标完成。失败保留独立有效台词，依赖失败行动的成功宣称不得展示。

统一 advance 恢复受保护人物结果之后、收取新候选之前，执行零模型到达续接。世界、控制、时钟、原行程与本人位置同事务校验；正常12倍/1倍时钟和约定保护照常执行，无条件则安静。取得时钟锁之后才取当前时间，避免另一标签页更新锚点产生虚假倒流。路线来源固定；到达不自动进入现场，不更新玩家位置，不告知旁人。

实际数据库验证包括：一次受控人物调用出发 → 独立真实到达零额外调用；重放、故障整轮回滚及原结果零模型恢复；遗忘来源、错误路线、unknown 不重买；真实世界锁与并发心跳。模型均明确替身，不能称真实自然演绎验收。P47后继13/13，Q48 kernel7/7，已有联合59/59。

发布策略与证据分离（44-51）：此前代码无条件 verified=true 并用 workId 补试演凭证，已移除。可信生产评审明确 trialRequired=false，允许未试演的合规稿发布，同时 trialVerified=false、trialReceiptId=null。其他 review port 未声明策略仍默认严格。客户端只服从可信 ready 与作品/版本/内容哈希/素材边界，不再私自追加试演要求。评审版本和依据变化使旧检查需要重新执行，既有稿和正式版本不改。真实试演凭证也只证明运行消息事件，不能代表完整产品验收。

44-51纯8/8、真实PG45/45（含无试演实际发布后下架、真实试演前后依据、旧严格review权限/失败/重放/并发、备忘录和HTTP、到达并发），check2875/2875、build通过。最初整库813通过/18失败/5明确模型跳过；端口、备忘录墙钟及发布证据已修，剩余失败继续逐项审查，不称全库绿色。

生产迁移80/80逐项校验，0080 checksum `ee6d4c0da2daba72f0fca9e99705f5356d0be2c9da244f209776bb1650eecc32`；2026-10-15T15:49:57.887Z，生产epoch2世界0，受保护原稿、副本和玩家世界版本/状态hash未变。本阶段部署READY、公网验证及44-52知情修正待实际追加。

仍未完成：作者开场/事件库世界级资格、导演机会到各NPC的交接及共享生命周期；完整观察范围/事后发现与实际消费回执；旧调用排空、存档迁移和旧引擎删除；真实模型连续旅程。44-52正删除“同地点/现场成员自动亲眼看见离开”的无依据推断，44-53只读设计复用现 kernel/73认知/候选，不建新知识队列。0本轮真实模型、0生产测试世界、不切换人类存档。

最终集成：da90b78a接44-52源码，root旧world-space断言同步为无伪造目击，实际数据库43/43通过。source已删除无依据departureObservation，旧带观察包的历史重放保留，玩家主动告知仍为report而非亲眼。最终check2875/2875、build、format通过（首次最终check发现root新增测试对unknown data缺类型收窄，补真实对象/事件类型断言后串行复验通过）。只读54将余下12叶项逐一与1028基线对照，其中地图新发现导致同事务版本错配是仍影响旧线上引擎的真实缺陷；44-55正在独立修复，不能称以后删除旧引擎即可忽略。53记录真实rendered manifest才可消费新观察；无完整room覆盖不推断无人/去向。0真实模型，受保护生产数据无改动；部署READY待核。

阶段七正式上线：360fd19859b660e6bf126d7d2bfe20f954701be4 / dpl_8HuieomDunPp2eDvLBEEyBFCTgCM READY，Nu正式别名与精确SHA核实；公网2026-10-15T16:00:35.875Z health/workbench/published200、匿名publications及publisherworks401。生产80核验，未启用epoch2、未创建真实模型测试world。本次没有新增浏览器会话或冒充匿名login检查为完整phone旅程。51可选试演证据和52删除假目击属于已上线限定范围，完整44继续进行；55正在处理实际旧引擎地点回复回滚。

44-55 root integration1ba05a5f+7b210e24: actual PG45/45 (story31 including wrongactor rollback/recovery, publication flow, native questions/travel), check2875/2875/build/format pass. NPC message vN plus real place discovery vN+1 now returns one frozen final causal receipt; context and replay agree, sourceevent identity stays original. No new migration or native legacyProgress:false change; production80 checksum/protected data reverified before push. No real models. READY/public pending.
