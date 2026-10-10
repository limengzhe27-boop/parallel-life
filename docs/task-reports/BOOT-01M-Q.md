# BOOT-01M-Q · 手机初始来信独立审查

阶段一审查已交，任务仍进行中；2026-10-10。Agent：codex-f-boot01mq-01a0c7c8-20261010。

独立工作树 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，分支 codex/boot-01m-q，冻结基线112bd87。已按主目录短锁领取，仅本报告及本人主表/报告镜像；业务、SQL、公共契约、phone、client和所有测试均只读。无数据库、HTTP、浏览器、构建或供应商资源占用。阶段二必须等I冻结契约并由根明确释放具体测试/QA范围。本报告供根读取转达，不自行跨线程回信。

已读AGENTS、PROJECT_BRIEF、主DEVELOPMENT、ARCHITECTURE_REVIEW、INITIAL_PHONE_LIFE_SPEC与主目录尚未入基线的PHONE_PREHISTORY_IMPLEMENTATION_PLAN。后两者是需求/方案，不是已实现能力。本轮只覆盖NPC过去来信、相对接管时刻、初始读态和当前通知；不实现父BOOT日历/便签/素材前史，不改变地点或时间制度，不虚构玩家历史发言。

## 结论与准确接点

现有immutable initial、Task Queue事务、own actor过滤可复用，但现协议无法同时满足“每位联系人有历史”和“新浏览器不全未读”。应先冻结有界历史提案、服务器一次解析的T0/ID及初始读态，再补查询和通知两条读取链。

|等级|冻结112bd87的证据与具体反例|本轮验收门槛|
|---|---|---|
|P1 覆盖缺失|src/contracts/world-build.ts:51 的messages仅1–4条；world-planner.ts的parseOpening只校验key存在，不要求每actor覆盖。现有tests/integration/world-build.test.ts:84合法夹具为3actor但只有a一条消息；b/c没有自己的过去，未选入现实人物也不会成为联系人。8联系人至多4条无法覆盖。|新增历史与当前来信的明确有界协议；每个应公开的新联系人至少一条合格过去来信，缺任一actor拒绝，不靠UI补模板。个人人生与固定cast试演两种propose路径都要检查。|
|P1 初始读态丢失|domain/types.ts:26 Message与WorldPhoneSchema没有初始已读/历史来源标记；world-app-data.ts:33和notification-projection.ts:22只看viewed。world-phone-app.tsx:466从pl_read本地集合初始化。新浏览器集合空，所有历史被当未读并产生通知。|历史默认已读来自权威基线；当前少量未读由明确条目标记。同一判定用于微信、角标与锁屏，消息列表仍显示已读历史。不能只初始化某一组件或把LocalStorage当服务端存档。|
|P1 时间和来源接线|build-handler.ts:33在模型返回后取现实当前time；:89将所有消息经openingMessageAt按索引倒推分钟。domain/opening-time.ts:4只有4个固定偏移，扩容不能代表过去几天。build-repository.ts:310返回消息时丢弃sourceEventId，world-app-data.ts:64再次只映射正文/时间。|T0一次确定，严格验证有限相对时间、角色引用及来源；解析后的at/稳定ID在成功基线固定。公开查询保留必要的安全历史/初始读态元信息，客户端不猜入库时间或genesis前缀。T0选择不新增用户调时间入口。|
|P1 公开联系人边界|player-projection.ts:29有有来源消息就引入发件者，未selected者relationship为空（:45），不公开persona。加入所有actor过去来信会使他们都公开，这是历史引入联系人而非授权公开后台资料。|每条历史必须确实是给主角可见的NPC来信。不能把NPC互相私聊塞入同一messages。每个公开actor可见但persona、内部actorTies、未公开关系和完整现实档案仍不返回。|
|P2 自己的过去召回|actor-context.ts:64先按actorId和blockedSources过滤，这是正确隔离；:70仅保最近12条，:138更早消息必须query相关才入。a旧来信“场地保留到周五”，之后超过12条闲聊，问“之前那件事后来怎样了”未必命中，不能因旧史已显示就承诺NPC一定记得。|用自己的初始来信验证实际context输入；a能承接自己的信息，b即便actorTies认识a也不能看到a私聊。长历史要覆盖模糊回问及预算，若不保证召回明确限定；不必额外模型摘要或把NPC说法写成共享canonical事实。|
|P2 legacy/replay|postgres-world-repository.ts:163仅对旧2–4条全同刻genesis做展示兼容，world-history.ts:80直接clone初始原时间。旧世界hydrate与原始replay可能在展示时间上不同；新明确时刻不应再次自动重排。|旧基线及旧read集合不补写、不重生。新版本有明确格式识别；GET/历史回执/replay保留新时间和ID，当前结果与同版本重放按同一规范比较，别用legacy时间修正覆盖新来源。|
|P2 来源与记忆|memory-store.ts:369的公开记忆谓词对普通world_event/user_statement做真实world_messages/world_events join，genesis只在initial、不是world_events行。不能把genesis字符串冒作真实回合来源。|首版自己的历史直接经actor-context读取即可；若I选择新增记忆必须先显式合法来源，原公开记忆/遗忘边界不放宽。Profile、suggested候选和另角色私有记忆不能改。|

以上是源码静态确认的缺口与风险，尚未复现新实现。它们不是宣称生产出现全部反例，也不是要求本轮扩大父BOOT范围。

## 事务和租约应保留的底座

build-handler.ts在queue.commit中同事务写world、人物绑定、world_initial_snapshots、opening与任务结果；build-repository.ts:45按账号锁去重命令/seed。postgres-task-queue.ts:79校验running、token、lease_until并锁任务，:87 finish失败会ROLLBACK；run-worker.ts:63对timeout/abort等标unknown，不自动重新付费。新历史、T0及初始读态必须同事务落入同一基线，不另在ready后补写。

现tests/integration/world-build.test.ts已有取消生成后不能提交、跨owner隔离、snapshot/seed；tests/integration/tasks.test.ts:46已有错误token、cancel、过期lease→unknown、不自动重claim。它们是既有测试源码，本轮没有运行，不能替新BOOT证明历史/读态原子性。

## 第二阶段可执行正反例（尚未运行）

先建议只释放一个新tests/integration/boot-01m-q.test.ts及本报告；I既有测试文件本人仍只读。字段以I冻结契约为准，以下描述语义，不另起接口。使用本人PG55458与受限pl_app/pl_worker；启动前重新登记资源和确认无监听。界面若需本人HTTP3263/3264及一个新Ego空间，必须先精确扩围登记；不复用他人session/cookie。本人供应商请求/生图均为0。

|场景|真实操作和可检验结果|
|---|---|
|1 完整正例|3个合成actor各一条过去来信（T0前7天/1天/120分钟；符合候选下限60分钟）、少量当前未读；使用fixture TextModel经真实WorldPlanner→buildHandler→Task Queue保存。固定cast试演也各有历史。查询每actor历史非空、role仅assistant、ID不重复，取snapshot核对时刻及读态；这是真PG配合夹具模型，非真实AI。|
|2 格式/覆盖拒绝|分别输入缺b历史、未知actorKey、重复历史key、非整数/非有限或越界相对时间、未来冒作旧来信、player发件者/role、未授权来源。要求运行时拒绝；不靠未知字段strip后继续成功。纠错次数仅夹具计数，不调用供应商。|
|3 原子失败|正常提案后在commit前cancel或用测试admin令lease过期，再正常返回；还测错误token。tasks不得succeeded，world/initial/bindings/opening及新历史附属数据均无半套。不能只断言ready=false。|
|4 重复和读回|同command同seed返回同world/task；异seed同command冲突；同seed不同command复用已存在world。成功后重复GET/hash/reentry和只读replay不新增历史、不新claim、模型夹具调用不增长；immutable initial全文不变。|
|5 来源/知情隔离|a历史含“场地周五截止”，b不知。真实Repository读state后actorContext(a)含自己的来源，actorContext(b)不含a私聊，即便两人有tie；blocked message/source不得再进入context。初始有限历史检查自己的来信完整进入实际context，不拿模型一句答复冒称来源过滤正确。追加13+闲聊后的模糊召回列为后续已知限制，依根最新要求不作为本包必修门槛。|
|6 旧版本与RLS|旧opening无新增字段、旧同刻基线及现有用户消息读回正常；新history后提交一次真实玩家turn，检查旧receipt仅含该版本已提交消息，后续消息未混入。other owner拒绝；同owner另world不混来源/ID/read态；现实profile及候选前后不变。|
|7 真实UI读态/通知|新专属合成会话无旧pl_read：已读历史可看但不推通知；少量当前未读的角标/微信/锁屏数量和target一致。展开通知不标读，打开实际会话才读，返回/滚动恢复；同联系人新消息新ID再次通知。清pl_read仅影响本人合成cookie来源且需授权限定；优先创建本轮新world避免清全站存储。|
|8 时间与双端|I确定的同一T0周围跨午夜合成时间，列表按stored at排序，锁屏/对话相对同一referenceTime显示；390×500/844与PC居中窄幅，打开通知定位正确。本包T0沿用现故事时刻，不新增1998年代选择或用户自由改时间制度；古早年代仅父方案远期场景，不作为本包发布门槛。|

待授权的真实PG执行入口：node --experimental-strip-types --test --test-concurrency=1 tests/integration/boot-01m-q.test.ts。这是待写新文件的执行计划，当前不存在/未运行。联合npm run check和npm run build在接I稳定源码且树依赖可用后执行；本阶段不为纯报告启动构建或数据库。生产迁移、I最多2真实文本供应商请求（含纠错）、READY及公网由唯一I安排，不自动代领额度。

## 已做、证据与接续

修改文件仅本报告和主表本人行/本报告主镜像。已完成基线及需求核对、静态缺口/准确接点、可执行数据库/UI负例设计；实际来源证据来自112bd87文件及行号。源码路径存在性和diff检查将随报告提交核对。没有实现新能力、没有运行npm check/build/PG/真实模型/浏览器；没有领域原型或内存Repository交付，正文样例仅测试计划。

阶段一报告供根/I复核；主任务仍进行中，等待I消息协议/T0/初始读态/legacy/安全查询字段冻结以及根对专属新测试和资源的明确扩围，再登记第二阶段。尚无本批上线版本，112bd87仅是上一朋友照片批READY基线；完整BOOT父与日历/便签/素材前史仍未完成。

报告引用的19项现有源码/测试路径逐项存在性检查通过；计划新增boot-01m-q.test.ts不计入。报告diff检查通过。个别只读搜索曾使用不存在的task-queue.test.ts/turn-handler.ts及不匹配shell通配符，随后按rg --files定位实际tasks.test.ts/run-worker.ts；未执行测试或修改源。

## 候选协议复核（根转达后，仍只读）

已读主镜像BOOT-01M-I的messageHistory v1语义。每actor1..6/总48、60..43200整数分钟、全局唯一局部key、同actor更早replyToKey、服务器分配ID与读态、同一T0/immutable initial、公开仅安全标记，方向可采纳；未发现必须重开存储架构或扩大父BOOT的协议冲突。目前主基线112bd87无genesis-messages.ts及新增字段，报告仍是候选，不将其当已实现/已冻结。

|可直接复用的原负例|按候选精确化（待运行）|
|---|---|
|覆盖/容量|缺任一actor、未知actorKey、同actor第7条/总第49条、重复局部key、同actor同分钟拒绝；正例按最小每actor1条及8actor×6条边界核验。|
|时刻|60和43200分钟端点接受；59、43201、0、负数、分数、字符串拒绝；JSON不能传NaN/Infinity，纯入口才测试非有限。不同actor同分钟应允许；同actor重复分钟拒绝。原30分钟正例已纠正成120分钟。|
|引用|未知key、跨actor、当前消息key、自引用、循环及同刻引用拒绝。minutesBeforeStart越大表示越早：a_new=120回复a_old=1440合法，反向引用非法。数组先后不应被误认为时间先后；若要求输入排序必须明确，稳定后测试依冻结约定。|
|玩家边界/权限|历史子对象额外role=user、player、绝对日期、assetId/任意事实/initialRead等均拒绝；runtime过去true/当前false，不允许模型修改。a自己的历史可入a上下文，b/现实Profile/suggested不入；所有actor公开仅因其发给主角的历史，不公开persona或内部ties。|
|原子性/兼容/通知|cancel/过期token和租约、重复/异内容同command、不可变hash/replay/旧receipt、跨owner/world、新浏览器历史无通知而当前1..4通知、展开不读/进入定位才读/新ID再次通知均直接复用。|

冻结前必须落实的接线条件（风险，不是已复现新实现缺陷）：

1. **历史可选仅用于旧读取，新创建两个planner入口与build写边界必须要求存在并再次核验。** 固定cast试演的pick/strict模型响应和两路纠错提示都要更新，不能一边要求history、一边在旧纠错中禁止该字段。缺history的旧输出不能成功新建。
2. **历史key和回复映射只能在完整校验后解析。** replyToKey对应同actor且严格更早的服务器message ID；Map或等价安全索引不能因输出数组乱序漏校验。at由一次T0减分钟，按at稳定排序；T0、metadata.startAt与当前消息均一致，当前秒偏移保持原1..4的先后次序，不复用旧分钟offset把过去历史压成开场消息。
3. **元信息必须穿过所有实际读取路径。** BuildRepository.phone、安全WorldPhoneSchema、worldAppData和通知函数同时承接initialRead及历史标记；state compact/hydrate、命令receipt和replay保持metadata/消息元信息。不仅纯helper证明排除历史，真实GET后新浏览器也应排除。旧字段缺失继续旧读态，不批量设成已读或补写。
4. **历史读态和当前未读是同一基线的原子结果。** 不能ready后补flag；过去true是虚构手机的初始读态，不冒称真实玩家已打开历史或持久跨设备回执。后续local markRead沿用现行为；不引入第二套Repository或额外记忆来源写入。

本批明确限制：初始每actor最多6过去+原最多4当前，在现近期12预算内可先测承接；后续长史模糊问句不保证永久召回，保持近期12/相关8，不扩actor-context包。timeZone候选Asia/Shanghai在本批现时刻范围与现display-time固定UTC+08一致；历史DST/任意年代不在本包，不悄改展示时钟。最坏48×160字与现8192输出上限不能仅据schema宣称模型必定产出，真实调用仍由I全批最多2请求含纠错证明，截断/unknown如实记录不自动重付。

本轮仅更新本报告和本人行，未写测试/源、未运行check/build/PG/UI/供应商。根明确预期后续独占new tests/integration/boot-01m-q.test.ts；只有稳定契约提交和根正式释放到位才登记第二阶段，I该文件保持只读。

## 第二阶段领取与冻结纯校验实证

根已明确释放唯一新增tests/integration/boot-01m-q.test.ts和必要真实HTTP/双端只读QA；已短锁扩围本人PG55458、必要HTTP3263/3264、boot01mq.localhost和一个新Ego（实际创建后补ID），忽略.local/boot01mq-*脚本/证据及本树临时依赖链接。接ddeb6e7→d91910d仅4文件；其他源/已有测试只读。先准备测试，完整PG/UI等I下一稳定业务提交根转达，不将旧接线缺失当新回归。

**实质纯runtime漏洞（交根转I修，执行者不改源）：** ddeb6e7的src/modules/world/domain/genesis-messages.ts validateMessageHistory用keyPattern.test(entry.key)但未检查typeof key。缺key时JS将undefined转成字符串undefined，恰好符合正则。直接node导入冻结函数、history={version:1,messages:[{actorKey:a,text:此前约定仍有效,minutesBeforeStart:120}]}：MessageHistorySchema拒绝=true，validateMessageHistory拒绝=false，genesisMessages成功生成history.key缺失。数字key=123也可能被正则接受。需要写边界同时要求key/replyToKey为真正字符串，不能只相信上游schema；本轮新增测试将覆盖。此证据仅纯runtime，不是PG/模型/线上成功。

冻结4文件中的genesis-messages.test.ts初始通知用例依赖notification-projection的initialRead过滤，而该caller改动尚不在ddeb6e7提交；不在当前半接线树运行并将失败称回归，也不把I工作树绿灯说成4文件独立提交全部已绿。等待完整业务冻结后一次必要全集验证。

专属新boot-01m-q.test.ts已准备（仅该文件可写）：一个独立纯写边界key回归+一个真实PG父测试下4组子场景，覆盖两planner、通过安全phone读的全部联系人/初始flags、真实回执/replay/immutable/RLS、8个拒绝/取消/过期/错误token/绕过planner parse负例no halfworld以及legacy。首typecheck因作者fixture字面量未parse与assert.rejects谓词类型失败，两处仅本人测试已修后typecheck通过。按根最新要求加入两条当前来信在formatChatTime分钟显示不同的断言，等待I最终协议；不坚持候选秒偏移。
仅跑新测试中纯key回归，实际red为Missing expected exception，符合已报告冻结缺key漏洞；log=忽略.local/boot01mq-evidence/key-rejection-red.log。真实PG父测试尚未跑，不能以此red称旧业务最终回归。一次未升级权限的忽略证据目录写被sandbox拒绝，未运行该测试，之后作用于本人范围的escalated写成功。55458无监听后启动独立PG用于后续稳定接线验收。

## 稳定接线真实PG与联合检查

已只读接I56be119→f0f94e0、分钟修复8b46909→7af7faa、PG测试f350461→baecbb7。缺key纯回归现转绿。本人PG55458专属boot-01m-q.test.ts最终6/6通过（含1纯校验、PG父和4有意义PG子组；不将6都冒称独立PG场景）。实际两planner写入/phone全联系人与initialRead、unordered同角色reply ID映射、可见分钟不同、自己context与隔离、snapshot/hash/receipt/replay、同命令与异内容/两世界、8失败路径no halfworld及legacy均通过；真实pl_app/pl_worker，夹具模型无供应商。旧库正例仍保持原read语义。

首真实PG为4pass/2fail（包含父级）：仅legacy显式旧夹具用pl_app UPDATE world_builds被42501正确拒绝；修本人测试为admin仅准备该自有旧夹具，实际读取仍受限pl_app，不放宽生产权限。原pg-first-stable.log保留，最终pg-final.log记录6通过。replay仅规范化既有notes缺失/空数组默认，未删历史/时间/来源；immutable initial另作原始全文hash比较。

一次最终npm run check537/537和npm run build通过，check仍不是537条真实PG；新专属PG不在npm test glob内，单独证据见上。本人开发库真实队列另创建3演员/4历史/3当前的显式合成UI世界，初始flags正确，暂停现有时钟防自动付费推进；private会话token仅忽略600文件。HTTP3263产品最终构建+3264仅合成会话helper启动，0供应商/生图，实际浏览器下一步。


## 实际浏览器验收及有限交付（2026-10-10）

Ego专属103/p1已完成并finish({keep:[]})一次关闭。真正产品HTTP3263，3264只写本人合成会话cookie；3角色/4过去/3当前由真实队列与Repository创建，不是浏览器假回复或内存Repository。锁屏初始pl_read为[]，仅小芳2/小李1当前消息显示，历史不通知。展开小芳通知后pl_read仍[]，13:02/13:22区分分钟；打开具体通知进入小芳聊天并仅清小芳两条当前未读，小李1保留。实际鼠标滚至历史scrollTop=0，返回再打开恢复0；纯历史联系人小陈可见9月10日过去来信，没有当前未读。刷新后历史4条ID/正文/读标记未变、仅小李通知，API200真实读取7条。

通过现有WorldRepository.commit/reducer写入明确合成director来信（没有模型调用），版本变为1，新message ID fe138bc4-7573-41f8-82cb-b2e69efafb98。实际刷新锁屏再次显示小芳新来信和小李旧未读共2；打开新通知定位小芳，再短屏打开小李定位正确。新来信前后raw immutable initial全文一致，经真实PG SELECT核验，不用UI文本代替持久化证据。

390×500、390×844和1440×900实际浏览器截图及API安全证据保存在本树忽略.local/boot01mq-evidence/。390短屏无横向溢出，通知展开区可滚动；PC手机宽420、左右510居中，页面scrollWidth=1440。人工查看lock-expanded-390-500和new-message-chat-1440-900截图。短屏展开超过可视区正常由内部滚动承接，不声称全部消息同时显示。未做公网验收、未做新世界真实AI、未做年代选择/长史模糊召回/跨设备已读或历史日历便签。

截图：lock-390-844.png、lock-expanded-390-500.png、history-390-500.png、history-only-390-500.png、new-message-lock-390-844.png、new-message-lock-1440-900.png、new-message-chat-1440-900.png、history-b-390-500.png。证据JSON：ui-fixture、ui-baseline、ui-final、appended-message、ui-initial-hash；没有token。初次wait微信因手机默认锁屏而超时如实保留，改为观察实际锁屏再执行，没有重建空间或改业务源。

根最新告知：I真实供应商首2请求失败（主角混入演员/覆盖缺失，纠错后演员缺persona/relationship），没有半世界，后续最多再2请求，全批累计4；这是根/I证据，不是本人执行。本人的供应商请求0、生图0。自己的fixture PG/UI绿灯不能证明真实模型或线上成功，也没有接管I修prompt或部署。

交付文件仅新增tests/integration/boot-01m-q.test.ts和本报告；主表本人状态/报告主镜像按短锁更新。新测试含纯runtime缺key反例和4真实PG子组；npm check537/537、build通过，新PG入口单独6/6（纯+父+4组）。这批是接线验收，不是仅领域原型，但生成内容为显式夹具，模型质量仍未验。执行范围没有生产源码/契约/SQL修改。

下一位为唯一I：仅接收本次QA测试/报告（不要重复接已集成业务提交），保留首次失败证据；负责完整prompt修后有限真实模型复验、生产39迁移确认、READY部署、公网关键路径及统一主表完成。本人仅标待验收，父BOOT完整手机前史仍未完成。Ego提示可升级，本轮未升级。资源将在提交前核对PID后只停止本人3263/3264/55458，归还临时依赖链接；不继续领取其他任务。

收尾实际核对本人PID51395/52380/52388后SIGTERM，55458/3263/3264已无监听；本树node_modules仅为symlink，已移除。103已关闭，资源归还。一次普通ps被sandbox拒绝，随后仅作用本人PID的escalated核对/清理成功，无自动审批拒绝。最终独立提交只含本人新测试与报告，状态待验收。

I集成收尾：新增test受控接收a37012c，最后双方真实PG12/12、540check/build通过；实际模型4/4失败，生产门控关闭，新前史整体待验，F夹具UI不冒称模型成功。

最终业务49916dd / 7z1iq8t5b / dpl_FtwM1auuuYvGNupsMQVkW45psyBP READY；正式health200、既有世界200、390手机/1440电脑420宽无溢出，失败入口明确保留设定/手动重新准备且预算仍4。两个专属生产失败task均failed/readyfalse/world0/initial0。I Ego104原pl_session精确恢复并一次finish、PG55450与HTTP3254/3255无监听，工作树临时node_modules链接移除；F103/55458/3263/3264已释放。整体新建前史4/4模型失败、生产关闭、待验收，恢复路径未新增真实模型成功证据。
