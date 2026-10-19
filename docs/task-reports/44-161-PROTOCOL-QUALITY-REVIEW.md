# 44-161 · 普通NPC协议负担与开场表达只读评估

2026-10-19，负责人codex-protocol161-review。按root分工，独立author-eligibility63/人生剧本，codex/protocol-quality161-review自 **79bddd601df0c83278cd9195c4b266b5250f41d4**。主表短锁登记后仅新增本报告及本人行/主镜像，公共NPC protocol/model/kernel/HTTP/SQL只读。0模型、0生产操作、0测试/全量验证、0部署；只做代码追踪及合成纯数据大小投影，不把报告当功能完成。后续开发须root明确文件范围。

## 1. 当前基线、任务及不重复开发的成果

79bddd60为root统一main后继docs/tests，生产src与正式 **3d888c65 / dpl_3n5XNR1gpN3txYnUjLzAgzFLZkbv** 相同，Nu READY。160已有限定验收：正常目录零玩家首句6NPC新来信、真实医院交还proposed日历、原用户档已保存导演交接恢复。check3698/build及PG等以root160报告为证，本包不重复执行。

继续缺口是开场紧扣度/内部计划口吻、暂缓后长线责任、纯unknown无已知安排恢复等，不再引用修复前“0交接”作为当前状态。161 root负责恢复/持续调度；其他Agent审查恢复和liveness，本包只协议/表达。

## 2. 已有、未有、是否真实导致失败

| 要求 | 79b真实代码 | 证据与判断 |
|---|---|---|
| 绑定NPC/world/当前input/渠道/正式ID | 服务装配、原snapshot与runner、nativeExecutionIntentIds已承担；短source refs自v8；v10 execution和v11已有goal更新机械附accepted_input | 已实现，不能重复包装成新功能。旧raw保持各自协议解释。 |
| 普通对话不强制目标/工具 | 当前允许goals/planIntents/responsibilities/executions空；inputInterpretation仍保留真实玩家语义 | 已实现；“无工具”不能删去答复/拒绝/承诺等语义增量。 |
| replyTargetRef | **未实现**。responseContract给currentPlayerReplyTargets完整四元组；schema用anyOf按目标精确耦合questionId/questionSourceId/responsibilityId/revision | 不是四个字段可自由错配；现有保护真实存在。仍有重复传输/填写负担，尚无本包证据证明它造成当前频繁报错。 |
| 空增量规范化 | transport去部分无业务含义null；goals的null/[]兼容已存在；v10/v11 executions等局部缺省做机械转换 | 不是所有字段可省略的通用sparse协议。provider strict仍要求12个顶层键，planIntents、focusChange等不能随便省。 |
| focus keep/clear/set | v9已有显式FocusChange；keep保留，clear有意清空；v1-v8旧raw不改 | 曾真实发生nullable focus:null误清造成quiet_changed，P9已修。不能称仍未区分。 |
| focus环境绑定 | set.value仍为原focus，含channel/threadId/subjectId/questionSourceId/replyToActorId；新decoder原样送canonical，kernel检查FOCUS_CHANNEL | **channel/threadId尚需模型重复填**；可在新协议机械绑定。尚无已审计生产case证明它是本轮频繁失败主因。subject/来源/答复目标不能一概自动填。 |
| 单execution局部ref | maxItems=1但ref仍可选action_1…action_16；原formal ID由compiler生成，statement通过execution:ref显式依赖 | 槽位比所需多，未有真实ref错误证据。可单独简化，但不优先于已证实故障，不删除行动成功依赖。 |

当前根因仍须以已确认160样本区分：v9 execution缺input、v10已有goal更新缺input、publication-genesis漏历史、邀约提议错误核销旧责任、Director上下文容量和并发帧。前三机械/上下文与能力grammar已修，不因字段多再广泛削弱kernel。replyTargetRef与sparse是后续负担优化，不冒称已经修掉上述真实错误。

## 3. 可重复的静态大小投影（不是性能/真实典型输出验收）

直接调用原 `npcResponseFormat` 构造**合成private、无能力、无已有目标**快照，0模型/网络/数据库，不执行runner；只统计JSON长度和键数，未输出生产上下文：

| 合成reply targets数 | schema字符数 | UTF-8字节 | 顶层必填键 |
|---:|---:|---:|---:|
| 0 | 8789 | 8797 | 12 |
| 1 | 9569 | 9581 | 12 |
| 4 | 11018 | 11030 | 12 |

12键为protocol、consideration、executions、statements、goals、responsibilities、questionWithdrawals、locationReports、inputInterpretation、planIntents、agendaReview、focusChange。无能力场景已把executions语法改null；真实有能力/已有目标状态的schema不同，不能把本表当实际平均值。

源码SYSTEM字面量14132字符/28738 UTF-8字节，WIRE_SYSTEM4808字符/8266字节；实际systemFor会按能力过滤部分说明，实际persona/观察也有预算投影，**这些不是tokens、实发总量或模型延迟**。NPC当前payload/message/request限制分别24000/48000/56000字符，不能与bytes/tokens混算。

额外合成JSON编码比较：一个带语义relation/decision的四元组reply为173字符，假设改replyTargetRef后77字符；包含一句合成普通回复的当前12键外壳351字符/361字节，假设sparse三键外壳171字符/181字节。后者均为**尚未实现的假设传输形态**，不是可用新协议、成功率或性能提升。没有获取真实典型输出分布、端到端延迟/费用对照，故不宣称“减半耗时/降低模型成本/减少多少报错”。

## 4. 人物内部计划口吻：输出链与上下文来源

### 已排除的机械路径

- consideration.reason被编译为episodeDecision.reason并保存在人物参与状态；agendaReview.reason是内部判断。没有找到把这两个字段直接复制为statements的分支。
- 原NPC kernel只把accepted.statements.text生成message.received；group/scene projector也只投影实际statements。没有把plan.summary或导演audit自动兜底成来信。
- 所以当前已观察的“内部考虑/汇报计划”口吻，不能解释成UI错误展示了内部reason，更不能在输出端删关键词或用固定台词替换。

### 已有上下文保护与残余风险

1. **收发身份已有明确绑定**。npc-agent-model中的replyAs、conversationParticipants.recipient/private玩家、currentInputSpeaker把player/system区分；root160已修过把任务主角当自己/错收件人。不能再次宣称尚未有收件人上下文。
2. **NPC计划和对白是不同字段，仍在同一模型调用**。模型同时读state目标/计划、planNextSteps就绪分类、selfAgendaContext、私有任务observations，再输出statements与增量；注意力容易落在“我准备怎样做”的表述，但这是上下文倾向，不是已证明单一根因。
3. **导演未来任务以plan observation进入**。actor-episode-intent-repository按精确本人request/actor/hash把future_task封成director_future_task、authority=future_proposal_only，并前缀说明非事实/非玩家同意；task文本来自保存的导演安排，不是代码给所有人同一通用台词。该observation与真实历史speech同在observations数组，结构上虽有kind，认知与元任务仍贴得很近。
4. **内部策略占位也是plan**。readPrivateAgentSnapshot对仅策略可见来源插入固定“支持已保存安排、原私聊不在此上下文”说明；这不是应该给玩家复述的内容。任何呈现context的调整都必须保留源与隐私，不能把缺失原文补回来。
5. **行为与口吻资料已存在**。selectActorPersona保留lifeContext/traits/drives/behavior/relationships五维，behavior预算2000字符；本人publication-genesis历史已经认证恢复。不能说“完全没人设/历史”。大帧下legacyPersonaExcerpt仍会均分压缩文本，且选段topic可能是机器wake JSON；是否因此丢具体语言样例，需查原suppliedContext/metadata，本包未读取生产raw，不能判定。
6. **private agenda规则已区分quiet/update_plan/contact**。quiet/update_plan不会自动生成statements；但当模型选contact，它仍可能写工作台式内容，语法校验无法证明文学质量。普通coordination的consideration.reason和statements也可同时存在，不应把参与理由当成必须公开的理由。

可执行质量判据：看每条主动来信是否带来本人具体信息/可回应想法/可拒绝请求/真实行动进展/关系表达之一；是否说给当前受众听、与本人性格和当下场景一致。不是每条必须制造危机，也不能将“我要做……”一概判坏——它可以是自然提议。判据用于限定真实验收，不做关键词拦截，不新增付费审稿模型。

## 5. 导演任务为何仍可能泛化

- 160已补按稳定actorId认证的actorDirectionMaterials各五维、明确taskParticipants主角与执行者、历史/current区别、开场多入口及task自足说明。已有问题不可重复开发。
- Director v8 authoredChoices每事件只决定一次，actorTasks以逐人物键选择task或null；代码从非null键派发对应任务。**没有强制每人非null或复制同任务**；根160真实6人联系是那轮实际选择，不是编排器固定每分钟全员联系。
- 目前每人task仍是1…600字符自由文本。schema能保证非空、本人映射与作者来源，但不能保证它包含具体议题、冲突、玩家可回应空间。“考虑怎样表达想法”仍可能结构合法。
- 每NPC刻意只收本人task/授权提示，**不收全局description/playerImpact/导演audit/其他人的任务**。如果task本身抽象，NPC不会自动获得全局具体场景；不能为补清晰度广播全局原稿或他人隐私。
- actorKnownTopics只能引用本人已有真实目标；开局可能无topic，整项actorTopics允许null。不能为了具体性先替NPC种目标或拿主题数量作联系配额。
- root160报告还保留青青/林白语作者背景疑似错置；这是原稿证据待作者核对，不自动按姓名交换，不把语义矛盾“修”成代码默认人格。

## 6. 建议开发小包与边界（等待root明确领取）

### A. 优先：本人交流上下文分层，先复用既有材料

范围建议独立NEW `npc-presentation-context.ts`及纯tests；root再接npc-agent-model。用原immutable snapshot及来源元数据构造**presentation上下文**：本次真实受众/发言者、最近相关真实对话、本人当前已知议题；将未来导演建议/私下复盘与实际对话材料分开呈现，不把计划observation伪装speech，不改任何sources或授予知情。

可考虑从**已认证且明确speakerActorId为本人**的历史speech取少量语言示例并标历史，仅作为表达参考；现有schema若没有可靠speaker元数据，先不做按姓名/前缀猜样例的快捷实现。已有behavior/历史可复用，不再加一套人物系统。预算压缩优先保留当前输入/相关承诺和人物边界，记录有限容量元数据，不静默删责任。

反例：系统wake不等于用户说话；群/现场不能放私聊样例；原稿建议不能成既知事实；历史样例不成新来信；不把内部reason拷贝到statements；没有足够资料保留原context，不编口吻示例。接线后真实少量多人物对照验证是否自然，不以payload改名自称解决。

### B. 可独立：replyTargetRef机械引用

范围建议NEW `npc-reply-target-reference.ts`+pure tests，复用原playerReplyTargets；root拥有NPC下一版schema/decoder/payload。目录只来自当前授权scope，ref在该immutable snapshot内有效，映射原四元组；模型仍决定related_reply/new_request/topic_change/uncertain、relation、decision、逐字quote。无target不得默认第一项，不能用source关键词猜责任，旧revision/跨会话/源撤销仍由原domain和commit拒绝。

用单一目录供payload/schema/compiler，避免各层另算目录后不一致。有限ref不是跨请求权限，展开的身份只能是当前原snapshot的合法目标。旧v1-v11 raw按固定旧codec，不把历史四元组错误默认补全。反例应有无target、新请求/NPC拒绝、玩家拒绝/暂缓/回答、多问题与同责任、跨渠道、旧revision、未知/重复ref、quote否定/原文真实性、paid raw重放0新模型。

收益先限定为减少重复字段/schema，真实错误减少需证据；它不会修上游500或unknown，也不是当前已确认机械输入锚问题的另一实现。

### C. 可小包：focus当前渠道机械绑定

下一版focusChange.set只让模型选subject/question/必要reply target，channel/threadId由当前已认证context绑定；keep/clear仍明确，是否缺省=keep须新版本显式定义。**不自动选subject或replyToActorId**，后者未证明在所有渠道都唯一固定。原kernel FOCUS_CHANNEL保留，旧raw错channel仍拒。

反例：private/group/scene只改当前会话；clear不是省略；旧focus保留；不知道目标不能造；来源与subject权限不放宽。此优化静态明确但本包未发现实际反复FOCUS_CHANNEL样本，不能说根报错已经修复。

### D. 后置：稀疏增量与单execution槽位

不能只给Zod字段optional就说模型少填：strictSchema会将可选字段变nullable但仍required。若要真正减少空字段，下一版可用单一`changes:[]`或`changes:{kind:'none'|…}`带判别的增量集合，同一次调用仍能同时有对白、输入语义、目标/计划/工具变化；编译成原完整proposal后沿原kernel/事务。

省略只表示无增量/keep，绝不清空state、focus、责任；inputInterpretation不是无工具时可省的装饰字段，真实回答/拒绝/承诺/位置仍须处理。旧格式不能静默重解释，跨增量对象冲突仍整提案校验。该改动涉及公共wire较广，不与161已确认恢复/调度故障捆绑。

单execution最多一项时可在新协议绑定一个固定本轮slot，不要求任意action_1…16；statements对成功的依赖仍显式指这项存在的execution。没有execution却声明依赖仍拒；不能把“我已完成”反推成动作。未有ref错误证据可先不做。

### E. Director每人任务的具体性：另一个小合同，别广播全局

若A后的限定真实验收仍泛化，可将每人future_task升级为结构化本人交流brief（具体议题、未来目的、可商量的做法/问题），由导演明确选择、原来源范围认证；代码机械绑定本人/原事件，不能造议题、已知秘密或结局。新字段应作为未来方向而非已发生事实，仍允许拒绝/暂缓。此项触及Director wire/保存hash/NPC source投影，必须root统一新版本，不能本包改字符串或清洗旧paid任务。

## 7. 后续验收顺序与当前交付状态

先由root完成161当前恢复/持续调度与实际错误定位，再按确切范围选A/B/C之一，避免一次重写全部协议。每项分别记录：代码完成→合入→纯/PG门禁→限定真实体验→正式READY/公网验证。

必要回归应覆盖：普通聊天空增量、回答旧问题、新请求、NPC拒绝、玩家拒绝/暂缓/换题、承诺+合法计划、工具合法/非法前提、本人历史与他人隐私、多人物与多渠道、并发/断网原回执、unknown不重买、旧v1-v11 raw兼容。没有新增状态写的纯helper不假称真实体验；source/事务/队列接线需root补真实PG。

本包仅代码读查、合成JSON/schema大小投影和报告，未跑测试/全量、未调用模型/数据库、未写生产或修改公共源码。主表待验收。当前表达缺口不是代码直接泄露内部reason，replyTargetRef与focus环境绑定也没有被证明是本轮频繁失败原因；不得拿这些推测放松事实、来源、执行结果或付费保护。
