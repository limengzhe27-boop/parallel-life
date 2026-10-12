# WORLD-PUBLISH-MAP-REVIEW-Q · 地图与导航只读复核

2026-10-13，负责人 `codex-publisher-md-review-q-01a0c7c8-20261013`。待验收；根集成人统一决定修复，不修改地图、现场、公共源。

准确审查树：主目录 `.local/worktrees/map-realistic`，分支 `codex/map-realistic-01`，HEAD `f711ffe33b18432ac7e89adaed71b07649f5e3ae`，审查时工作树干净。基线含根 `94e7f4c78b37cf6527d8efb93e5807e79a82fc39`；最新 f711 改五文件，地图只增 target 同步，另含 notes 文案、scene panel 滚动、scene stage 在场空态和 CSS。报告 `MAP-02-INTEGRATION-REVIEW.md` 是历史验收陈述，不替代当前准确代码。

## 保留的真实边界

- `mapSelection` :14–30 用 WorldSpace.storyNow + 实际 route.durationMinutes 预估到达；列表 :1057、详情 :1080 使用原路线耗时，不依据画布像素距离或交通模式倍率造时间。
- 新行程 :200–224 检查 world/version、busy/paused/已有 operation/重入，提交仅 commandId/expectedVersion/routeId。动画不写位置、clock、NPC、出席或事项完成。
- SpaceClient.travel/recover 校验 receipt world/command/route/version，mapFeedback :55–89 再核且异常呈 unknown。pending 反馈仍是“正在确认行程”；真实 committed 才显示到达/实际分钟/arrivedAt。useWorldMap 将原命令先存本地恢复记录，pending 重载变 unknown，不自动重发。
- unknown 可以只读核对，核不到回执后的重新提交是显式、同一原命令；paused/busy 禁用新的提交。committed 且当前已读版本/地点与 receipt 一致时，1.4 秒自动继续只是清 view operation/选地点，不运行新旅行或现场任务，不据动画结束宣布到达。
- 进入现场只在当前实际地点可点，map.enterPlace 走原真实服务/任务回执；currentSceneId 已存在则打开该场景，不把 UI 自己造的 ID 当现场。当前点相关联系人只来自 selected.contactActorIds，呈“联系”，不表示 NPC 在该点。
- notes recordDestination 仍用服务器授权的 navigation.placeId/actorId/invitationId，未按名字猜 ID，未自动行程/完成事项。SceneStage 新逻辑只过滤实际 actor presence 列表，修正只有玩家时的空态，不新增 NPC。

以上为源码核对，不是本轮真实 PostgreSQL 或线上回执验收。

## 具体问题与静态反例

### P1：无来源路名和米距仍在准确当前源码

`map.tsx:812–826` 固定渲染“丰和路”“长宁路”“长宁巷”及“200米”。mapDiagram :34–51 明确只是已知地点数组的逻辑网格，没有经纬度/道路/距离信息。反例：同一套网格用于任意世界，连道路设定都没有却仍显示相同道路和 200 米。aria-hidden 只影响读屏，不能让视觉事实变真实；“地点示意 · 非地理距离”不能给固定米距提供依据。应移除无来源名称/比例尺，保无名称的抽象底纹。当前没有发现固定城市/天气字符串，不能把旧城/天气问题一概说成仍在。

### P2：减弱动画没覆盖 SMIL、内联 transition 和 JS smooth

`map.module.css:487` CSS 通配 animation/transition none 可以关闭 CSS 动画（包含 currentPin::after 的额外规则）。但 `map.tsx:867/874` 原生 SVG animateMotion 的 repeatCount=indefinite 不是 CSS animation；`:715` 画布、`:920` 点位 inline transition 的优先级高于普通减弱 CSS。f711 新 `scene-panel.tsx:85` scrollTo({behavior:'smooth'}) 及 :662 输入框 scrollIntoView smooth 也没有读取用户减弱设置。应对 SMIL 条件不渲染/隐藏移动层，inline 与 JS 同步使用 media query；不能以 CSS 存在就宣称全部减弱通过。

移动 SVG 层只在 committed 且旧 selection 仍有该 route 时绘制，不是提交前实际出发证明，也不表现持续真实路上过程。建议保持定位反馈与必要的短状态动画，避免已到达回执后无限循环暗示仍在途中。

### P2：便签跳地图的失效目标和加载后定位

f711 `map.tsx:106–112` 的 effect 仅依赖 target/worldId，初次打开地图时数据尚未加载，detailsElement 可以 null，后续数据到达不会因 target 不变再次滚动。应在实际匹配地点与 DOM 就绪后定位并聚焦。

另 `mapSelection:16` 未知 placeId 会静默退回当前位置；player-records :639 只要 matter.relatedPlaceId 就给 map target，未在此投影证明地点当前可见。因此陈旧/未再可见地点的“前往现场推进”可能显示另一当前位置且允许在那里进入现场。没有直接篡改位置/绕过后端，但对目标含义有误导。应明确“原地点暂不可用”，保安全返回已知地点，不默称目标现场。

Notes 两处文案从“查看地点”变“前往现场推进”，实际动作仍仅 open(map, target)，没出发、等约或打开现场；需文案表达中间步骤，或由根定义显式复合流程，每个写操作仍保原命令与真实回执，不靠导航自动推进。

### P2：分类及辅助控制边界

现源码已有已知地点的真实文字搜索、类别按钮过滤、缩放/图层状态和触摸手势，旧报告“都没有操作”已不适用于此 HEAD；它们依然不是地理检索/距离服务。类别用名字/描述字符猜，例如描述含“林白语”的餐厅可能被归到公园，药店分类可收医院；应标识当前是文本筛选或按作者明确分类，不能声称真实 POI 类型。

罗盘 :725 是有 onClick 的 aria-hidden div，读屏/键盘不能使用该重置操作；工具/地图点触达尺寸、缩放后的可达性、手机系统键盘、短屏和长地点名须根实际浏览器验。地点世界事件来源 :1093 统一称“来源于人生起点”，后续发现来源可能被说错，应使用实际来源类型/时间。

## 验证、资源与接续

本轮只读 HEAD/clean、提交差异、地图/notes/scene/controller/client/domain 来源路径和减弱规则。未运行 npm check/build、浏览器、模型、数据库、生产、任何端口；未创建新场景或世界。报告中的反例是静态源码推断，不是已跑测试。此前根 26 项专项/390 现场证据仅是其报告，未由 Q 重跑。

根优先移除当前路名/米距，补减弱动画和准确目标加载定位/失效态；在准确最新版本验证地图第一排、搜索、缩放、原 receipt 的 pending/unknown/paused/committed，以及 notes→目标地点→合法现场。继续保原 command receipt、后端授权与已发生证据，不扩大为地理天气服务或全 NPC 位置。
