# BOOT-01P-Q · 前史跨应用来源独立审查

**最新状态：待验收。** 本人四应用UI、两新专项、真实PG/HTTP及手机PC验收已交；供应商/生图0。I唯一集成与真实模型/部署验收仍需其最终记录，不能把本报告视为全部产品或P生产已完成。后文保留第一阶段及失败接续历史；本页末段是最终结果。

2026-10-10，codex-f-boot01p-q-01a0c7c8-20261010；独立 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/boot-01p-q 从109c63e，旧82783ce保留codex/boot-01n-q。主DEVELOPMENT本人第一阶段已短锁领取确认。仅本新报告、本人行及主镜像可写；所有业务/公共契约/SQL/配置/旧测试只读。无PG/HTTP/browser/npm/provider/image。本轮不新增测试，不提前领取UI源码范围，不发跨聊天消息。

已读AGENTS、PROJECT_BRIEF、主DEVELOPMENT、ARCHITECTURE_REVIEW、根BOOT-01P-COORD、I第一阶段入口、主目录INITIAL_PHONE_LIFE_SPEC/PHONE_PREHISTORY_IMPLEMENTATION_PLAN；只读以下基线代码。I当前仅登记接续说明，尚无冻结跨应用协议，因此下面全部为审查建议和待执行反例，非新实现通过证据。

## 结论及真实接续缺口

同一已校验genesis历史绑定日程与主角已知系统记录可行。应从已保存的具体来信引用建立小规模关联，在同一初始事务落盘；不能让前端根据文字猜日程、让records伪造正版本世界事件，或把相册原图变成虚构现场实拍。当前109c63e已上线的是BOOT-01N两步旧来信，尚不是跨应用前史交付；550check/真实模型7请求/READY来自I上批记录，本人本轮未执行。

|实际基线接点|缺口及影响|
|---|---|
|build-handler.ts：state.appointments=[]；HistoryPlanner只返text/minutes|旧来信无结构化日程/记录来源，普通当前消息和opening.notes不能自动猜成已知任务|
|contracts/world-records.ts、domain/player-records.ts|仅opening_field与正版本world_event，events要求version>0；虚构初始消息不能伪装version1事件，初始记录不能标玩家真实讲述/已做选择|
|player-records-repository.ts|日程/messages只JOIN world_events；即使initial存新日程，也会在此读路径丢失。需显式读取同owner/world不可变initial，与正版本投影分清|
|postgres-world-repository.ts hydrate|先拼initial.appointments和event投影，再依receipt版本重放invitation.responded。同ID同时落initial和projection会重复；若用当前状态覆盖旧快照，则旧回执会读到未来接受/取消|
|domain/invitations.ts与reducer.ts|真实accept/cancel/reschedule/attend/miss有显式命令与版本，过去提议不能现在accept；无status的legacy不能自动confirmed；新appointment.proposed均默认proposed|
|album-projection.ts/readForWorld|相册是实际world_album和获准world_person_bindings；绑定原图date来自assets.created_at，读取还要求owner、world授权、ready及对应revision。拥有某图不等于已授权这个世界/人物，更不证明是故事现场|
|actor-context.ts|只收本人消息/参与日程/可见facts，世界全体不自动共享私聊。把系统记录或日程详情加入world facts会造成来源或参与范围扩大|
|notes-records.tsx/messages.tsx|现records来源展示只区分opening/world_event，跳微信只到actor会话，不能宣称定位具体历史气泡；相册导航未纳入records public union，需I协调准确冻结|

## 建议的最小协议与冻结门槛

1. **关联必须指向稳定的初始来信。** 模型只选已有actorIndex/letterIndex或局部历史key并给有限标题/日程相对时间；运行时将其绑定已冻结演员及服务器messageId。全员history的编号/乱序/覆盖规则保留。引用须确实存在、同world、同actor；不按名字或模型任意UUID猜。记录文本优先引用原来信原文或可验证quote，assertion明确是虚构起点中的人物来信，不是玩家已作行动或现实事实。不得使用opening.notes作为默认公开输入，notes/private persona/current私聊不因加关联而重新送模型。
2. **新增明确genesis来源类型，不污染正版本事件。** I可在public records来源union与内部初始元信息增加独立kind（名称由I冻结），带该world/初始版本标识/已存messageId与故事at；version=0基线不同于事件eventVersion>0。读端核验initial中的原条目和来源，不只相信模型meta或客户端claimed ID。真实用户后续回应仍为正版本invitation.responded，来源应能区分最初提议和本次真实回应。sys/只读记录与用户可编辑Note分开，不把生成记录insert为用户note。
3. **日期与状态有因果。** 来信at=T0减分钟；邀约at是拟定活动时间，记录source.at是来信时间，三者不能互相替代或用入库时钟。首小包建议只初始化future proposed（relative T0有限正分钟、at>=T0，且晚于源来信）；不用模型的confirmed/responseAt/responseVersion/玩家回复。过去内容可作为只读“曾收到的来信”记录；若要过去attended/confirmed，需另明确虚构基线状态语义和动作可用性，不能混为真实玩家赴约。本包未冻结前不自行加该能力。跨午夜周几按固定UTC+08同T0，源文字的“明天/周五”与活动日期仍需模型真实样本/人工核对，范围校验不等于语义因果已证明。
4. **角色参与和可见范围不能扩大。** 首包最小日程participant只绑定来信发件人；增加其他人物须有明确已授权共享来源，不能仅由“都认识主角”推断。主角能看记录不表示NPC全知；a私聊衍生记录不能作为world事实传b。blocked genesis source/消息的检索与关联日程知情规则需一起复核，不通过摘要重新引入被屏蔽来源。共享图或共同日程不自动开放所有历史私聊。
5. **照片只关联已授权素材，程序决定来源。** 模型不接照片像素/现实拍摄信息，不输出assetId/revision、场景实拍解释或story撮影日期。不允许其自动指派某张真实照片就是某场历史活动。最小诚实关联可由runtime按照该actor已有sourcePersonId→本world人物绑定的ready资产显示“该人物的带入素材”，它只是人物参考关联，不是该日程/消息的拍摄证据。保留资产原date/createdAt/kind/revision及“上传时间不代表共同经历”说明；无图允许只完成消息/日程/记录链路，不新素材/新image任务。未明确带入的普通seed参考图、同owner另一world上传图、作者私有照片和同名其他人的图不得自动绑定。用户另行明确关联的未来接口不在本批假装已实现。
6. **写入一次、恢复按版本、读取按来源。** 初始authoritative完整小条目放immutable initial，避免同时作为world_event投影重复写；build ready/initial/人物绑定/权限核验/任何初始附属表一次queue.commit。记录读、phone/calendar、actorContext、command receipt与replay必须共用这一初始来源，加后续真实响应到目标版本；先保原记录，再按同ID演进，不用现在的状态污染旧回执。素材read每次重检ready/revision/owner/world授权；失效不复活原图，已存引用和文字也不能假称图片仍可读。
7. **容量和付费有界。** 建议首包全世界至多3个日程、6个记录，允许0个有事实支持的关联，不为凑数造过去玩家行动；确有适合关联的场景要实际验证至少1条消息→日程→记录。runtime素材引用不增加模型输出能力/调用。继续两阶段同100秒/外110/route120，known各最多2纠错、unknown/取消/截断不自动重付，不追加第三轮模型摘要或读取时付费。最终容量与源码路径由I/根冻结，本建议不是公共契约。新批预算另记，不继承N剩余3次。

## 最小可执行验证（待冻结与资源释放）

|场景|实际操作|验收断言|
|---|---|---|
|P01 同源正例|真实两阶段fixture通过Task Queue建立3演员；a一条过去消息引用明天场地邀约，生成只读记录；选入a真实ready合成上传素材；固定cast/无图另正例|消息ID→邀约ID→records source和navigation准确；source.at早于T0、appointment.at晚于T0；状态proposed/无玩家回复；带入图asset/revision正好获准值且原上传日期不变。fixture只验接线，不能冒称AI生成或真实拍摄|
|P02 引用与权限负例|未知/重复key，外world消息，a关联b私聊，同名两actor，引用当前消息冒充history，额外role/confirmed/responseVersion/privateNote|整体拒绝或准确已有规则拒绝；不按名字合并，不把普通notes开放、不生成玩家过去发言。缺关联可以0而非模板填满；一条坏关联不能静默删掉后当完全生成成功|
|P03 时间与同意|固定UTC午夜T0，过去source与未来proposal；非法分钟/过去可回应邀约/absoluteDate/互相矛盾明天标签；刷新越过活动时刻|runtime拒绝越界时刻；UI按story date/来源时间显示；没有回应不自动confirmed/attended，不因读取或“已读”改变邀约状态。语义矛盾仅结构测不一定能发现，真实样本另外记录|
|P04 知情/现实隔离|a历史和日程含唯一哨兵，b无参与；initial record对主角可见；hidden persona/notes与未选现实访谈另哨兵；屏蔽genesis source|真实get state→actorContext：a仅自身已知，b不泄漏a私聊；privateProfile/candidates不变；公开records/phone不包含内部哨兵。照片关联不升级为canonical event事实|
|P05 日程生命周期/旧回执|同initial proposed ID真实accept→reschedule（回proposed）→cancel；重发相同command并重放各版本；另旧玩家turn receipt|任一版本同ID只有1项，phone和records同版本状态一致；原v0仍proposed，v1回执仍confirmed而非后来cancelled；source区分genesis与真实回应；重复命令无第二事件/记录；replay无image任务/模型执行，initial原文hash不变|
|P06 素材权限/失效|ready selected图正例；相同owner未带入图、另world图/另一owner/作者图、旧revision、deleted/pending/failed图；asset提交前变化；actor共用同图|未授权引用不能readForWorld；初始commit权限变化整批回滚无半套；共享图去重而不广播私聊/串sourcePersonId；删除后新读取缺图且不伪造替代，不修改上传日期。没有模型读取图或生成新图|
|P07 原子/租约/幂等|valid world/history但关联非法、第二步取消/unknown、commit lease过期或错token；重发same command、同owner两world/otherowner|world/initial/bindings/日程/记录附属/素材outbox无半套；元build failed/unknown诚实，task非succeeded；全成功每world不同ID/来源；相同命令读回不补造genesis，不改已有世界|
|P08 旧版与UI|显式无新metadata的legacy以及N仅history世界；冻结后390短长/PC，record→日历/微信/素材，再返回/刷新|旧private note内容保持，opening.notes不突然公开；旧历史已读与当前少量未读规则不变；sys/不可编辑；导航到正确actor/invitation/真实asset，不能把打开actor会话称精确气泡定位；有图才加载真像素，无图诚实；浏览器不写假API|

以上后续应通过真实Postgres Repository/API/任务租约，fixtures明确合成并单独记录；测试文件/资源尚未释放，所以当前未创建、未执行。若涉及新SQL/权限/迁移由唯一I分配与生产验收，Q不提前预留号。主records目前coverage=recent，增加有限初始记录后应准确解释覆盖范围，不能宣称完整人生记忆。

## 基线源码与接续

只读核对路径：src/contracts/{world-records,world-build,invitations,album}.ts；src/modules/world/{infrastructure/build-handler.ts,infrastructure/history-planner.ts,infrastructure/player-records-repository.ts,infrastructure/postgres-world-repository.ts,domain/player-records.ts,domain/invitations.ts,domain/world-history.ts,domain/genesis-messages.ts,application/actor-context.ts}；src/modules/media/infrastructure/{album-projection,asset-repository}.ts；src/features/phone/{world-app-data.ts,apps/notes-records.tsx,apps/calendar.tsx,apps/messages.tsx,apps/photos.tsx}。公共契约、hydrate/records/初始化等属于I，不因发现接点自行修改。UI准确范围待冻结后根另释放，不自动拥有所有phone文件。

修改仅本报告及本人主表/镜像，没有新增能力、测试或领域原型。没有npm check/build、真实PG、API或浏览器运行、模型/图片、生产部署。静态现有20文件路径将核验存在；报告差异检查。最初尝试不存在records-repository/world-phone路径和工作树无未跟踪前史计划，已纠正为player-records-repository及主目录计划，只读定位失败不包装为验证。

第一阶段报告完成后整个BOOT-01P-Q仍进行中：等待I最小来源/时间/照片协议冻结和根准确写范围/独占资源释放，再领第二阶段；不会把本次审查标整体已完成/用户已验收。下一位I先冻结genesis来源与version0日程恢复/records、写真只是素材参考及准确跳转，然后实施真实任务/API/PG，最终由I部署READY公网。当前线上仍109c63e的BOOT-01N有限历史，跨应用前史关联尚未实现，父BOOT/长期任务/地图/图生图均未完成。

20个现有源码路径存在性检查通过；仅静态读文件与报告diff检查，没有执行产品验证。


## 第二阶段领取与UI准备

根释放后按短锁确认，仅四apps tsx/必要两module.css、唯一新tests/boot-01p-ui.test.ts/integration/boot-01p-q.test.ts可写；公共world-app-data/apps-types/所有契约/后端只读归I。接edff0ed→5fd49b8，仅5已冻结契约/领域文件；本树临时依赖symlink已建立。55458/3263/3264无监听核对，尚未启动PG/HTTP/Ego，等待I后端稳定；boot01pq.localhost与一个新Ego创建后登记，0供应商/生图。已读DESIGN及当前Next use-client指南，保既有外壳/navigation/client/interview。

四应用最小UI已准备：notes-records仅服务端relatedLinks，来源“虚构起点来信”、来信时间/活动时间/真实回应时间分别展示，去重同primary目标，sys仍只读；微信初始历史caption与既有Links；日历origin/待回应，沿现命令确认而非自动同意；相册detail既有Links接记录，实际sourcePerson原图保上传日期与诚实说明。未从正文推断新的联系/素材/日程。

独立新boot-01p-ui.test.ts真实React渲染/回调5/5：sys无编辑、同源导航ID/去重、invitation活动/来信/回应分开、历史标记仅过去、照片原date/无链接及缺图、legacy来源；旧notes-records-ui.test9/9。均显式fixtures，不是浏览器/DB/AI。首typecheck仅契约半接线树失败，包含PhoneInvitation.origin尚未由I apps/types同步和PlayerRecords领域旧kind未接新契约；报告保typecheck-ui-prepared.log，不改I类型/仓储自行凑绿。下一步等I后端/适配冻结，再联合类型/PG/双端，不把协议commit视完整业务已通过。

### 稳定UI交接（2026-10-10）

根指出来信分类说明不准确，已删“也包括已收到的来信”；起点身份仍在about，history_message仍由服务端放history/此前记录，未改公共投影。已接I冻结661b4d3→0ca920a，公共类型缺口随I适配闭合；本人typecheck通过，新5+旧9组件测试14/14通过。稳定提交仅四tsx、一局部CSS、新UI测试和本人报告；PG/实际浏览器/check/build尚待后续，仍进行中、0供应商/生图。根可先交I接稳定UI，随后本人在55458/3263/3264独立验证，未自行部署。

稳定UI提交：25d6926；I源接收提交0ca920a。

### 独立PG与构建里程碑
55458真实PostgreSQL18.4、pl_app RLS/pl_worker队列，新专项5/5（容器+4子组）通过。P01/03/04同名ID/时间/分类/只读/blocked来源及私聊/Profile隔离，P06实际webp读、未选/异owner/world/revision/failed/deleted/无图，P05三命令/旧回执/逐版本重放/immutable hash，P07非法quote/date/permission与错误token无halfworld，P08 N无关联兼容。P02伪造ID/actor/world/current反例仅基于persisted state的纯领域调用，不冒称SQL。首次测试误读invitations/token字段，已修正测试，保留pg-first.log；pg-final.log通过。check561/561、build通过，新专项格式/类型通过。
Ego108/p1已创建登记，仅本人3263/3264 boot01pq.localhost、合成世界/真实上传测试像素；锁屏实际读通知，后续390x844/500与PC链路、返回刷新/真像素验收。服务器非loopback fetch禁止、clock paused，真实供应商/图片服务0，fixture不证明AI或真实拍摄。仍进行中，稳定UI25d6926可先接。

PG专项稳定提交898b776（父25d6926），根/I可先接独立测试；当前UI正在验收，尚未宣称交付完成。

### 实际HTTP发布阻断 · 请I接续修复

Ego108，真实390×500产品，world ea35b400-cd62-48dc-8965-0f1ba624e4af / invitation 88e9b631-4f12-4c2e-86ba-ddaf53f4b58e，从历史记录到日程点击一次“接受邀约”：503 UNAVAILABLE，页面“暂时无法连接，写好的内容还在。”，server request b27f13aa-d001-4840-8bc9-eaddc989b351。日志Zod unrecognized_keys path invitation keys sourceMessageId。src/app/api/v1/worlds/[id]/invitations/route.ts:30只剔sourceEventId，其余内部Appointment含新的sourceMessageId直接传严格InvitationReceiptSchema，公共InvitationSchema无此键。这是API序列化接线问题，真实Repository专项无法发现；Q不改I/public API。需I显式公共字段投影（含准确origin）并补HTTP响应校验/旧回执一致性验证，不能只扩白名单暴露内部字段凑绿。DB是否已提交将只读查证，不重发accept。稳定UI25d6926/PG898b776均已镜像。此前浏览器等待文字“接受邀请”/多条caption选择器/刷新未解锁超时为自动化误读已调整，不当业务失败；本次503是真实API失败，联合验收不放行。

503后真实GET /api/v1/worlds/ea35b400-cd62-48dc-8965-0f1ba624e4af 返回200/version1/invitations[0].status confirmed，origin准确；after-503-phone.json保留无密钥。已提交但响应失败，不能声称未写入；没有重发accept。刷新→锁屏→解锁恢复同日程已确认，无重复条目。HTTP /phone路径不存在的404为本人定位误用，已改实际GET世界入口，不作产品缺陷。

### 双端界面与相册滚动修正

Ego108实际390×844：历史只读record→同ID日历→正确小芳会话，caption仅两条历史；record→真实私有素材240×320→反向record。日期保上传10月10、不代表共同经历。390×500 record入口在屏内、无横溢；刷新先锁屏，解锁恢复hash同record，日历滚动后accept按钮可达。1440×1000实际手机容器420×880居中，record/calendar/photos/messages均已查看和截图，正确联系人，返回微信列表可用；photos真像素与下方来源入口可滚动访问。所有这些为本地合成世界、真实API/SQL/磁盘素材，不是线上/供应商验收。

实际PC相册往返scroll247.5→0复现：ready图片首次挂载未预留高度，shared shell恢复时页面过短；未改shared navigation。本人apps.module.css仅给既有fullPhoto加height55svh（保max-height/object-fit contain）预留图片框，不改素材尺寸/来源/像素/接口。重check561/561及build通过，实际同photo→record→photo280→280恢复，通过。截图photo-frame-pc.png。首问题及未修503均保留，不把旧截图当修后图；需I接后HTTP补丁再复验，不新任务/不供应商调用。

API失败后实际已存accept commandId 9d0474f1-ace9-4430-a3c1-5f7fafebb3a0，expectedVersion0，resultVersion1，request_payload通过本人world/owner限定SQL只读取得；committed-command.json保留，可待I补丁复用同command验证幂等。当前仅一次接受，无新付费任务。

相册局部滚动修复稳定提交75977df（父898b776），供根/I接。

### 验证边界与截图入口

最终局部修复的短屏相册往返394.5→394.5且无横溢；锁屏小李通知真实操作进入13000f4c-2fe2-4b42-9c5c-e32a721d6aac会话，旧历史有caption、当前消息无caption。未发送角色聊天，0模型/0图生成。Ego108继续用于待I补丁同命令验收，不另开空间。

本人修改文件：四apps tsx、apps.module.css、新tests/boot-01p-ui.test.ts、新tests/integration/boot-01p-q.test.ts及本报告；主表仅本人行/报告镜像。notes-records.module.css未改，共享types/world-app-data/契约/后端仅接冻结commit，未自行写。没有新Repository/API/迁移，也没有内存仓储生产接线；新测试中的模型输出只是fixture，P02部分负例是纯领域验证，实际PG/repository/资产/receipt另列。完整初始人生/长期记忆/多人等父需求未由本批完成。

实际截图（ignored本地证据，未假称公网截图）：
- [390×844旧来信记录](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/record-390x844.png)
- [390×500记录](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/record-390x500.png)
- [日历来源/活动分开](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/calendar-390x844.png)
- [实际旧来信和当前消息](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/messages-390x844.png)
- [修后PC相册来源/滚动](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/photo-frame-pc.png)
- [修后短屏相册](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/photo-frame-390x500.png)
- [真实接口503](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/accept-503-390x500.png)
- [锁屏通知正确联系人](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/boot01pq-evidence/notification-390x500.png)

证据索引evidence-index.json仅安全ID/计数/路径，不含会话token/连接密钥。PC calendar/record/messages另有图；尚待I冻结HTTP修复、同command回执和改期取消实测，再做资源关闭恢复，不能把本地build/fixtures称线上完成。最新已知线上109c63e的N批，最终P生产版本由唯一I记录。

## 最终独立验收与资源交接（2026-10-10）

接I稳定9c1c799→c4f12ab、5552248→0984d50、e32701a→8efacd1（本树原未接两前置，因此各仅接一次）；未编辑I源码。e32701a同时移除本人新PG测试的机器55458断言，测试可由I独立配置运行，本人实际资源仍只55458、启动夹具继续强制端口。最终check563/563、PG新专项5/5、build全部通过，证据check-http-patch.log/pg-http-patch.log/build-http-patch.log。

Ego108同一world/原已commit command真实HTTP复验：原accept200/v1 confirmed；新reschedule200/v2 proposed；cancel200/v3 cancelled；再次原accept200/v1 confirmed且整个回执完全相等；最新GET200/v3仅一个同ID日程；陈旧新命令409。所有回执公开白名单，无sourceMessageId/sourceEventId；origin保持同world/seed/初始message/来信at。HTTP records200取消记录source.world_event、origin.world_genesis。http-fixed.json/http-record-fixed.json完整安全证据保留。最初503已真实提交事实与截图仍留，修复不通过重复新accept补救。接口测试是浏览器page.fetch真实同源命令，不伪造API，也不绕CSRF/RLS；复验后刷新解锁真实UI取消记录，回应时间10月10、源来信10月9、改期后的活动10月11 16:40三者分别展示，sys无表单，无横溢。responded-record-390x500.png在转场中捕获，颜色偏淡，仅作辅助，最终布局凭前述稳定截图及真实DOM状态，不冒称静态设计定稿图。

本次接续点：I已接25d6926/898b776，另接75977df图片框滚动修复（局部CSS），并收本最终报告提交；唯一I继续有限真实模型验收、生产开关/迁移确认（本批本人无新迁移）、READY/公网，记录实际版本后才能决定整体完成。本人未调用供应商/未自行部署；未用本地fixture或构建替代真实模型与生产验收。当前主报告仍记录109c63e线上N，最终以I更新DEPLOYMENT证据为准。真实模型/P开启尚未在本人证据中证明，因此仅待验收，不勾选已完成。

资源已恢复/关闭：Ego108仅boot01pq.localhost命名pl_session及该3263 origin local_storage清除，task.finish({keep:[]})成功且仅一次，无其它域/空间改动；本人HTTP3263/3264进程停止，PG55458受控停止；本轮唯一合成账号/world和唯一240×320测试图片经owner/world/title/file校验删除，新PG专项的owner/temp files在finally清理；保留safe evidence，不删除他人数据库/素材。临时node_modules仅自有symlink移除，未删共享依赖；独立工作树和本轮提交留给I。无继续领取其他任务。

## 唯一I集成收口

## 本批收口：兼容修复已上线，自动关联未开放（2026-10-10）

业务d59fe3f，独立树d8274da；Production laid82hg9 / dpl_9TSTzZpENKSxdGzCCvf4vPCz8xrk READY，正式 https://parallel-life-nu.vercel.app 已切换。无SQL变更，生产39项迁移校验和一致；最终563check、联合旧N+新P真实PG20项（含父子容器）及build通过。F最终报告59c95bf与主镜像SHA一致，仅收报告不重复接其后端祖先。

本批实际修复：邀约已提交却503的公开回执投影，旧回执保持原版本，改期/取消/latest唯一条目与陈旧409；四应用来源展示与相册返回框高度。真实本地HTTP及双端通过；公网health200、N两world/P authored world共3次实际读取200、旧来信分别8/4/4保留且historyLinks0，records未凭空回填。390×500无横溢，PC1440手机宽420，旧来信caption实际DOM与PC稳定截图可见；手机截图停在当前消息区，不宣称该图含标签。原上传合成200×200 PNG正式读取200/146bytes；旧PEOPLE合成会话UNAUTHORIZED，未恢复它或把它计成功。公网无新邀约正例，不能将本地HTTP验证写成公网邀约通过。

实际预算8/8，最后一次来源为第6真实世界阶段缓存+第8实时历史，原ordinary同seed/input正式retry；第8缺明确日期被严格拒绝，任务failed/world及initial0，authored暂停。新historyLinksEnabled=false，N旧来信开启，自动关联仍待验，A16仅有限已上线兼容界面可体验，父BOOT未完成；本批没有NPC真实承接测试，0生图，只有1合成上传和2原world IDs。原自动审核拒绝后人类明确批准有限范围，后浏览器恢复调用曾自动审核超时未执行，重试限定备份后成功，无绕过。保留各次真实失败、未链接成功与探针误读记录，不以夹具或JSON结构测证明AI稳定。

资源收口：仅自有本地合成账号/world/磁盘像素经ID/owner/title确认清理；55450/3254/3255无监听，PG正式停止。Ego107正式域单一pl_session精确恢复、仅boot01pi.localhost会话/local_storage清理、finish一次；其他网站/空间不动。Ego更新提示已见，本批未升级。密钥与cookie只在ignored 0600证据，未提交。未关联访谈/APIclient/创作/设置WIP保留未stage。

下一步：改良真实关联的结构输出及日期策略，再在另行明确预算内验证完整实时两阶段、选入朋友同源原图和NPC承接；目前没有剩余外部调用授权，不自动续跑。以下历史记录保留，最新状态以此节和最终ignored部署handoff为准。

