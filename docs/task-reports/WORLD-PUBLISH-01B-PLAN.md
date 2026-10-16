# WORLD-PUBLISH-01B-PLAN

2026-10-12；负责人codex-world-publish01b-plan-01a11a84-20261012；只读规划，待I冻结公共契约。主表按I明确指定任务短锁登记，只写本报告及本人行，未领取后端实施范围。

准确核查基线83f9c114770730876212ec9568e331db6af1d08e；用git show读取已发布文件，不把主目录旧96e51d1或未提交creations页面当后台。已读WORLD_PUBLISHING_MVP_PLAN.md及script-library/urban-relationship/INTAKE.md；没有打开原稿内部链接、复制私有原件或公开原稿。本轮0模型/PG/生产写/素材上传/生图/端口/部署，无源码/契约/SQL修改。

## 已有能力及准确限制

|路径/机制|真实能力|发布后台不能直接继承的部分|
|---|---|---|
|0032_setting_drafts、0033_setting_revision_delete_guard；setting-draft-repository|owner私有草稿、不可变修订、当前修订FK、命令hash、乐观更新；每owner最多20draft/version0–99|没有作品组织、员工权限、审核、发布状态。owner RLS不能直接改成全站作者可读；现私有用户创作继续保留。|
|0034_setting_trials；setting-trial-repository|精确draft/version取修订→独立ApprovedSeed→持久build；同command回同seed/build；不复制现实档案正文|trial仍要owner profile FK，只作身份引用；不是员工发布身份。试演创建会走模型任务，不能dry-run自动触发。无“试演通过”的可信自动评分；旧修订试演不能替新稿背书。|
|LifeSettingContent schemaVersion1|2–7人物，role/desire/voice；有限关系/1–5故事线，entryCue明确编辑意图；总16KB；关系与source引用验证|不是任意可执行节点图，未有结构化公开人物卡/素材/成就。API parseBody还有20KB上限、DB JSONB32KB；必须协同版本化/预算，不只调一个上限。Trial当前拒重复姓名，而人物身份应稳定ID；需单独兼容验证后调整，不按同名合并。|
|0040_official_lives；OfficialLifeId/Card/List/ApprovedSeed|四固定ID枚举，列表max4，instances preset_id四值CHECK；按owner/preset/version唯一独立世界、hash回执、不可更新|无动态目录/上下架、后台冻结发布源。instances不是模板表，增加一行并不能发布。ApprovedSeed official source无profile可用，旧个人/试演FK不可因此全部移除。|
|official-life-repository及OfficialLifeCatalog|服务端静态pack，list仅公开card；start原子创建seed、world、不可变initial、build metadata、clock、instance、receipt|旧事件来源已定，不能更新state.initial让旧档吃新稿。动态发布接线要保持同样事务原子性和无伪AI成功任务。|
|officialGenesis|稳定local key→新UUID；6NPC；恰3条来自3人的当前通知；每NPC至少1至6条历史；各时间/引用/知识边界校验|新稿人数、来信数不能硬凑六人三通知；新初识角色无旧聊天时不能编聊天。放宽数量须新协议并保引用/时间/有界上下文；不能只删旧assert。|
|0041_world_space|玩家行进回执与commands/events同源FK、owner RLS、immutable|不是节点/作品目录迁移。到地点≠节点完成，不能重解释已有行进事件生成从未发生的玩家选择。|
|SignedSession、server/http authenticated|签名游客ID/过期+账户存在，写Origin/CSRF、owner上下文|证明游客会话，不证明员工/发布权限，也不含可撤销员工角色。后台路由隐藏不构成授权。|
|AssetRepository.readForWorld及0039头像|owner/world/ready/revision与既有授权binding/current-avatar检查|私有owner资产URL不能公开模板复用。发布封面、角色/场景图、剧中照片须独立许可及可见性；上传白板/关系图不自动变角色肖像。|
|scene-step-progress等|有限county-yellow-hair/指定matter/version的R17真实步骤与来源；旧规则未变，母04真实全链未通过|不是通用作者任务引擎；新稿写转账、亲密度、小游戏或任意条件不能获得执行能力，也不能借旧R17规则给新节点假完成。|

## 建议最小持久化边界（待I评审，未定义迁移号）

**先版本化结构内容，不按每个作者字段新增SQL列。**世界观、人物public/private设定、角色关系/初始知情、已发生history、开场手机、地点、候选节点/编辑意图、导演基调存于带schemaVersion的修订内容；演员/地点/节点使用作品内稳定key，不用姓名/标题关联。可发布内容与原稿分离：原稿仅私有归档/核对，运行包由编译器白名单产出并附capabilityVersion；未知schema或未支持的可执行要求阻止发布或明确留在未发布草稿，不能静默宣布可玩。

实际需要关系表/列/约束的建议如下；名称供讨论，不是已冻结API/DDL：

|实体|必要列与约束|为什么不只塞JSON|
|---|---|---|
|内部principal/role grant|可信员工身份映射、作用域、权限、撤销/到期、auth version，受控bootstrap和审计|服务端/DB命令都能检查可撤销发布权；client owner/role字符串无效。发布组织的资产不应随私人guest账户删除而cascade丢失。|
|作品registry|稳定work ID、草稿引用、当前正式version、上架状态、metadataVersion、创建/更新时间|目录分页/过滤与上下架并发锁。current version复合FK指向本作品已冻结版本，不能指向别作；不要把title当unique主键。|
|不可变publication version|work ID+positive version PK、schema/capability/compiler version、批准修订定位、内容/公开card、contentHash/mediaManifestHash、操作者/时间、检查及试演依据|精确冻结、重现、禁止update/任意delete；版本源约束与单调分配不能依赖client。正式正文只给受控后端，不提供普通玩家完整模板JSON下载。|
|发布素材及绑定|独立publication asset ID/storage key/hash/mime/size/revision、授权用途/可见性、许可审查状态；绑定work/version/role key/place key等|防跨作品/版本借图、撤销/丢失的生命周期、封面公开和秘密图分权。snapshot引用准确不可变资产修订，不能只存owner URL。|
|发布/下架/恢复命令回执及审计|principal+command ID unique、操作目标/expectedVersion/hash、result版本、源动作、时间；授权审计不可任意改|重复幂等、同ID异内容冲突、并发下架/发布排序、追责。权限检查在幂等回放前，撤权用户也不能借旧回执读后台。|
|玩家模板instance binding|owner+work+publicationVersion唯一，seed/world FK+source来源一致；必要时单独新binding表兼容旧official表|每人独立世界、继续旧档/开始新版区别、删除/跨owner约束。public catalog与个人存档查询分离，下架后旧档还应可继续。|

草稿是否继续0032或新增团队草稿表由I决定：个人草稿20/99限制与owner FK不得悄悄重定义；初版若只单作者可复用其修订机制但需作品/员工授权关联。如需多人内部编辑，独立团队scope或显式grant，不能将现owner RLS改成任何staff读全体玩家私有稿。

索引只围绕实际查询：上架作品(state/更新时间/ID分页)、版本(work/version)、实例(owner/work/version)、素材绑定(work/version/use/targetKey)、员工授权(principal/scope)、回执(principal/command)。不为每条性格/节点正文建列或全量GIN。未来节点调度若有跨world due任务，应在实际任务表存world/node/source/due/window/status及唯一调度键；候选节点作者文本现在不需每节点单表。避免发布后台一次新增第二套调度引擎。

## 员工身份与发布事务

- 独立内部登录或已有可信身份服务映射员工principal；游客登录不能自助变staff。grant由受控管理通道设置，可撤销、过期、限制作品/组织与编辑/试演/发布权限。前端不接受role/ownerId/发布操作者作为授权依据。
- 服务端命令执行前及短事务提交时核查当前权限；编辑准备期间撤权需阻止发布，不以早先precheck授权永久生效。长模型/素材网络准备不占数据库事务锁；事务重查冻结修订/hash/素材许可/试演定位。
- 不把发布凭据给普通pl_app或pl_worker；若使用受控数据库函数，固定search_path、最小EXECUTE与受校验principal/context，防任意settings字符串伪造身份。不授予BYPASSRLS；消费者仅查安全card和自己的world，NPC依然只获裁剪知情。
- 发布锁本作品与授权必要行，分配新version、冻结正文/素材manifest/证据、更新current/publication状态、记audit/回执同事务；失败全部回滚。下架仅停止新建，不删除正式版本/已拥有世界。开始体验与下架需锁或可序列化 admission 检查，不能仅依赖事务外缓存判定。
- 内容及媒资许可撤销与“下架”不同：已有存档仍可运行不代表可继续分发被撤许可的图片；素材再读取按独立生命周期策略明确处理，不能回滚后偷偷替换版本图。

## 节点是可能性，不是既定剧情

三个层次分开：作者候选节点内容；导演在当前窗口选择的事件提案；运行时校验且真实保存的世界事件。候选满足前置只成为eligible，不等于triggered/completed或必定发生。导演可以不选、延期或选择其他事件；节点图可以分支互斥，不是全部必须遍历的任务清单。

未来运行节点应使用有界typed条件/效果白名单：引用已经发生的事件/资源、当前时间地点/知情与互斥条件；可执行范围与证据单独冻结，禁止SQL/JS表达式和提示词绕过。导演可提出NPC邀约、环境变化或机会，不能预写玩家已答应/签字/到达/转账/同意关系。玩家选择来自实际输入，完成来自各行为的真实source与接收证据，失败、拒绝、错过和延期都是可保存结果。

eligible→director_selected→committed可分别记有限源/决策version防重，不能把selected写成completed；节点参与NPC按实际presence/observable事实获知，不提前收到全节点图、其他人秘密或可能结局。作者随机概率和“一定触发”不能成为玩家动作来源；随机选择如实现应有可审计选择源/幂等，不能每次刷新重新抽选/自动调模型。未实现的结果如真实通话/图生图/资金到账保持诚实能力状态。

## 旧四模板和玩家存档迁移

1. 新增迁移，不改0032/34/0040/0041既有checksum。先可加新registry/version/media/grant/receipt/binding结构及受控策略，旧四ID/旧read路径保留，避免先改四值CHECK导致旧部署兼容失败。
2. 旧静态四pack按其实际内容版本导入为可信官方发布版本，保旧稳定slug及source.kind official_life读适配；精确计算card/opening/source/media hash，不假导出历史所有版本。旧玩家world_initial和state仍原字节，不由当前pack重建。
3. 动态作品用新增source变体与固定publication ID/version/hash，兼容读取旧official source和setting_draft/personal；不能直接把旧OfficialSeed enum改string而取消服务端目录存在性/发布状态校验。旧无profile official FK例外继续精准，新publication无现实资料来源可另加受约束例外；trial现profile_id和draft owner FK保留。
4. 玩家新instance可独立表记录动态work version，旧official_instances不急于搬迁。要统一时先以精确(owner,preset,contentVersion,world,seed)回填新binding并校验唯一/源一致，旧receipts返回值不变；没有源版本正文的legacy世界只继续存档，不假称可重建模板。
5. WorldState旧schema保持可读，新增publication binding按可选字段/外部绑定；NPC稳定character key→实际world actor UUID持久映射供资料/素材/节点引用，不能拿名字/关系改图或隐形演员对应。装饰life-art匹配不能成为权限或正式发布身份。
6. 新协议允许有界不同人数/开场通知/零历史，保时间和所有引用验证、上下文预算及现实资料隔离；旧v1–v3四包仍按旧编译/校验器重放。建议人数/通知上限由I结合现模型调用上界冻结，不在规划硬定任意数目或删除三通知守卫。

## dry-run、回滚与上线边界

- dry-run只读选定草稿修订、身份/授权、支持能力、引用/时间/可见性和素材manifest；产生未发布检查报告/hash，不创建world/trial、不调模型、不上传图片、不改current publication。原稿内部链接不被导入器主动抓取。
- 本地真实PG先迁移→导旧四包→新动态包→序列化/权限/回滚矩阵，读回旧seed/initial/world/receipt摘要核验。生产只读checksum/兼容前置核查后，由I按独立项目授权应用新迁移；不能试着在生产DROP重建或修改0040历史文件。
- 发布前任何失败回滚正式version/current指针/回执/audit；对象存储准备物可以保私有待回收，事务失败不公开引用，清理只删无引用暂存对象。
- 发布后的撤回靠新上下架/选择已冻结旧版命令，不“UPDATE修正发布JSON”。已创建新世界保原版本；不可把旧schema代码直接回退到不认识新seed的部署，应关闭新发布/新建feature gate但保新增reader。没有新实例前可停止新功能，仍不要求自动DROP新表。
- 本任务0部署；实施批需fullcheck/build、真实PG、生产迁移核对、READY、公网普通玩家/员工/双用户独立验证。既有母04失败不因后台可保存模板而改完成。

## 实施所需真实PG验收矩阵（本轮未执行，18例）

|#|实际事务测试|预期证据|
|---|---|---|
|1|普通guest、伪role/owner字段发布/读后台原稿|拒绝，0正式version/回执/正文泄露。|
|2|编辑者无publish grant、过期grant、跨scope作品|均拒；不能把owner私有草稿权当staff发布权。|
|3|dry-run后/模型准备期间撤权，提交再核|提交失败，冻结版本/current不变；旧幂等回执也不绕权限。|
|4|两命令同expected metadata/revision并发发布|精确一成功一冲突；version唯一，不能晚稿覆盖。|
|5|同command同hash重放及同ID异hash|原版本/原回执不重发；异内容冲突，无第二audit业务动作。|
|6|新修订用旧试演/检查hash或不同素材manifest|阻止发布，不用v1结果为v2背书。|
|7|素材跨owner/作品/版本、未许可、deleted/错revision|发布或读取拒，公共页不出现私有资产URL。|
|8|card公开查询与幕后正文/秘密图片读取|普通player只得安全card；未获知演员看不到幕后内容。|
|9|两普通账号开始同模板版本|各自seed/world/actor UUID/event/message/memory/clock独立，RLS互读404。|
|10|同owner同template/version重复并发开始|唯一instance，相同command同回执；异命令恢复原实例，不重复开世界。|
|11|实例事务中初始快照/clock/绑定/回执任一迟发失败|所有创建结果回滚，无孤儿seed/half-world/假成功task。|
|12|发布新版并继续旧四包及动态旧存档|old state/initial/事件/source hash不变；新开绑定新版，不自动迁移旧过去。|
|13|开始体验与下架并发；下架后重试/继续|按明确提交序结果，下架后不新建；已有回执/旧档可恢复。|
|14|恢复上架/切已冻结旧版与未知版/跨作品版|仅合法本作冻结版可成为current；FK与hash关联拒错误。|
|15|不同人数/开场通知/零历史的新协议与旧四模板|新合法起点无凑数假history，旧compile兼容；坏actor/time/localkey引用拒绝。|
|16|候选节点已eligible/被导演选择但玩家未采取行动|不写玩家选择/完成/奖励；延期或未选可保存且不自动再调用。|
|17|节点声称NPC收到但无真实动作、未来/引用/否定或不可见source|事务拒绝或合法保存未完成状态，不能发成果/机会；原来源不变。|
|18|节点调度重放/版本冲突/互斥与未知外貌关系|只一次真实事件；冲突回滚、未选支线不成事实；稳定key映射不按姓名混人。|

矩阵实施时使用真实数据库运行角色/RLS和并发事务，不用superuser结果冒充player权限；模型输出用明确fixture可测事务，但不代表真实模型质量。实际发布完整体验仍另设授权真实模型批次，旧04不续。

## 冻结与接续

I先冻结动态ID/source兼容、内部principal/grant、发布内容schema/编译能力/公开私有字段、素材权限/复制生命周期、实例admission与上下架、旧版本导入策略，然后分配独占SQL及repository/API实现；UI可在契约冻结后开发，不与根/他人同时改公共契约或迁移。本人仅规划文件交接，不自行实施新表或公开供稿。

NPC-AVATAR-UNIFY-03B已冻结2fd8917ee4cd5ecc03277e80fb9a3407a1f6b9b2，32局部/type0/337boundary，待I双端/fullcheck/build/READY。用户已明确授权同步结果，但发送工具本轮返回“requires approval, approval policy is never”，消息未发出；未绕过或将失败当同步成功。此限制不影响当前报告交付。

登记接续：I稍后新增同任务分配行，与本人先按明确指令登记行重复；本人短锁合并仅此任务两行，保I定义及唯一Agent、待验收状态，未改其他任务。建议六类核心持久实体加既有草稿机制，非已冻结七张新表。
