# BOOT-01R-Q · 时间编排与前史来源独立审查

## 第二阶段交付 · 待验收（2026-10-10，优先于下方第一阶段历史记录）

根已正式释放冻结源码1ae2b84、3c5bb7a和独立验收范围。已接入为ea526ab、42e1288；第一笔因旧工作树缺P最终prompt产生两处冲突，仅从1ae2b84原样取history-planner.ts/world-planner.ts，未手写业务变更。四个目标业务文件与3c5bb7a逐字diff为空。仅新增两份已登记测试；旧P测试及公共契约仍只读、I唯一适配。本人独立验收已交付，整体待验收，未上线、未真实模型验收。

- 新`tests/history-invitations-q.test.ts`：5/5，字面跨午夜/跨年/闰日/世纪、P8原失败、年份、NFKC/Cf/Cc、时段有限门、cast/严格union/容量/重复、0及record-only/legacy、known固定槽纠错与unknown/abort；不同body同slot保独立提案。诗意“太阳从地平线升起”仍可能通过晚间槽，明确只证明有限字面拒绝，非全面语义理解。
- 新`tests/integration/boot-01r-q.test.ts`：实际PG55458独占test库5/5（父+4子组），真实Queue/Build/World/Profile/Assets/Records/RLS。两个同名人物、同actor同slot不同body的两个来源不合并；初始已读/当前未读、proposed、角色私聊与素材隔离、Profile不变、私有DTO不持久；accept→改期→取消和0..3版本重放、原command回执、immutable不变；真实上传像素读取/修订权限与0/N；坏槽/正文、lease过期、素材权限竞态world/initial/bindings/messages/events/outbox均0。
- 首轮PG及typecheck失败是本人新测试把PhoneDocument的id误写为worldId（NOT_FOUND、TS2339），仅改本人新测试后5/5和575check通过；保留首失败日志，不修改业务或旧assertions。
- `npm run check` 575/575、独立`npm run build`通过、新两测试format通过。证据为忽略`.local/boot01rq-evidence/`的pure-first、pg-first/pg-fixed、check-first/check-fixed、build、format日志。
- R专属UI fixture已用真实dev库Queue保存、暂停时钟：3actor、4历史/3当前、1next_morning邀约、1真实上传合成像素；两次complete是明确合成fixture，供应商/图片/生产请求均0。HTTP3263/3264及唯一Ego110/p1已登记实际验证。

独立提交1050c59仅两新测试及本人报告。真实HTTP/UI：390×844/500及1440×1000，PC手机宽420、无横向溢出；Ego110/p1实际日历待回复、旧来信原发送日、备忘录无editable、授权照片240×320原上传日期和来源回跳通过。UI接受保存无错误；真实HTTP原command200/v1confirmed、stale409、改期200/v2、取消200/v3，latest3后重放原command仍200/v1confirmed，phone/records200、messages及initial真PG不变、命令恰3。刷新解锁恢复同一calendar记录及已取消日期。HTTP辅助初次多传worldId422、只读DB辅助误表/脚本引号与两个browser定位等待失败均为本人辅助脚本问题，修正后通过，未改生产源码。截图已实看mobile-proposed/mobile-source-record/mobile-original-photo/mobile-short-confirmed/pc-confirmed，日志及http-results/final-db保存在忽略boot01rq-evidence。供应商/生图/生产请求0，模型与像素均明确合成，不算AI/公网成功。

接续给唯一I：仅收1050c59的两新test（不要把旧树祖先/报告一起合并）及本报告后续最终提交；旧P DTO仍I唯一适配。I完成联合真实生成/NPC承接、生产迁移/门控/READY/公网，才能标已完成。有限字面时段拒绝不保证全语义，source照片是授权带入原图，不代表拍摄/共同经历。本人R资源已按根新指派PHONE-TIME-REMOVE-01复用同一55458/3263/3264/boot01rq.localhost/Ego110完成验收并统一清理；未加模型预算/第三空间，未自行部署。


2026-10-10；Agent `codex-f-boot01r-q-01a0c7c8-20261010`，会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。已在主DEVELOPMENT短锁确认根指定任务，独立 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，新分支 `codex/boot-01r-q` 从本人59c95bf仅承载新报告，原P分支和提交保留。审查源码以只读 `git show a2dd72c:path` 为准，不把旧工作树副本当主表/最新源。本阶段只写本新报告、主表本人行和主报告镜像；公共源码、契约、所有旧测试、其他报告只读。供应商/生图/生产/PG/HTTP/check/build/browser均0，没有新测试执行，也没有自行部署。

已读AGENTS、PROJECT_BRIEF、主DEVELOPMENT、ARCHITECTURE_REVIEW、ARCHITECTURE相关分层/来源/任务部分、DEPLOYMENT最新P条目、根R协调报告、P-I最终失败与上线记录、P-Q交接，以及a2dd72c的HistoryPlanner、genesis-messages、genesis-links、world-build契约、WorldPlanner和build-handler接点。根最新方向是仅改模型私有response规范化、显式invitations数组与有限slot，不改持久version1/严格date guard；以下为审查建议，具体契约仍由I/根冻结。

## 当前事实与必须保留的失败

P交付为兼容修复：业务d59fe3f、记录a2dd72c，I报告Production laid82hg9 READY、正式域名已切换；旧N两步来信保留，historyLinksEnabled=false。本人本轮只读该证据，没有重新请求公网或宣称独立复跑。上批模型预算8/8耗尽，不能借余额；没有真实新关联正例或本批NPC承接通过。

已只读定位并抽取 `.local/boot01p-real-output-8.json` 中实际connection：actorIndex0、minutesBeforeStart2880、quote“咱们干脆周末一起去爬山吧”、calendar.minutesAfterStart2880。恢复T0=2026-10-10T08:18:15.303Z，故事UTC+08是周六16:18；source是10月8日周四16:18，活动+2880是10月12日周一16:18。若“周末”从旧来信周四理解，通常指随后周六/周日；从T0周六理解也不能直接确定周一。这既不是可无损补一段日期的正例，也不能当作允许任意周末语义后就成功。原raw guard仍应拒绝，原task failed/world及initial0事实保持；不复用这个输出生成真成功。

实际guard在genesis-links.ts要求quote恰好一个M月D日HH:mm，四个数字匹配T0+minutesAfterStart的UTC+08，不解析自由“周末”。它不验证quote以外正文的第二个时间，也不验证额外年份/自由相对词/人物秘密。genesis-messages另验quote是同一text子串、全cast覆盖、每人1..6、过去分钟60..43200且同人不重复；未来calendar30..10080。createGenesisLinks和verifiedGenesisLinks核验同world/actor/message、source genesis、future proposed，无玩家回应。不能修改这些约束来追认P坏样本。

## 初稿方案比较：独立邀约提案（已被本页末段冻结变体替代）

建议链接模式的模型私有JSON用 `{groups:[...], invitations:[]}`：invitations字段必须显式存在，0..2；groups仍每个actorIndex恰好一次，普通旧来信规则保留。每条邀约仅 `{actorIndex, slotId, activity}`，activity是自然、具体、不带日期的活动短句。禁止模型在此返回quote、UUID、分钟、绝对日期、reply/accepted、其他参与人、人物资料、asset/revision。关闭链接的N模式继续旧groups规范，不要求新字段。上述名字和长度上限是建议，不能当已冻结公共契约。

运行时给最多两个slot，保存在本次调用的确定表中，由同一冻结T0产生；例如s1活动+1440分钟、s2活动+2880分钟。每项同时确定邀请来信的过去发送偏移，均60..43200，且slot之间不同；不要让模型对邀约发送时刻再做一次日期算术。模型只接slotId和可读完整故事日期/时间、必要公开人物信息，不接私人persona、开场notes、其他私聊或访谈。slotId不是“明天”“周末”，不能靠名字推时间；活动和发送都用故事UTC+08，不用系统本地时区/真实Date.now重算。

新邀约是**新增独立的已声明提案来信**：保留原groups普通来信，不在已有任意正文里附一个日期，不覆盖/删改旧消息后掩盖冲突。比如模型activity“去附近的步道走走”，runtime渲染“2027年1月1日18:30，去附近的步道走走，你有空吗？”，得到一个确定text及其中同一段quote、对应minutesBeforeStart/connection.calendar.minutesAfterStart，再交给既有MessageHistoryProposal校验。时间和问句外框是运行时渲染，具体活动是模型提案，不能声称整句未经处理的原始模型输出或预设故事回复。空activity、寒暄或不具体内容不能靠外框凑成有效邀约。

由runtime生成key（普通past_*和邀约独立命名空间）、绑定已有cast actorKey，最终仍保存现有version1 history/genesisLinks/immutable messages和appointments，不存新slotId字段进公共世界/照片/回执，不新增世界事件version0伪装正事件。public records和phone继续读已保存同一message/appointment来源。渲染结果必须通过现有strict guard及长度/容量校验；不能截断使活动丢失，也不能静默丢坏提案、删普通来信来腾位置。邀约加入后该actor总条数仍≤6、全世界≤48，connection≤2；同actor发送分钟冲突须明确拒绝并走已有known纠错，或者由冻结的确定分配算法在调用前提供不冲突发送槽，不能读取时调整历史时间。最小实现可将邀约发送偏移列为保留分钟，让groups避开；这会有模型遵从失败，需实测，不可隐瞒。

若I倾向让invitations引用既有messageIndex，必须先把被引用消息的形状定义成专门邀约内容（不得带另一段自由日期）；不能在普通letter上追加/替换正文后算源quote原文验证已成功。相比额外messageIndex、组乱序、覆盖/长度和旧message残留问题，新增独立提案来信更简单，来源由模型明确选择的actor+activity和runtime槽共同组成。旧原始消息不再是新来信的被引用证据，不得宣称新邀约是从某条无日期聊天“抽取出来”的事实。

### 自由文案的限制与不能承诺的部分

仅活动短句中拒绝时间表达：周末/明天/后天/今天/昨天/下周/周几/月底/节假日、月日/年份/钟点/ISO/数字日期、多个时间/范围、时间标记伪造或占位符残留。无需扫描并改写旧N已保存来信；普通groups没有calendar的自然旧消息不能凭命中“周末”自动转日程，也不因新规则被读时拒绝。明确已授权种子若要求周末才可开展活动，而给的槽全部在工作日，应0或选择合法周末槽；不能让模型用不含“周末”的文案抹去种子的约束。首包不宜宣称支持任意自然日期解析。

这不是“正则即可理解全部时间”。“早餐”“日出”“午休”“下班后”“春游”“晨跑”“过完年”等可能隐含时间；有的活动自身就带时段含义，不应被简单词表改写成任意槽。例如23:30槽+“去吃早餐”结构可过、语义不可信。需采用有限活动限制/适配约束或真实样本审阅，明确词表能覆盖的反例与剩余语义风险；不能声称全文无相对词即完全因果正确。活动带“你已经答应/上次你选了/已订好/到时小李会把秘密告诉我们”同样可能违反玩家行动和知情边界，日期renderer不能解决。运行时保证的是proposed/单sender/不写Profile和facts；内容性质仍需现有角色规则、拒绝明确违规样本及真实语义验收，不让模型结论升级为用户事实。

### 与严格占位符方案比较

|方案|确定性与复杂性|审查结论|
|---|---|---|
|独立invitations+slotId+activity|runtime只组合已选slot与具体活动，新来信整体唯一日期；普通groups完整保留，需处理总数/保留发送分钟|优先；不改持久schema/guard，范围最小且边界能测|
|正文一个严格{{TIME}}标记并独立slotId|还需验标记恰好一次、在text和quote中位置一致、转义/空白/嵌套/多slot、渲染前后长度和原片段映射；模型仍可能在标记外写周末|仅当确需自由句式才用；少一个渲染模板，增加两套字符串语法和验证路径|
|无标记自由正文自动猜日期或补尾句|原文字相对sentAt而补日期相对T0，语义可冲突；quote通过不代表全文一致，甚至会覆盖原P失败|拒绝；不能fallback到默认槽或悄悄删相对词|

## 待冻结后执行的精确反例

以下均为**拟执行**，本阶段不建测试、不运行DB/模型；时间以固定UTC+08解释，runtime offset以瞬间分钟算。纯规则反例与真实SQL/HTTP必须分开记证据。

|ID|输入或操作|必须满足|
|---|---|---|
|R01 原P8不可追认|保原周末quote、send2880/future2880、T0周六2026-10-10 16:18；原private groups缺新invitations|旧guard仍INVALID_GENESIS_LINKS，新linked私有格式不识别缺字段/旧connection；不能默认slot或伪造已上线成功|
|R02 槽身份|slotId未知/空/number/大小写变体/前后空白；模型自行传at/minutes/role/participants/asset；本调用以外的slot对象|严格拒绝；只查本调用固定表，不按id尾号/label/模糊词匹配，不接受模型传回的时间表覆盖服务器表|
|R03 显式零与漏选|完整groups+invitations[]；缺invitations/null；有activity无slot/有slot无activity；场景确无适合活动|[]合法且不造records/calendar；漏字段拒绝；不对所有世界要求至少1，不把“缺slot”降成0骗成功|
|R04 日期在正文|activity“周末一起爬山”“明天18点吃饭”“下周一跑步”“10/12 16:18见”“2025年10月12日16:18见”或含第二个日期；候选s2实际周一|新邀约拒绝相对/另一绝对日期，不删除这些词替换；不能仅检查渲染后的quote有正确数字；原普通不关联旧来信依N规则保留|
|R05 两个锚点|T0=2026-12-31T15:30Z（本地12月31日23:30），source=T0-1440（本地12月30日23:30），s1=T0+1440（2027年1月1日23:30）|消息发送日、活动日及T0分清；不能把“明天”从12月30误解释成1月1；邀请生成正文只用slot明确绝对日期，snapshot source.at不变|
|R06 午夜/跨年|T0=2026-12-31T15:59:30.123Z（本地23:59:30.123）；+1440及+2880；并测UTC日期与本地日期不同|本地2027年1月1日、2日23:59，年份/分钟正确，无Date.now/宿主时区影响；保秒/毫秒与整数offset，不能floor T0后产生非整数差导致guard失败|
|R07 闰日/非闰年|T0=2028-02-28T15:30Z和2027-02-28T15:30Z，slot+1440/+2880|分别2028年2月29日/3月1日与2027年3月1日/2日23:30；不拼非法2月29日，不把月份/闰年交模型计算|
|R08 唯一渲染/quote|空白/超长activity，渲染后quote>80/text>160，模型传额外quote、重复标记/多个slot；规范化后人为改quote/text/offset任一|拒绝越界和原文不对应；不截断、不靠partial match、多日期正例不能通；现strict日期guard仍执行，quote对应同一生成消息，不拿他人消息子串|
|R09 同人多来源/满员|两邀约同actor同slot；同actor不同slot；两actor同名且同slot；普通group已6条再加1；groups漏actor/越界/重复/乱序；普通消息撞保留发送分钟|重复actor+slot拒绝，允许不同来源时各稳定独立key/message/record；不按名字合并或把不同NPC邀请合成群体已约好；超过6不能删旧条补邀约；乱序正常、全cast/分钟旧校验不退化|
|R10 知情/秘密|a邀约b私聊内容/其他participant；活动宣称玩家已同意/过去行动；私人persona/notes/未确认现实事实哨兵；屏蔽sourceMessage或genesisEvent|未知字段及明确违规内容不通过；prompt无内部输入，公共phone/records无私人哨兵；state.facts/Profile/Memory不新增，b不见a私聊/邀约；blocked源过滤继续生效。未写出的泛化语义检测不能冒称已实现|
|R11 未读与proposed|0/1/2邀约+若干普通历史+1..4当前开场，刷新越过活动时刻但未回应|新增邀约来信initialRead=true、过去at，当前仍initialRead=false与原分钟分配；不增加玩家历史气泡，calendar仅future proposed，不因消息已读/经过时间变confirmed/attended|
|R12 原子/unknown|阶段2收到坏slot/坏活动；transport unknown/截断/取消；known第二次仍坏；queue错token/过期lease/提交前素材权限变化|不自动第三次请求、不重新付费世界阶段；world/immutable/bindings/messages/calendar/events/records和image outbox无半套；failed与unknown区别记录、重试显式；归一化无额外模型调用|
|R13 receipt/恢复|新slot日程accept→reschedule→cancel、旧accept同command、各版本重放、同owner第二world|仍一个id按版本演进；旧v1仍confirmed，latest v3 cancelled；origin/消息/初始hash/上传日期不变，不读取时再次渲染/分配slot，不自动回填旧世界|
|R14 legacy/禁用|旧N无connection、P合法fixture已有connection、P第8失败raw、linked false但模型主动输出invitations|N和已存P照原快照读，不要求私有新数组、不改原text；P既有严格反例保持；关闭链接拒绝新提案且生产门控不被模型输出自行打开|
|R15 活动与时段|晚间槽+早餐/日出、工作日槽+显式周末限定种子、activity“随时都行/我们之前已经...”|记录结构与语义两层；不能凭slot合法给内容质量绿灯。需明确定义有限拒绝范围，合适槽不足时0或known失败；不改活动词骗过约束|

## 最小验收门槛及新测试候选

1. I/根先冻结私有JSON、slot数量/确定算法/发送保留分钟、activity允许范围/拒绝范围、容量及0处理、promptVersion。范围优先HistoryPlanner内部私有schema和纯normalize helper；不增持久version、不迁移旧世界、不改date guard/公共phone。slot表必须在本次T0冻结一次，known纠错用同表；不能每次attempt换时间造成新的来信、账单或日期漂移。
2. 候选独立新 `tests/history-invitations-q.test.ts`：R01..09/R11/R14/R15可确定的部分，直接对已冻结实际helper/planner运行；完整cast、minutes/capacity反例，不抄实现常量作为expected，UTC午夜/跨年/闰日用独立字面预期值，分别验证rendered text/quote/sourceAt/at而非只断言parse成功。加入原P8严格拒绝和正常[]正例，不改任何旧测试以凑绿。未创建、未运行。
3. 候选独立新 `tests/integration/boot-01r-q.test.ts`：R10..14实际Postgres队列+仓储+RLS+private素材，在规范化后真正存immutable并验证same source/未读/状态、lease/坏slot整批回滚、read receipts/初始不变和legacy。合成model/pixels单独标注，不接内存仓储生产；公共HTTP响应白名单及origin正版本回执需实际HTTP/UI交接验证，不能复现P那样仅Repository绿就忽略503。文件及端口/浏览器资源待根准确释放，本阶段都0。
4. 在另行授权新预算内由唯一I做**完整实时两阶段**普通与固定cast有限真实正例，合适种子至少一个自然具体邀请且同源日期/角色正确；另无适合活动的[]正例也需接受。不能靠预存阶段1或失败P8加工当新真实成功，known纠错/首失败/unknown及实际供应商次数分别记录；至少一真实NPC承接该原来信，与最新日程一致，不把角色认识冒成用户事实。没有预算时保持gate false、不申请增加调用来凑通过，不借P8历史额度。
5. 最终联合check/build/真实PG、390短长屏和PC来源链/无图/真原图/只读/返回刷新、实际HTTP旧回执及生产迁移一致，I唯一推送部署READY后公网核对限定新增正例。纯renderer/date测试证明确定日期，不证明自然邀约或玩家体验质量；新功能未验证不勾P/父BOOT或用户体验A16。

## 当前交付与接续

本阶段产出仅本新报告和本人主登记/镜像，不新增业务能力、原型或测试。静态读取/原P8 connection抽取/文档diff及提交路径核验可做；没有npm check/build、真实PG/HTTP/browser、供应商或线上新验证。记录P上线事实仅引I既有报告，不能算本人R执行。第一阶段报告供根审核；整体BOOT-01R-Q保持进行中，等待I私有协议和根专属新测试/资源释放，不自行领取其他应用任务、不向I跨聊天发消息、不接管部署。

## 根最新冻结方案复核与第二阶段登记接续

**本段优先于初稿的顶层invitations数组建议及R03等旧DTO例子。** 根已采纳I的每message严格二选一：普通`{text,minutesBeforeStart,connection?:{quote}}`（仅记录，不可calendar），或`{minutesBeforeStart,invitation:{slotId,body}}`（不能同时有text/connection/quote）。由于专用邀约变体根本没有自由旧正文，不存在在另一日期正文上硬加日期或覆盖已保存原文的问题，也不增加原group条数，解决初稿追加方案的容量/发送槽协调成本。赞成此更小方案；发送时间仍由既有minutesBeforeStart限定，必须区分slot活动日期与source.sentAt，不把body的相对词从T0解释。0邀约就是全普通messages，**不要求顶层invitations字段**，顶层额外字段严格拒绝；有invitation却缺slot/body不得降成普通或合法0。

槽仅soon=T0+60、next_morning=故事UTC08次日10:00、next_evening=次日19:00；“次日”按T0故事日期，不按旧发送日期、实际执行当日或UTC日期。三个槽均保T0秒/毫秒，offset必为整数：不把目标直接截到整分而改变原秒，从而与既有严格整数偏移冲突；day rollover在同一pure helper中完成一次，prompt与renderer共用同表，known纠错不可新建T0。next_morning在T0已过10点或T0刚过午夜时都仍是**次日**10点，不暗改成今天最近10点。slotId只有限枚举查表，不接受returned label/offset覆盖表。

冻结后的关键字面预期（候选新纯测试应按这些独立字面结果，不从实现常量反推）：

|固定T0|soon|next_morning|next_evening|
|---|---|---|---|
|2026-12-31T15:30:00.000Z，本地23:30|2027-01-01 00:30，+60|2027-01-01 10:00，+630|2027-01-01 19:00，+1170|
|2026-12-31T15:59:30.123Z，本地23:59:30.123|2027-01-01T00:59:30.123+08:00，+60|2027-01-01T10:00:30.123+08:00，+601|2027-01-01T19:00:30.123+08:00，+1141|
|2028-02-28T15:30:00.000Z，闰年本地23:30|2028-02-29 00:30|2028-02-29 10:00|2028-02-29 19:00|
|2027-02-28T15:30:00.000Z，非闰年本地23:30|2027-03-01 00:30|2027-03-01 10:00|2027-03-01 19:00|
|1999-12-31T15:30:00.000Z，上世纪跨年|2000-01-01 00:30|2000-01-01 10:00|2000-01-01 19:00|
|2026-10-10T16:00:00.303Z，本地10月11日00:00|10月11日01:00:00.303|10月12日10:00:00.303，+2040|10月12日19:00:00.303，+2580|

R02/04/08增加混合message字段、ordinary connection里calendar、model invitation额外at/offset/quote、超80完整渲染串、同人两条同minutesBeforeStart、全局ordinary记录+invitation总关联3等拒绝；root保全局连接<=2，不是每种变体各<=2。R09同人不同来源以原消息位置/key/发送分钟为身份：不按相同slot或同名联系人合并记录；两个同slot但不同发送分钟的来信不能被误认数据库幂等重复（是否语义重复仍按I冻结的规则，不自行引入合并）。既有groups每actor1..6/覆盖/乱序不变。R05..07预期改用上表三槽，不再用初稿s1/s2的+1440/+2880。R14旧N输入/输出协议和已存P无年份继续兼容；I可增加明确YYYY年一致性负例，**不能删原guard**，原周末失败仍拒绝。

body按I有限明确时间语法拒绝，不去掉周末、明天、上午等词后重新渲染。需记录中文时刻/全角数字与冒号/英文tomorrow或weekend/零宽分隔时间词等测试是否覆盖；有限实现未支持某语法，就列限制或另冻结拒绝范围，不能声称所有自由时间矛盾已识别。slot合法的早餐/日出等活动隐含时段以及玩家已接受/他人秘密，仍有语义审阅门槛。只要未知/违规field、明确时间冲突、整轮容量/来源错误则全拒绝，不用无条件quote=fullText来代替body、slot、cast校验。

根准确预释放后本人只可新增`tests/history-invitations-q.test.ts`、`tests/integration/boot-01r-q.test.ts`及本报告/本人行/镜像。**旧P-Q测试DTO适配唯一归I**，本人所有源码/公共契约/旧测试只读；I稳定source经根转来后才接并开纯/PG/双端验收。允许届时独占55458、必要3263/3264、boot01rq.localhost、独立check/build、一个新Ego创建后登记，启动前本轮已只读核对三端口无监听；当前实际仍0PG/HTTP/browser/build/model/image。必要ignored `.local/boot01rq-*`真实fixture/安全证据与依赖symlink届时使用，不造特殊生产导出入口；若普通纯helper无可测试接点，先给精确缺口而不改I文件。

本阶段报告原提交c77eeec，更新冻结协议复核后再提交；整体仍进行中等待稳定源。本轮无新测试文件/测试执行，不擅自增加代码或付费范围、不向I发消息。

## 第二阶段末次清理及接续（本段为最新收口）

R独立测试`1050c59`、双端/HTTP交付报告`0029dfb`均已提交并主镜像；后续根唯一指定的时间入口移除实现`0ecf94d`另有独立PHONE-TIME-REMOVE-01报告/登记。最终check578（在575基础上新增3项时间导航回归）及第二次build通过，不重复付费或把UI变更当新的数据库能力。本R专项实际PG仍5/5，纯专项5/5；fixture complete与上传像素是领域/界面合成样本，真实Queue/Repository/HTTP/RLS验证已分开记录。

复用后的Ego110已专域cookie/local_storage清理并finish一次；本人PG55458、HTTP3263/3264停止且三端口lsof无监听，唯一R合成owner/world及上传图删除、private会话JSON和临时依赖symlink删除，安全证据/截图保留。根新增背景/系统records编辑边界/地图只读核实记录在PHONE报告，未扩大本R业务或测试范围。本R整体待验收，生产当前本人仅引用P兼容部署d59fe3f/a2dd72c；不声明本R已READY或关联gate已开启。唯一I接1050c59两新测试及上述报告、0ecf94d手机改动，负责真实模型/NPC、最终集成生产和公网，不从QA祖先接他人backend代码。

## I最终集成与公网验收（本段为最新）

业务a24a8d4，Production parallel-life-4bvku0qbd-limengzhe27-boops-projects.vercel.app / dpl_J8DR4KQwhz8Bmc5bheRsfx1dfmSB READY，正式 https://parallel-life-nu.vercel.app 已切换。最终578/578check、build，N/P/R联合29真实PG（含父子）通过；生产39迁移哈希一致。新普通/固定cast2+2阶段及NPC各1，共6/8真实文本，0上传0生图，两个新世界均暂停、initial不变，原图复用、邀约仍proposed。来源完整链/只读记录/权限及旧世界8/4/4无回填已实测。

时间入口0ecf94d+0f00bad已集成；新公网390×500/844首页/状态栏/锁屏同17:25、1440手机420px居中，无横溢及工具遮挡；旧time/director回桌面、schedule到真实calendar，四App可打开返回、clock不变。旧短屏17:42疑点没有证明计算偏移，accepted正确viewport/新清晰像素替代旧视觉证据。Ego109正式与本地会话仅单个pl_session按备份恢复，finish一次；I/F本地PG/HTTP/夹具/依赖symlink清理，生产测试世界保留paused。源码/测试限定范围释放；其他主client/interview/创作/设置WIP未纳入。

有限文字时间门不等于完整语义理解；首阶段普通开场早晨/实际傍晚、称呼与NPC长模板句仍是遗留，旧album String(Date)丢毫秒如实记录。本批不冒称所有创建或全部角色文案正确，不回填旧世界、不生成AI照片。背景/地图/导演长期近期任务仅方案/待开发。用户新增发送失败重复底部提示登记CHAT-SEND-ERROR-01待开发，保留消息局部失败/草稿/附件及UNKNOWN回执核对，不盲删其他操作错误。

本次只做一次最终文档归档；文档部署READY与最终线上版本留ignored handoff，不循环改tracked READY记录。
