# MA-ARCH-44-P：人物状态与执行边界审查

负责人 codex-ma-arch44-p，辅助对话01a11a84。唯一架构集成者为「设计平行人生体验原型」root。只写报告及本人登记；没有业务、SQL、模型、生产或作者内容修改。

## 依据与基线

直接读取主对话人类消息01a13e4e-3aca-7393-b151-0df34712955f，确认本次是整体运行架构重构，取代继续局部补丁的方向。时间采用最新12倍浏览／1倍交谈现场／60～90秒条件检查／离开暂停，不沿用旧PRODUCT的时钟措辞。

实际源基线：history-chat-media 的1028b06b。主目录main落后，不作为业务实现基线；读过主登记、PROJECT_BRIEF、ARCHITECTURE_REVIEW、PRODUCT、ARCHITECTURE及NPC-AUDIT-43和STRICT两报告。本辅助分支1e2a771的EARLY已按内容合入44a74a14；本分支没有待合并业务修复，旧a439903候选不是当前运行入口。未声称已审遍全部历史分支。

43已有的来源绑定、个人phase与sharedEventPhase分离、部分开场即可记进度、旧hash兼容，不应再当作尚未修复的同一问题。1028仅提高模型结构遵循和诊断，不等于真实参与判断已验收。43后续实测由root停止及闭账；本审查不消费其剩余额度。

## 当前真实调用与状态归属

私聊：`api/v1/worlds/[id]/messages/route.ts:27` → `resolveTurn:78–95` → `characterPlannerFor.prepareContext` → `publicationCharacterPlanner.prepareContext:26–38` → `readActorEventGoals` → 发布进度或普通目标记忆 → NPC模型 → canonical语义/作用域校验 → 世界commit。

提交：`postgres-world-repository.ts:577–609`先保存成功命令，再在同一事务调用PublicationStoryRepository.reconcileInTransaction、重取人物记忆、构造context并applyActorEventAssessments。原子性有价值，但仓储反向协调了发布剧情和人物业务。

主动：`server/services.ts:239–272`开场 → 发布剧情 → 通用advanceWorld的串行handled返回；`publication-story-service.ts:73–82`空池直接handled、唯一续演免导演选择。导演目前在选择时读取全局观察，不是所有行动的统一协调入口。调度替换详细范围由44-B负责，本报告不抢写。

群聊：`application/group-turn.ts:15–39`先按group-runtime选择人物，再给GroupPlanner独立GroupActorInput。`group-ports.ts:16–26`没有统一人物持久状态版本、目标/计划/等待对象。群邀约在`group-repository.ts:234–255`写group消息和appointments；普通目标在`actor-goal-repository.ts:78–91`只寻找私聊world_messages的来源。这是同一个actorId的渠道分叉，不是同一个持久Agent的不同表达。

现场：已有导演判定与独立人物模型调用，不能称“完全由导演代写”。但scene-planner独立组织人物输入和动作槽；R17专属槽与执行台词仍在`scene-planner.ts:1064–1073、1111–1117、1165`。应保留现场内核/存在性/动作验证，替换独立人物状态解释和故事专属规则。

### 已证实的结构债务

|位置（均为src/modules内，server已注明）|实际行为|架构处置|
|---|---|---|
|world/infrastructure/actor-goal-repository.ts:178–225、499–523|普通目标执行进度以belief/agent_inference私有记忆JSON保存，hash控制恢复|迁入人物/目标执行投影；记忆保留信念、经历和摘要，不能作为执行权威|
|settings/infrastructure/publication-event-progress-repository.ts:128–153、484–493|发布目标使用独立表、来源证据与revision|保留证据和去重机制，迁为统一共享事件及人物参与投影，删除第二套目标解释器|
|settings/infrastructure/publication-event-goal-context.ts:331–385|读取context时initialize/apply开场及后续实际进度|改为明确的已提交事件投影用例；上下文查询不写入，也不因模型失败偷偷改变投影时点|
|world/infrastructure/actor-goal-repository.ts:338–367|把普通及发布目标拼为私聊frame|替换成统一AgentSnapshotReader，不再每个渠道独立拼状态|
|world/infrastructure/postgres-world-repository.ts:583–609|持久化层执行发布协调、人物读取和语义应用|上移应用层UnitOfWork，仓储只保存/检索；保持一个短事务原子提交|
|world/infrastructure/clock-repository.ts:22–39；server/services.ts:87–88|BEGIN+advisory事务锁覆盖整个run；普通messages也经withWorldActivityLock包住模型调用|替换长事务锁为持久领取/执行token与短事务CAS；保留防重、租约及明确unknown保护|
|server/publication-story-service.ts:166–170|选择阶段多种异常统一finishSelection unknown|拆已知非法输出、已知拒绝、版本过期与付费结果未知；未知不得自动重发|
|settings/domain/story-event-progress.ts:329；infra/publication-progress-beat-store.ts:215–227|消息进度计数仍可产生seek_closure，候选与领取混用个人/全局计数|把事件结果、个人计划进展、联系频率拆开；收尾必须有终止原因与剩余责任|

注意：当前`publication-event-progress-repository.ts:469–472`已经阻止多人初始消息膨胀共享productiveBeats，旧“六人出场立刻六拍”的原探针不能原封不动当作最新缺陷。剩余问题是计数驱动收尾及候选/领取口径不统一，不是全局计数完全没修。

## 目标状态模型及所有权

以下是待root审阅的职责模型，不是已经存在的表或已批准公共接口。

|对象|身份与内容|唯一维护者|
|---|---|---|
|NpcAgentState|worldId+actorId+revision，人物定义版本引用、可见事实/关系引用、私有信念、目标、计划、等待条件、已执行责任引用|应用层NpcAgent用例提出delta，内核验证后事务提交；导演不代改私人决定|
|SharedEpisode|worldId+episodeId+revision，参与意图、真实呈现、共同已知事实、因果依赖、未完成责任和终止原因|世界内核；导演提议引入、协调和节奏，NPC提议本人调整/退出|
|Goal/Plan/Action|稳定ID、actor owner、来源、目标结果、前提、下一步、触发、阻塞及结果引用；目标和执行计划分离|该人物提出，内核授权；共同事件仅引用，不用“谁后来发过消息”结账|
|PlayerDecision|本人原始输入来源+所指request/goal/revision，accepted/declined/negotiating/deferred/undecided；不确定保留待定|NPC同一次模型调用提出语义，内核校验保存；导演可观察，不能伪造玩家决定|
|ConversationFocus|channel/thread、当前提问者、回复对象、事项引用、当前焦点|渠道/应用协调根据真实消息与明确提案更新；换话题不关闭事件|
|ActionResult/ResponsibilityReceipt|实际执行类型、对象、前置版本、结果及被处理的责任ID|内核执行器；不能由台词、摘要或任意新消息生成“已完成”|
|DecisionAttempt|一次模型/执行请求的输入快照版本、预算预留、request token、响应与校验状态、提交结果|应用协调和任务仓储；与人物计划状态分开|

Agent不是持续运行线程。多个渠道使用同一worldId/actorId状态与决策入口，模型、模板和代码可以共用。ownerId属于访问边界，多人中另有授权成员/共享场景版本；不同人生不得仅凭actorId复用私有状态。

人物态度/信念、说过的话、计划、执行结果、世界确认事实分别保存。角色可提出退出请求，但退出不等于共享事件成功。个人目标结束、共享事件结束、当前话题结束分别转换；待定也不能为凑enum误写成“无关”。

### 统一来源与跨渠道上下文

用内核生成的SourceRef表达实际world事件、私聊、群消息、现场entry、行动结果及可见范围；模型不能制造owner/world/actor/source ID。来源解析统一做receipt、version、时点、对象及forget校验，再交给目标/决定投影。

AgentSnapshot包含本人状态与来源引用；ChannelEnvelope只包含本次获准看到的消息/成员/地点、回复对象和允许动作。私聊已作出的“本人计划”可影响群内自身行为，私人原话/秘密不会因此自动公开。群里甲提问、玩家短答，先由实际reply-to/开放问题/事项责任确定候选，再以语义判断处理歧义；不选默认数组第一人，不全员补答。

## 应用、导演、内核、渠道契约

1. 统一Ingress把玩家输入、时间检查、已提交结果、开场意图等变成有来源的唤醒，不负责猜成功。
2. SnapshotReader按同一world/actor/episode版本只读生成授权快照；投影落后应显式补投影或报告等待，不在reader暗写。
3. NpcAgent普通交互一次模型返回对白、必要语义判断、本人计划调整和最多有限行动提案，带依赖关系。不能把坏行动删掉后仍展示依赖该行动成功的对白。
4. Director接收授权全局观察、人物计划摘要、冲突和候选责任，产生协调提案：选择事件、次序/资源冲突、需要本人回应的方向、引入/暂缓理由。简单确定性单人行动无需每轮多一次导演调用，但新跨人物因果或冲突须有明确导演决策触发。导演不返回所有人的最终对白或私人态度。
5. Kernel校验、授权、执行及事务保存，形成真实结果与Outbox；ChannelProjector把同一结果投到日历、群/私聊、现场/地图。资料摘要和记忆整理异步进行，不阻塞主回复。

## 领取—模型—提交与失败恢复

短事务A：核权限/时钟/预算/版本，生成attempt与输入摘要、幂等key、lease/token；保存已接收输入的可追踪状态。提交并释放连接。模型调用在事务外。

响应已收到：先持久保存可恢复的受保护结果，不输出到日志；解析与依赖校验产生已知合法或已知非法结果。短事务B核attempt token、world/actor/episode版本与来源，原子提交事件、Agent状态、结果、回执、Outbox；晚到token失效时不落旧结果。若数据变更可确定性重验，限定重验范围；需要重新模型推断时走明确新授权/额度，不静默补调用。

Attempt至少区分reserved、request_sent、response_received、invalid_output、stale_discarded、committed、cancelled_before_send、unknown_after_send。unknown指已发出且结果/费用不确定，禁止自动重试。格式错误是已收到结果，不应伪装unknown；CAS冲突是已知过期，不应假称执行成功。人物Action则单独有proposed/ready/waiting/blocked/executing/succeeded/failed/withdrawn等合法转换，不把一次模型超时混为“世界动作已经执行过”。

旧事务锁不得直接删除后裸奔：必须先落持久attempt/token和短锁CAS，覆盖重复请求、多标签、晚到响应、跨渠道并发、租约过期和暂停。模型运行期间的短事务以外不占数据库连接；不声称当前已经发生连接池耗尽。

## 迁移与清理建议

保留：现有世界事件/commands回执、Outbox、RLS和工作租约权限、来源/forget围栏、实际开场收据、时间锚点及私有素材边界。复用其规则和测试，不因为新命名重写已正确的内核。

合并：发布progress与普通私有goal state进入同一人物/事件投影；群/私/现场消息来源进入统一SourceRef解析；选择/邀约/普通事项/编剧开场作为统一调度的不同候选来源。

替换：上下文读隐写、仓储选人与业务调度、通道专属人物状态解释器、以消息计数/任意回复消费责任、模型调用长事务。具体故事物品和句式移至作者内容/通用能力参数，移除核心Planner的R17专属分支。

迁移步骤：

1. 冻结旧写路径归属，制定新schema、causal source与语义状态转换；增加投影版本与世界engineVersion，用户可见状态尚不变化。
2. 按真实事件/有效receipt建立新人物与共享事件投影；旧belief JSON仅在hash、来源及执行证据有效时迁移为候选或有来源状态。未知/无标注保留未知，不从旧普通文本补“同意/拒绝”。保存migration provenance及旧版本快照。
3. 用只读shadow比较连续旅程状态，shadow不调用模型、不执行动作、不双发消息。新旧都写同一责任是禁区；单世界某时刻只有一个执行引擎。
4. 首先切换真实私聊及开场，再让群聊、现场和主动唤醒调用同一Agent入口；每阶段公共内核协议先稳定。未切换渠道须有明确迁移边界，不长期同步维护两份目标。
5. 新事务动作已发生后，回滚不能简单切回不认识该结果的旧调度器。保留内核事件，暂停新增执行，修复/重放新投影；仅在旧系统能读取全部新事件且责任对齐时允许回切。旧时间/约定/历史不倒退。
6. 全旅程验证后删除旧goal-memory写入和读取、legacy双解释/串行handled调度；兼容代码有明确删除验收项，不作为永久兜底。

## 验收交给root纳入统一计划

必须验证partial开场已回复、私聊→群→现场同一人物、原提问者接短答、天气闲聊不消费赴约责任、答应/拒绝/协商/待定/沉默不同后续、跨角色计划和共同时间、无消息时合法本人动作结果、重要节点快进停下、旧存档、并发与unknown晚到恢复。事件收尾看已履行/撤回/到期的责任与后果，不看消息拍数。

本报告是只读架构输入，未执行check/build/PG或模型；没有业务变更，避免把43已通过的检查再次冒称44实现证据。新schema/权限/任务队列方案确定后必须真实PG验证，再按项目要求check/build、迁移核验、READY部署和公网旅程验收。完整架构实施、统一文档和最终交付仍由root负责。
