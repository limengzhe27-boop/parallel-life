# BOOT-01N-Q · 两步历史生成独立审查

2026-10-10；Agent codex-f-boot01nq-01a0c7c8-20261010；独立 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/boot-01n-q@4b593e2。已读AGENTS、PROJECT_BRIEF、主DEVELOPMENT、ARCHITECTURE_REVIEW、INITIAL_PHONE_LIFE_SPEC、PHONE_PREHISTORY_IMPLEMENTATION_PLAN、根BOOT-01N-COORD及新I报告。领取短锁已确认，第一阶段只写本报告/本人主行/主镜像；全部业务、公共契约、SQL与旧测试只读。没有PG/HTTP/browser/npm/模型/生图资源占用。旧fd8c719保留原分支，未重做GitHub权限。

## 判断与事实边界

世界开场先校验演员、再独立生成少量历史、完整通过才原子保存，方向可行，可以降低上批同一输出混合人物/历史的格式负担，但不是成功保证。4b593e2仅生产恢复基线：worker-composition明确historyEnabled:false，普通/固定cast走旧开场；上批4真实请求全部失败，540check/12PG与正式旧世界可用是I历史证据，不是本轮执行或新历史生产成功。

已读I候选：legacy世界提案并冻结演员；HistoryPlanner只接opening/T0，回同顺序二维数组，运行时分配actorKey/key；共享100秒deadline与外层110秒/路由120秒；每阶段最多2次已知结构纠错，总4次，unknown/取消/截断不重付；生产先false。本轮I最多10真实供应商请求含纠错/NPC，不能把每build最多4次当成总批10次的自动配额控制。本人0调用。候选尚无冻结源码，因此下面是风险与未来测试要求，不冒称新实现已复现漏洞。

根随后明确采纳两项约束：第二步改groups{actorIndex,messages}，整数唯一完整覆盖、允许乱序；输入仅player-visible identity/setting及index/name/已公开relationship，禁止persona/ties/notes/其他人的开场私聊/seed/完整访谈。以下前两项原候选风险已有设计决策，保留原因与反例，等待冻结源码证明落实；不再要求根重复选择编号方案。

## 冻结前需要落实的门槛

1. **仅靠位置不能验证角色绑定。** 候选二维数组若交换甲乙两组，长度/字数/时刻都合规，运行时按位置绑定仍会合法地错存私聊。程序提供顺序清单只是prompt约束，没有可验证身份。建议模型输出每组显式机器编号（例如{actorIndex:0,messages:[...]}），编号由程序分配且从冻结key表查找：唯一、整数、范围、完整集合全验，禁止名字匹配/parseInt/漏项后zip/slice补齐。正常输出乱序可按编号映射。此为独立模型私有格式，不要求改WorldPhone公共契约。若坚持纯位置格式，应明确承认“交换组无法自动发现”，不得把该反例写成已通过；根已选显式编号，后续只核对实现，不再重复请求决策。显式编号也不能证明文字语义正确，只能防格式上的顺序错位。
2. **opening并不等于全部可见或允许转发。** 目前opening含所有actors.persona、actorTies、各演员current messages和内部notes。新历史输入若直接JSON.stringify(opening)，即使不接seed，仍可能泄露他人私聊和隐藏动机。需建立明确裁剪：共同可见identity/setting、T0、各编号对应的必要姓名/主角关系/公开角色与自己的说话方式；不传全演员私人愿望或当前私聊，不把opening.notes自动当公开事实。全员一次生成仍有模型语义风险，严格字段校验不能证明不全知。可用两个合成哨兵检查prompt无他人私密资料，并用actorContext检查最终a/b实际来源隔离；真实NPC承接另由I证明，不让模型一句“知道了”冒充来源校验。
3. **校验冻结必须在规范化授权资料之后。** 普通personRoles分支当前在WorldPlanner中按person_N绑定sourcePersonId、恢复授权姓名/角色、检查角色冲突；buildHandler还会重验。历史阶段应接最终这个获准opening，而非先捕获未经角色修正的原JSON。第二步不能改actors/identity/setting/ties/current或重新推断sourcePersonId；失败纠错也不能重跑第一步并换演员。普通入口至少3NPC、共享schema至少2；固定cast合法2NPC必须保留，不统一套普通3人下限。上批主角被列actor仍须第一阶段拒绝，文本prompt不是运行时主角身份的完整语义证明。
4. **两阶段及纠错共用一次T0和deadline。** T0当前由buildHandler在模型前取一次，传propose；历史at应T0减60..43200整数分钟，当前仍45/25/12/5分钟，从尾截取，history头同T0/UTC+08。不可第二步用Date.now、耗时后重新取锚点或用入库createdAt。100秒不能每步/纠错重新开始，外层runOwnedTask已110秒、route120秒、gateway每请求85秒；必须合并同signal，剩余时间不足时不启动新请求。默认signal缺失也要受总deadline约束。外层取消、租约heartbeat失败、deadline均终止后续步骤；model忽略abort迟到返回不能进入commit：需在阶段边界和写前检查signal，queue lease合法不能代替已取消判断。真实SQL提交时间不能仅靠模型AbortSignal保证硬时限，需留下事务/收尾预算，不宣称100秒后所有网络/SQL一定停止。
5. **失败不能降级冒称成功。** 第二步缺人/超字/格式坏/超时/截断/取消，不填模板、不删有问题演员、不丢掉history退legacy，也不ready后补写。只能保留已排队build元记录与failed/unknown诊断，world、initial、bindings、messages、事件/receipt、media与outbox不落半套。交易失败也整体回滚。未知失败不自动重跑；显式重试保持现task生命周期，不引入新stage task/数据库/checkpoint。共享总deadline信号应交runOne，或错误带CANCELLED/TIMEOUT等现识别code，否则内部deadline可能错记普通failed并误导重付。截断本批禁止付费纠错，保留AI_TRUNCATED；解析响应已收到且字段已知不合法才有限纠错，gateway异常不能混入通用结构catch。
6. **门控三模式需要不歧义。** legacy输出/输入/默认请求选项按现生产旧规则；single-pass严格历史保持旧测试与调用者；two-step明确启用并写入history头/初始已读。若historyEnabled与historyMode并存，必须拒绝矛盾选项或规定唯一优先，不能planner生成legacy而handler以historyEnabled判断要求history，或two-step成功却handler漏flag。唯一生产组装显式控制；PG/真实模型都成功前不改生产开关。旧initial不回填，旧all-same-time兼容不重新排列新明确时间。

## 可运行验证矩阵（第二阶段待释放）

未来唯一新增tests/integration/boot-01n-q.test.ts；现阶段该文件不创建、不运行。沿用真实PG pl_app/pl_worker/Task Queue及Postgres Repository，显式fixture TextModel只用于结构接线，不是假AI生产。

|编号|操作|通过条件|
|---|---|---|
|NQ01 普通正例|3NPC，person_0有授权分支角色；世界模型合法后历史各1条，编号输出乱序；a多一条跨日历史|actor ID对应原获准key，姓名/分支角色一致；历史覆盖全员，不按输出顺序错位；current只有少量；fixture各阶段调用数明确；不是供应商成功|
|NQ02 固定cast|2NPC固定作者character顺序与openingCharacterId；后3至8人边界|身份/地点/人物/关系完全来源固定修订，首current仍openingKey；不访问现实Profile；2人不被普通3人规则拒绝，不改顺序对应|
|NQ03 绑定与容量|缺/空组、多组、重复编号、-1/out-of-range/小数/数字字符串/null、同名两演员；交换顺序|全覆盖校验拒绝坏编号；合法乱序按编号映射，同名不合并。根已规定显式编号，合法乱序必须按编号成功；纯位置回退列为拒绝用例；每人1..6/总48，8×6边界与第7条拒绝|
|NQ04 输出权限|第二步额外actors/identity/key/role/read/player/assetId/sourcePersonId等字段；文字空白/161字；第一步演员少于合法数、缺persona或玩家混入|严格第二步私有schema拒绝额外能力；转成既有history后再次validate/genesis写边界；不strip越权再成功；第一步不合法不调用history，保持0持久world|
|NQ05 私聊/事实隔离|a私密哨兵场地暗线、b私密哨兵资金秘密，私人Profile另哨兵；截取历史prompt；真实state读a/b context；blockedSources|历史prompt不含完整seed/私人Profile/他人私聊/私有persona；a只接a历史、b不含a历史；blocked message/genesis source被排除；现实Profile/candidate不变，不写推测事实。纯字段校验不能证明模型语义不漏，需人工/真实NPC补证|
|NQ06 时间|固定T0=2026-10-11T00:10:00+08:00；阶段完成延迟但锚点不变；历史60/43200，坏59/43201/0/分数/非有限|at严格依同T0，跨日显示昨日；current分钟不同且<60，history>=60；snapshot/header/GET/referenceTime一致。无需新增1998年代选择、DST制度或现时钟改造|
|NQ07 共享取消|模型第一步完成后abort；第二步迟到合规响应；纠错前abort；无外部signal入口总deadline；取消中heartbeat仍validlease|停止后续model并拒绝晚commit，结果非succeeded、无world。deadline证明优先检查signal继承/期限；后续授权短预算或原生定时辅助，不等实际110秒/不用内存仓储证明持久失败。若需test clock/config必须先登记，不改共享测试配置|
|NQ08 有限纠错|第一步坏→合法，第二步坏→合法；第一步TIMEOUT/UPSTREAM_FAILED/TRUNCATED；第二步同；全部history校验坏|结构合法修复最多2+2请求，history纠错使用同演员/T0，不重跑setup；网关未知/截断无追加付费；无自动背景重试/无fallback legacy；task正确failed/unknown和脱敏耗时/版本诊断|
|NQ09 真PG原子失败|第二步坏/throws/abort；调用前、阶段间、commit前lease过期/错token，事务中故障（如授权asset失效）|world/initial/bindings/messages/events/media/outbox全部零，opening仍null，task非succeeded；保留排队build不算半world。stage1授权写真不能提前enqueue media|
|NQ10 幂等及租约|同command/seed再次enqueue，异seed同command，同seed另command；同任务竞争claim；旧lease完成晚于新lease|同task/world无追加生成；冲突按现409；仅有效lease可ready，旧提案不得写第二套。无自动重跑unknown，显式retry不偷偷复用未落盘stage1或更换immutable seed|
|NQ11 持久/旧回执|全成功后真实GET/reload/replay及两个玩家turn，读取旧command receipt；otherowner及同owner另world；显式legacy fixture|initial原文hash不变；历史IDs稳定，新world重新分配source/IDs；旧回执不混未来，RLS按owner/world隔离；legacy无history/initialRead按原语义，不重写旧数据|
|NQ12 模式/接线|legacy、single-pass、two-step入口与worker组装，固定cast/普通都测；冲突选项|legacy无新history要求及输出选项，single-pass原严格失败仍有效，two-step全成功后runtime flags正确；生产启用是I审定的明确决定，不默认constructor放开|
|NQ13 实际双端|根明确释放独立资源后新合成会话390×500/844、1440×900：历史联系人、当前通知、展开/定位/返回/滚动/刷新/追加新ID|历史初始已读/不通知，当前少量未读数量与target一致；展开不读，会话才读，新ID再次通知；无横溢/PC居中；截图与PG互证。用合成fixture可验UI但不代表AI或公网|

## 现有代码接点（4b593e2只读）

- src/modules/world/infrastructure/world-planner.ts：parseOpening及普通person_N/sourcePersonId/branchRole规范化；proposeSetting固定c_N、固定演员与首current。候选history-planner.ts当前基线不存在，不提前声明实现。
- src/modules/world/infrastructure/build-handler.ts：time取一次、person mapping最终写边界、genesisMessages、单queue.commit内world/绑定/素材outbox/initial/opening以及成功task。新历史不得移动到commit之后或拆单stage task。
- src/modules/world/domain/genesis-messages.ts：全员覆盖、key/引用/时间与初始flags；需保留第二步转换后的最终验证，所有初始ID由runtime。
- src/modules/tasks/infrastructure/postgres-task-queue.ts：commit查running/token/lease_until，事务finish_task后COMMIT；RLS/lease fence不替代AbortSignal检查。
- src/modules/tasks/application/run-worker.ts：20秒heartbeat，combined abort停续租；TIMEOUT/CANCELLED/UPSTREAM_FAILED/combined.aborted记unknown，已收坏输出记failed；不自动付费重试。
- src/server/run-task.ts外110秒；src/app/api/v1/tasks/[id]/run/route.ts maxDuration120；src/server/config.ts gateway85秒；src/modules/ai/infrastructure/yibu-text-model.ts每调用signal合并、截断/超时语义。
- src/server/worker-composition.ts当前显式historyEnabled:false；公共配置和业务仅I可写。
- src/modules/world/infrastructure/build-repository.ts：ready来自opening；同seed复用、同command异hash冲突；安全phone保留initialRead/origin不输出persona/history局部key。
- src/modules/world/application/actor-context.ts：先来源/actor过滤，近期12/相关8，真实Profile不入；本包不扩长历史永久召回。
- src/features/phone/world-app-data.ts、src/features/phone/notification-projection.ts：flags映射与历史通知排除；仅后续只读QA，不重新搭手机外壳。
- src/contracts/world-build.ts：history可选仅legacy read，新写需runtime强制；当前schema actors最小2，普通parse另最小3。

## 本轮交付与接续

仅新报告及本人主行/镜像，业务能力无新增。没有运行npm check/build、任何测试、真实PostgreSQL、浏览器、供应商或生产部署；上述矩阵全部待执行，不用上批通过值冒充本批绿灯。无领域原型/内存Repository交付，JSON编号仅设计示例。

先给根/I审查门槛：显式角色编号与输入裁剪已由根采用，仍待源码；同T0/deadline/取消写边界、两步失败原子性与三模式协调待冻结核验。根可直接读主镜像转达，不回发跨线程消息。等待I冻结commit及根明确释放唯一新test与隔离PG/UI资源，之后短锁扩围并实际验证，不能因为报告完成标整个BOOT-01N-Q完成。第一阶段报告交付后保持任务进行中待依赖，生产仍4b593e2恢复版无模型前史，父BOOT五类完整前史/多聊天/地图/任务保持未完。

15个基线现有代码接点存在性检查通过。新history-planner与boot-01n-q.test仅候选不计入；静态定位中曾尝试旧错误路径domain/actor-context、domain/context、task-runner和components/phone，已用rg --files纠正，未运行或改文件。报告diff检查通过；纯文档不运行check/build。


## 第二阶段 · 稳定源码与真实PG

根正式释放后短锁确认第二阶段，接b265959→016e63e只读5文件，本人唯一新增tests/integration/boot-01n-q.test.ts和本报告。PG55458启动，HTTP3263/3264与一个新Ego待构建后启动，host boot01nq.localhost；本树check/build和忽略.local/boot01nq-*证据/guard/合成会话脚本、临时node_modules symlink均在登记内。业务/SQL/旧测试全未改，本人模型/生图0。

新专属测试最终6/6（1纯边界/跨午夜+PG父与4真实PG子组），真pl_app/pl_worker队列和Repository：普通同名演员按乱序显式编号绑定，授权person/branchRole，历史输入不含persona/internal relation/ties/notes/current/privateProfile；两阶段同signal/T0，2人固定cast；13种失败模式包含缺人/重复/额外role/角色冲突、TIMEOUT/TRUNCATED/UPSTREAM、阶段间和晚到原生abort、TimeoutError、task cancel、过期和错token，world/initial/bindings/messages/events/media/outbox零且opening null；legacy只1旧协议调用无新flags。真实receipt/replay/immutable、同命令/异seed冲突、两world/RLS、Profile/candidate不变也通过。不将6全称独立PG案例。

首类型检查仅本人fixture披露unknown不在schema enum，修为never。首PG6/6；后补实际genesis/formatChatTime跨午夜断言时T0使用带offset字符串触发领域isoInstant规范UTC拒绝，PG组仍通过但纯测试失败；只将测试anchor改2026-10-10T16:10:00.000Z（同UTC+08午夜00:10），重跑最终6/6。昨日23:10历史、当前昨日23:58/00:05真实函数通过。两次原失败日志保留，不改domain放宽入口。

npm run check550/550通过（并非550真PG），新专属PG不在常规test glob内，单独运行见pg-final.log；build进行中。通过真实两阶段fixture+队列新建UI世界951ad0fd-daec-4659-882e-bfe79a27041d，3actor/4past/3current，原clock暂停，fixture两次本地TextModel返回，不调用任何供应商。不冒称真实AI/公网。下一步实际双端读态/通知/历史/刷新，再独立test报告待验交I。


## 实际双端与第二阶段有限交付

本轮唯一Ego106/p1，实际产品3263+仅会话helper3264，boot01nq.localhost。独立新世界由两步fixture model经过真实Queue/Planner/Repository保存（2 fixture complete，本人供应商0/生图0）；server guard禁所有外部fetch、已有clock暂停，未使用他人105/browser cookie。正式生产worker仍旧门控不是本树本地函数模式。没有公网或真实AI验收。

实际390×844锁屏首次local pl_read=[]，仅小芳2/小李1当前来信；过去4不通知。390×500展开小芳，13:49/14:09分钟不同、local read仍[]；点击13:49通知定位小芳聊天、只清她2当前未读，小李1保留。鼠标真实滚至历史scrollTop0可见10月3日与昨天14:14来信，返回重开scrollTop0恢复；仅历史的小陈可打开9月10日消息。实际刷新API200且7消息对象全一致，历史ID/内容/flags稳定、仅小李1锁屏通知。PC1440×900手机宽420、左右510居中、无横向溢出；再点击小李通知定位正确，显示10月8日旧来信和14:02当前。人工查看history-390-500与refreshed-lock-1440-900截图，无截断正文/外壳溢出；短屏历史可滚动，不声称一屏展示全部。raw immutable initial经真实PG SELECT与创建时原全文比较一致。

根在进行中要求本包UI未变有限收尾，已遵守：未追加新UI事件、未重跑构建/全库或更多截图场景。浏览器新ID再次通知沿用BOOT-01M-Q的fd8c719及其new-message-lock/chat证据，不冒称本轮又跑；本轮专项PG真实两个turn及notification投影确证新ID通知、user消息不通知。既有完整折叠/桌面/横幅机制未重新全量验；本轮实际展开/滚动返回已经顺路核验。未来13项矩阵是候选计划，实际仅本报告明确的纯1+PG4子组/13失败模式及双端冒烟，不把所有矩阵都称执行完毕。

证据在本树忽略.local/boot01nq-evidence/：pg-first.log（首PG绿）、pg-cross-midnight-first.log（补UTC格式前纯失败）、pg-final.log（6/6）、typecheck-prepared.log（首夹具枚举失败）、check-final.log（550/550）、build-final.log（通过）；ui-fixture/ui-baseline/ui-final/ui-initial-hash.json与fixture.log。截图lock-390-844、lock-expanded-390-500、history-390-500、history-only-390-500、refreshed-lock-1440-900、history-b-1440-900.png。private会话token只在忽略0600文件，不在报告/安全证据。没有内存生产仓储或领域原型交付；新增的是接线/持久化验收测试，生成内容仍明确合成fixture。

根转告I已有本批7/10真实供应商（普通世界首遗漏place纠错计入3，固定cast2，NPC承接2），普通4NPC8过去+3当前、固定2NPC4过去+4当前及NPC承接成功、原initial hash不变；这是根/I证据，本人未执行，不替其确认READY。上批4真实失败完整保留，本批不是重置失败账本。最坏模型容量/语义因果、角色长期模糊召回与完整父BOOT五类前史仍不在本次QA成功保证内。

实际资源清理：Ego106 finish({keep:[]})一次完成；仅核对本人PID58234/59102/59110后SIGTERM，55458/3263/3264无监听；临时node_modules symlink已移除，独立树仅新测试和本报告待提交。Ego提示有更新，本轮未升级。修改仅tests/integration/boot-01n-q.test.ts与本报告/主镜像和本人主行，业务/SQL/旧测试只读。

下一位为现有唯一I：接收本次QA独立提交（勿重复接b265959业务源），把fixture证据和I真实模型分开；负责生产39迁移一致、明确生产two-step门控、READY部署和公网关键流程。本人主表仅待验收、资源释放，不再领取任务或发GitHub内容；根可读本报告镜像转达。未上线/未公网不能宣布完整交付或用户已验收。

## I受控最终有限集成验收

有限集成自审通过：业务7a98c8f/2wwrxj6mp/dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，QA独立test7e7fe79待随最终文档发布；550check/build、最后15串行专项全部通过（含F纯跨午夜/PG父组）。本批实际7/10文字请求=普通世界2+历史1、固定cast世界1+历史1、两NPC各1；普通4人物8旧/3当前，固定2人物4旧/4当前，NPC版本1/immutable hash不变。正式READY后health/两world均200，390短屏/长屏和1440电脑420宽无溢出，历史默认已读不通知，当前独立分钟/读态正确。旧M四失败不改为通过；本轮首遗漏地点纠正、脚本receipt误读只读恢复、语义样本限制保留。所有真实seed明确合成，不冒称AI推荐；真实模型执行为本机冻结planner+生产受限Queue/Repository，未额外付费测试HTTP /tasks/run。model gpt-4o-mini与旧自有正式task元信息一致、85秒gateway同实现；当前生产敏感env值由Vercel遮蔽，无法直接比较key/baseURL，不冒称已独立核验。两自有world已暂停/仍version1，7请求不变、0生图。I105会话精确恢复并finish一次、PG55450及HTTP3254/3255无监听（HTTP未启）、临时依赖链接清理；F106/55458/3263/3264清理。39生产迁移06:11:28Z校验一致、无SQL。仅有限NPC过去来信本包完成，父BOOT日历/便签/素材/长期召回/跨设备读态及任务地图多聊天仍未完成，用户A15待体验。

三个报告/主表/A15/DEPLOYMENT只作这一次最终文档归档，随后最终READY与正式读态写忽略handoff，不循环追加文档。不再新开任务。
