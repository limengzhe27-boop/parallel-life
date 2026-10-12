# WORLD-PUBLISH-01B-STORE

2026-10-12；codex-world-publish01b-store-01a11a84-20261012。进行中：第一步公共契约/DDL权限提案待I冻结，未创建数据库/执行0042或实现repository。

## 起点及独占

独立/Users/limengzhe/.codex/worktrees/world-publications-store-01b/人生剧本，codex/world-publications-store-01b。0ee892b+精确19f→87f→fc6→4fb→359安全链（本树50c0c17/98b36f1/04cb419/138c68b/1a26c73）字节相同，不夹NPC/UI/身份源码。根已确认联合206/Q独立194，解除依赖后主表短锁领取。

仅新0042_world_publications.sql、contracts/world-publisher.ts、settings/infrastructure/publication-repository.ts、tests/integration/world-publications.test.ts、tests/world-publisher-contract.test.ts、本报告与本人行。0042和本地55477独占，启动前已核无监听但尚未启；旧41、world/seed/history、private setting_drafts、身份、API/UI只读。0模型/生产迁移/生产业务写/素材/图/部署；密码仅ignored配置，不记录。

## 提案给I冻结

Actor身份仅repository方法独立principalId参数，必须Root signed session验证后提供；请求体严格只接受命令与版本/数据，拒principalId/role/approved/supported。DB active/canEdit/canPublish在读取、长检查准备后、提交及回执重放前重查，不以登录通过替代。

契约新文件导出：PublisherDraftContentSchema为先纯JSON64KB/原型守卫再record，{}、不完整/未知schema保私有可保存。create(commandId,title,content)，save(commandId,expectedDraftVersion,content)，check(commandId,expectedDraftVersion)，publish(commandId,expectedDraftVersion,expectedMetadataVersion,checkId)，unpublish(commandId,expectedMetadataVersion)，restore(commandId,expectedMetadataVersion,publicationVersion)。所有version非负安全整数，正式version>=1；body不接受世界owner、approved、runtime registry或员工标志。

Work区分draftVersion与metadataVersion；metadata只在上架/下架/恢复/正式新版本时递增，保存草稿不替换正式内容。get返回当前工作summary+精确草稿version/hash/content，可指定旧草稿修订读取；list仅summary，分页100/nextCursor，不把原稿批量塞列表。public catalog同样分页，不限四个固定ID，但不接创建世界。

check返回invalid/blocked/ready和安全code/path/missingCapabilities/mediaVerified/trialVerified；invalid表示PublishedWorldContentSchema拒，不阻止原私稿保存。check不是发布授权；ready只有可信server ReviewPort提供真实adapter registry、媒体manifest核验和精确修订试演依据时才可得，默认registry空/media未核/trial未核，因此发布不能成功。校验报告不把隐藏正文/模型回复/secret混入错误。

拟Repository(db,ReviewPort=unavailable)导出list/get/create/save/check/publish/unpublish/restore/publicCatalog；ReviewPort接work/draft/hash与已parse内容，返回可信runtimeCapabilities、mediaManifestHash/verified、trialReceiptId/verified与reviewerVersion。它是Root constructor内部依赖，不是body。check保存精确revision/hash/依据；publish和restore再次调用可信核验并在短提交事务复核版本/权限，防素材或adapter在旧check之后变化。有效gate仅内测fixture，不声明生产已有adapter/素材/试演。

## DDL/RLS六类新表

1. publisher_principals(UUID id/displayName/canEdit/canPublish/active)：不放密码、不FK到私人guest账户；管理员受控bootstrap，pl_app/pl_worker不能自助授权，pl_publisher无写principals权限。
2. publication_works(UUID id/title/createdBy/draftVersion/metadataVersion/currentPublicationVersion/listed/times)：独立内部team，不开放private setting_drafts。版本复合FK与正数/单调/上架必有指针约束。
3. publication_draft_revisions(work/version/content JSONB/contentHash/createdBy/time)：immutable修订，允许未填完但只纯JSON64KB（应用原始紧凑字节）。DB JSONB ::text会加格式空格，拟96KB物理安全界限，不假称二者字节完全相同；与既有16KB应用/32KB DB相似有序列化余量。I可调整，近边界不截断数据。
4. publication_checks(UUID/work/draft/hash/status/安全issues+missing/受控basis)：精确修订FK；默认blocked，可保存检查结果但不准client写伪ready。发布必须绑定相符check且重新核gate。immutable历史检查与结果可恢复。
5. publication_versions(work/publicationVersion/fromDraft/check/content+hash/safeCard/mediaManifest/trial/reviewer/createdBy/time)：immutable正式内容，复合FK锁住确定修订/检查；不能UPDATE旧正式版改玩家起点。正式号由锁work后服务端分配，不用body提供。
6. publication_receipts(principal+command/hash/operation/work/result/time)：不可变幂等；同ID异hash拒。JSON请求hash规范化key顺序，读回JSONB后不因键排序变化误判；回执读取/重放前再核当前权限。

角色pl_publisher NOLOGIN/NOBYPASSRLS，只新表/函数最小权限和schema USAGE，无旧profile/world权限。本地测试另LOGIN成员fixture，绝不把生产role改LOGIN或输出密码。可信publisher.principal_id使用事务local set_config，不复用app.user_id作为staff授权。

政策/trigger以active读取、canEdit草稿写、canPublish正式与上下架控制；work draftVersion变化只能+1且不得动正式pointer，metadataVersion变化只能+1且不得动draft，身份字段不可变。必要权限函数SECURITY DEFINER固定search_path=pg_catalog并拒PUBLIC/app/worker执行；命令授权函数可FOR SHARE锁principal行，避免给publisher UPDATE principals权限来锁撤销。RLS ENABLE+FORCE，pub raw checks/稿/versions不给pl_app SELECT；公开catalog用窄SECURITY DEFINER函数只投影当前listed安全card字段，不返回隐藏全文/素材私URL，app只能执行该只读函数。

## 实施后真实PG目标

分local dev/test55477；普通app伪principal上下文仍无raw访问，inactive或缺publish拒/回执重放拒；未知schema/{}可保存但check invalid/publish拒；无adapter/media/trial默认不成功；合成可信fixture能测试版本/FK/immutable/原子但不冒充真实发布。重复/异hash、并发save/publish/meta单赢家、素材依据错修订、check后撤权/更新、restore旧版不改正式内容、下架安全catalog消失且版本保留、迟发异常全部回滚、旧41 checksums/四模板/实际initial快照不变，至少18专项。

当前没有DDL执行或repository实现，先请I审核以上请求/返回名、两个版本语义、检查表及ReviewPort/DB角色设计后冻结；UI/HTTP只有Root接线，正式instance/admission/media storage不在此任务。

## 根补问的明确边界/方法/错误码提案

首期单一内部team：active staff能读新内部作品，canEdit可编辑任何团队作品，canPublish可发布/下架/恢复任何团队作品；created_by只审计，不作私有owner筛选，绝不依用户名授权。需要个人工作区或多组织时后续新scope迁移，不先悄悄赋全体staff读取旧玩家setting_drafts。Root signed权限与DB权限取交集；repo DB权限不是让Root跳过session operation权限。

拟方法签名（仅提案待批准）：list(principalId,{limit?,cursor?})=>PublisherWorkList；get(principalId,workId,draftVersion?)=>PublisherWork；create(principalId,PublisherCreateWork)=>PublisherWork；save(principalId,workId,PublisherSaveDraft)=>PublisherWork；check(principalId,workId,PublisherCheckDraft)=>PublisherCheckResult；publish(principalId,workId,PublisherPublish)=>PublisherPublicationResult；unpublish(principalId,workId,PublisherUnpublish)=>同result；restore(principalId,workId,PublisherRestore)=>同result；publicCatalog({limit?,cursor?})=>PublishedWorkCatalog（另安全只读函数，普通app仅此公开函数）；consumeLoginLimit(kind,bucketHash)=>{allowed,retryAfterSeconds}（无principal，因为登录前，不提供后台写权限）。

错误码沿已有稳定TaskError：FORBIDDEN（无内部DB角色/active/所需权限），NOT_FOUND（作品/修订/检查不存在或不属于关联），VERSION_CONFLICT（draft/meta竞态），IDEMPOTENCY_CONFLICT（同command异内容），INVALID_INPUT（非纯JSON/非法请求），INVALID_STATE（未ready/过时依据/未上架等状态不允许）。数据库/服务依赖错误由Root HTTP统一UNAVAILABLE，不把全稿/SQL/密码写错误。登录限流allowed=false由Root响应RATE_LIMITED/429和retry秒；校验invalid/blocked为可保存结果而不是假发布成功。

提议0042新增第7类独立publisher_login_buckets：kind(global/client/username)、bucket_hash（服务端HMAC，64hex）、window_started_at、attempts，组合PK；无用户名/IP/密码/令牌/验证值。除管理员维护外不授pl_publisher直接读写表，仅窄consume函数SECURITY DEFINER+固定search_path，EXECUTE只给pl_publisher，普通app/worker/PUBLIC拒。

函数用真实数据库时间做登录限流（与世界故事时钟无关），固定kind规则，原子upsert同桶、并发不丢计数/过期窗重置、错误hash/kind拒；Root在scrypt之前生成global/client/username三个HMAC桶，全部均需放行，不从body接受limit/窗口参数。初提global60次/60秒、client10次/15分钟、username6次/15分钟，数值由Root冻结后实现；匿名浏览器不能直连publisher DB函数，HTTP只用私有服务role。用户名桶不可用不加盐SHA以免字典还原；HMAC密钥只服务端ignored环境。测试只本地bootstrap LOGIN成员，不给生产pl_publisher LOGIN。

当前只新增contract提案，类型/边界检查待记录；尚未写42 SQL或启55477。Root请冻结上述team范围、方法/输出/错误、ReviewPort检查证据与限流规则后再实施，同六文件独占保持。

提案检查：新contract专项6/6pass、type0/339boundary、git diff --check过；尚未实现repository/42或启动PG。这些只证明请求/私稿结构边界，不证明保存/发布后台可用。版本列拟bigint并约束<=JS MAX_SAFE_INTEGER，与现Version契约一致，回DTO显式转换，不让超大expectedVersion默入32位截断。根可在冻结时缩为int并同步新契约，不改旧Version类型。

## 给I的具体冻结表（团队与登录桶方向已批准）

|命令/读取|请求字段（只这些）|返回|
|---|---|---|
|create|commandId UUID；title非空<=80；content纯JSON object，可{}，compact UTF8<=64KB|PublisherWork|
|save|commandId；expectedDraftVersion；content同上|PublisherWork，draftVersion+1，metadataVersion/正式pointer不变|
|check|commandId；expectedDraftVersion|PublisherCheckResult；绑定当前精确draft/hash；非完整或unsupported照实invalid/blocked|
|publish|commandId；expectedDraftVersion；expectedMetadataVersion；checkId UUID|PublisherPublicationResult，服务端新publicationVersion、meta+1；不由body给approved/caps|
|unpublish|commandId；expectedMetadataVersion|PublisherPublicationResult，meta+1/status=unpublished，保正式版本及pointer|
|restore|commandId；expectedMetadataVersion；publicationVersion>=1|PublisherPublicationResult，meta+1/status=published，恢复指定已有本作品版；重新Root gate核验，不造新版本|
|list|可信principalId独立参数；limit1..100、cursor UUID可省略|works summary[]/nextCursor nullable，不返回正文|
|get|可信principalId、workId UUID，draftVersion可省略（当前）|PublisherWork，可读不可变历史修订|
|publicCatalog|limit1..100、cursor UUID可省略，无员工principal参数|安全work cards[]/nextCursor，只已上架，无原稿/实例|
|consumeLoginLimit|kind=global/client/username；服务端HMAC bucketHash 64hex，无body窗口/limit参数|allowed bool/retryAfterSeconds int，Root登录前消费3桶|

所有请求version为0..Number.MAX_SAFE_INTEGER整数，正式version>=1；数据库bigint+同上限，禁止负数/小数/截断。请求体一律strict，员工id/role/owner/approved/supported/canPublish不在合同中。

PublisherWorkSummary：id/title/draftVersion/metadataVersion/status(draft|published|unpublished)/publicationVersion(nullable)/createdAt/updatedAt。
PublisherWork：上述summary+draft{version/contentHash64hex/content(JSON)/createdAt/createdByUUID}。
PublisherCheckResult：id/workId/draftVersion/contentHash/status(invalid|blocked|ready)/issues[{path:(string|number)[],code}]/missingCapabilities[]/mediaVerified/trialVerified/checkedAt；无原稿文本/密码/模型原始错误。
PublisherPublicationResult：workId/publicationVersion/metadataVersion/status(published|unpublished)。
PublishedWorkCard：id/version/title/hook/identityLabel/experienceNote/description；初版不返回任何素材URL或完整结构模板。

|数据库对象|pl_publisher内部服务|pl_app普通玩家|pl_worker|管理员bootstrap|
|---|---|---|---|---|
|publisher_principals|SELECT仅当前上下文自身；无INSERT/UPDATE/DELETE|无|无|可登记/撤权active和edit/publish，密码不入表|
|publication_works|active team SELECT；edit create/save；publish上下架指针，trigger限制字段/单调版本|无原表权限|无|迁移/恢复维护|
|draft revisions|active team SELECT；edit INSERT；禁止UPDATE/DELETE|无|无|本地fixture清理/受控维护|
|checks|active team SELECT；edit或publish可检查后INSERT，immutable|无|无|维护|
|formal versions|active team SELECT；publish INSERT，immutable|无隐藏全文|无|维护，非自动覆盖旧版|
|receipts|只当前principal SELECT/INSERT，immutable，重放前权限检查|无|无|维护|
|login buckets|无直接表权限，仅consume函数|无|无|清理过期桶|
|internal has/lock_permission functions|EXECUTE；principal来自可信事务上下文，提交前锁核当前active/权限|无|无|函数所有者|
|consume_login_limit函数|EXECUTE（私有服务连接，登录前可调用但不授作品权限）|无|无|函数所有者|
|published_work_catalog只读函数|EXECUTE|仅此safe目录EXECUTE（不是内部publisher写/原稿函数）|无|函数所有者|

所有新表ENABLE+FORCE RLS，新角色NOLOGIN/NOBYPASS；函数SECURITY DEFINER固定search_path=pg_catalog、全qualified表名，REVOKE PUBLIC。主要FK：work-currentDraft→draftRevision、work-publicationPointer→formalVersion均复合work/version且deferrable；check→精确draft/hash；formalVersion→精确draft/hash和check；receipt→principal/work。当前draft可变，修订/check/formal/receipt UPDATE/DELETE禁止。版本身份createdBy、创建时间不可改；metadata更新不改draft，save不改published内容。

Root API错误冻结建议：身份cookie缺失/签名失效由Root UNAUTHORIZED/401；DB未知/inactive/operation权限不足FORBIDDEN/403；相关记录不存在NOT_FOUND/404；draft/meta冲突VERSION_CONFLICT/409；同command异请求IDEMPOTENCY_CONFLICT/409；非法JSON/strict体INVALID_INPUT/422；未ready或restore/unpublish状态不允许INVALID_STATE/409；登录桶不足RATE_LIMITED/429+retry；真实DB/gate依赖故障UNAVAILABLE/503。check invalid/blocked本身为200可读检查结果，不吞成成功发布。

Trusted ReviewPort建议内部输入{workId,draftVersion,contentHash,content:严格parse后的PublishedWorldContent}；返回{reviewerVersion,runtimeCapabilities:ReadonlySet<string>,media:{verified,manifestHash:null|64hex},trial:{verified,receiptId:null|UUID}}。默认返回runtime空、media/trial未核。该参数只Root constructor/service注册，不从body传入。publish需原check精确revision/hash+同素材manifest/试演依据，且当次gate仍ready；restore核已有formal的精确内容/依据，不依赖新草稿当前内容。长核验在事务外，提交再锁work+principal、比版本/hash、原子版本/metadata/receipt，不占锁等模型。

拟登录桶固定额度仍为global60/60秒、client10/900秒、username6/900秒；哈希用Root服务端HMAC，不存IP/username、密码、token、验证值。窗口计数用DB真实时间，不接世界clock；同桶原子并发upsert，未过期超额仍不放行，过期重置。若Root调整额度，仅本0042独占落实，不扩旧guest登录或limits表。

以上具体合同/权限/错误待I最终冻结后实施repository与42；合同当前34421ac可直接审新src/contracts/world-publisher.ts，未启动55477/执行任何SQL。

## 最终候选源冻结（技术持久化已实现，后台未接线）

根最新优先级已执行：只保存/检查/发布/目录及原写好的下架恢复底座，不增加高级版本面板。Repository新增getPrincipal(principalId):Promise<PublisherPrincipal|null>，可信事务local publisher.principal_id、自身SELECT+active过滤，停用/不存在返回null，错误角色FORBIDDEN；不从请求取角色、不增加42权限，Root signed与DB交集由HTTP接线负责。新增实际PG证明当前改权立即反映/连接上下文不泄露。

实际导出与最后合同：PublicationRepository(db, reviews=unavailable)，PublicationReviewPort；getPrincipal/list/get/create/save/check/publish/unpublish/restore/publicCatalog/consumeLoginLimit。world-publisher.ts保持344提案字段，仅根明确补save optional title、checkResult issuesTruncated以及list/result/catalog type导出。完整方法/请求/DTO见上表。save改title同revision乐观锁与回执，正式card从immutable content读取；不传title保旧。hash含principal/op/workId与canonical key排序JSON，null-prototype数组也能无代码执行地canon/roundtrip。provider输入深拷贝，exceptions不当ready，默认能力空/媒体与试演未核；ready与成功发布仅在本地明确合成review夹具中验证，不冒充真实运行支持。

最终发布专项23/23真实PG（22独立子项+父项）、7新契约、npm run check1444/1444/type0/340boundary/build0/指定格式diff0。整批PG此前279=273pass/5明示real-model opt-in skip/1旧role-grants分类断言fail；新增getPrincipal后其自身23专门复验过，未把该整批旧断言写成绿，等I精确修只读oldtest后统一复验。旧41hash与四官方template/真实initial/world/instance值保持；最终local dev/test全42hash逐项只读与files一致，证据ignored .local/store-local-migrations.json。本地55477已正常停止，无端口/HTTP/worker/模型在途。42尚未生产应用。

首次旧库测试strip-only不支持本人constructor参数属性，修自己repo为显式字段；首次42 PLpgsql NOT CASE表达式缺括号，整个42事务回滚，修源后才本地正式应用；首个truncation fixture只产生60issues不足100，换本人的多字段错型fixture产生实际>100，未改实现阈值/旧测试。完整check第一次因只准备test而dev未迁移，旧character-image-flow连接未准备dev清理挂起；只停止本人test进程、对本地dev应用迁移后完整重跑1444/build0，不改旧tests/假跳过。错误/回滚与接续均如实保留，本轮0真实AI/图/上传/生产库/新生产世界/生产角色/部署。

交接：源码六文件冻结，Root可按提案34421ac→304d02a→本次实现后继集成（前置content安全两文件与359869c字节一致，原依赖各cherry仅供独立树准备，不再作为STORE差异重入Root）。唯一I需要先对旧role-grants正确新增staffOnly审计/权限反例，再全PG/fullcheck/build；生产42/受控NOLOGIN成员连接及principal bootstrap、登录/HTTP限流、内部工作台、真实review/素材/试演、动态实例化与上架公众体验均由后续已分配切片，未在本项假称完成。

## 根集成本地端口守卫小后继（2026-10-12）

根在本人登记55476集成时被新test硬编码55477挡住，23项业务断言尚未执行，不是业务失败。按根明确要求仅改本新test与本报告：PUBLISHER_TEST_PORT默认55477；显式值须正十进制整数、1..65535、等于当前localConfig.port；在adminClient连接前拒绝非法/不匹配值。adminClient仍固定127.0.0.1与parallel_life_test，全部app/worker/publisher夹具沿该local config连接，绝不读生产DATABASE_URL、不自动改配置/切库。所有23项业务用例/fixture/迁移/repository/合同均未改。

本人55477确认无监听后重启原独立本地cluster；默认与显式55477各23/23真实PG通过；0/65536/小数/负数/带空格/显式55476不匹配六反例在连接前失败。完整check1444/1444、build0、diff0。第一轮check在本人PG尚未启动前遇旧character-image-flow ECONNREFUSED，启动原库后完整重跑通过；未改原test/跳过。根应以PUBLISHER_TEST_PORT=55476在自己库复验，不宣称根23已绿。本次0生产迁移/图/模型/部署，新43另独立树准备。
