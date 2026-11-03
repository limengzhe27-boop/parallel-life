# ARCHITECTURE-SIMPLIFY-37：状态、协议、数据库与调度精简

2026-11-03；root-simplify37 唯一集成。基线9f495c63。当前为本地实施，不是全部21项完成，也不是持续演绎验收通过。

## 已实施

- 当前wire19：即时行动只需要执行意图，不机械创建goal/plan；计划允许goalId=null。旧付费wire18及更早协议仍按原解释恢复，不改变原行动身份。
- 新协议退出continuation输出；普通等待回复由已有问题承载，条件等待由计划承载。正常提交时移除旧包装；独立await_condition迁成普通无goal等待计划，已由计划/责任承载的条件不重复建立。不可变历史不改写。
- episodeParticipations不再追加写入人物JSON；从已提交episode receipt、attempt、event、command认证投影。私聊、群聊/现场、生命周期、来源认证接到同一回执依据；正常提交移除旧JSON副本。
- 删除人物memoryIds/relationshipIds写入与当前模型回显；真实记忆、关系、来源不删除。历史snapshot保持解码兼容。
- 0122合并approved_seeds重复唯一约束；迁移依赖外键后删除重复约束，无CASCADE。初始化SQL不再要求两个冗余ID列表。
- 自主复盘不再扫描固定4096条终身历史；定向读取当前family、未决调用、完成锚点和静默退避所需后缀。collect不锁世界；worker/cron共享默认60秒冷却/租约。0123将continuous/presence等资格移到领取前，删除空领后的完整时钟查询。
- 手机world/clock/advance分别退避；402仍整体停止。媒体等待按真实观察耗时控制轮询，不用剧情时间将图片判过期。
- 独立审查38发现的无goal计划退出缺口同步修复：领域、仓储预检、0124数据库函数支持有明确关闭依据的独立计划。替换/成功完成/空参与不等于撤回，多人仍需所有相关人物明确退出。

## 集成发现与修正

1. 删除参与JSON后，发送前来源核验仍读旧字段，导致AGENT_REVISION_CONFLICT；来源解析已统一读认证回执。原入口manifest旅程11/11通过，含超过24条参与历史与原结果恢复。
2. 删除旧quiet continuation后，任意主动联系候选被当作自主复盘的优先阻塞。优先预检只检查实际事件/行动/条件事项，不用另一自由联系机会阻塞同类评估；真实PG quiet/await_response/unknown/partial/4200条历史8/8通过。
3. 多人退出旧夹具依赖立即重复advance绕过呈现节奏。退出测试改为其余人物经真实私聊入口承接原pending请求；测试范围是退出一致性，不用它证明主动调度体验。

## 本地数据与测量

0122/0123应用前后：177 worlds、13452 messages、9994 events不变。仅本地克隆库；未操作Supabase/生产。

同一原档6人快照，捕获真实组包但不调用模型：messages+输出配置合计每人减少2457字符（约4.5%–6.0%）；原范围41072–54983，现38615–52526。人格材料长度逐人不变。此处是JS字符串字符数，不能称token或耗时按比例降低。

原2fb存档通过正常advance检查一次：played=0，actors=[]，no_candidates，模型调用0，无新增attempt。**长期主动演绎仍未通过。** 未补消息、未强制重开事件、未重复付费刷结果。

## 21项逐项去向

|审查36项|状态与后续|
|---|---|
|1、2 无用人物ID列表|当前写入/协议/SQL已退出；旧JSON随合法提交退休|
|3 强制目标包装|当前工具/计划已取消；独立计划退出同步0124；未批量改历史目标|
|4 重复参与状态|当前读写已切认证回执；历史副本随提交退休|
|5 continuation|当前输出退出、正常提交迁移；旧未提交存档读取/恢复仍保留，不盲删等待条件|
|6、7 历史扫描/collect锁|已定向查询并移除收集写锁；完整性能对照未做|
|8 多阶段重复资格|去掉自由联系互相阻塞；跨阶段认证职责尚未全部拆完|
|9 重复索引|0122已应用本地克隆|
|10 旧引擎回退|未删除：全克隆仍5个epoch1世界，需接管后退休|
|11 历史协议隔离|当前wire19独立选择；旧decoder尚未完整拆出大文件|
|12 付费快照留存|未删除：35 unknown、2 response_received、1 request_sent仍需恢复；终态引用迁移/归档未完成|
|13 旧发布运行表|未删除：依赖旧世界接管及历史来源认证迁移|
|14 pending失败投影|38复核修正：已有available/in_flight/paid_terminal统一判定；尚无具体UI误导证据，不新增状态、不清空付费保护|
|15、16 调度政策/空领|已统一并接0123|
|17 world GET无变化短路|未完成；不能只比较world.version漏掉图片/头像变化|
|18、19 轮询退避/虚拟时间过期|已修，聚焦测试通过；本轮未做浏览器交互验收|
|20 内核重复纯解析|未完成；须分离不可变格式和实际依赖重验|
|21 媒体旧执行旁路|未删除；旧任务消费者/恢复迁移尚未证明|

独立审查38新增的当前工作视图、attendance全量重放、孤儿零发送恢复、任务恢复锁范围、摘要扫描及现场记忆写入等，不冒称本批已经解决。后续应以该报告核对现状，不重复按旧基线修改。

## 验证与接续

- 主干合并后check曾4184/4184、typecheck/boundaries、隔离build通过；0124及退出接线之后再次运行最终门禁，最终结果见末尾追加。
- 原入口事件承接PG11/11；自主复盘PG8/8；本地worker PG1/1；continuation及模型聚焦106/106。
- 子任务100世界公平测试隔离55683通过；root在55432运行同测试被专属端口防护拒绝，未绕过该保护，不算新增成功证据。
- 不覆盖其他线程文档；不部署Vercel；本地运行版需最终构建后切换。任务总体继续进行中。

最终门禁：check4185/4185、boundaries/typecheck与隔离build通过。0124原入口PG覆盖有goal/无goal及单人/双人退出，共一条连续旅程通过；纯领域退出9项通过。0124已应用本地克隆，三项内容计数仍完全一致。3218新构建health200；web2144，queue2218，proactive2146；3219未动，未部署生产。旧队列进程85385已不存在，其遗留worker.lock经PID核实后归档再启动，没有凭超时删除活跃锁。原档无新消息问题仍未解决。

## 独立审查38合并后的下一阶段清单

合并日期2026-11-03，核对HEAD d46a9076。用户本轮要求更新清单，未授权本轮额外业务修改；本节为后续实施计划。唯一任务状态仍在DEVELOPMENT.md，以下子项属于37，不另起平行架构或状态总表。

### 先校正已完成与证据范围

- F1独立计划退出：38取证早于e6b3e84e；该提交已同步domain、仓储预检及SQL0124，并有有/无goal、单/双人退出真实PG及替换/完成/空参与领域反例。列为已实施验证，不再重做；它不等于“人物接受到执行完成”的全部旅程已验收。
- continuation新协议退出及旧条件提交迁移亦已实施；旧存档未发生合法提交的兼容读取仍在。不能把“仍可读旧字段”重新当成新协议仍强制填写。
- F2的15810→41788是独立报告的合成字符测量，不是本轮重测、token或时延。它证明历史计划会进入组包，不能直接证明原档20秒等待全由此造成。
- 原36第14项判断收窄：现有请求状态与派发资格不是两份相互竞争的状态账；pending不意味着可以重买。若有UI错误，应先找出具体消费者再修，不新建状态枚举。
- 记忆写入“已全部统一”的旧概括撤回。memory-handler已归统一入口，不代表scene-repository也已迁移。
- 本轮复读了F4孤儿跳过、F5全世界attempt锁、F8多余列表查询、F10预收集及F1新退出规则；其他F项按38提供的定位进入实施前核实，不冒称本轮逐项重跑。

### 排序、变更和验收

|子项/优先级|现在的问题 → 具体处理|关键位置/删除内容|完成标准|
|---|---|---|---|
|37-R1 / P0；F4|已accept但无attempt，版本变化便永久消费候选；统一经锁证明零发送后的原family恢复，与cancelled_before_send共用规则|agent-wake-recovery、advance、receipt/claim；删孤儿永久skip分支，保留旧receipt身份|accept后崩溃、无关quiet、并发恢复、旧进程迟到；每项合法工作最多执行一次；sent/unknown绝不当零发送|
|37-R2 / P0；F5及§4.1|单task恢复锁全世界且另用严格版本否决；按task/receipt/actor定位，复用统一提交依赖判断。committed读取已认证event/receipt，不再次编译旧raw|agent-task-recovery、agent-commit-version、run-agent、kernel；删全世界SELECT *锁及重复版本裁决/已提交重新解析|无关变化保留原结果；角色/共享条件变化正确拦截；response_received用原response；committed重复请求0模型；投影修复仍幂等|
|37-R3 / P1；F2/F9|当前工作混入累计终态；参与历史又重复认证读取。按活跃工作、必要依赖、明确引用组织同事务只读视图，参与/后续共用认证结果|agent-state-context、source-resolver、chat-context-read、episode-lifecycle、model；先去无关终态组包/重复查询，再考虑持久归档|1/100/10000历史样本；保留拒绝范围、未答问题、执行依赖、撤回与恢复证据；planNextSteps同步缩小；当前工作、人格及任务材料不被历史挤掉|
|37-R4 / P1；F10|同版本collect两次，前次Promise.all可绕过局部失败隔离；一次收集规范化，优先判断与调度复用结果|advance、schedule-agents；删重复collect，不建候选缓存表|每源一次收集；一源失败不拖无关人物；版本变更重新收集；依赖冲突继续关闭执行|
|37-R5 / P2；F3，关联原17|历史attendance触发全世界重放，records常驻订阅放大；统一日程投影/定向增量及旧档回填，记录按真实消费者加载|postgres-world-repository、chat-context-read、player-records、use-world-records、records-loader；删重复日程重建与无消费者自动刷新|到场/取消/改期顺序、旧档和历史版本正确；无关历史增长不导致普通读线性搬运；首页任务等真实消费者不被误停；媒体/头像变化不漏|
|37-R6 / P2；F6|主提交中全历史筛摘要候选；利用已有批次/来源做有界增量资格，可靠任务投递保留|conversation-summary、kernel尾部；删每次完整历史排除扫描，不新建摘要Agent或每轮模型步骤|不足批次阈值廉价返回；历史已覆盖不重买；queued/unknown、并发消息与摘要失败不阻塞聊天；记录SQL扫描和事务耗时|
|37-R7 / P2；F7/F8|现场和通用记忆各自写库，更正锁owner全量，列表额外过滤无效；统一写入接口表达world_event/world_message，再迁现场；更正限定scope/key，删除无效列表查询|scene-repository、memory-store、services；合并重复SQL，不合并不同人物知情，不删除forget来源闭包|同key跨世界/人物隔离、并发纠正/重复写、遗忘不复活、消息/事件来源正确、32来源边界与历史可见性|
|37-R8 / P2；F11|唯一生产组装走pipeline，旧synthesizer执行分支主要由测试选择；迁测试后删除联合参数及旧执行分支|media-handler、worker-composition、相关测试；保留供应商适配及pipeline旧格式兼容|旧缺purpose任务可恢复；ready不重复生成；unknown不重买；权限、失败、素材投递语义保持|
|37-R9 / 最后；原10/11/12/13/20/21|旧路径/快照仍有消费者；先完成R1–R8及接管核对，再定归档和删除|旧引擎生成入口、历史decoder、终态快照/旧发布运行记录；不删作者原稿/世界历史|全库旧世界和未决调用清单、恢复/来源/摘要排重消费者切换、备份及恢复演练；明确留存策略后才删数据|

R7中的无效列表查询与R8可以独立提前处理，但不抢占R1/R2恢复主线。F1已收口；F2–F11均有上表对应，38§4.1的committed重放单列到R2，避免遗漏。

### 分工边界

- root唯一集成人：R1/R2/R3/R4，共同涉及调用身份、当前工作视图、调度和提交；顺序交付，公共契约不由多人同时改。
- 可交给其他Agent的独立包：R7记忆统一（涉及记忆负责人先确认范围）；R8媒体handler退休及旧任务测试；R5日程/记录只读定位与专属回归。若改公共kernel/services/phone根组件，先交具体diff给root接线，不同时写。
- 每个包先登记文件归属；验证Agent只改专属测试/报告，不自行放宽生产条件。这里只记录可并行分工，本轮未实际派发或启动开发。

### 产品验收贯穿每批，而非最后才看

在原2fb存档保留身份、历史、时间和进度，按来源追踪：导演请求→人物承接→实际计划/行动→执行结果→下一次合法机会→新消息投影。出现no_candidates、quiet或失败时记录具体原因及下一次触发依据；不将“worker活着/有两条消息/API200”算作持续推进。合成故障测试验证恢复，原档真实模型/页面验证自然演绎，二者分别报告。

性能统一记录messages/schema字符及可获得的真实token、SQL次数/返回与扫描行数/锁等待、首条可见文字和完整完成时间。同场景前后比较，不用删字段数量或字符下降承诺秒数。原档当前no_candidates与长期主动演绎未通过仍是总任务未完成项。

## 2026-11-03：恢复一致性与当前工作分离（root-simplify39）

用户授权继续实施，本轮子任务R1/R2-T/R3-C已集成；追加修复原档实证的episode unknown准入和媒体假新信息。没有新业务表、列或迁移；保留原存档全部历史。

### 本轮删除、合并与保留

- R1删除旧版本无attempt就永久跳过candidate的SQL/集合/过滤。合法同一候选经锁证明未claim后，复用原receipt、command、hash、原文，在当前frame领取；不造successor回执。已存在attempt重放直接读原receipt，避免拿当前body重新accept造成COMMAND_CONFLICT。unknown原请求不重买。
- R2恢复从“全世界SELECT * FOR UPDATE”改为task原输入→receipt→actor/command→精确attempt锁。付费响应恢复用现有resolveAgentCommitVersion，保留人物/权限/共享条件检查。已committed重放走认证event/command/receipt结果，不加载旧raw、不再过当前model preflight/parser；幂等投影修复保留。新请求preflight失败关闭已领取但未发送的reservation。
- R3模型组包前使用currentActorWorkState，活跃工作与依赖闭包进入模型，state和planNextSteps一致；删除模型末尾另一套终态裁剪。私聊、群聊/现场来源准备、有界聊天旧引用收集使用同一视图；commit/claim/recovery仍完整状态。全部玩家决定及对应责任范围保留。私聊/渠道快照内已认证参与回执供source resolver复用，少一次重复查询；lifecycle再次读取及全参与历史尚未完全合并。
- 原档实证：mediaCompletionPacket把当前storyAt每次写为observedAtStory，localInitiativeContext将相同媒体结果当新信息。删除该重复字段和collector的当前时间相等要求；真实完成时间、sourceStoryAt、来源认证保留。不同读取时刻的同一结果observation完全相同，不加hash字符串例外。
- 原档另一断点：episode派发把人物所有unknown永久当busy，而claim已有过期无response/event时允许不同合法请求继续。派发/手机probe统一episodeActorAttemptBlocks读取现有lease/response/event证明，claim增加event_id IS NULL一致条件。同request unknown/paid_terminal继续禁止复购。新增的sent/leaseExpired/hasResponse/hasEvent仅为查询结果投影，不是数据库或模型字段。

### 验证与真实结果

- npm run check最终4189/4189（包含boundaries766/typecheck）；隔离npm run build通过。
- 原kernel PG15/15，含已committed重放时readResponse/preflight/parser全部禁止、伪造token拒绝；run-agent/latency23/23。
- task恢复+原入口manifest PG18/18；媒体真实worker→context PG4/4（不同storyAt观察相同）；有界读取PG1/1；model/current-work/media候选67/67。
- 子Agent隔离PG：原receipt双恢复/迟到旧claim5/5；episode unknown 68/68含1PG。同一unknown不能重买；不同事件可领取。root已接两个公共查询/claim条件。
- 实际组包合成0/100/10000无关终态计划：16043/16042/16042字符。仅字符量，不是token/延迟结论。重要决定与责任不会为了预算被丢弃。
- 原用户档2fb97a4a，正常advance一次（2026-11-03 10:09:42Z），3次真实文字调用、0生图、0人为消息、0新世界。原pending5条中1条原可执行事件成功交接并consumed；舒雅婷提交quiet（理由“当前无新信息或需要表达的内容，保持安静”），无plan；其余2轮也quiet。世界保存至v486，played=0、新消息0。恢复通路通过，**主动剧情演绎仍未通过**，不以changed=true或consumed冒充成功。
- 未对四条paid_terminal旧失败请求发起重买，未重置3条unknown，也未强制NPC发言。静默重复媒体验证通过后恢复常驻worker，构建切换见下一条记录。

### 仍待续（不隐去）

1. 原档事件为什么被人物认为没有参与价值、已有责任为何无下一步，需要对实际作者机会/当前玩家决定/模型输入连续核查；本轮未强行重演已quiet请求。
2. 120条历史玩家决定连同责任范围仍可能超预算；当前诚实拒绝超限，不偷删拒绝语义。需要按事项读取/精简表达并保留精确可追溯历史，尚未完成。
3. F9参与/lifecycle完整同事务复用，F10重复collect与局部失败隔离未完成；群聊/现场无attempt且版本已变的零发送task路径仍严格失败，R1仅解决private wake。
4. R5日程/attendance历史重建、R6摘要资格扫描、R7现场记忆写者合并、R8旧媒体执行旁路、R9历史退休继续按原清单；未物理删除恢复所需历史。
