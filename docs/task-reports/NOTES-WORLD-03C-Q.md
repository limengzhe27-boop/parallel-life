# NOTES-WORLD-03C-Q · 阶段成果与后续机会独立审查

## 身份与范围

- 状态：待验收。已交付独立可运行审计测试；集成验证与部署由既有I负责，未冒称完整产品完成。
- 负责人：codex-f-matter03c-q-01a0c7c8-20261011；会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。
- 独立目录：/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本；新分支codex/notes-world-03c-q，基线51f753f；原codex/nar03-ux-qa/a8b86dd保留。
- 依赖：03B已验收发布；本轮已消费I c0e40da及B5197adb/8ede4e4冻结实现，按最终交付段验收。
- 仅允许：新tests/matter-progression-audit.test.ts、必要新tests/integration/matter-progression-audit.test.ts、本文及主表本人行。全部源码、旧测试、contract、UI、SQL/config只读。
- I负责公共协议、records/UI与集成发布；B负责事项进展、scene-world-results/仓储/知情反馈。
- 资源：已登记启动全新隔离PG55458完成验证，现已停止且无监听；旧库/旧数据未动。0模型/图片/生产写/浏览器，不部署、不推main、不领其他任务。
- 领取：2026-10-11，主表短锁读回后才能开展独立开发。

## 领取时接续（历史记录）

先安全建立新分支，读当前可信近期成功规则、长期追求投影、知情者来源、回放和幂等路径；提出独立负例/最小可检验协议。I冻结协议且通知B稳定后才新增可运行实现测试，不臆造公共字段或复制后端规则。每次关键进展更新本文。

本轮目前只读文档/git核对与登记；没有新增测试，没有check/build/真实PG/模型/浏览器或公网证据。

## 第一阶段规则审查与冻结形状（2026-10-11）

已在干净独立树建立codex/notes-world-03c-q，HEAD51f753f，旧a8b86dd分支保留；没有reset/覆盖旧改动。已只读核对AGENTS/项目说明/主表/架构复核/架构/PHONE_EXPERIENCE_NEXT/03B报告以及matters、scene-matter-policy、scene-world-results、agenda、actor-context、return-followups、player-records和现有真实库集成用例。这里只是审查方案，没有新增测试执行。

I本轮已冻结可选形状：

- WorldMatter.pursuitProgress：milestones[{matterId,title,eventId,eventVersion,at}]、nextOpportunityIds[]，最多10/10。
- WorldMatter.opportunity：{pursuitId,triggerMatterId,key}。新机会not_started、director_proposal来源为实际事件、有prerequisites。
- PlayerRecord.progress：milestones[{title,at,recordId}]、opportunities[{title,recordId}]；opportunity:{pursuitRecordId,triggerRecordId}。

字段由I写schema/records/UI，B写规则/事务/来源，本Q不写替代类型或臆造函数名。形状兼容并不证明语义可信：每条title和recordId均应来自同世界授权记录，stage/source需要运行时校验。

### 现有入口必须处理的接续点（不是已实现新功能的回归结论）

1. scene-matter-policy.ts当前完成要求immutable initial里存在original，matterCriterion只识别官方preset v3 near_term。新director_proposal机会既没有原始snapshot定义又不是preset，若照搬旧逻辑将被拒绝，造成看到下一步但无法成功推进。B需按opportunity.key、实际trigger事件及同世界定义的可信规则识别，不能删掉原始来源校验或接收模型自报条件绕过。
2. not_started不能直接通过旧validMatterTransitions完成；需要明确玩家提交真实行动时的受控开始/达成路径。浏览备忘录、点击去地图、GET、只聊“想试试”和重复查询都不能替玩家开始/接受。不能为了跨过状态门槛预先自动in_progress；也不强制新增独立accept API，具体走已有SceneInput还是受控命令由I/B冻结。
3. 现有sceneMatterResultFact只说明该事项达成/受阻；stage/new opportunity需要同事件有依据记录，不能把奖励guard布尔值当资源到账或把新机会当已经承诺。事件回放必须计算同一成果/机会，不能为重放再次发新任务/消息。
4. 现有agenda以任意sourceVersion较晚的assistant消息抑制matter_result；这不足证明阶段或机会已被人物承接。测试须覆盖结果后先有一次不相关回复时，下一步仍存在、能参与；若本批定义仅反馈已知近期结果，报告应明确边界而不写已完整承接长线。

## 独立测试计划

下列断言写入新tests/matter-progression-audit.test.ts，B稳定冻结后调用实际函数、world reducer/history与正式投影/实际组件导航回调；不复制实现、字符串查源码、建立内存生产Repository或使用test.todo掩盖必须实现项。未做的通用条件/互斥失效/资源奖励不伪造通过。

|组|输入或动作|独立判断的期望|
|---|---|---|
|可信阶段|同世界已裁定的近期成功，有实际scene/action/event与版本|新增一个有来源milestone，原近期历史保留；pursuit仍in_progress，不因一个动作整体completed；title来自可信事项|
|无客观成功|user_report“完成了”、plan/hypothesis、失败、partial、空观察或未满足条件|不新增milestone/nextOpportunity，不自动接受机会，旧进度深比较不变|
|错误绑定|另world/owner、错误scene/action/relatedMatterId、篡改preset或opportunity.key、触发事项不是已完成、未来/错误eventVersion|拒绝或无增量；不借用户输入/模型worldResults自报直接解锁|
|重复与上限|重复原command、重复同source、同事项换command/event伪重复、两次concurrent同版本|阶段/机会身份稳定，每个真实目标只记一次；有界10/10，不截断后重新生成，不移动已成功门槛|
|新机会未接受|只GET/读records、点来源/地图/联系人、收到通知|机会保持not_started；prerequisites有真实trigger来源；不新建玩家选择或赴约，不改时间/位置|
|真实可参与|从progress机会recordId打开详情，再通过合法地点/人物/现场入口提交机会对应实际行动|能真实queued→resolved，成功推进下一阶段；无入口或无可信条件须诚实显示限制，不提供空按钮或成功后永久无法完成|
|不自动速通|近期A成功使B出现；B未行动；或下一阶段需新动作/第二来源|A只新增其里程碑，B未completed，无自动链式全完成；实际B成功才再进展|
|NPC知情|在场/离场/只被邀约/只收到耳语/关联但未见证/同名不同ID|只获得确有观察来源的内容；不能用relatedActorIds或玩家可见替代知情；整个pursuitProgress不得泄漏其没见证的其他milestones或nextOpportunityIds|
|撤销/隐私|blockedSources含trigger事件/结果事件/fact/事项ID，隐藏事项或外world里程碑|NPC不知结果；玩家投影不输出隐藏/外国record标题、计数或死链；不能靠source带公共名字绕过|
|历史与旧档|旧无pursuitProgress/opportunity存档重复读取，新事件完整回放到vN及早于触发的vN-1|旧档无静默回填；回放vN与持久state一致，vN-1没有未来机会；重复回放无Outbox/任务/消息副作用|
|来源呈现|progress.recordId/pursuitRecordId/triggerRecordId导航，阶段时点跨午夜|实际open回调落可读的授权系统记录/来源，世界故事时间一致；名称不替代ID，不按客户端日期造来源|

### 必要的新真实PostgreSQL验证

使用新tests/integration/matter-progression-audit.test.ts，沿现有真实OfficialLifeRepository、SceneRepository、PostgresWorldRepository、TaskQueue/runOne、PlayerRecords与history流程。测试规划覆盖：官方v3真实近期成功→同事务阶段与机会→未接受读取→实际新机会行动再推进；同command重复/两个并发command；同世界错owner RLS与另world来源拒绝；事务失败回滚world/events/state/receipt/任务/scene items；完整回放一致；旧initial不可变、旧档多次读前后整行/各表counts不变。

裁定器使用明确命名的合成proposal输入实际任务handler，0模型；它只证明运行时边界/事务/队列，不证明模型能自然理解不同表达或NPC台词质量。新机会条件冻结后再选择真正可执行的测试文本，不凭先写的测试字段拼出“已成功”。

PG55458尚未领取/启动。若新增真实库测试必要，先检查主表资源及监听，登记专用新cluster/test库配置，只清理本人新fixture，绝不复用/删除旧chat-send合成账号、私有JSON或他人库。不得因本地端口拒绝而写“已验证”。

### 本轮验证及下一步

本轮实际修改目前仅主表本人领取行与本报告；独立分支已建，git工作树干净。未新增测试文件、未运行check/build/test:db、未调用模型/生成图片/生产写、无UI截图/公网。现有712/222检查是03B集成人过去证据，不计本Q。

先将本方案与现有入口缺口回传I，等待B提供稳定函数签名/规则map、生成新机会的可信条件/记录及正式commit。随后只在已登记新文件补测试，运行专项/check/build，必要真实PG，先待验收；最终整包部署由既有I完成。所有源码修复通过本报告/I协调，不自行扩scope。

## 第二阶段已实际开始

已顺序同步冻结c051a36→78fcd5d→12d4f27→7c950a8，不自主修改其源码。新tests/matter-progression-audit.test.ts已建立四官方真实genesis独立夹具并运行18条行为断言，18通过0skip/TODO；实际覆盖一/二阶段、长期不全完成、未接受、失败/假设自述、源码/世界/初始定义篡改、重复/检查点回放、旧状态不回填、NPC见证与无关回复不消费、模型额外字段不授予权。此轮属合成裁定与纯规则，未计真实模型/库。

资源55458当前无监听，主表已登记全新cluster .local/matter-progression-audit-pg/data/runner/日志（主目录），dev/test与旧cluster物理隔离。只读取本人私有runtime作本地fresh角色密码；不修改它、不启动旧库、不删旧私有数据。新真实库测试按已有实际TaskQueue/SceneRepository路径，不复用B/根测试当本人证明。

## 第三阶段：实际验证与确定性缺口

已提交18独立纯负例5d366cc；本人夹具类型错误修复63cd205，实际typecheck通过。依赖已顺序同步至I c0e40da、B5197adb（本树b27d926/d8ab26c），未编辑业务源或旧测试。

全新PG55458已实际READY，独立新tests/integration/matter-progression-audit.test.ts运行9/9通过、0skip/TODO。使用真实官方v3 Repository、实际SceneInput/持久Task Queue/worker/事务/reducer/receipts/RLS/Records，合成planner明确q-synthetic-no-model，0模型调用。覆盖failed/partial/plan/hypothesis/user-report伪完成事务失败、非在场NPC说话、跨owner RLS、同expectedVersion并发只有一人成功、一阶段机会未接受、读取/同命令不写、真实失败不达成与另一次真实行动完成第二阶段、完整实际事件回放及早于成果版本无未来、不可变initial；失败后世界version及events/sceneitems/memory/commands/receipts/Outbox/task行数全不变，任务status=failed是允许的失败记录。

最新独立纯负例新增长历史实际generic fact eviction后有限阶段proof保留/早于阶段版次无未来，和四官方preset的I读侧可信key/title/derivedID负例，均通过。总计21条目前20通过1失败：actorContext blockedSources含trigger或pursuit ID时阶段facts已正确隐藏，但机会matters使用raw state.facts，仍把机会标题/说明送入NPC上下文。已报I/B原范围修复，本Q不改actor-context、不弱化断言，不称公网漏洞或真实模型泄漏。完整check已启动，待修复后最终复验；本轮仍进行中，未部署。

## 最终交付 · 2026-10-11

### 文件与独立提交

仅本人新增/更新：

- tests/matter-progression-audit.test.ts：21条独立真实规则行为断言；首次18条5d366cc，类型修复63cd205，最终负例补丁ca30876。
- tests/integration/matter-progression-audit.test.ts：9场景加顶层容器，测试运行器统计10项真实PostgreSQL验收；ca30876。
- docs/task-reports/NOTES-WORLD-03C-Q.md，以及主登记目录docs/DEVELOPMENT.md本人行（短锁更新，主表由I保存集成）。

本树只是顺序消费已冻结依赖，没有编辑公共接口、迁移、配置、业务源、旧测试、B报告或根NotesUI。最终依赖包括I c0e40da及B5197adb/8ede4e4；同步时曾因依赖文档缺失产生冲突，均abort后按正式前置提交顺序重取，没有手改他人文件解决。不要合F整个分支；只取5d366cc、63cd205、ca30876及本报告提交。

### 完成的验证能力

四官方v3人生中的可信近期成功只推进一个有来源阶段，长期追求仍进行中，新机会未接受；机会真实行动才有第二阶段。失败、partial、计划、假设、用户自述、跨世界/所有者/来源/版本/初始定义篡改均不能授予进度。独立检查同来源幂等、旧状态不回填、历史无未来、实际generic事实窗口淘汰后的有限proof保留、模型额外字段不获权，及四pack读侧机会key/title/derivedID防御。

独立审查发现的唯一新增确定性缺口：阻断trigger/pursuit ID后，机会从raw state.facts绕过已过滤阶段facts进入NPC context。已交B修复8ede4e4，保留原失败断言；修复后21/21通过。又在真实PG保存后的world上验证actorContext：原见证NPC能见机会，阻断trigger/pursuit后不能见阶段fact与机会标题/说明。本Q未修改业务源，未将它描述为已发生的公网或真实模型泄漏。

### 本人实际运行证据

- 新独立纯规则专项：21/21，通过；0skip/TODO。
- 新独立PostgreSQL专项：10/10，通过（9行为场景+容器）；0skip/TODO。
- npm run check：746/746，通过，边界/类型/完整test均通过。
- npm run build：exit0。最终PG文件追加真实隐私断言后，专项及npm run typecheck再次通过。
- 两个新增文件Prettier检查、git diff --check通过。
- 忽略证据：主目录.local/matter-progression-audit-pg/evidence/{pure,pg-final,check-final,build-final,typecheck-final}.log。未复制runtime或密码到报告。

第一次整体check在全新dev库未应用迁移时未正常收尾，已中止；随后在本人fresh隔离dev库应用已有41迁移并重新完整check获得746/746，不把先前挂起运行计为成功。test库同样用项目正式migrate，未新增SQL或第二数据库方案。

### 哪些是真实数据库证据

fresh cluster位于主目录.local/matter-progression-audit-pg/data，只监听127.0.0.1:55458，使用隔离parallel_life_dev/test与正式pl_app/pl_worker角色。实际OfficialLifeRepository.start→SceneRepository.enterPlace/input→PostgresTaskQueue/runOne→sceneTaskHandler→运行时reducer及真实事务/receipt→PostgresPlayerRecords.read全部执行。

实际负例证明：伪完成/不在场NPC提案导致failed，输入已合法写入后世界结果事务不提交，world version和events/scene_items/memory/commands/scene_receipts/Outbox/tasks行数不变；任务失败状态与诊断本身允许保存。实际RLS令另一owner查不到world或records；两个同expectedVersion命令只一个成功；同command及重复读取不接受/重复机会。失败的新机会没有阶段成果，另一次真实显式行动才完成第二阶段，长期仍进行中、机会仍唯一。实际存储全事件从immutable initial回放的matters与version与持久结果一致，早于触发版本没有未来成果，重复回放一致，initial未修改。

另有明确合成的legacy兼容存档，经真实Repository存储后多次读，state/version/initial与events/tasks/commands行数不变，不填可选progress字段。它不是旧用户生产存档，也不是伪造历史业务验收。测试仅清理本人本次随机账号；没有读取、复用或删除旧CHAT夹具、私有JSON、旧cluster或其他Agent数据。

### 原型及限制

0模型/图片调用；planner为明确q-synthetic-no-model合成裁定，证明持久运行时边界，不证明真实模型理解或NPC文字质量。纯测试夹具与历史checkpoint属于领域原型；其中长历史是实际领域函数回放，但不是大规模生产数据库性能验收。真正PG证据仅上述正式Repository/Queue/事务用例。

仅四官方v3有限两阶段链；通用动态条件、长线多步终局、资源奖励到账、互斥失效及真实模型质量不在本任务，不因746测试宣称整款产品完备。本Q没有改UI或做手机/PC浏览器验收；根负责Notes组件/导航及双端/公网联合检查。

### 接续与资源释放

源码已冻结；PG55458/session55741已正常SIGINT停止，lsof确认无监听，fresh数据与安全日志留存忽略目录，不删除旧资源。本Q没有HTTP/browser资源，0生产写、0部署、未推main。

I下一步只取上述Q独立patch及报告，在B8ede4e4/I c0e40da统一基线再跑联合check、真实PG、build及Notes双端/来源导航，确认既有生产41迁移一致后由I唯一提交部署、等待READY并公网实测。上线前只标待验收，不能已完成；真实模型质量仍由单列AI-QA接续，不自动领取其他任务。
