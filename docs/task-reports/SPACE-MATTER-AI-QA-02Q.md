# SPACE-MATTER-AI-QA-02Q · 累计步骤与NPC实际行动独立验收

## 身份与范围

- 状态：待验收（真实开场及手机完成承接静态审查已交；完整真实模型体验未通过）。
- Agent：codex-f-matter-aiqa02q-01a0c7c8-20261011；辅助会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。
- 独立目录：/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本；codex/matter-ai-qa-02q；基线6e39217。旧codex/matter-ai-qa-q/f31bafb完整保留，不reset。
- 根明确分配02Q；主表短锁登记并读回后开始。依赖01真实失败与6e39217既有规则/仓储，第一阶段已满足；新规则专项实施依赖根冻结接口，尚未满足。
- 唯一写范围：本报告、主登记表本人行；预留新tests/scene-step-progress.test.ts，契约未冻结前不写。全部业务/contracts/其他测试/配置/SQL只读，不开发地图。
- 本阶段无端口、数据库、迁移号、模型额度、HTTP或浏览器；Q不付费、不生产写、不部署。真实调用/预算和唯一集成发布由根负责，不继承01余额。
- 已读AGENTS、PROJECT_BRIEF、主DEVELOPMENT、ARCHITECTURE_REVIEW、ARCHITECTURE；旧架构时态说明不取代当前源码。

## 现有代码可确认的边界

基线为6e39217，不把以下读到的旧能力称为02已经完成：

- domain/matters.ts：WorldMatter只有末次evidence和pursuitProgress，未有累计完成步骤；completed/abandoned/superseded禁止再转移。
- domain/scene-matter-policy.ts：validateWorldMatterSceneUpdate核world/scene/action/result源版本、官方v3或trustedOpportunity、地点/邀约/见证等；completed依赖单action succeeded和action/observation文字条件。deliver_r17条件含验收/签收文字，但没有记录执行接收/检验的人和累计步骤，所以不应把含关键字等同真实检验来源。
- domain/scene-world-results.ts：applySceneWorldResults校验当前事件顺序、action绑定、事项版本、可见observer facts，之后同次导出progressSceneMatters；world-history.ts重放经过同入口。新step逻辑必须在同运行时边界，而不是Repository专有旁路。
- infrastructure/scene-repository.ts：commitSceneProposal建立同event来源的action resolution、scene entries、worldResults/事项/阶段/机会/observer facts；NPC只作为dialogue文本保存。不得让文本“我会检查”直接算已经检查。
- infrastructure/scene-task-handler.ts：planner外部执行后queue.commit提交；tasks/infrastructure/postgres-task-queue.ts在同db事务执行业务callback与finish_task。这里是事务入口的静态证据，尚非本轮真实rollback/幂等证据。
- 已有tests/fixtures/matter-progression.ts固定action+observation成功文本仅供领域规则测试。本轮新专项不能把这种构造成功称为模型自然度或真实接收检查。

01失败是重复未给缺项及手机INVALID_PROPOSAL未提交。串行NPC文本缺执行结构与自由历史缺累计ledger是已确认结构差距；它们是否为模型循环唯一原因没有ablation，不能宣称已证。

## 验收矩阵（冻结契约之前提出，不虚构导出函数）

新schema/type/function由根唯一冻结。Q测试调用实际纯规则和实际reducer，不先自定义一套假引擎；不使用固定台词、字数或标题出现次数打自然性分数。

|编号|情形/负例|预期与必要证据|验证归属|
|---|---|---|---|
|S01|作者固定ruleVersion/必要步骤/允许接收人；proposal改规则、增加签名或等未到客户|拒绝改trusted定义；原R17向老周或车主交付不被临时加条件|Q纯规则；根真实样本|
|S02|分三次核对接头、说明交付、写记录，前两次partial|实际有效子步累计保留，最后只需剩余条件；整项结果与单次outcome分开|Q纯规则/reducer；根PG与AI|
|S03|已执行子步与一个不成立子步混合|不凭整体partial抹掉有效步骤；非法提案须整事务拒绝，不能偷偷存前半段|Q纯规则；根PG|
|S04|我会/准备/等客户来/请求老周检查/假设/引用检查通过|承诺、请求、自述和假设不是已执行证据，不credit NPC动作或玩家后续|Q纯规则；根实际模型|
|S05|NPC实际检查/接收提案，由其他NPC代执行或替玩家签字|仅本人可执行授权动作，执行者来自当前调用与presence；玩家请求不替代执行|Q纯规则；根PG/AI|
|S06|真实接收人已在场，通讯录联系人/离场角色/未来日程参与者冒领|接收人身份与本场景同事件实际presence/地点/物件/前置核验；关联不等在场|Q纯规则/reducer|
|S07|step引用别owner/world/matter/scene、同名角色或另场景event|拒绝；标识、原始source与definition版本共同绑定，标题相同不能通用|Q纯规则；根RLS/PG|
|S08|伪造eventId/version、未来来源、丢source、action未resolve、结果源不一致|拒绝，不靠自由文字补proof；scene之间是否允许合法累计由根明确规则，不能默认共享|Q纯规则/reducer；根PG|
|S09|新current delta给已完成step换执行人/换来源、删除旧step、再次要求补做|保留既有已提交证据，拒绝篡改/回退；新合法动作不清空ledger|Q纯规则/reducer|
|S10|同一step/同一source重复、同command回执重放，不同command重交同完成条件|幂等或明确拒绝，不能重复累计、阶段、机会、observer facts；原receipt不变|Q纯幂等；根真实PG/HTTP|
|S11|事项completed后partial/failed/重新打开现场要求in_progress或欠项|终态不可复活；已完成步骤与来源不消失，新事项要独立定义/来源|Q纯规则/reducer|
|S12|旧event不含steps，新代码读/重放/恢复已发展旧世界|不从旧台词/regex补历史step，不迁移初始快照；未知规则不自动套最新版本|Q纯兼容/reducer；根PG|
|S13|step齐全但整item缺允许receiver或NPC行为；反之先提completed|有完整受控来源与必要条件才完成；未满足明确missing，不强置success|Q纯规则；根真实链|
|S14|已完成触发阶段、新机会生成，回放/刷新/重试再次触发|单一确定性机会ID/来源，阶段一次；机会仍未接受，不能代玩家参与|Q纯reducer；根PG/AI|
|S15|NPC未目击完成、未收到披露却得到所有step/私人档案|先权限过滤再预算；执行者/目击者只接相关可见事实，不能全量私聊泄漏|Q纯权限负例；根真实对照|
|S16|world state更新后scene projection/records/receipt/memory写入失败|事件/状态/steps/NPC action/阶段/机会/投影/回执整事务rollback，不留半成果|根真实PG故障注入；Q不以内存mock证明|
|S17|冲突旧版本、租约丢失、unknown、取消或响应丢失|拒绝过时提交、只读核原回执；未知不自动重付，不重复NPC行为|根Queue/PG/HTTP；Q可审纯来源|
|S18|输入与裁定已把记录写好，下一轮仍泛称记录没写|runtime保存累计事实供NPC/导演；真实模型必须能解释真正剩余步骤，不用模板测试替代|根实际模型；Q独立语义审查|

最小有限规则需由根明确R17实际终点与允许接收人，不把“另一人签名”或必须等刘航当隐含要求。required、done、missing必须分开；未提交候选steps/角色动作不能混入已保存ledger或宣布机会已解锁。规则能约束来源与权限，不足以独立证明模型提出的每个观察在语义上真实，仍需原输入/角色可见context/实际输出与保存结果的联合审核。

## 地图A/E/F只读复核（以6e39217源码为准）

|世界/行为|当前实际支持与限制|
|---|---|
|新官方人生|official-genesis.ts使用作者opening.space，新v2/v3预设有地图；来源是作者设定，不是定位服务/现实IP。默认继续旧存档不会变新版|
|新普通自建世界|build-handler.ts用deriveInitialSpace；仅opening.space显式草案经authoredSpace/validateSpace核actor/invitation引用和路线才保存。无草案保持空态；城市名不自动生成街区/固定路程|
|已有space的世界|沿已存来源移动；选择地点只预览，travel事务成功才改变位置/故事分钟，命令回执幂等。不能把动画当提交成功|
|旧官方v1、world v0且无space|space-repository.ts核不可变snapshot/人物/邀请原消息与pack兼容，显式establish才建立；legacySpacePack限定当前v3向原v2地图兼容，不自动升级任务或回填历史|
|旧普通v0无space|必须有initial snapshot/approved seed/world_builds.opening显式space，并核演员/世界绑定，才能显式establish；没有可验证草案则空态|
|已发展旧世界且无space|version>0拒绝补建立，保护已保存历史；不能默认重开或覆盖玩家旧世界|
|地图到达/进入现场|到达仅位置，不等已见面、赴约或事项完成；enterPlace显式进现场，生效确认日程参与者只是候选，通讯录联系人不自动在场|
|离开后NPC/日程|旅行离开目击事实只给当时目击者，知道原地点而非目的地；未目击者不自动知情。proposed过期不责备，confirmed到点仅可询问/提碰面，不擅判失约|

E旧报告的“从城市地点推导通用街区与15/20/25分钟”已被后续真实性修复取消，现domain/space.ts:deriveInitialSpace明确无opening.space就undefined。F旧报告“已在地点自然见面”也必须按agenda.ts当前措辞降为地图到达而非见面证据；不能引用早期报告扩大能力。A19/A21/A22的限定技术上线与测试归各原报告，不算Q本轮重验。

尚欠：没有证据证明所有普通新世界都能生成合格地图；旧已发展无图仍不能补；真实模型旅行→完整事项→NPC行为→长期阶段/机会、动态通用空间/长线玩法/实际奖励仍未完整验收。01真实链未通过，这轮不能因地图存在就说补齐。

## 当前验证与接续

- 本阶段实际修改只有本报告和主表本人领取行；源码、测试、公共配置、数据库均未改。
- 已完成：clean旧独立树确认、基线存在/新branch、短锁登记读回、规则/事务接点/地图实现只读审查、S01–S18矩阵回根。
- 未执行：新专项（新接口尚未冻结）、npm check/build、真实PG、真实模型、HTTP、浏览器、部署；不得借01或地图旧计数冒称通过。
- 接续：根冻结step rule/evidence/action/delta及实际纯函数、reducer接口和兼容约定后，Q只在独占新tests/scene-step-progress.test.ts写必要正负例，先新纯测试再适当check/build；若需要隔离DB或其他文件，先由根明确登记资源/范围。本Q不先占公共迁移或业务实现。
- 集成验收：待根填写；完整产品与模型自然度没有通过结论。

## 冻结类型与首次纯规则专项（保持失败证据）

接收根8c6214f公共候选类型和708616e纯domain，独立树对应a48336e/1e35c11；不修改根文件。根已明确必要order_reviewed/repair_explained/handed_over/received；connector_checked/record_written/receiver_inspected可选。真实接收人来自允许且实际在场relatedActorIds，整项scene_steps完成与单action partial分开。

已写专属tests/scene-step-progress.test.ts，实际首跑26项：19通过、7失败、0跳过。已复现：未来/假设源截肯定substring；引用去引号；NPC未来承诺、否定截substring、别角色动作、玩家动作被转成自己的canonical动作；同delta重复receive_r17产生两条actionTexts（steps仅一条）。7项已回根，根在原源码范围修复，Q不改业务或删负例。

正例覆盖三partial逐次累计并保留第一source、四必要步骤聚合完成且不强制记录/复检、可选NPC实际检查；scope/source/plan/hypothesis/failed/不在场/终态负例与旧无扫描覆盖。纯函数测试没有声称事务/回执/AI自然度通过；原始world不被拒绝delta修改也不等于数据库rollback。

首typecheck发现新测试未声明数组索引存在，已仅修测试索引声明；后续类型检查结果另记。新接口先同步时权限自动审核超时未执行，依工具允许重试一次成功，无用户确认阻塞或范围扩大。

当前接续：根新domain修复提交后同步并复验同26项，补必要对象/请求/终态/实际source负例；root Repository/reducer尚在接线，PG/模型/公网未完成。不能先标产品通过。

## 复验记录：1f900dd → f14e3e2

- a24a911仅本人新测试和报告；7d751c6仅补本人测试，现32项冻结。先前typecheck索引问题已修并通过，不放宽负例。
- 接根1f900dd（本树dbdef7e）后26项21pass/5fail：5原正例因actual拆句去尾标点误拒，完整substring带句号也属合法引用；已回根，未用删正例标点假装通过。补对象/日期/执行主体/旧完成绕过等6负例及不带标点NPC负例，32项实际21pass/11fail。
- 接根f14e3e2（本树0df8dd9）后32项实际30pass/2fail/0skip：最初7问题、标点及R18/未来日期均已复验通过；剩余两处是真实纯规则绕过，不能称源已全绿。
- 剩余1：saved input为“老周核对R17维修单”，截inputQuote“核对R17维修单”，observationQuote“你核对R17维修单”，能错误给player credit，输入执行主体不一致。
- 剩余2：已存在stepProgress且只完成order_reviewed、缺真实received，validateWorldMatterSceneUpdate仍可凭旧succeeded+交付/签收文字条件完成。新已启用ledger应强制聚合条件；旧不含ledger历史仅沿明确兼容路径，不取消旧事件。
- 两处已回根，业务源未改；待根新稳定修复后同32项再验，通过才运行适当check/build。根真实PG在途，不作为本人已通过证据。本人0模型/图/生产写/PG/HTTP/browser。

## 第一轮独立交付（基于根3d5c36a冻结源码；最终增量见后节）

实际最终结果：本人34项新scene-step-progress专项全部通过；同时执行B的14项scene-step-planner专项通过，总48/48、0失败、0skip/0todo。模块边界323文件通过、typecheck通过；本工作树npm run build成功退出0，23静态页生成完成。git diff --check通过。没有把供应商捕获mock提案或固定成功文本当真实NPC自然性。

最后多句主体负例8e185dd和无“我”自然交付正例2526c00均保留，通过根3d5c36a来源所在句执行者规则；stepProgress不完整后不能用旧succeeded文字条件绕过，根1123c03已复验。optional写记录/复检仍不成为必要门槛，当前partial和累计终点区分保留；本报告历次失败计数/精确源版本保留，不以最终绿覆盖。

独立同步过程：先漏B前置就接6ce561f产生非本人报告/planner测试modify-delete冲突，已完整abort未完成cherry-pick恢复干净树，再接冻结前置2c941d8→6ce561f→1123c03→3d5c36a，未手工覆盖/解决他人文件。同步后的本地提交只用于独立验收，不能由根合整枝重复公共源码。根当前WIP与其他主目录修改未纳。

### 实际修改、验证与归属

- Q只改新tests/scene-step-progress.test.ts、docs/task-reports/SPACE-MATTER-AI-QA-02Q.md；主表仅本人行按短锁更新。没有业务/接口/迁移/地图实现改动。
- 本人交付测试链：a24a911（首26+报告）→7d751c6（32项）→8e185dd（33多句主体）→2526c00（34省略我正例）；根已陆续接收，最终完整报告另纯报告提交。根应接专属提交，不合独立整枝。
- Q实际验证为上述34+14纯规则/planner专项、模块边界、typecheck、独立build、diff检查。本次完整npm run check未运行：其入口包括tests/rls-tenant-isolation.test.ts和character-image-flow.test.ts真实DB连接与fixture写，超出Q明确0DB范围；已告根，不通过配置隐藏或跳过冒称完整check通过。
- Q真实PostgreSQL验证0、模型/生图0、生产写/API/HTTP/browser0。不是拿内存数组当生产Repository；领域纯fixture仅验证规则/来源，不证明持久事务或模型效果。
- 根报告本轮真实PG纵切5/5（含partial累计、NPC接收、阶段/机会、下一步、迟失败rollback与history replay），完整PG242pass/5显式opt-in模型跳过；其完整check此前797、最终增加用例后待根重跑，根build0。以上归根，Q未执行/查询DB，不能外推RLS全量或真实自然度。
- 本轮地图仅按源码核对支持矩阵，没有实测公网地图或新增世界；旧A/E/F验证归原发布者，旧E报告的通用街区逻辑/F到达即见面措辞已说明过时。

### 下一位Agent的接续点与未完成项

根/I接本报告与专属测试做集成验收，跑最终完整check/真实PG/build；按生产41项迁移/当前独立项目部署与READY/public流程完成发布。Q不部署、不改他人任务最终状态、不另领任务，构建进程已结束，无数据库/服务器/浏览器资源待关闭。

真实模型新预算仍待人类授权，本Q累计0调用，不继承01保守11/12余额。获得授权后，由根维护单一账本/合成世界/回执来源，从实际核单→说明→交给允许在场者→NPC实际接收→近期完成→阶段/有来源机会→用户真实下一行动继续；Q可对新公开合成证据按01冻结语义矩阵审查。未授权时不自动调用或把本轮纯fixture说成改善证明。

本轮规则纵切仅county官方v3 R17/r17-delivery-v1，不是普通世界通用长期任务引擎，不自动回填旧历史，不代表四人生全部完成、奖励兑现或长期好玩。**独立规则专项通过；完整真实模型“完成→NPC→后续机会→第二行动”仍未验，01真实未通过结论没有被本轮测试抹掉。** 部署/公网最终结论由根统一记录，本报告先待验收。

## 最终增量：当前NPC执行不能漏存，历史不回填（根1d3ae2d）

根追加当前NPC已执行声明必须有typed动作或同actor已有合法累计来源。原测试把“旧对白”放在input.dialogues（该字段是本次NPC结果），字段归属不正确；根没有改Q文件。Q同02Q范围接续并拆为真正历史world.messages不扫描/不变、当前receive和inspect已执行但npcActions空必须拒且不留ledger、同actor可引用已有自身received但不得新增第二条效果。不是删除历史保真或降低执行证据门槛。

新专属测试提交b57b3b5；本人专项现37项。接根1d3ae2d（本树3107284）后实际37+B14共51/51通过，0失败/0skip/0todo；模块边界323文件和typecheck再次通过；该源码版本npm run build再次成功退出0、23静态页生成完成。没有修改根源码，新的B后续adapter需根最终集成检查，Q不以此次数量代替真实模型验收。

此前0777422第一轮报告与48项结果保留为对应3d5c36a时态；本节是最新交付。测试完整链a24a911→7d751c6→8e185dd→2526c00→b57b3b5，根已接的不要重复合。最终报告单独提交，并只同步本报告主镜像。构建进程已退出，树干净，无PG/HTTP/browser资源。

根转达新的人类授权：最多2个官方合成测试世界、总18次文字供应商调用含导演/NPC/纠错，0图片上传生成/个人资料，结束暂停；根唯一调用与账本，不继承01额度。上节“待授权”是当时状态，此刻授权已批准，尚无本Q新真实模型输出证据或通过结论。Q继续0供应商/DB/生产写，不读取私有账本；只在根交允许的公开合成输出/回执/前后保存证据后做独立语义审查，不常驻等待、不自动调用。

最终任务待验收、同范围冻结释放；下一根验收专属test/report、完整check/真实PG/build与READY/public，然后按新授权验证真实第一阶段→NPC已保存行动→stage/机会→真实第二行动。任何领域/合成捕获proposal通过均不能冒充线上真实模型承接自然，01未通过结论仍保留。真实PG本轮均由根执行，本Q真实PG仍0；地图仅只读结论，未扩大开发范围。

## 真实模型开场摘要独立复核：空presence不能靠旁白补人物

根在新2世界/18文字授权内交本Q以下合成实际摘要：开场旁白含“此时……整个店里只有老周师傅在一旁忙碌”，但presentActorIds=[]、scene.presence只有player，没有NPC对白；下一轮核对行动因schema invalid failed，实际无新进展，保守预算已占5/18。本Q本次只读根转述及主02报告，不读取私有账本、会话、原始数据库或生产API，也未获得这一轮完整taskId/resultVersion/来源event/安全模型元数据；本节不虚构这些标识，不把保守额度写成精确供应商账单。

结论：此开场存在人物在场一致性缺陷。旁白把老周写成正忙碌的实际在场人物，而真正presence只有玩家，因此不能当成老周确已在场，更不能说知情NPC已承接、接收/检查或事项已完成。没有NPC对白时该角色自然性未覆盖，不能用“在一旁忙碌”替角色行为来源。下一轮failed是被拒提案，没有可验的新完成步骤/阶段/机会；本轮完整体验尚未通过。合法空presence本身不是错误，矛盾来自旁白越出实际在场记录，不能为通过R17强制补一个NPC。

主02报告已有候选32df2e0/racc3qapp READY、首开场TypeError/resultVersion null及根开场无action解引用修复/专项6过的记录。这是此前失败历史，不与此处空presence开场/下一轮schema失败混成一个原因。本Q没有本轮原始非法提案，不能判断是哪个schema字段、不完整输出或何种模型原因；已报告schema invalid而不是无证据说网络不稳。

### 有限改进建议（只建议，业务由根/B实现）

1. 开场导演只写合法可见环境；NPC在场/动作不由旁白断言。若真实presence为空，不能写某NPC此刻忙碌或已经见到他；当前有合法参与候选也不意味着必须选择在场者，不强制赴约。只读投影、NPC调用与动作权限共同沿实际presence。
2. 给真实模型明确当前阶段所需JSON结构、enum、nullable和空数组边界；开场没有saved action时没有执行结果/step或NPC动作。实际attempt只提出绑定现有world/matter与当前源的候选步骤，非法schema整轮拒绝，保留安全错误分类；不放宽校验或自动从自由文本补类型。
3. 候选修复后，经正常API显式离场再进入同owned world，生成新的开场/在场事件；旧开场、failed任务与原receipt保留，不重写过去、清空累计已确认步骤或从旧旁白回填老周presence。新进场仍允许空，后续交付必须有真实可接收人的合法来源，不制造假过去。
4. 每次新的开场/动作/纠错沿唯一根账本计入18上限，成功/失败/unknown分别留证；unknown不自动重付。只有新实际保存的presence、NPC typed动作、steps、事项状态/阶段/机会与跨App结果一致，才评价修复有效。不因为READY、纯测试51过或schema现在合法就宣布体验通过。

已将以上边界回传根。同02Q仅本报告和本人主表行更新，0业务/新测试/模型/生图/DB/HTTP/browser/生产写；本次纯文档只执行diff检查，不重复测试/build。结构化规则专项与根数据库证据保持其原版本和归属，不转为本样本真实NPC证据。下一根修复真实输出、发布候选、按预算显式重新进入，并给安全公开的前后状态/输入/回执/角色实际输出供Q再审；没有证据的完成→NPC→后续机会→第二步仍未覆盖。范围冻结，报告待验收，不常驻等待或自动另领。

## 手机完成后承接路径：静态漏项与实际质量分开

根指定同范围只读turn-planner、character-policy、actor-context及pursuit ack。检查根工作树当前HEAD f7d3c48e1d712cfd0b7f47205c108548a12edb83；当时只有eval工具WIP，以下业务源码未由Q改动。此节是代码路径证据，没有新真实模型/数据库/生产API调用。

### 确定漏项：自主结果回访未适配scene_steps

- domain/agenda.ts:229的matter_result入口直接跳过evidence.kind不是scene_action的事项。新R17整体完成使用scene_steps，所以即便canonical matter/pursuit结果确已保存，此入口不会产生该事项的matter_result议题。不能以现场完成后已存事实，推断人物主动回访已经接通。
- domain/return-followups.ts:50亦仅认scene_action，过滤结果议题时不接受scene_steps。application/advance-world.ts重新buildAgenda并核议题可见，不能绕过前述缺失入口救回新kind。
- witnessedMatterResult本身已支持两kind，actor-context和matter-progression也已适配。因此这是下游agenda/回访旧kind判定的确定漏项，不是新整体完成必然不产生canonical事实，也不是用户手动私聊必然失败。

已立即报根；根确认在自身业务范围扩两入口并补纯回归，保留可信同源/实际目击/未确认不升格等限制。Q未修改业务/新测试，也尚未取得该修复版本实测证据；后续不能只放宽kind而跳过结果event、关联世界、已获准目击和消费来源检查。用户手动发消息与自主回访须分别验收。

### 主动私聊路径：具备新结果上下文，不代表已实际成功

actor-context.ts过滤blocked source、可见世界/角色事实，核matter_result与scene_action或scene_steps事件绑定，核pursuit milestones和真实触发事项；completed/blocked事项还要求witnessedMatterResult。之后先权限过滤再预算；不会把整个步骤ledger、现实访谈或其他人的完整私聊塞给NPC。预算不足时资料可被合法裁剪，不能承诺每次一定含全部结果。

turn-planner.ts的resultFocus来自此已裁剪context.facts中的当前actor可见canonical matter_result/pursuit_result，取至多6；指示只承接已保存成果与尚未执行机会。用户消息本身不产生世界验证完成。resolveTurn调用parseProposal和validateCharacterEffects，再交现有Repository事务；普通私聊不能提出matter.proposed或建立全知事实、替其他角色发言/排日程。手机私聊协议没有scene receive_r17/inspect_r17执行效果，承接已保存结果与执行新的现场物理动作需区分；不能把私聊中的未来承诺当新typed动作证据。

旧01手机503/INVALID_PROPOSAL仍未得到原始非法提案/精确字段，不能根据静态路径直接定位那次失败，也不能说本轮phone已成功。parseProposal要求schemaVersion1、1..20合法effects与唯一id；character-policy再限制角色归属与来源类型。有合法对白不意味着附带非法effect也能提交，边界拒绝仍应如实记录，不能放宽护栏使旧错误变绿。

### ACK接续风险（有条件，不等同必然断点）

turn-planner.ts先算ackReply是否存在正确actorId的message.received，再将回复actorId归一化为当前人物。若模型漏/错actorId而其余JSON合法，归一化后reply可通过，但此前ackReply=false会忽略acknowledgedResultFactIds。这是同一提案的确定处理顺序与条件风险，不是所有回复都会漏ack，也没有证据表明它就是旧503原因。根暂挂待办，Q不改源。

通过时，ack只从当前可见canonical精确ID生成当前actor的私有belief marker；不会生成世界结果。resultWasAcknowledged要求同actor marker与同source的实际assistant消息。此消费标记证明内部已标回应，并不足以证明台词自然、具体承接了成果；仍须人工读本轮真实正文及结果源，不能拿ack字段当模型质量评分。无关/未目击人物应没有结果上下文与ACK权限。

### 只读源码指纹（发现漏项时版本，后续修复需新版本）

- domain/agenda.ts：d86dd8ee2b74b245e9eae85d4507bd9debe17b8e3cfcc6a7321bc83f73c57b2e
- domain/return-followups.ts：a2ef96e5695cad3082a3370e94f8bb64055cd772e01466bb5a48b78ee99906d1
- infrastructure/turn-planner.ts：24ba7bcac05c35567924b1087805b623dc7aee60b3396065b2cbf9c579560f87
- application/actor-context.ts：53c4dd62fb82849b6ec6c1ed14325951cf828472c19c42386fd1c2b49f1d4ef1
- domain/character-policy.ts：e3633d24ca5922e5277c8443a83cc40a82e79af9b317fb434d5c8d78ae33bf34

本增量只报告与主表本人行、diff检查；0新test/业务/模型/图/DB/HTTP/browser/生产写，不重复build。不再并写或补构造成功样本。下一根合B的明确开场JSON与真实presence输出，修agenda/回访kind漏项并独立验证；在保守5/18已占的根账本内继续有界显式验收，不自动unknown重付。此时开场有presence矛盾、下一行动schema失败、近期事项完成/NPC承接/机会/第二步仍没有本轮真实成功证据，保持未通过。Q报告待验收、范围冻结，等安全公开实际证据再审。
