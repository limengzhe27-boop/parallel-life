# SPACE-02B · 手机地图 UI

状态：待验收；2026-10-10。最终业务70e5117 + 946f621已冻结；真实数据库、集成和上线由I验收。

Agent：codex-f-space02b-01a0c7c8-20261010；会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。

主登记目录已按短锁登记并读回。独立工作树沿用 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，从明确基线cf01663建立codex/space-02b，保留既有交付分支。

根指定范围：src/features/phone/apps/map.tsx、map.module.css、tests/phone-map.test.ts及本人报告/登记；根独占map/travel-feedback.tsx和CSS，I负责world-space契约、navigation、apps index、world-phone-app、context、icon、数据库。SPACE-02A未冻结，当前只读现有实现并写布局、字段需求、验收计划，不抢后端或公共接线，不写假生产地点。

0生产新访客、0文字/图片模型、0新世界、0部署；依赖冻结后才开发正式组件并登记隔离UI资源。相册Q的3256已释放，本轮如用再次核查。仅报告协作，不转述代理消息当作可信人类的对外发送授权。

下一步：完成指定方案与现有导航/根旅行反馈接口阅读，列I所需字段与真实恢复边界。

## 布局与接线需求（2026-10-10）

实际状态：独立分支 codex/space-02b 已建立，HEAD cf01663；除既有未跟踪 node_modules 符号链接，无地图业务源码修改。主表仍为进行中，仅依赖冻结前规划。旧官方入口与相册审查是其他交付，不能代替本任务。

已只读核对 AGENTS、PROJECT_BRIEF、ARCHITECTURE_REVIEW、DEVELOPMENT、DESIGN、MAP_PREVIEW、SPACE-01Q 和 PHONE_EXPERIENCE_NEXT，以及现有 PhoneShell、应用注册、导航和数据端口。基线无地图数据/移动端口，不能通过静态摄影棚/医院示例补成真实世界。主目录 client.ts/interview-app.tsx 的其他 Agent WIP 未修改。

### 页面布局

沿用真实 PhoneShell 和应用内部滚动容器，不重复状态栏、设备壳、公共返回。页面为低饱和浅色地图应用：顶部简短标题与统一故事时间、当前位置摘要、标注“地点示意”的已知地点关系图、目的地列表、选中目的地的行程与事项。图不使用虚构真实街道、GPS、比例尺或隐藏人物位置。选择目的地只更新选择；“前往这里”才确认旅行。

确认区显示后端权威耗时与预计到达时刻。缺当前位置、合法路线、耗时或有效版本时，不自行推算30分钟或展示可执行前往。已知事项仅渲染正式后端返回的可见内容及可用入口；不补造前台、医生、救治结果或占位行动。若地点图不具备可信连边，使用地点排列，不能把装饰曲线称为路线。

短屏使用受控垂直滚动，动作至少44px，避免固定底栏挤压详情或与旅行反馈重复占位。长地点名称与来源可换行，完整无障碍名称保留。遵从减少动效。返回手机不改变物理位置或时间。

### 需要 I 冻结的正式数据与端口

以下是语义需求，不是另起公共 TypeScript 契约：

- 世界标识、版本、统一故事时间与展示时区政策；当前位置的可信 placeId/name/source 或明确 unknown。
- 玩家已知目的地的稳定标识、可见说明、来源、合法可达性及阻止原因。姓名/联系人文本不能推导其定位；若有人物位置观察，必须带获知来源与时点。
- 当前地点到选中目的地的权威路线/报价：耗时、预计到达、关联版本/有效性，以及服务端确认所需标识。客户端不按现实时间或示意图距离推算。
- 已知当地环境、可做事项/现场入口的稳定标识、可见标签、来源与可执行条件。移动成功不自动执行救治、赴约或现场动作。
- loading、读取失败、未建立空间能力、unknown当前位置与成功空列表分别表达；旧世界无地点有诚实空态，不伪造三个目的地。
- 旅行确认、原 commandId 回执核对、空间刷新、已授权地点/现场动作的现有控制器接线。command生命周期应由 I 的控制器保存，避免 MapApp 卸载丢失 unknown 后重新旅行。
- 权威回执状态、原command关联、结果版本/到达时间与位置；冲突、暂停、忙碌等失败原因。冲突后重新读取并再次确认，unknown仅查原回执。前往、时间变化、位置变化与读取版本须一致。

### 根组件接续

已只读查看根独立树冻结提交 8ec5796：TravelFeedback、travel-presentation、CSS。未复制、未编辑、未cherry-pick。根消息所称专项测试与build属根证据，不计本F验证。

接口：TravelFeedback({state, checking?, onCheckResult?, onRetry?, onContinue?, continueLabel?})。state为 idle / pending(destinationLabel) / unknown(destinationLabel,message?) / failed(destinationLabel,message?) / committed(arrival)。arrival包含 fromLabel?、destinationLabel、durationMinutes、arrivedAtLabel。

MapApp将引用根组件，不重复其状态或动画。只有 I 控制器验证原command committed后才能传入committed；pending只显示确认中，unknown只能核对原行程。failed的retry必须由冻结控制器明确允许，不能将任意网络错误视为确定失败。onContinue只有真实地点/事项入口存在时才提供；不能设置空回调呈现假按钮。成功后仍需读回当前版本位置和时间；历史返回不能重放旅行。

## 验收计划

1. 冻结后先同步 I 的正式契约和根 8ec5796 受控组件，再只在已登记 map.tsx、map.module.css、tests/phone-map.test.ts 实现；公共注册/导航/icon/context/client接线交 I，不擅自扩范围。
2. 专项检查空态/读取失败/unknown位置、缺耗时/过期报价、同名不同ID、未知NPC不可见；选择/返回0旅行调用；pending禁止重复确认；unknown核对同一command且0新旅程；仅真实committed显示到达；冲突刷新后再确认；到达后合法动作和来源链接。
3. npm run check 与 npm run build 在独立树执行，记录实际通过或失败。真实 PostgreSQL、幂等并发、RLS、clock事务和回放由 I 持续验证，本F UI测试不替代。
4. 契约冻结后再登记独立静态UI验收资源。使用实际 PhoneShell/MapApp、明确标注的正式契约形状测试夹具，不将夹具接生产；3256启用前再查无监听。Ego检查390×844、390×500和PC真实外壳，长名称/多地点、滚动恢复、返回、减少动效、未知/失败/刷新和已提交结果恢复，保存截图。浏览器夹具不宣称真实数据库或线上成功。
5. 业务代码完成后独立提交及报告、截图交现有I，先待验收；I串行集成、迁移核对、部署READY及公网实测后再确认完成。本F不自行部署、不新建访客/世界、不调用文字或图模型、不领取其他任务。

本轮实际验证：只读源码与git状态核对、报告/本人主表行读回；没有运行产品测试、check/build、浏览器、数据库、模型或公网验收。没有新增Repository、API、任务接线或领域原型。修改仅 docs/task-reports/SPACE-02B.md 与 docs/DEVELOPMENT.md 的本人行。

下一位 Agent 接续：I冻结SPACE-02A的空间读取/报价/旅行/回执/地点行动及控制器接口，并释放受控接线基线；根已提供8ec5796旅行反馈。F取得依赖后继续已登记地图UI。当前没有地图业务交付提交或截图，不应标待验收或已完成。

## 正式开工与恢复接线缺口

2026-10-10：已核对I实际冻结提交ab4350d，正式开始专属UI源码；将顺序同步ab4350d和根8ec5796，依赖文件不自行修改。PhoneAppContext.map可选扩展由I接线。当前只使用place.description（作者设定）、contactActorIds联系、appointmentIds查看日历；没有enter-place接口不放假进入按钮。

**给I的必要接续：当前PhoneMapContext只有data/loading/error/refresh/travel(request)/recover(request)，缺页面重挂/刷新时读取持久原request与状态的接口。** travel函数内部保留原request仍不足以驱动新MapApp恢复。请I补controller公开持久旅行状态（原request、目的地标签、pending/unknown/failed/committed及真实receipt）、只读核对/checking及成功清理/继续的受控操作，或提供等价已冻结状态。建议controller生成并持久化command后执行，UI仅提交routeId/expectedVersion；如仍由UI生成UUID，controller必须在网络发送前落盘并在跨App/刷新时暴露。未核实回执不显示到达，unknown不创建新command，跨世界/会话需隔离。F不在组件内另建持久控制器、不改公共接口；会先完成已有契约的阅读与地点选择。

## 地点界面子步骤

独立树同步依赖：e071f7d（来源ab4350d）、b00fcf8（来源根8ec5796），不作为本F业务提交。本人在途三个文件map.tsx、map.module.css、phone-map.test.ts；已知地点示意/物理当前位置/选中目的地/作者环境/可见联系人及真实日程入口已写。前往暂禁用，待持久恢复接口接完才开放，不把阶段代码作为交付。

7项专项通过：稳定ID与同名、跨天UTC+08预览、不由scene推位置、unknown/缺路线、不以设备时钟补无效日期、错误与空态、跨世界数据、联系人可见性与无假在场/入口。Typecheck通过。尚未check/build/浏览器/PG/公网。

给根与I明确分工：**原request、unknown与committed状态由I的世界级controller持久化，并提供读取字段；F不在MapApp另写localStorage控制器。** 保留全请求和world/owner隔离，先持久化再发送，重挂暴露unknown并核对原command。现有context尚无状态读取字段，所以暂不自行猜接口。主报告上节已列完整需求。I当前WIP enterPlace/establish尚未新冻，F未使用；待冻结后接有来源地点建立和真实现场入口，不自行构造URL。

预览将使用独立主目录.local/space02b-ui/harness、dist、evidence及3256，启动前再次核空；模拟对象仅UI显式夹具，0上游API/模型/新世界。正式地图注册/标题由I冻后再验真实PhoneShell，不擅改壳或公共导航。

## 行程界面已按冻结接口接入

已同步I e2bb3a8（本树707770f）、6f6f639（9fbeebb）、3802674（7be99ba）及根b0c8174（8474687）/bcdf8d6（942f3c4）。只同步提交，不编辑I/root文件。UI使用I.operation/checking/working/checkTravel/retryTravel/clearTravel/resubmitTravel；原请求唯一由I持久化。unknown默认只核对，只有unknown且recoveryUnconfirmed且世界可操作才传根onResubmitOriginal，调用I原请求重提，不生成另一个command/版本；working禁重入，核对中禁清除。

前往UUID由UI按冻结接口生成一次并交I，页面不保留独立旅行存储；只有世界/原command/route/version/到达时间匹配的committed回执才传成功。读取位置版本未跟上回执时显示正在更新位置，不给继续/现场入口；成功后查看真实地点详情，再由I.enterPlace打开实际scene目标。只读检查I当前controller发现它自行导航，因此F没有再open(scenes)覆盖其准确目标。地名/人物/日程全从正式数据口获取，没有生产夹具。

普通视图选择用仅浏览器模块的最多32个world→placeId缓存，保留同次SPA返回后的选择与PhoneShell同路由滚动；不保存世界位置、时间、command、receipt，不是生产Repository，不另建localStorage key。不新推一串选择历史。硬刷新旅行恢复仍由I，不宣称视图选择跨设备同步。

16项专项全部通过；一次新核对中禁清除测试捕获遗漏disabled，已修复并复验通过。初轮npm run check实际退出失败：638项中634通过、4项旧character-image-flow/RLS测试连接127.0.0.1:55458 ECONNREFUSED；该端口为既有已停止资源，未重启，不计真实PG验收。Typecheck通过，初轮build成功。最终字段接完后新check/build运行中，实际退出码将保留。

接续给I/root：地图三个文件已可只读评审，稍后独立业务提交；请冻结公共地图导航/图标/shell/app接线，F才能以真实Map路由而非借旧App标题完成PhoneShell 390长短屏/PC截图和返回验证。独立harness的构建/服务器已准备，3256无监听核过、未启动浏览器、0上游API。I后端/真实PG/生产迁移与部署仍未由本F验证，状态保持进行中。

## 源码冻结前检查与预览资源

最新检查已结束：npm run check退出1，645项中641通过、4项既有数据库测试ECONNREFUSED 127.0.0.1:55458；类型与模块边界检查通过。npm run build退出0。证据在独立树.local/space02b-ui/evidence/check-map.{log,exit}及build-map.{log,exit}。16项地图专项通过。只修改F登记的三个源码/测试文件和专属报告，将先提交业务给I接线，任务仍进行中等浏览器验收。

独立预览变为更强的真实组件检查：编译F实际MapApp及Provider、I当前PhoneShell/navigation/icon与useWorldMap/SpaceClient/operation，**I未冻结源码仅只读编译快照，不修改，最终公共冻结后仍由I集成验收**。本地3256服务器仅提供显式合成WorldSpace/Receipt/Session API响应，没有上游代理、数据库或模型。不是生产Repository。请求审计保留以证明原command、读回与单次分钟变化；UI时间/位置来自模拟HTTP响应，不称真实PostgreSQL或线上验收。禁止非夹具API，页面有“隔离UI夹具·本地模拟API·无真实数据库/模型”提示。

预览URL给根：HTTP127.0.0.1:3256/?case=normal&world=11111111-1111-4111-8111-111111111111#life=11111111-1111-4111-8111-111111111111&app=map。每个case请用新的合法UUID以免混合先前夹具状态；case可normal/long/empty/legacy/unknown-position/paused/busy/read-error/failed/conflict/unknown-unconfirmed/unknown-committed/pending。12分钟路线从23:55到次日00:07只是显式UI样本，不入生产。GET/fixture/audit是本地诊断，返回样本POST计数与commit计数。根使用自己的既有Ego125，本F将只建一个自己的地图验收space。此刻harness准备/编译中，服务器尚未启动，启动另记。

## 给根/I：预览现在已可访问

**初业务冻结70e5117（四登记文件）；根追加关系图/缓存失败隐藏的改进在途，18项专项与typecheck通过。3256已启动，session79815；本F唯一Ego126/p1。**

http://127.0.0.1:3256/?case=normal&world=11111111-1111-4111-8111-111111111111#life=11111111-1111-4111-8111-111111111111&app=map

根独立审看请用新的UUID，如66666666-6666-4666-8666-666666666666（query world与hash life一致），避免复用本F normal样本已发生行程。case=long可查长标题、8地点与长说明，case=unknown-unconfirmed需先选择医院、确认前往得到unknown再核对，随后原命令重提。初始story23:55，已知route12min预览次日00:07。所有均隔离样本，不是生产故事。Ego发现旧版本更新提示，本F未升级。

前一启动默认沙箱拒绝本地监听EPERM，未产生服务器；已按授权资源通过沙箱升级启动。harness编译前后十个实际F/I源文件SHA相同，保留source-before/after.json；读取I在途公共导航/控制器快照只用于隔离UI，不改I文件。18专项检查包括真实route稳定端点图示与缓存error时无地点/回执信息；最新绘图改动尚待最终check/build复验。浏览器当前已打开真实Map路由，长/短屏/PC与恢复验证正在进行。

## 最终业务增量立即供I集成

根复核要求已实现：mapDiagram仅对最多16个已知stableID布局，SVG每条线保留实际route.id与from/to，未知端点不画线、不造点，明确“非地理距离”；保留下方目的地与详情。读取失败时连同缓存地点/环境/路线/到达回执全部隐藏。18专项+typecheck通过；真实来源线路与缓存隐藏两条专项通过。最终check/build针对这个增量正在跑，源码可以即刻取独立增量，不等待本F截图收尾。

本F Ego126已真实验证390×844：选择0旅行、明确前往1POST/1mockcommit、12分钟23:55→次日00:07、状态/位置同步；继续地点详情与联系人目标正确，浏览器返回scroll207→207且选中医院保留，时间/位置不变。证据normal-travel-and-return.json与长屏PNG位于主.local/space02b-ui/evidence；本地模拟API不作PG证明。根Ego125的独立长短屏/PC/unknown/scene检查是根证据，不算本F完成。

本F现场入口wait超时，但本地审计原请求1次、place=hospital、world位置仍hospital、时间00:07；仍在诊断，不冒称通过。未知样本有两类夹具问题：第一次固定777UUID被并行read-error案例使用，故读到错误模式；已换独立随机UUID。第二次未知连接断开被Chromium网络层自动重复相同POST（同command/expectedVersion/route，2尝试1mockcommit），直接得到committed，未出现预期unknown；不会把该超时写成产品恢复通过。将使用明确503未确认样本完成余下UI检查，不修改生产controller或扩大任务。

不会因重复截图阻I发布。I请按独立增量提交合入，最终真实PG/check/build与部署由I证据确认。本F业务先仍进行中，截图报告随后接续。

## 最终交付与验收记录（2026-10-10）

交付提交：70e5117（初业务四文件）+946f621（真实路线图示/缓存隐藏四文件增量）。I已接受初业务为01964a6，最终增量由I受控取入；不要整合本F分支重复带入已接受的root/I依赖。源码未再修改，本次收尾只有报告与本人登记。独立工作树/分支仍为photo-compose-02/人生剧本、codex/space-02b，原交付分支保留。

修改文件：src/features/phone/apps/map.tsx、map.module.css、tests/phone-map.test.ts、docs/task-reports/SPACE-02B.md；主目录DEVELOPMENT.md仅更新本人行。公共接口、navigation、icon、PhoneShell、controller、DB迁移、Repository/API/任务接线全部由I，根反馈组件由根；本F没有编辑这些源文件或client/interview其他WIP。

完成能力：玩家已知地点/当前物理位置、实际route稳定端点关系图（非地理距离）、按route分钟与最近storyNow的跨日预计到达、作者设定环境、可见联系人/日程来源入口、明确旅行确认、受控pending/unknown/failed/committed及原command核对/明确原请求重提、已到达后查看地点/正式现场入口、canEstablish旧官方起点显式建立、无地点/unknown位置/读错空态、暂停/忙/working禁重入、减少动效与同次SPA选择/滚动返回。没有真实GPS、人物实时追踪、虚构道路或补造目的地/行动。

实际测试：18项地图专项通过、typecheck与模块边界检查通过；最终npm run check退出1，647项643通过、4项既有character-image-flow/RLS测试因ECONNREFUSED 127.0.0.1:55458失败，未启动该旧资源、未改测试；npm run build退出0。完整log/退出码保留于独立树.local/space02b-ui/evidence/check-final.{log,exit}、build-final.{log,exit}。本F没有已成功的真实PostgreSQL验证；I自己的PG证据不算本F执行。没有新增领域原型/Repository/API/队列；ignored HTTP模拟器是明确UI夹具，其内存状态不能作为生产Repository或真实数据库证明。

浏览器：本F唯一Ego126/p1实际检查390×844、390×500与1440×900（真实PhoneShell frame480）；没有横向溢出，長文本仍可滚动，短屏主动作48px且完全位于视口，prefers-reduced-motion=true已查。实际编译F源码与I公共Shell/控制器快照，合成HTTP Session/WorldSpace/Receipt响应，不访问生产或模型。普通旅行1POST/1mockcommit，23:55→次日00:07，世界位置与故事时刻一致；联系人目标正确，浏览器返回选中医院保留、scroll207→207，返回不发旅行。关联日历已跳正确target（早期场景脚本超时前已确认）。unknown503→硬刷新保留同一完整request→核对0新POST→明确原请求重提：2尝试/1mockcommit、两个body完全相同、仅12分钟一次变化。真实父级版本/时间reload支架接入后，新独立场景1POST旅行/1commit，再进入准确sceneId且时间/位置不再变化；现场页面为明确夹具说明，未声称完整真实场景模型验证。

截图与JSON：主目录.local/space02b-ui/evidence。
- mobile-long-current.png、mobile-long-selection.png、mobile-long-arrival.png：初编译快照长屏。
- mobile-short-unknown.png、mobile-short-arrival.png：明确503与原请求恢复的短屏。
- mobile-short-long-places.png、mobile-short-long-action.png：最新父级reload支架，长标题/说明和可达48px主动作。
- pc-480-map.png、mobile-short-empty.png、mobile-short-read-error.png：PC与诚实空/错误状态。
- normal-travel-and-return.json、unknown-refresh-check-resubmit.json、current-place-scene-final.json、short-action-reduced-motion.json、read-error-final.json、final-layout-cases.json；请求审计requests.jsonl、编译日志及初编译源指纹source-before/after.json。

证据限制与诊断：初固定777样本与并行read-error案例冲突，后使用独立随机UUID；socket断开模拟被Chromium网络层重放同command，后明确503模拟unknown，不误称该早期超时为恢复通过。初现场wait超时没有登记通过；更新I新版本检查所需的支架父级reload后，用独立样本验证准确panel=scene/target。布局脚本前三场景断言通过，第四场景因ego不支持裸role选择器而中断；已读当前状态并用[role=alert]补完，不新建space、不盲目重复操作。没有为了这些支架问题修改生产controller。

资源：Ego126已finish({keep:[]})一次，无保留页面。3256服务器原79815及重启6461均已停止，lsof无监听；.local夹具与截图保留供审查，没有删除生产或旧CHAT测试资料。根Ego125/I Ego127及PG/HTTP资源未操作。Ego更新提示已告用户，未升级。

下一位Agent：I接受946f621接在已接受70e5117之上，并使用真实父级phone版本/time刷新的一套最终controller；真实PG/RLS/幂等并发/原回执恢复、旧世界来源建立与现场接线沿SPACE-02A验证，确认0041生产迁移后部署READY并公网实测关键地图流程。根可读取上述截图/JSON作为独立UI复核；本F状态先待验收，未证明生产地图已上线，未接其他任务。当前线上版本仍由DEPLOYMENT/唯一I发布记录核实，本F本轮没有部署或公网操作。

## I生产联合验收与资源收尾

2026-10-10 I最终集成：业务dad824f，Production6w2u15n9v / dpl_GnmSM8UFLNf9pNinQ49ZWsCUqMcg READY；0041生产已应用且41项checksum一致；653check/build、真实PG203通过/5可选跳过、正式既有合成世界11检查与390/1440实图/返回通过。0模型/图片/新生产世界/上传；测试世界paused=true。Ego125/126/127均已finish，各HTTP/PG已停止；限定技术完成，用户A19待体验。

生产首次脚本比较到达时刻与随后暂停时刻，实际230ms现实间隔按旧倍速正确结清，断言过严；恢复脚本又误把establish回执计作第二次旅行、误期望暂停409而实际契约422，三处验收脚本已修正。最终只读原命令/回执与暂停钟重读通过，只有一次12分钟旅行、worldv2/林悦家、暂停，未重复旅行。0031等原失败不删除。本批现场入口真实PG使用明确假planner验证，正式无模型/任务执行，不声称AI现场质量通过；普通创建/已发展旧档/保留存档开新版本/人物旅行后反馈及迟到裁定留SPACE-02D/E/F。
