# 44-109-NPC-IDENTITY-DIAGNOSIS-Q

负责人 codex-ma44-109-identity-q，集成人限定只读诊断，待验收。独立npc-identity109-q/codex/npc-identity109-q，精确基线3bc59d51。仅本新报告与本人主表/报告镜像；业务源码、SQL、模型配置和生产均未改，未调用模型、运行测试或读取生产存档。

## 结论与证据等级

集成人报告：本轮实际4/6调用（导演前2次invalid、最后1次合法quiet；NPC1次committed），NPC近似复述玩家第一人称请求，随后advance played0且无新调用，测试档已暂停、额度闭账。本诊断未独立读取上述付费请求/原响应，不能把转述当新的独立实模证据。真实作者事件演绎仍未通过，合法JSON/committed不等于本人自然回应、事件参与或整段完成。

源码确认两个不同问题：NPC身份提示表达可加强；导演已考虑资格的去重会抑制同资格后续唤醒。没有证据证明模型网关交换消息角色，或quiet把未演事件写成完成。

## NPC真实链路

- src/server/npc-agent-services.ts:110 起原sendMessageIfEnabled先核owner/world/epoch；epoch2不会回旧planner。约132起accept将原command.text作为origin=player保存，recipientActorId/threadId由command.actorId绑定，不把输入转换成人物台词。
- src/modules/world/infrastructure/agent-snapshot-repository.ts:174 起历史观察明确前缀主角或本人姓名。495起actor.name来自当前actorContext，persona包含本人persona/relationship/经裁剪modules；511起本轮input只有sourceId/text/origin。
- src/modules/world/infrastructure/npc-agent-model.ts:19起system先讲观察、回执、机会、能力等机制；约38起才泛称当前人物持续Agent及“不替玩家说话”，约41已有“不机械复述问句”。265起payload.actor包含name/persona/boundaries/definitionRef，身份actorId另在state；295起input保留玩家原文与origin但无显式sender/responseAuthor映射。306起真正发给模型的是system和一条user(JSON payload)，没有逐条聊天role序列。
- 同文件364起describeSuppliedContext缓存实际messages并计算modelInputHash，398起decide复用同一messages，不在返回阶段改写模型台词。
- src/modules/ai/application/model-content.ts:6–20逐条保留role/content；src/modules/ai/infrastructure/yibu-text-model.ts:69–88将其传给网关。这里未见user/assistant交换、玩家原话直接冒充assistant的实现。
- src/modules/world/domain/agent-kernel.ts:482起检验statements与玩家回合有回复，637起按动作结果过滤；结构/身份归属校验不等于能证明一句自然语言的“我”语义属于NPC。不能据committed宣称自然角色表现通过，也不宜靠字符串相似度粗暴拒绝所有复述或正当引用。

最小建议：单独登记npc-agent-model.ts及对应adapter测试。把明确“你此轮扮演actor.name/state.actorId，input.origin=player的第一人称属于玩家；以本人立场回答，不替玩家改写请求”的身份锚点移到system开头；payload增加由服务器既有state/channel/input派生的紧凑responseAuthor/inputSpeaker说明（player/wake/coordination分别区分，绝不把系统协调当玩家话），保留原input/text/来源与完整边界。最好显式表达对话双方与回应目标，避免把private audienceActorIds=[actorId]误作唯一发言者。不要把人物私密材料放入群/现场，不加固定回复，不自动改写模型输出。纯adapter测试只能证明协议清晰，需后续另授权少量真实多轮验收才能验证自然表现；目前不能断言这就是该次复述的唯一成因。

## quiet与作者事件再考虑

- src/modules/world/infrastructure/agent-narrative-repository.ts:165–214：bootstrap遇committed或已付费terminal就返回无cause，消费的是初始导演评估资格，不是事件成果。
- src/modules/world/infrastructure/narrative-wake-repository.ts:78–111：计算eligible且未occupied的当前qualification，然后对同sourceHash历史ANY committed（包括quiet）及已付费invalid/stale，把其snapshot内所有eligible且当时未occupied的nodeKey/nodeHash/qualificationKey加入alreadyAttempted；当前相同token不再产生wake。它不要求该节点曾被选入机会，也不要求导演逐事件解释暂缓。一个quiet可以抑制快照中多个尚未演出的作者节点，同资格普通消息也不自动制造新cause。
- src/modules/world/infrastructure/authored-event-eligibility-repository.ts末尾：occupied只取真实proposed/active shared episode；nodeProgress来自readEpisodeOutcomeProgress，明确排除“考虑回执/消息数等于呈现或完成”。因此quiet不创建episode，也不写节点完成；目录仍可显示eligible，但“可考虑”和“尚未消费唤醒资格”不同。
- src/server/npc-agent-advance-services.ts:约500起，仅在retry/needsEvaluation/wake或pending时协调；约529起无selected且无pending episode则quiet。故后续played0/0新调用与当前去重策略相符，不能称导演再次成功，也不能仅凭源码确定该具体生产回合唯一经过哪个分支。

最小建议：由集成人单独协调narrative-wake-repository、Director评估原因/结果协议、相关真实PG与显式入口，区分“已查看/有依据暂缓/实际提出机会/已呈现/已完成”，不能简单删除alreadyAttempted造成重复付费，也不能把quiet强改bounded_opportunity。优先提供用户明确请求重新考虑的有来源新原因，或在相关人物决定、责任、玩家选择等真实语义变化后重新检查仍eligible未呈现事件；沿稳定command receipt、unknown阻断与原队列，不按计时/无关聊天/version变化自动重买。若要自动再考虑，须定义可验证的新依据与成本策略，不能默认把所有看过的节点永久消费或每次轮询重付。当前显式retry只适用于known失败恢复，不应偷偷拿它重演已成功quiet。

## 下一步范围与未完成

本报告不授权业务修改、试演重置、发布渣男体验或剩余额度。建议先分别登记NPC身份协议与导演语义再考虑两项精确任务，集成人协调公共契约。修后需adapter输入边界测试、导演quiet不伪成果且同原因不重付/新合法原因才可重考的真实PG，再单独授权真实角色回应与作者事件参与验收。当前整体体验仍未通过，不能标完成。

集成人确认分工：后续辅助仅在新任务冻结后负责NPC显式speaker/replyAs及本人身份协议；导演已看/暂缓/实际呈现、新语义唤醒、公共契约/SQL/调度由root唯一负责。本报告交付即冻结，未启动后续实现。
