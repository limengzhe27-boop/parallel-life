# MA-ARCH-44-B — 入口、调度与时间生命周期重构审查

负责人 codex-ma-arch44-b；root唯一公共契约/集成负责人。基线 `1028b06b`，工作树 `/Users/limengzhe/.codex/worktrees/npc-director-progress/人生剧本`，分支codex/ma-arch44-b。只读源码、只写本报告/登记；0模型/PG/生产/SQL/业务改动。43付费QA由root清理闭账，本报告不沿用额度，也不宣称新Agent接口已有实现。

## 核心结论

应替换目前三套顺序抢占式调度，建立一个应用层统一候选调度器。每个NPC拥有独立持久身份、收件箱、待履行责任、目标状态、观察游标和工作租约；导演管理事件计划、节奏与候选协调；世界内核独占事实校验与事务提交。持久独立Agent不要求一个NPC一个常驻进程或一直运行模型，同一模块化单体/worker可按需执行不同Agent。

现状不是“没有存储”：已有事件、回执、角色记忆、私有目标进度和任务队列。问题是这些持久能力没有形成唯一的NPC生命周期和调度责任源；仓储、应用、页面各自决定谁该说话、何时唤醒、什么算回应。

## 1. 精确当前调用图（均为1028b06）

```text
玩家私聊 POST /api/v1/worlds/:id/messages
  messages/route.ts:25 withWorldActivityLock（世界级，跨模型调用）
  :26 clock.read → :27 resolveTurn
  services.ts:320 characterPlannerFor → publicationCharacterPlanner
  resolve-turn.ts:34 receipt → :36 world snapshot → :78 prepareContext
  :95 model.propose → validation → :133 worlds.commit
  postgres-world-repository.ts:473 world row transaction/version guard
    :578 succeeded receipt
    :583 publication reconcile → :599 actor goal assessment
  messages/route.ts:49 story.progress → :58 drainOutbox
  → HTTP committed receipt

手机可见页 world-phone-app.tsx:419 checkForWorldNews
  use-world-time.ts → DOM activity / 15s presence lease / 1x-12x mode
  5s tick → 开场支路 :445 readOpening/advanceOpening
  开场结束后 :484 idleDue(75s) → :511 advanceWorld(automatic=true)

services.ts:233 advanceWorld
  :239 advancePublicationOpening
    → handled=true（包括planning/unknown/quiet/本次已生成）:255直接return
  :256 advancePublicationStory
    → handled=true（包括managed empty pool/quiet）:271直接return
  :272 generic advanceWorld 只有前两者都unhandled才执行

published应用 publication-story-service.ts:56 世界advance lock
  :57 clock → :59 paused quiet
  :67 story.opportunities（仓储内挑选continuation人物）
  :69-73 directorPool但候选为空，也handled quiet
  单个continuation直接prepareProgressBeat；多候选可能director选择
  :187 prepared claim → :249 resolveTurn → 世界事务/进度回执

generic应用 advance-world.ts:45 世界advance lock
  :60 advanceClock(managed15世界分钟/legacy30)
  :66 没满beat不finish保锚点
  :128 followupAgenda(eligibleAgenda(buildAgenda(...)))
  :134 selectSpeaker → :198 resolveTurn → :finishAdvance

显式等待 services.ts:179 waitStoryTime
  story-wait-repository.ts → 世界锁/版本/重要边界/源进度验证
  → story.waited事件+世界时间+回执+activity同事务
  不生成NPC消息；页面随后可能自动调advance

后台 server/scheduler.ts:12 runDailyScheduler
  claim_due_worlds（SQL0030:21）→ services.advanceWorld(...,1,true)
  vercel.json每日04:00 UTC一次；不是75秒后台Agent调度器

现场 scene-task-handler.ts:15-28
  task lease → scenePlanning → ScenePlanner.propose → commitSceneProposal
群聊 group-task-handler.ts:29起
  task lease → loadGroupRead → planGroupTurn/GroupPlanner → persistGroupEvent
  （两者与同步私聊/三段advance是不同执行入口，已有队列但不等于统一NPC Agent）
```

### 具体结构性问题

1. **资格与所有权混淆。** `handled=true`同时表示“此系统管理这条人生”“暂时没有候选”“存在unknown”“本次实际产出”，services按这个布尔值全局短路。一个published模板安静，generic中真实已到期的其他待办也无机会参与，不是某NPC有正当理由保持安静那么简单。
2. **NPC当前是按请求组装的planner。** services:320每次建factory，独立记忆/目标有持久来源，但没有一个统一持久Agent收件箱/责任状态；手机私聊还在HTTP请求里直接跨模型持世界锁。不能将factory+不同persona描述为每人独立的持久生命周期。
3. **世界级网络期串行。** 私聊messages/route.ts:25、所有advance各自世界锁覆盖模型工作。它保护了现有版本一致性，但一个人物生成期间其他人物/现场/行程会受全世界锁影响；只换成更多planner实例不能消除这个边界。
4. **事实保存与调度纠缠。** postgres-world-repository.commit:583/599在事实提交内调用publication reconcile/人物目标更新；部分是必要事务投影，部分reader也可初始化/追认进度。新架构应把“由已提交事实推导的确定性投影”与“下一次叫谁出来/选什么事件/何时再问”完全分开，不能把后者留在仓储。

## 2. 无关后来消息为什么会消耗责任

|位置|当前判断|错误的责任边界|
|---|---|---|
|agenda.ts:50-58|只用整个world.messages最后一条user消息推awaiting_reply|不是按NPC、频道、输入ID追踪；别的对话可使较早欠回复不再出现在候选中。正常私聊用户消息与回复又同一事务落库，所以不能把这个规则当可靠收件箱。|
|agenda.ts:140-154|邀约初次消息后，该NPC任何另一条assistant消息即可不再给proposed_appointment线程|“聊过别的事/回了谢谢”被当作该邀约已处理；无invitationId/responseTo因果回执。|
|agenda.ts:91-102|约定时点之后该NPC任意assistant消息即可不再给appointment_due线程|无关回复可能消耗到点提醒；不能证明赴约、改期、提醒或放弃责任。|
|agenda.ts:302-313 / advance-world.ts:89-93|某演员12故事小时内说过话抑制多数线程|人物级冷却会压掉他另一件合法责任，而不是只限制同一请求反复催促。|
|return-followups.ts:26-31|本次批量advance同日/12小时内再发常被过滤|是另一个独立于published idle规则的节奏系统；不形成统一公平性。|

替换成持久`Obligation`，每项至少有actorId、scope(world/event/request/channel)、basisSourceIds、等待谁、nextEligibleAt、状态与完成依据。`观察过`、`回应某条输入`、`处理某项责任`、`玩家参与`、`事件完成`是不同回执，不能共用lastSeen/cursor或“后来有消息”。

收到一条新消息只推进该Agent的已观察游标；未履行责任独立保留。完成责任必须引用具体inputId/obligationId、实际outputEventId及覆盖来源；回复另一人/另一话题不会隐式删除。若NPC明确撤回请求，记录自己的请求withdrawn；不等于玩家答应、不等于整个事件完成。

模型可以提出“本回合处理了哪些责任”，内核验证ID属于该Agent且来源可见、对应输出真实提交；不能只凭一句“我处理完了”核销物理事项。语义承接与人物质量仍需真实模型验收，结构验证不能证明人味。

## 3. 沉默、拒绝、等待与75秒的真实关系

- `use-world-time.ts:103-111/158-159`对document任意pointerdown/input/focusin/keydown/wheel重置lastActivity；`world-phone-app.tsx:484`要求75秒无这些活动才请求续拍。玩家一直翻地图/朋友圈属于“无关活动”，当前会持续推迟整个世界主动推进。这是DOM空闲与人物是否有事混在一起。
- `time-experience-policy.ts`：75秒免费检查，30秒conversation grace；`use-world-time.ts:174-179`busy结束也重记conversation。DOM textarea/contenteditable事件可触发1倍，现场route也固定1倍，浏览12倍。它影响投影速率，不能作为玩家同意/拒绝/回应事件的依据。
- published `story-event-progress.ts:99-104/326-342`还有brief10/standard20/extended30世界分钟idle；`progress-beat-store.ts:190-208`还会在claim时再核最近source冷却。generic则用15世界分钟beat。刚结束对话75现实秒约只有9.5世界分钟，不能承诺“每75秒一定发生事件”。
- `mayFollowUp`的同event/actor两次无回应硬限有实际回执支撑，可保留为默认反骚扰政策；但应该成为统一调度器按责任计算的额度，而非某一仓储路径独有。用户拒绝后人物可换自己的方案/暂缓/收尾；这个用户请求退出不清空人格的长期目标，也不能跨scope解释成用户永远拒绝该人物。
- `clock-activity-repository.ts:227-270`45秒租约、普通heartbeat不恢复已过期/暂停、约定deadline cap；`clock.ts`投影与真实时间锚点分开。它们是正确时间边界，重构须保留，不为证明续拍删保护。
- 显式wait是已授权的时间命令，原子保存来源/版本/时间/回执，并在重要节点停下；它不是NPC行动，不应该消耗/完成别人的责任。等待跨过多个due时，统一调度器从实际截止时间生成有限候选，不能为了赶日程伪造对话/赴约/成果。
- 当前story-wait-repository.ts:290-307的required真实未完成事件会阻止等待。新模型中应区分“此事件优先呈现”与“必须让用户参与”；用户明确继续/忽略一个提示只能解除这次提醒停点，不能伪造完成，但也不应永久锁住整个人生等玩家走剧情。此项需新语义/契约，不应再给旧required布尔值叠例外。
- SQL0030:34-54后台claim每UTC日全局最多2条人生、last_tick超过20小时、排除旧director unknown；SQL本身不是presence/nextEligible调度。39服务层会对过期managed clock quiet，但不能说当前cron提供可靠独立NPC运行。新架构仍遵循当前“离开暂停、回来明确继续”，不暗自改成全天模型模拟。

## 4. 替代架构：统一候选、独立Agent、内核事实

以下是**建议新接口/记录，不是已落地API**；root冻结契约后才可实施。

### 4.1 单一应用入口

`WorldOrchestrator.acceptInput / observe / advance / wait`共享一条确定性生命周期：

```text
认证/参与权限 → 内核接受真实输入并给durable receipt
 → 按可见性路由到NPC mailbox + Director观察流
 → 纯候选收集（开场、直接回复、NPC责任、约定、地点/现场、已触发事件）
 → 统一评估作用域阻断/时间/预算/公平性
 → Director选择/协调 → 单个NPC Agent获取自己的工作租约
 → 裁剪私有上下文 → AI提出消息/行动/目标变更
 → WorldKernel核验来源/读集/时间/权限/幂等与实际行动授权
 → 单事务event+state+input/obligation处理回执+outbox
 → 记忆/各APP投影；产生下一次确定性due唤醒
```

开场是有授权意图的候选类别，不是占领整个world的调度器。模板事件是事件计划候选来源，不是吞掉generic责任的分支。没有候选返回`idle(reason,nextWake)`，只对自己scope适用；不能再用handled布尔值屏蔽其他来源。

### 4.2 候选与阻断（建议字段）

候选`candidateId`必须由真实原因稳定标识，带worldId、actorId、eventId/obligationId、channel、kind、basisSourceIds、dueStoryAt、expiresAt、requiredResources、readVersion、priority、costUpperBound；未发送openingPlan仅授权方向，不填delivery receipt。

统一评估器返回`eligible | deferred(nextEligibleAt) | blocked(scope,reason) | completed(receipt)`；先免费确定性评估，再决定是否用导演模型比较，避免所有轮询都先花导演调用。多个合理候选只比较候选ID和必要公开摘要，不把所有NPC私密记忆混给彼此。

|阻断|作用域|其他候选如何处理|
|---|---|---|
|身份/世界初始化未完成、世界暂停/租约过期/重要时间cap|world|不自动生成；可读/可核回执，明确继续/处理后再醒。|
|某次模型结果unknown|action/command及其冲突资源|先查回执，不自动重付；不让无关NPC责任永久消失。能否并行由资源集和事实依赖决定。|
|同一NPC已有未决生成|agent|输入先持久排队；默认不重入同Agent，其他独立Agent可被评估。|
|事件前置未到/人物当前拒绝该请求|event/request/actor|只阻断依赖该前置或该参与人的候选，允许其个人其他目标与他人自主方案。|
|同请求已提醒两次/近期已交谈|obligation + episode|抑制重复催问，不消费别的待办；关键新事实可有源地改变nextEligible。|
|本次预算耗尽|budget(account/world/pass)|不生成，保留责任和下次时间；不填假消息。|

“作用域小”不等于忽略跨资源风险。若unknown的行动可能占用同一地点/约定/共享事件状态，相关候选也应阻断；纯私聊另一个人的独立待办不应被模板managed quiet自动吞掉。所有阻断原因可安全记录枚举与scope，不记录私人脚本。

### 4.3 NPC独立持久生命周期

Agent身份至少区分world/branch与actor；同一个人物在不同人生的记忆/目标不可默认串用。持久邮箱接收按授权可见的输入、他人行动、日程到点、导演建议；持久目标/立场与短期请求分开。每次工作持有Agent revision/lease并记录input覆盖范围；LLM实例可复用，无需NPC常驻进程。

私聊API当前在同步模型完成后才随turn.resolved保存玩家文字（resolve-turn.ts:133-156），没有独立服务端NPC mailbox接受回执。应替换为先保存玩家真实输入/责任接收（无需AI解释就能确认“玩家说了这句话”），再按Agent生命周期生成，返回accepted与最终committed两个可区分状态；客户端pending/恢复跟踪真实receipt。现有场景/群聊队列能力可复用，不能说同步私聊已经具备这个协议。

导演给计划、节奏、事件协调建议；NPC依据自己性格/知识/立场提出自己的下一步，可以拒绝导演建议。计划、意图、对白、世界事实分层：模型不能因为导演“希望见面”就把到场/同意写入世界。

### 4.4 时间与唤醒

保留12倍浏览、对话/现场1倍、暂停、45秒活动确认宽限、已确认约定到点停、explicit wait/next morning、多人/多人生方向。区分三种时间：现实执行/租约时间；权威story clock投影；每个责任的nextEligibleStoryAt。不要把DOM最后操作、模型调用完成时间和对话轮数混成一个计时器。

15秒heartbeat只证明会话presence与显示模式；30秒grace只做交互放缓；75秒作为免费检查/兜底唤醒上限，不是剧情事务时钟，不是每次模型调用许可。滚动地图不撤销人物的due责任。服务端根据story due、当前speed/lease/cap计算下一次免费检查时点，模式变化重算；重要输入/到达/约定操作是事件驱动的早唤醒。

离开默认停在有效期限，不夜间偷跑剧情；回来先给继续/快进选择。正在输入可抑制打断式呈现，但不能将“正在打字”当作已回复某请求，不能抹掉其他NPC到点状态。多人同一世界时间控制需明确共享时钟及参与权限策略；现有单owner表不能被冒称已覆盖多人同步。

### 4.5 世界内核与并发

保留事实事件/回执/Outbox事务、RLS/角色可见性、实际场地/行动/完成证据校验。仓储负责读取/保存，不再决定选谁和剧情何时发生；AI只提案，不能直接写DB。

网络期间使用持久Agent/work lease，不长期持数据库世界事务锁。最终WorldKernel提交仍短锁世界行，按command幂等并原子写入世界新version。第一阶段可保守保持整个world版本栅栏，冲突保留输入/责任，不静默重付；之后才在root批准的协议中加入actorRevision/eventRevision/实际读集和clock fence，让无关B聊天不必使A有效工作报废。不能简单把旧expectedVersion改成最新版本后强行保存；相关状态变动必须重新验证或重新计划，并受预算控制。

## 5. 保留、替换、迁移清单

|组件|处理|理由/迁移边界|
|---|---|---|
|世界事件、command receipt、RLS、源版本、Outbox、真实场景校验|保留并收口到Kernel|唯一事实权威，不允许新Agent绕过。|
|39 clock/activity/wait的时间规则和来源证明|保留规则、归入统一TimePolicy/Kernel命令|不撤销12倍/暂停/多人生/多人；减少各入口自行decode/投影。|
|37 opening计划/真实delivery回执，43 early稳定意图与实际出场分离|保留不可变来源，迁移为候选/Agent激活记录|不能把planned身份当已出场；不是继续保留opening全world短路。|
|publication shared progress/criterion/status证据|保留来源和历史，迁移到显式EventInstance projection|不把某个人退出当全事件结束，不以模型口头完成替代真实证据。|
|services三段handled链、opening/story/generic各自调度入口|替换|统一收集/评估/协调，无运行时fallback叠链。|
|PublicationStoryRepository.progressSpeaker/prepare中的选人和节奏，generic selectSpeaker/agenda消费推测|替换/拆出应用策略|仓储只提供源快照与条件写；纯eligibility函数可迁移复用，不能让SQL/repo成为第二个导演。|
|人物级12小时、DOM75秒无操作、多个彼此独立限流器|替换为按责任/episode统一PacingPolicy|保留反刷/预算约束，取消无关话题相互消费与全局饥饿。|
|私有memory_records里的目标进度JSON缓存|导入显式Agent/Event状态后停止新写该用途|记忆是参考，执行责任有typed生命周期；详细数据契约由root/Agent状态子任务冻结。|
|scene/group各自生成工具链|迁移接同NPC生命周期/Kernel，保留channel能力|手机、现场、群聊共享人物连续性；已有worker不代表已完成统一。|
|每日最多2世界、20小时旧cron|替换为presence/due驱动唤醒与持久工作队列|不能拿原cron承诺持续世界；不引入无授权常驻付费模拟。|

### 不叠兼容条件的迁移步骤

1. root先冻结角色/事件/时间/候选/命令的边界与单一输入输出契约，标明哪些新API不存在。新增typed状态和读取投影仅做确定性来源导入，不生成消息、不替历史补engaged/declined；unknown保unknown。
2. 从实际actor、已验证交付、历史真实决定、尚未履行的责任创建Agent/Event迁移快照与来源映射。旧manuscript/publication/world事件ID不改；旧存档时间按已批准规则保当前时点，不按新倍速回算离线。
3. 可以做**只读无付费shadow候选比较**检验丢责任/重复/错误scope；shadow不执行模型或写事实。不能同时运行两套付费调度器来“对比”。
4. 按整个world/branch原子切换唯一engine epoch与事件checkpoint；先核旧inflight/unknown回执并建立明确失效栅栏，不能按超时猜无结果。所有写入口（包括旧worker/旧HTTP）都须在内核/最终事务验证engine epoch；仅改路由flag挡不住旧在途任务。不得旧链quiet后又fallback新链，或双写让其中一个看起来成功。
5. 旧端点若需保URL，只做统一命令网关的薄转译，不保留第二套业务选择；旧回执可只读回放，旧数据reader有明确迁移终点。历史来源适配集中一次，不把新if散布到每个planner和repo。
6. 按root登记的独立模型额度验收，再正式切换；43闭账额度不挪用。失败保留输入/责任、回执与明确原因，不能以固定对白或伪造进度兜底。关闭旧writer前不宣称kernel唯一。

## 6. 核心验收（建议，不是本次已执行）

- A有欠回复，B连续聊天/刷朋友圈：A责任不消失；同A聊无关话题也不核销邀约提醒。
- opening B unknown：其自身恢复要显式，A已实际出场可正常回应；其他无冲突候选不被batch managed quiet吞掉。
- 玩家沉默、滚动地图、拒绝某请求：世界都能在合法时间和预算内产生可解释候选；拒绝不会被重设为engaged，也不反复催同请求。
- 等待/次日/约定到点：事实时间与日程严格一致，重要节点中断；明确继续不等于赴约或事件完成，不强迫用户走剧情。
- 一次结果unknown：回执可核对、重放不重付；只阻断冲突scope。其他人物不发生全局饥饿，旧epoch/晚结果不可落库。
- 手机→地图到达→现场→手机/群聊：同一个持久人物记住实际知情来源，工具行动与APP投影都源于Kernel提交；未见信息不凭全局导演视角泄漏。
- 新旧世界切换、多人生隔离、未来多人共享时钟权限均保留明确契约；不能用单人当前通过冒称多人已实现。

本报告是架构输入，不是重构交付；未写代码/SQL、未调用模型或生产。下一步由root整合各子报告、冻结唯一新架构与任务边界后实施，不建议再为43调度短路追加兼容分支。
