# WORLD-PUBLISH-01E-STORE · 发布世界与员工私有试演持久化

2026-10-12；Agent codex-world-publish01e-store-01a11a84-20261012。根唯一集成，主表已短锁领取进行中（准备）。独立 /Users/limengzhe/.codex/worktrees/publication-worlds-store-01e/人生剧本，codex/world-publish01e-store，自3c24bf6（836c12b/76ba6e4/已冻STORE），不夹HTTP WIP。仅新0043_publication_worlds.sql、settings/application/publication-world-ports.ts、settings/infrastructure/publication-world-repository.ts、contracts/publication-worlds.ts、新integration/publication-worlds.test.ts/契约专项、本报告及本人主行。Q编译四文件及所有旧源/42只读。55478确认无监听且尚未启动；0模型/图/上传/生产迁移/世界写/部署。

## 极小合同候选，待根冻结

- startPublished(ownerId,workId,{commandId,publicationVersion})：可信session owner不从body收，返回worldId/seedId/workId/publicationVersion/draftVersion/contentHash/replayed。安全目录仅card+自己存档，不能取内部全稿。
- startTrial(principalId,workId,{commandId,draftVersion,contentHash})：当前员工权限再核、精确保存修订；试演owner内部生成独立身份，不借用真实玩家档案访谈。返回trialId/worldId/origin/replayed，原稿不返回普通app。
- getTrial(principalId,trialId)与trialEvidence(principalId,workId,draftVersion,contentHash)：内部员工授权；证据只允许精确试演同owner/world的assistant消息与world_events version>0实际提交sourceEvent关联，genesis历史不能计入。未核默认verified=false/receiptId=null。
- CompilerPort.prepare({content,origin,ownerId,worldId,seedId})由内部构造注入，消费Q冻结WorldState v0、PublicationOpeningMetadata与namespace映射；body不接受compiled/approved/caps。origin仅workId/publicationVersion/draftVersion/contentHash，无publicationId；sourceEvent publication-genesis:<worldId>。

## 跨角色事务提案与未决边界

同事务内窄definer准入：核app.user_id或publisher.principal_id及当前权限，锁work精确上架指针或draft/hash；合法内部repo拿对应内容编译，随后commit再核绑定身份/origin与v0结构，一次写world/clock/initial/binding/receipt。下架竞态由work锁串行；老存档继续不依赖后来上架状态；两owner独立world/记忆。函数固定search_path并REVOKE PUBLIC，publisher仍无普通玩家表任意读写，生产不接admin池。

安全关键尚待根冻结：SQL不得把客户端可传prepared直接当可信编译；需明确内部服务准入绑定与SQL可验证的编译结构/来源约束，不能只用可猜ID作授权。试演专用身份/运行连接、PublishedSeed独立published_work/trial类型以及public-safe metadata公共槽由根负责。收到准确冻结后才写0043与六源测试，不伪造旧story/tradeoff。

当前仅准备，无43源码/SQL执行/PG/HTTP/模型通过证据。旧STORE端口小后继915aa8bb69fb17f4cc8ef007310a717255fed4ae已独立交根（默认/显式55477各23pass），不混入本slice；根55476复验仍未在本报告宣称成功。

## 实际实现与冻结交接（2026-10-12）

准备合同准确50f387f57cc2d36f72090231146634c8a68b7ee6，root已接；本树精确依赖Q615b3af247a7dc03451123ecff4a2d5b8c46ea62→8eef8446a9efd168c80142f8da0a64fa48393821（只读cherry，无Q源改），以及已交Root的STORE端口915aa8bb69fb17f4cc8ef007310a717255fed4ae（仅准确依赖）。本次最终差异只七新文件链，不把这些依赖重复并入root。

PublicationWorldRepository(db,compiler=unavailable)实际方法：startPublished(ownerId,workId,{commandId,publicationVersion})，startTrial(principalId,workId,{commandId,draftVersion,contentHash})，getTrial(principalId,trialId)，trialSession(principalId,trialId)仅内部授权session，trialEvidence(principalId,workId,draftVersion,contentHash)，catalog(ownerId,{limit=50,cursor?})。编译端口prepare input含content/origin/originKind(published_work|trial)/ownerId/worldId/seedId，root适配到Q published|trial，并返回unknown {world,opening,seed}。没有network/model要求；事务内prepare→纯compile→commit。runtime先无执行JSON guard、strict v0/metadata/seed schema、owner/id/完整origin和真实内容公开字段校验、引用/初始来源校验，再检查PostgreSQL JSONB实际物理尺寸，不解析旧ApprovedSeed。actor与public relationship上限600，真实>400合并关系持久化反例通过。默认缺编译器UNAVAILABLE；unsupported/非法结果INVALID_STATE不保存，不冒充能力支持。

43新增三私表：immutable publication_world_bindings（精确源draft/hash/formal FK、独立world/seed、公开owner+version唯一/员工draft trial唯一），immutable publication_world_receipts（kind/requester/command精确请求幂等），publication_world_admissions。全部FORCE RLS且app/worker/publisher无直接表权限。准入窄definer锁current work上架指针或当前draft/hash、锁员工权限、按requester串行；不可猜随机UUID票绑定session_user+SET ROLE身份、backend_pid/txid、requester/origin/hash及三个内部ID；仅同事务一次消费，未消费票deferred constraint拒绝整个提交。commit重核上架/草稿及权限，atomic新world、seed(NULLprofile)、initial、build、clock、binding和receipt；trial owner为独立随机UUID新账号，无profile/interview，clock初始paused=true。普通app不能准入trial，pub无普通玩家表任意读取/写入，生产repo不使用admin池。旧save继续不依赖后续上架状态；公开目录safe cards仅关联当前owner当前formal版存档。

getTrial仅本人trial和当前DBreview权限，safe DTO无owner；根已批准内部trialSession另窄函数，返回ownerId/worldId/seedId/origin供正常app服务内部session，无新public endpoint/不覆盖pl_session/不从body收owner。证据精确work/draft/hash/本人trial，必须同world/owner的version>0事件、succeeded command/result_event及assistant message sourceEvent实际关联；genesis历史/初始来信、玩家message、错误source/其他员工/错误hash都false。receiptId为验证过的精确trial binding UUID，默认未核。

根批准的两个旧约束仅在43窄更新：seed_profile_source保留原profile/official分支，新published_work/publication_trial须deferred同事务binding完整source/owner，app直接fake NULLprofile seed拒绝；world_builds_opening_check旧opening仍<32768，只publication_opening+schemaVersion1允许<65536，缺kind/其他kind/version2不会因SQL NULL逃逸，Q联合64KB预算仍独立保留。实际真compile开场37346字节/总45660，可完整保存12人/12长notes；旧超32KB、错kind/version、超64KB实际PG均拒，不截断。

## 实证与限制

最终专项27/27真实PG（26子项+parent），包括两owner独立actor/world/seed、同名稳定key、跨owner读拒、同命令回放/异请求冲突/并发单实例、private trial不混公开实例、无真实档案、撤权含回放再拒、nonce/跨owner/未消费票拒、late clock失败回滚（含独立trial账号计数）、精确真实投影来源证据、初始历史零证据、下架锁竞态/旧存档继续、14fn精确grant矩阵、known fact与参与者区别、immutable initial/origin、旧42checksum与officialstart、600关系/新旧预算。

实际Q纯compiler34专项与全部contract/unit随1590/1590 check/type0/build0通过，指定格式/diff0。全PG最终307=301pass/5明确real-model opt-in skip/1只读旧role-grants分类断言失败；没有把该整批写成全绿。该旧断言只缺staffOnly（42三触发helpers）/private（43三触发helpers）分类，root明确独占补；新14函数逐项app/staff/private/worker真实权限测试已绿，绝不为旧断言增权限或跳过。root统一源链接入后仍须全PG/check/build、生产迁移42/43和部署READY/public实测，本项不算已上线后台完整体验。

真实PG证据在忽略.local/publication-pg-final-verified.log及publication-full-pg-budget-final.log；check/build分别publication-check-budget-final.log/publication-build-budget-final.log。review approval fixture明确synthetic，仅为准备本地正式版本；世界genesis是真实纯compiler，试演回复为正常WorldRepository提交的明确合成proposal，并非真实供应商自然回复成功。0模型/图/上传/生产角色/迁移/世界写/部署。

修复过程保留：首次43 IF CASE缺括号SQL回滚，未应用坏migration；本fixture reviewReceipt初始随机导致fresh Gate拒，本fixture固定真实本地证明，不改Gate。trial owner早期加字符串前缀不符合Q UUID，改本人43为独立UUID，不放宽compiler。初始无消息fixture不能形成有效source篡改反例，扩成合法历史/来信；证据反例先误选user projection，改fixture精确actual assistant，不改否定断言。首全PG发现旧seed source.kind缺失NULL NOT IN会误入新约束，已修本人43首guard COALESCE，仅新来源检查，并重建本人55478唯一local dev/test后完整复验旧朋友/照片/私人seed已绿。所有WIP迁移重建仅本人全新合成本地cluster，无生产/共享用户数据。未改任何旧source/test或Q源。

14fn权限交接：appOnly publication_admit_published/publication_commit_published/publication_player_catalog；staffOnly publication_admit_trial/publication_commit_trial/publication_get_trial/publication_trial_session/publication_trial_evidence；private（app/worker/pub全拒）publication_bridge_immutable/publication_admission_consumed/publication_seed_binding/publication_binding_result/publication_admit_internal/publication_commit_internal；worker全部拒，search_path均pg_catalog/PUBLIC全部撤权。
