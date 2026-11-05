# ARCHITECTURE-INDEPENDENT-38：独立精简审查与删除门槛

日期：2026-11-03。负责人：`astra-independent-audit38-20261103`。本报告是审查，不是精简实施或持续演绎验收。

## 1. 结论与真实范围

**同意上一轮“精简强制步骤，而非只改字段名”的方向；但不能直接照原21项顺序删除。** 当前另一线程已经实施其中多项，而部分下游仍保留旧假设。更值得优先做的是：

1. 让“无需机械goal”的决定贯穿人物计划、事件退出、数据库约束和恢复，而不是只让schema接受null。
2. 将当前有效工作与历史审计分开，退出正常读取/提交中的全历史重建。
3. 收口重复的恢复判定和写入实现，而不是删除恢复凭据、安全边界或用户历史。

本轮直接追踪源码、调用链、迁移、模型组包和调度消费者；另有两份只读子审查，重点结论由主审复读。执行了纯函数/模拟适配器探针，**没有真实模型调用，没有连接数据库，没有启动服务，没有修改业务代码/数据库/配置，没有提交推送或部署**。仅新增本报告和本人任务登记。未做112表的第二次实时普查，也未复查原存档6人的当前goal/plan数量；这些数字不能当作本轮新证据。

### 基线变化（重要）

开工时HEAD为`9f495c63`且有37批业务WIP；审查期间其他线程依次提交：

|提交|本轮已核实的源码变化|
|---|---|
|`d8a0f754`|分离轮询退避，移除按剧情时间判断媒体过期|
|`470c33a2`|独立plan/action、当前wire v19、参与结论改回执投影|
|`b0e44b3d`|退休人物冗余索引与重复seed约束，新增[0122迁移](../../db/migrations/0122_retire_actor_indexes.sql)|
|`490e604f`|自主复盘窗口读取、collect锁策略、调度政策/资格，新增[0123迁移](../../db/migrations/0123_proactive_eligible_claim.sql)|

收口取证HEAD为`490e604f28331fa71655b12e791da384b0c7d49a`。离线探针在`b0e44b3d`时执行，其涉及的组包/生命周期/恢复实现未被490调度提交改变。报告校验时又出现他人的continuation、来源解析、模型协议等未提交修改；不将这批后续WIP视为已验收，也不覆盖它们。下述行号对应取证时文件，后续修改可能移动行号；不把外部提交算作本轮修改，**源码已改不等于迁移已应用、测试已通过或线上已更新**。

## 2. 增量发现与安全处理方式

### F1｜高：取消强制goal后，事件退出仍强制要求goal或责任

**已用纯函数复现规则缺口；不是原档故障复现。**

- [人物计划类型](../../src/modules/world/domain/agent-runtime.ts#L38-L49)已经允许`goalId:null`。
- [生命周期投影/退出判断](../../src/modules/world/domain/episode-participation-lifecycle.ts#L254-L274)可以识别独立计划，却仍要求原先`engage`的人至少有goal或responsibility才能退出。只有明确withdrawn的独立计划仍返回false。
- [数据库退出函数](../../db/migrations/0112_active_episode_withdrawal.sql#L11-L33)第29行保留同一要求；不能只修TypeScript。仓储的退出预检也要同步审查。

**应替换：**以真实承接工作及明确撤回依据判断退出，不依赖为满足规则制造的goal/责任。独立计划的撤回必须与“被替换”“普通关闭”“成功完成”区分；当前close理由的保存方式要能提供明确退出证据，不能仅把`plans.length>0`加进条件就一律退出。

**验收：**无goal计划接受→等待→执行→完成、接受→明确退出、替换计划不退出、即时行动无需计划；多人任一人仍在参与则不退出；在途旅程、未决媒体和已发送attempt继续阻止错误撤销。领域与真实PG函数给出相同结论。

### F2｜高：人物“当前状态”仍携带累积历史，模型裁剪次序先伤有效内容

- [内核合并](../../src/modules/world/domain/agent-kernel.ts#L683-L700)保留旧plans/actions；后续仍合并goals、responsibilities、decisions，终态不是移出当前状态。
- [上下文投影](../../src/modules/world/application/agent-state-context.ts#L190-L290)对这些数组逐项输出；[来源解析](../../src/modules/world/infrastructure/agent-source-resolver.ts#L40-L59)按全部状态收集来源；[私聊定向读取](../../src/modules/world/infrastructure/chat-context-read-repository.ts#L63-L95)同样收集历史引用，超过768个必要引用会退回完整读取（[上限分支](../../src/modules/world/infrastructure/chat-context-read-repository.ts#L206-L216)）。
- [模型组包](../../src/modules/world/infrastructure/npc-agent-model.ts#L445-L480)还给计划逐条计算`planNextSteps`。并非没有优化：无活跃工作时已有compact；超预算时也会删终态。但[裁剪顺序](../../src/modules/world/infrastructure/npc-agent-model.ts#L813-L929)先删可选观察/裁人格等，最后才剔除终态工作，且后者没有同步重建所有派生字段。
- 人物状态另有[应用JSON上限](../../src/modules/world/infrastructure/agent-runtime-repository.ts#L212-L232)及数据库大小约束；只裁模型payload不能解决持久状态无限累积。

**实测合成输入：**相同当前责任、人格、来源和输入，仅增加不相关的finished计划：

|终态计划数|payload中的计划数|planNextSteps数|messages字符数|输出配置（含schema）字符数|
|---:|---:|---:|---:|---:|
|0|0|0|15,810|9,622|
|20|20|20|20,988|9,622|
|100|100|100|41,788|9,622|

以上为`JSON.stringify(...).length`，**不是token、UTF-8字节或模型耗时**。使用实际`NpcAgentModel`和内存捕获适配器，没有网关请求。

**应替换：**在来源解析和模型组包前形成一个当前工作视图，保留活跃工作及其依赖闭包、最近有意义的结果/选择；终态历史按需读取。先削减读取与payload，确认消费者迁移后再考虑持久状态归档。

**不能直接删：**活跃计划依赖的终态action/result、玩家拒绝/同意的对象与修订、未回答问题、撤回证明、付费恢复引用。不建议新增一套“当前议程”写账来复制现有状态。验收要覆盖1/100/10000条历史、有/无活跃工作及状态大小边界，而不是仅把限制调大。

### F3｜高：一次历史到场让普通读取永久退回全世界重放；记录订阅又放大它

- [私聊读取](../../src/modules/world/infrastructure/chat-context-read-repository.ts#L171-L188)发现任何历史attendance便抛fallback；[服务入口](../../src/server/npc-agent-services.ts#L669-L684)转完整世界读取。
- [完整读取](../../src/modules/world/infrastructure/postgres-world-repository.ts#L239-L264)只要历史存在一次attendance，便读取截至当前版本的**所有事件**、重放整个世界，最终仅使用重建的appointments。这不是仅重放本次到场事件。
- [玩家记录读取](../../src/modules/world/infrastructure/player-records-repository.ts#L26-L81)又实现相同历史重放，并持有世界`FOR SHARE`锁。
- [手机根组件](../../src/features/phone/world-phone-app.tsx#L107-L112)常驻安装records hook；[hook](../../src/features/phone/use-world-records.ts#L55-L66)随phoneVersion改变重读；[版本协调](../../src/features/phone/records-loader.ts#L22-L33)不一致时还会再次拉phone。用户只聊天也可能触发这条链，不必打开记录应用。

**应替换：**在原提交事务维护可认证的日程/到场当前投影，或只读取相关日程增量，不把全世界恢复作为普通读的必经步骤；将重复的日程重建收口成一处。记录内容按真实消费者按需读取/标记失效，不必每次私聊都刷新全套记录。

**门槛：**保留原不可变邀约来源、后续response/attendance版本及旧档回填；不能直接删fallback留下过期投影，不能直接去锁造成多查询混版本。保留旧版本读取、分支重放和授权。验收长历史下普通GET不随无关事件总量线性搬运；验证到场、取消、改期顺序、记录与手机版本一致，以及媒体变化不依赖world.version单字段判断。

### F4｜高：零发送恢复分成两条规则，可能把没执行过的工作永久跳过

- [孤儿wake规则](../../src/modules/world/domain/agent-wake-recovery.ts#L46-L69)：只要已accept、无attempt且世界版本前进，就把语义候选当作已消费。
- 同文件[正常zero-send恢复](../../src/modules/world/domain/agent-wake-recovery.ts#L86-L114)却允许`cancelled_before_send`、未发送/无结果/无事件的attempt生成受约束successor。
- [advance](../../src/server/npc-agent-advance-services.ts#L370-L390)加载孤儿，[候选过滤](../../src/server/npc-agent-advance-services.ts#L838-L844)直接跳过；[accept和run](../../src/server/npc-agent-advance-services.ts#L1368-L1419)分离，确有中断窗口。

**离线探针：**版本9→10、同一仍ready的语义候选：无attempt路径被排除；全未发送的cancelled attempt返回successor。纯规则复现，不声称已在原档发生。

**应替换：**统一“经锁证明未发送”的恢复协议；保留原receipt和family，重验候选，受控形成后继执行身份。不能简单删除skip让旧receipt每轮冲突，也不能把unknown当零发送重买。验收accept后崩溃、别人quiet提交、两恢复并发、旧进程复活及sent/raw/unknown反例。

### F5｜高：单个task恢复全世界attempt锁定；版本判定也与提交引擎重复且不一致

- [任务恢复](../../src/modules/world/infrastructure/agent-task-recovery.ts#L62-L67)先`SELECT * ... agent_attempts ... FOR UPDATE`读取/锁定整个世界的调用（含大response/snapshot），再在JS按原task派生command筛选。
- 同文件[版本否决](../../src/modules/world/infrastructure/agent-task-recovery.ts#L193-L234)对世界版本改变一律走stale/conflict。
- 但[统一提交判定](../../src/modules/world/infrastructure/agent-commit-version.ts#L82-L122)已经允许玩家输入跨过其他人物无共享效果的quiet提交。私聊入口也明确使用这一规则。

**离线模拟：**群聊玩家原付费结果版本9，只有其他人物quiet导致版本10，实际`resolveAgentCommitVersion`返回可提交的`{appendBaseVersion:10,commitVersion:11}`；恢复入口的版本相等检查仍会拒绝。模拟SQL只返回合成记录，无数据库调用。

**应替换：**按原task/receipt/actor定向定位并锁原attempt；已保存原结果的恢复复用统一依赖判定，取消多处不一致的“世界有变化就失效”。零发送重准备与已付费原结果恢复仍需区分。

**验收：**无关quiet不浪费原结果；共享变化、角色修订、成员退出继续拒绝；原token fencing、重复retry幂等、unknown不重买全部保留；恢复单task不得读取或锁无关历史大响应。

### F6｜中高：可选会话摘要，每次私聊提交都重新扫描历史决定有没有工作

- [内核尾部](../../src/modules/world/infrastructure/npc-agent-kernel.ts#L2103-L2114)在private渠道、主事务结束前await摘要入队；不是模型调用本身在事务里。
- [摘要资格查询](../../src/modules/memory/infrastructure/conversation-summary.ts#L26-L60)对人物消息做历史`row_number`，关联历史task的`messageIds`排除已覆盖消息，最后才`LIMIT 24`。SAVEPOINT吞错只避免功能失败，不消除扫描和锁持有时间。

**应替换：**以有界/增量资格和覆盖窗口选批；可先廉价判断是否有新增未覆盖消息。若移出提交必须可靠投递，不能fire-and-forget；无需另起一个摘要调度体系。

**重要归档反证：**现在历史summary tasks是“已经处理过这些消息”的依据，直接删除终态task会破坏排重，可能重新购买摘要。先迁消费者再归档。[付费前后来源复验](../../src/modules/memory/infrastructure/conversation-summary.ts#L109-L138)必须保留。验收长历史已覆盖、少于16条、queued/unknown/并发新消息，并测锁时间及重复购买次数；本轮未做EXPLAIN或耗时测量。

### F7｜中高：记忆仍有两套实际写入实现；不能称“都已统一”

- [memory-store](../../src/modules/memory/infrastructure/memory-store.ts#L30-L75)有scope锁、遗忘/更正保护、归一化及32来源合并边界。
- [scene写入](../../src/modules/world/infrastructure/scene-repository.ts#L1550-L1615)仍自行derive、查active同文、写record与refs，并未调用上述持久化路径；合并条件与来源数量处理不同。
- 机械替换也不安全：[来源类型推导](../../src/modules/memory/infrastructure/memory-store.ts#L18-L23)把所有character记忆设为`world_message`，现场人物记忆实际上引用`world_event`。

**应合并：**统一持久化规则，显式传入正确来源类型；保留每名真实观察者独立可见记忆，不合并不同人物的认知。先修接口表达能力，再迁scene写者。

**安全范围：**现代码确有不同写入机制；没有在真实库复现“遗忘后复活”，不能把潜在风险写成已发生。需测同scope并发、重复场景、遗忘/纠正、事件型/消息型来源归属及>32来源边界。

### F8｜中：单项记忆更正锁整个owner；列表还有恒无作用的额外过滤

- [更正](../../src/modules/memory/infrastructure/memory-store.ts#L228-L240)先取目标scope锁，再调用[全量读取](../../src/modules/memory/infrastructure/memory-store.ts#L179-L206)锁owner所有可见记忆，回到JS才筛scope/branch/character；实际更正只需相应key的旧active记录。
- [列表服务](../../src/server/services.ts#L253-L263)先查询character progress ID并在结果中排除；底层[列表查询](../../src/modules/memory/infrastructure/memory-store.ts#L292-L300)及[可见性谓词](../../src/modules/memory/infrastructure/memory-store.ts#L417-L420)本就不允许character记忆，两集合不会相交。

**可收口：**更正SQL直接限定owner/scope/branch/character/key/status；删除列表那次无作用的hidden查询及filter，保留真正的底层可见性过滤。这是一项不需要新表的低风险精简候选。

**不要类推：**forget确实要追踪派生来源闭包，不能也只取目标一行。验收同key不同scope隔离、两世界并发更正、NPC私有记忆不可见、遗忘派生闭包。

### F9｜中高：删除参与JSON后，不应每次重建全部参与历史两遍

- 新[参与投影](../../src/modules/world/infrastructure/episode-lifecycle-repository.ts#L13-L38)对该人物所有consumed requests关联receipt/attempt/event/command，没有活跃事件窗口。
- 紧接着[生命周期读取](../../src/modules/world/infrastructure/episode-lifecycle-repository.ts#L41-L90)又按投影身份查询同组事实/事件；[snapshot末尾](../../src/modules/world/infrastructure/agent-snapshot-repository.ts#L987-L993)每次挂载followups/results。

**判断：**以回执为权威方向正确；但“少存一份JSON”不能换成聊天每轮重建并核对全部历史。先确认当前活跃/被引用请求，批量构建一个本事务内的已认证读模型，复用给参与结论和followup；终态历史按需回看。提交时重验可变条件，不能用跨事务缓存充当权限。

**门槛：**退出/重评、已结束事件的必要记忆、来源撤销和旧付费snapshot都不能遗漏；不再新建另一张权威参与表。以1/100/10000条已结束请求测试返回范围、查询行数与恢复一致性。

### F10｜中：同次候选收集两遍，前一次还绕开了局部失败隔离

- [advance预读](../../src/server/npc-agent-advance-services.ts#L870-L873)用`Promise.all`收集；随后[调度调用](../../src/server/npc-agent-advance-services.ts#L987-L989)再次把相同sources交给调度器。
- [调度器](../../src/modules/world/application/schedule-agents.ts#L349-L380)重新collect，用`allSettled`实现failureScope隔离。前一次抛错会使这层隔离根本无法执行。

**可合并：**同一版本的一次收集、一次规范化，优先级判断和调度复用结果及失败范围；不引入长期缓存/候选表。不是每个collector都发SQL，不夸大成“双倍数据库耗时”。验收每源一次collect、局部源失败不影响无关actor、版本变化重收集、冲突候选仍失败关闭。

### F11｜低风险候选：旧媒体执行分支可以比原报告更明确地退休

- 全src查到唯一生产组装是[worker](../../src/server/worker-composition.ts#L275-L276)传`readMediaService`函数，因此[handler分派](../../src/modules/media/infrastructure/media-handler.ts#L14-L27)必走pipeline。
- 旧synthesizer实现主要是测试调用面。历史task并不靠该TS参数类型选分支；当前[pipeline兼容](../../src/modules/media/infrastructure/media-pipeline-handler.ts#L32-L43)已处理缺purpose旧请求，[幂等/unknown](../../src/modules/media/infrastructure/media-pipeline-handler.ts#L125-L142)也在现路径。

**可删除候选：**迁移对应测试后，删除旧synthesizer执行分支及联合参数，组装只接一个handler。保留真实供应商适配器、旧任务格式兼容、ready复用、unknown保护及素材权限。无需为删一个未被生产组装选中的TS分支而先清空历史任务；但仍需旧任务恢复测试。

## 3. 对原21项逐项复核（不是重新列21个待修）

原报告：[ARCHITECTURE-NECESSITY-36](ARCHITECTURE-NECESSITY-36.md)。

|原项|本轮判断与当前状态|
|---|---|
|1 memoryIds|同意退休持久索引。37已改类型、模型投影/初始化及正常提交清理；保留真实记忆，勿重复实施。|
|2 relationshipIds|同意退休索引。37已改；不要据此删除真实关系或人物静态关系设定。|
|3 强制goal|方向同意，37已放开；不能宣布整链完成，F1证明退出消费者仍要求旧包装。|
|4 参与JSON|回执单权威同意，37已切投影；还要解决F9重复全历史读，不是再加一张表。|
|5 continuation|合并真实执行等待同意；聊天期待回答不等于玩家责任，“无当前意图”可不占业务待办，但quiet的付费/退避证据不可丢。当前仍有独立字段和collector，未完成退休。|
|6 历史复盘|37已用anchor/quiet suffix/current-family取代原4096上限；本轮不再报“仍超过4096就失败”。尚未独立证明新窗口完整性，advance仍读整世界attempt/orphan（F4入口），长期成本不能只看一个查询。|
|7 collect写锁|37已按phase去collect写锁。保留claim/send/commit必要锁；多SQL一致性仍需并发验证。|
|8 多阶段授权|不能简单“一次校验永久通过”。可复用不可变材料；撤销、角色修订、租约、预算及暂停属于可变授权，发送/提交需要重验。|
|9 seed重复唯一索引|37已有0122，保留外键定义再重绑，不使用盲目CASCADE。本轮未查询实际库，不确认迁移已生效。|
|10 旧生成回退|同意在旧档接管后退休生成入口。epoch2正常quiet不等于会再跑旧引擎，不能说每回合都运行两套。|
|11 旧协议|隔离历史decoder只是组织代码；真正值得取消的是committed重放还重新解码/编译，见下节。未提交旧付费结果仍需要旧语义。|
|12 终态快照保留|同意制定留存，但status=terminal不等于无消费者：committed重放、部分导演handoff、摘要排重仍读旧材料。先切消费者再归档。|
|13 旧发布表|条件退休；部分旧开场/剧情执行记录仍被新引擎用作人物已知事实或防止重演。不能整组DROP publication表。|
|14 failed仍pending|原判断过宽：已有统一available/in_flight/paid_terminal和共用派发资格。pending表示未消费，不等于可执行；未独立证明某UI仍误导，不能把这项当已复现缺陷。|
|15 worker/cron政策|37共享60/60默认已入源码；吞吐批量与宿主唤醒可有区别，不必强制所有宿主参数一样。运行环境/实际定时未查。|
|16 资格后置|37已前移到0123领取SQL；非continuous不再先空领。advanced仍表示调用返回成功，不能拿它当剧情变化数；quiet提交也不能误当失败。|
|17 整包轮询|仍有必要改，且F3比传输整包更深：正常读全历史重建和常驻records订阅。变化标识必须覆盖媒体/头像等独立修订。|
|18 共用退避|37已按world/clock/advance区分503；402全局策略仍显式保留。勿重复报旧问题。|
|19 剧情时间算媒体过期|37已退休，改为真实时间快速观察窗口，不把过期等同生成失败；未做本轮手机/PC交互验收。|
|20 内核纯重复解析|可以单次解码/编译；保留提交可变依赖重验。优先修F5已出现的不同入口规则不一致，避免先泛化一层通用校验框架。|
|21 旧媒体handler|F11补足唯一生产组装证据，可迁测试后收口旧执行分支；不删除pipeline旧数据兼容。|

## 4. 不能按“看起来重复”删除的东西，以及原报告需修正之处

### 4.1 已提交结果也还依赖旧decoder，先把重放改为读原回执

[run-agent重放](../../src/modules/world/application/run-agent.ts#L94-L122)对response_received和committed共用raw/snapshot读取，[后续](../../src/modules/world/application/run-agent.ts#L270-L307)仍parse再commit；[内核](../../src/modules/world/infrastructure/npc-agent-kernel.ts#L197-L225)也在已提交短路前解析。

正确减法是：认证原command/attempt后，committed按原event/receipt返回，不重新演算已发生结果；保留幂等投影修复。未提交paid结果才走对应历史decoder。这样才为归档/退休decoder创造条件。不是先删除raw再修恢复。部分导演stale/invalid还有handoff重验，不能只按status批量删。

### 4.2 记忆来源表有安全消费者，不是零业务SELECT就可删除

[来源触发器](../../db/migrations/0010_memory_source_refs.sql#L12-L33)验证来源存在和owner，另有[RLS/权限](../../db/migrations/0010_memory_source_refs.sql#L37-L48)。`source_ids`与refs双表示可评估，但需先迁安全约束、显式来源类型和所有写者。原报告“记忆来源已全部统一写入”的概括应收窄，F7展示scene仍有独立实现。

可先做的低风险优化是来源delta或批量INSERT，避免重复合并时把全部旧refs再逐条写一遍；不必立刻迁整张表。

### 4.3 旧表仍能承载新引擎需要的事实

[人物情境读取](../../src/modules/world/infrastructure/actor-situation-repository.ts#L25-L59)仍读取旧开场/剧情记录；[事件资格](../../src/modules/world/infrastructure/authored-event-eligibility-repository.ts#L146-L152)利用历史执行证明防止重演。另有数据库SQL函数读取publication绑定/版本。先取消旧生成写入口，再迁历史读取；当前一个账号全是epoch2不足以证明全库可删。

### 4.4 保留职责，不保留重复机制

- 导演安排、NPC选择、玩家明确同意分属三个主体，不合成一份万能任务。
- 世界实际位置与人物知道的位置分开，不给NPC全知视图。
- 问题与正式责任不同；精简不能把每次闲聊都升级成承诺。
- 输入receipt、付费attempt、task/Outbox解决不同故障，保留身份、unknown和可靠投递。
- 世界事件/历史、当前执行状态、手机投影保留不同用途；替换全量重放，不清空用户历史。
- 世界领取公平冷却、advance批次互斥、付费attempt token是不同保护，不能因为都叫lease就删剩一个。

## 5. 推荐实施顺序与通过条件

不是同时重构11个模块。按以下小批次执行，每批先固定基线、给旧数据/恢复样本，再实施和验收。

|顺序|实际要减少的机制|通过条件|
|---|---|---|
|A 先堵精简回归|F1退出的机械goal依赖；F4/F5重复且不同的恢复规则|领域+真实PG：独立计划全生命周期；零发送可恢复；原paid结果不重买；共享变化正确冲突|
|B 完成任务与当前工作链|F2历史工作混进当前；F9重复参与历史重建；复核37的新调度窗口|导演交接→NPC明确承接/退出→即时执行或真实下一步→条件满足调度→实际结果接回事件；不手造台词/承诺；长历史成本受当前工作量约束|
|C 去正常链路的历史重建|F3日历/records重放与自动订阅；F6摘要资格全扫；F10二次collect|长历史SQL扫描行/锁持有/传输量对照，记录按需且版本一致，摘要可靠入队无重购，单源失败不拖全局|
|D 收口低风险冗余|F8无效查询/过宽锁；F11未使用媒体执行分支；F7写入规则统一|来源类型、遗忘/纠正、双世界隔离及旧媒体任务恢复；不以减少文件数代替正确性|
|E 最后删除旧数据/执行路径|旧生成入口、冗余热快照/旧decoder|全库旧档与未决调用清单、消费者迁移、约束依赖、备份恢复演练后才批准；数据留存与用户隐私政策另行明确|

每批至少记录：本轮不再强制生成的对象/不再执行的步骤；模型messages+schema大小；SQL次数、返回/扫描行数、锁等待；首条可见回复和完整完成延迟；丢任务/重复付费/权限泄漏为零的故障注入证据。不能据合成字符变化承诺具体秒数。

业务实施按项目要求运行check/build，SQL/权限/队列需隔离真实PG，UI需手机/PC，最终真实演绎另验。本轮为只读审查，且公共目录正在并发改动，**没有运行全量check/build、没有迁移验收、没有性能或线上验收**；不引用37报告中的绿色结果冒充本轮验证。

## 6. 本轮验证台账与接续点

实际执行的离线探针均在Node `v26.8.1`下通过`--experimental-strip-types --input-type=module`从stdin运行；未落业务测试文件、未读取密钥、没有网络/数据库适配器。它们证明的是：

1. 真实生命周期函数：`engage`且只有`goalId:null`的withdrawn计划，followUp=terminal而withdrawAllowed=false。
2. 真实模型组包+捕获TextModel：0/20/100条finished计划得到本报告F2字符数，schema不变，计划和派生nextSteps都进入payload。
3. 真实wake纯函数：同样零发送条件，无attempt被排除，cancelled_before_send可successor。
4. 真实commit版本函数+合成SqlClient：群聊原paid回复跨其他人物quiet提交允许append；与task恢复前置版本否决对照。

没有把断言“当前缺陷行为成立”的探针说成“业务已通过”。未跑真实故障恢复、未评测模型行为质量，也不证明除此之外没有问题。

**接续建议：**由37唯一集成人先接F1的领域+SQL退出规则及F4/F5恢复一致性；本审查不另开并行源码写线程。已改的1/2/6/7/9/15/16/18/19按实际迁移/测试状态接续，不重新开发。其余按A–E小批次执行，任务状态仍只登记在[开发总表](../DEVELOPMENT.md)。
