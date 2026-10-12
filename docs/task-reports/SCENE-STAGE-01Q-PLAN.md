# SCENE-STAGE-01Q-PLAN — 现场呈现只读复核与验收计划

2026-10-12；Agent `codex-scene-stage01q-plan-01a0c7c8-20261012`，辅助会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。主目录本人短锁确认进行中；原独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，新分支 `codex/scene-stage-01q-plan`，准确已发布基线 `778eff398cad7dbb0a91827cb28c789db6ac7869`。旧2d9/c3审计分支和报告冻结保留，没有reset或覆盖。

仅本新报告与主表本人行；全部src/tests/契约/SQL只读，不读根WIP验收。根已接回本轮唯一实现/契约与集成，独占现场组件/样式和必要phone-shell字段接线。B原04已closed16/18、测试世界暂停、真实完整链仍未过；本UI计划不继承额度或补成成功。人物名片、分支分类及新图片模型任务均先排队，本Q0模型/PG/生产写/端口/浏览器/部署。

## 已读与主要结论

已读AGENTS、PROJECT_BRIEF、DEVELOPMENT、ARCHITECTURE_REVIEW及DESIGN当前规则；按准确基线读phone-shell、phone.module.css、world-phone-app、world-app-data、avatar-art、scene-panel/scenes.module.css、index-state/world-sync/state、通知projection/state、scenes/world-experiences/world-build/album公共契约，以及AppViewport/viewport-geometry。只读核对既有资产route/readForWorld和安全player-actors投影，未实际访问数据库或资产URL。

|问题|当前实现|实施判断|
|---|---|---|
|现场是否还用同一手机壳|WorldPhoneApp的renderPanel('scene')直接渲染ScenePanel；PhoneShell持续按worldId挂载|继续复用，不能新建第二壳或重置同世界通知与路由|
|现场有无顶部微信横幅能力|banner为StatusBar之后、所有route内容之前的兄弟层，无scene排除；只要求有新banner且未锁屏|机制仍在，但只在真实新通知到达并刷新data时显示，不能从现场对白伪造微信|
|场景图片|scene-panel.tsx的media_reference分支直接null；ScenePanel未接photos|确实未显示，需根接授权素材映射；无图时诚实原创示意，不冒充生成图|
|人物可用字段|SceneOverview从scenePresent得到实际actorIds，contacts有安全name/relationship/avatarUrl；安全投影不含Persona|按实际在场与授权id匹配，不能把预约/全contacts当在场或补人物背景|
|短屏与键盘|scenePanel有reading内滚+composer；壳只存外层panelPage滚动。AppViewport记录visualViewport height/offsetTop|必须处理内层滚动恢复及真实可用高度，不能只靠桌面缩屏或媒体查询|

## 通知层及同步

PhoneShell已有新ID检测arrivingIds，取最新事件时间通知并显示6秒；knownIds以首次传入通知初始化，因此旧未读记录不是“刚到”的弹窗。通知来自授权persisted messages（排除user/initialRead/viewed）、已加入群的实际消息，以及当前有效邀约；它是App内部呈现，不等于iOS系统Push。

横幅CSSabsolute、z-index8、top60px+safe-area（有开发notice时84px）；StatusBar层级4，手机root isolation/overflow hidden。新stage插图、人物层和遮罩不应盖横幅/截断点击，不能在横幅出现时把整页滚到顶。锁屏时横幅隐藏、原锁屏通知分组仍承担显示，不另复制一套scene通知。

私聊通知按actorId定位；群通知按conversationKind/groupTarget隔离，同名或相同target值不混。私聊open走壳navigate保存来源hash；群回调目前由WorldPhoneApp直接改hash，需单独检自定义返回与浏览器返回是否都回原现场，不可仅验私聊。关闭横幅/打开通知的openedIds是本地UI记账，不是服务端read receipt；进入实际thread才沿用原已读逻辑。

现场回复在SceneRead.entries.dialogue，不因为说了话就等于微信消息。SceneWorldSync在非busy且新worldVersion时刷新手机投影；只有真实world.messages新增才能弹微信。既有WorldPhoneApp还有world clock轮询与advanceWorld通路，这不是WebSocket，不能宣称实时push或后台主动可靠链已验。新UI保留现有桥接，不为了造提醒自动发消息或启动模型。

## 图片与人物边界

SceneRead.media_reference的media含assetId、purpose、owner/world/source引用，**没有URL或revision**。域规则已区分scene_illustration（关联该事件）和scene_reference（旧素材引用），scene里message_attachment不合法。显示必须先筛本world/scene和observableTo包含player；不能把返回集合里NPC-only媒体或全部相册任意当现场画面。当前read API是拥有者场景读取，ScenePanel.stream渲染所有entries；新呈现建议按player可见性再次明确筛选，不能只看kind。

已有WorldPhone.photos是授权AlbumPhoto列表，字段id/worldId/title/date/createdAt/kind/sourcePersonId/width/height/revision；worldAppData按该列表生成world-scoped资产URL。根可传这个有限投影/映射，以同world且id===media.assetId找revision和已授权URL。引用存在而素材列表尚未刷新或无revision时显示诚实加载/不可用，不能默认revision1或猜assetId是网络地址。

`/api/v1/assets/:id?worldId=...&revision=...` 经owner、world归属/绑定、ready和revision验证，private/no-store。不能因scene map未命中就退到不带worldId的owner-only资产接口；拥有者现实私有素材不自动获准带入此世界。Scene media缺revision也不能保证旧历史图片字节版本，展示现有授权版本应标“关联素材”，不能伪造“刚刚拍下的现场”。kind=upload、createdAt仅说明上传，不证明拍摄时间；旧generated素材原展示“生成来源待核验”，UI不升级为本轮模型生图成功。

无可用引用时可用根新增原创SVG场景示意，必须明确示意/非现场实拍或本轮生成，不把壁纸、标题regex命中的相册图或风景图库冒充此事件。加载失败/权限撤销/404/URL过期返回同类fallback，图标/姓名仍可读；不要无限重取或自动生成。展示不同世界/scene需清理旧图失败状态和源，不闪出上一世界图片。

在场actor只来自scenePresent(scene,worldVersion)和sceneOverview.people；预约参加者、全联系人、对白里提及的人均不是当前在场证据。历史ended scene用“记录中的人物”等历史语义，不能当当前到场；只有实际speaker id能决定对白是谁，不由名字regex或第一人称猜身份。

WorldPhone的安全actors投影字段id/name/relationship/sourcePersonId/photo{assetId,revision}，不含私人Persona。schema虽容许summary，当前projectPlayerActors实际不填，不能从后台persona补“性格/经历”。resolveAvatarArt返回authorized-photo/character-illustration/generic-illustration及label，优先已授权人像，否则原创插画；PhoneContact只保留avatarUrl而没有kind/label，根若用于较大人物画面可传现有view层元数据避免当真实肖像，不扩大公共private字段。照片不可用或未知联系人用可读姓名/通用图示，不冒认角色，不显示完整现实档案。

## 导航、输入及可用高度

PhoneShell保留scrollKey(worldId,route)及panel外层位置，但panel缓存键仅panel:scene，ScenePanel.reading才是实际内层滚动。这意味着仅壳位置不保证现场→通知→返回能恢复阅读位置，历史scene和current也有外层位置混用风险。根需明确单一阅读容器或按worldId/sceneId保存内层位置，不通过改wrapper key丢通知/草稿。

当前输入sessionStorage按worldId/target保存draft和command；原commandId、expectedVersion、relatedMatterIds、原文及失败/unknown重读/显式重试链必须保留。视觉分开旁白/对白/自己的输入，不改变模型所接原文或将想法画成已执行事实；失败说明不抹已保存行动，不自动retry/离场。当前按钮“回到手机”会调用client.navigate，是业务写，不等于纯浏览器back；只读QA不要误点或把两者结果混记。

布局采用同一手机内全页，不回到PC双栏/外辅助面板。保留原status bar、壳header/返回、safe-area及home gesture，不重复Dock或系统栏。正文、图、人物、输入必须共享实际可用高度；图片可随短屏收紧或可折叠，不能固定大画面+大人物把输入/正文挤出。font/点击目标不以缩小换空间，44px交互目标、字体放大和长中文换行均须通过。

AppViewport现已有height/offsetTop补偿，并对pinch zoom不追踪。媒体查询max-height测layout viewport，不代表软键盘visual viewport；优先依据phone容器size/可用height做紧凑状态，保留原offset与缩放语义。PC容器内420、外层430规范独立；不为scene复制公共外壳。宽度跨601px、横屏/平板及PC边框高度使用100vh的路径可另检，不把手机390模拟等同所有设备键盘。

## 冻结后的可执行验收矩阵（本回合未执行）

|场景|操作/可信夹具|应观察|
|---|---|---|
|390×844正常|合成授权scene含环境、在场actor、两种对白、media_reference；来源标明|图片/人物/旁白/对白分层清楚，无横溢出，输入与原反馈/失败状态可达，只有一壳|
|390×500短屏|长正文+多人+图，展开/收紧，再读至末尾|内部正文能滚，图/人物不吞全高，发送/返回44px且末尾无遮挡|
|visual220/offset90→恢复844|同页focus/输入草稿，不提交；观察输入与通知层|原稿/选区不丢，输入和主要按钮可达；恢复不留大空白，不影响pinch zoom|
|真实手机微信/Safari键盘|有明确允许的只读或阻断写的fixture，展开/收起/旋转|记录实际设备验证，短屏/CDP结果不能冒充真机|
|PC1440×900内420|同场景及长姓名，字体放大|窄幅一列、无外辅助面板，图和文本不越界/裁掉身份或否定含义|
|scene展开收到新私聊|本地隔离fixture更新真实消息形态的ID/at；生产只读旧paused数据|横幅在图层上，6秒与关闭行为正确，点进exact actor thread，返回同scene/阅读位置/稿|
|新群/同名联系人|不同conversationKind及target碰撞的fixture|群路由不混私聊，自定义返回/浏览器back均恢复；不能按姓名猜路由|
|初始旧未读/锁屏|已有ID、世界切换、锁屏后新ID|旧未读不伪装新到；锁屏分组用原机制、打开定位，世界切换清旧层|
|媒体source矩阵|player可见ready引用/不可见引用/缺revision/404/跨world/旧scene/加载失败|只用授权同world映射；缺图明示示意或不可用，无owner-only绕行、未授权图和自动生成|
|人物矩阵|现/离场/未来预约/未知actor/照片失效/插画|只有实际presence在当前栏；unknown可读fallback，照片优先/插画明示，不暴露Persona|
|输入与回执|只改本地draft，模拟queued/running/failed/unknown及新world版本|原文/command恢复，unknown不自动付费，结果未确认不画完成；SceneWorldSync同版手机投影|
|历史记录|读ended scene或无time_place的旧记录|不当新入场，不以当前storyNow冒充旧记录发生时间，不回填图或自动完成|

新的浏览器验收先由根登记独立fixture/端口或选择已paused正式测试世界。当前world-phone-app有自动advanceWorld路径，未暂停且时钟due的世界可能触发模型；0模型QA不能只因“没点发送”就把打开活世界当安全只读。基线验证不调用进入现场/返回业务view/离场/重试/发送API；模拟提醒和状态要明确是隔离UI夹具，不伪造生产消息。生产验证保持真实照片授权/404/跨owner读证据，若需SQL由根独占执行。

## 验证事实与接续

本次仅本地源码/契约只读核对及文档diff/主表回读，未运行test/check/build、浏览器、PG、HTTP、模型、上传/生图/部署，没有截图。以上矩阵为待执行建议，不能当产品UI已实现、真机/真实图片/模型或数据库通过。

计划报告提交待验收后由根决定有限素材props/滚动与可用高度方案，独占实现并给准确freeze；Q再按另行明确的只读UI验收范围复核实际呈现与路由/通知。根负责全check/build、41生产迁移只读、READY/public和完整记录。其他排队任务不在本报告开工，旧04模型链失败/closed状态不改变。
