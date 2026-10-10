# SPACE-02A · 地图后端与串行集成

Agent codex-space02a-i-01a11a84-20261010。独立 scene-index-transitions / codex/space-02a，基线 cf01663。2026-10-10 已主表短锁领取。当前进行中，未上线。

## 冻结给 UI 的最小契约

类型源 src/contracts/world-space.ts，controller src/features/phone/map/context.ts；I 将 PhoneAppContext 增加可选 map?: PhoneMapContext。F 仅实现 apps/map.tsx、map.module.css 和专项 UI tests，MapApp 接收 PhoneAppContext；公共 apps/index、navigation/icon、world-phone-app/context 由 I 接线。根 travel-feedback 8ec5796 由 I 串行接受。

GET /api/v1/worlds/[id]/space -> WorldSpace：worldId/worldVersion/storyNow/paused/busy/currentPlaceId/places/routes/currentSceneId。place 有 id/name/description/source/contactActorIds/appointmentIds；route 有 id/fromPlaceId/toPlaceId/durationMinutes/modeLabel/source。只返回可靠来源的玩家已知地点与路线，没有经证明的位置时 currentPlaceId=null、routes空。联系人仅可联系，不声称他在现场。

POST /api/v1/worlds/[id]/space/travel，body TravelRequest={commandId,expectedVersion,routeId} -> TravelReceipt：status=committed，commandId/worldId/version/sourceEventId/routeId/fromPlaceId/toPlaceId/fromLabel/destinationLabel/durationMinutes/departedAt/arrivedAt/leftSceneId。任何失败未算到达。

POST /api/v1/worlds/[id]/space/receipt，相同原请求，只读 -> TravelRecovery：原 committed 回执或 {status:unconfirmed,commandId,worldId}。changed fingerprint 409，跨 owner404；unconfirmed不是失败/退款证明，核对不执行旅行。UI须保存原 request；提交中不假称出发，unknown先核对，重复原 command 不重复加时间。

PhoneMapContext data/loading/error/refresh/travel(request)/recover(request) 是唯一界面入口；刷新与 receipt 后 I 重新读取 world/clock/space。F 可生成 UUID 并保留整个请求及相应原始版本；暂停/忙/未知位置禁新旅行，但允许刷新和核对。到达后公共环境 description 标明作者设定，可真实阅读；contactActorIds 通过 open(messages,actorId) 联系；appointmentIds 通过 open(calendar,id) 查真实日程。只有已确认且到时、与当前地点绑定的邀约可以进入原现场，不能自动执行或伪造活动完成。进入按钮可由 I controller 后续追加而不让 F 用新 URL 猜动作。

## 来源和实现政策

四份官方内容在新 contentVersion 中添加明确作者设定的地点、故事路线耗时、初始位置及邀约绑定，与现有情节吻合；无真实GPS。新世界将空间同 immutable genesis 保存。旧世界不猜位置，不在 GET 写回、不改旧 immutable；无可靠资料诚实空态。本批不为旧生产世界自动补地图；后续如需建立必有独立可信来源事件。

旅行一次事务锁 world/clock/position，结清旧现实anchor，departure=max(world.time,projectStoryTime)，arrival=departure+route分钟（speed不乘路线），world.time/clock.storyNow/lastTickAt/position/scene leave/event/receipt同事务；暂停拒新旅行。活跃付费回合或 unknown 不静默取消，先拒旅行。当前地点与现场参与分开，离开现场仅 player presence；来源只通知实际现场已知参与者，不广播私人信息。故事区间记事件，旧约定不一律改 missed/attended。

## 唯一公共文件范围与迁移

0041_world_space.sql 预留 I；world-space contract/domain/application/repository、world types/replay、official-genesis/presets、clock/scene repository、server/services/新space routes、新phone map controller/client/context、phone-shell/navigation/apps index/world-phone-app/phone-icons及必要专项测试。主client/interview/LIB WIP只读。根仅 travel-feedback/presentation，F仅MapApp/CSS/tests，不并写。0付费文本/图片/生产新世界/生产上传；PG55450/HTTP3254启前核查。本批实际代码目前只有契约和context，未运行检查、数据库、UI或部署，不能称交付完成。

## 接续

先完成官方空间来源与原子仓储/锁规则，再真实PG幂等并发/回滚/RLS/replay，接F/根冻结并执行 check/build、手机PC、生产迁移/READY和只读公网；原图/私人档案与NPC实时定位不混入地图。

## Contract follow-up (2026-10-10)

ab4350d frozen first interface; additive fields are now frozen: SpaceSource world_event includes eventId/eventVersion; WorldSpace.canEstablish; PhoneMapContext.enterPlace(placeId)/establish(). enterPlace requires actual current place and invokes the existing durable scene/free-action kernel. Contacts are never treated as present NPCs. Old official instances can explicitly establish authored locations only at version 0, no active scene or busy task, with checked unique original actor/invitation bindings. No read backfill or immutable rewrite; modified legacy worlds stay honest unknown. New four packs contentVersion 2; existing owners continue old saves. Retired-star keeps authored 95-minute venue journey.

Synchronous paid messages route additionally owns the same advisory lock across the model call, blocking travel. setClock now locks world then clock in one transaction with that advisory key, avoiding lost travel anchors. Initial typecheck failed because the type insertion searched interface rather than type; corrected before revalidation. Root travel-feedback 8ec5796 accepted as 41a8093. PG 55450 started after checking the port; no HTTP/model/production mutation yet.

## Controller operation freeze

Controller now owns world-scoped persisted operation (request/fromLabel/destinationLabel/status pending|unknown|failed|committed/receipt?/message?), checking, checkTravel(), retryTravel(), clearTravel(). F must not create another storage key. pending restored becomes unknown; checkTravel only reads original receipt; retryTravel only explicit known failed and checks receipt first, no new command/version guessed. clearTravel only committed/known failed, never pending/unknown. Original travel(request) and recover(request) remain. Source/context addition e2bb3a8; next interface commit below is usable without uncommitted inference.

Controller freeze SHA 6f6f639: operation/checking/checkTravel/retryTravel/clearTravel and enterPlace/establish are public. I has now written map/client.ts, operation.ts, use-map.ts (not use-world-map.tsx); these remain exclusively I-owned, root must not duplicate them. Root proposal to write a controller arrived after this implementation; no scope release. Source/domain/repository still under verification, not frozen as backend. Operation storage is localStorage pl-travel:<worldId>, restored pending is unknown and check only calls receipt. Local PG session44151/55450, no HTTP yet. Departure fact now in the travel event/reducer; old bindings are validated unique names+relationships and invite title/source actor/text/participants rather than array position.

## Final additive recovery fields

PhoneMapContext adds working and resubmitTravel(); TravelOperation.recoveryUnconfirmed?:boolean becomes true only after actual original receipt returns unconfirmed. UI can show explicit resubmit original only for unknown && recoveryUnconfirmed; calls same original request, no new command or version. Each resubmit first checks receipt again. New travel requires persist success before POST; storage disabled produces known local failure without a write. Root can extend feedback optional onResubmitOriginal; no controller scope release. Node strip-only integration first failed on parameter properties before reaching DB; replaced with explicit fields and rerunning. Pure spatial4 tests passed; no paid call.

## Backend validation progress

2026-10-10: map type/public controller additions e2bb3a8/6f6f639/3802674 frozen. First integration import failed on Node strip-only parameter properties (no DB actions); fixed explicit fields. First DB run exposed clock.read Date->String->Date dropping milliseconds (6 subtests passed, 1 failed); fixed native Date conversion. Rerun spatial real PG 8/8 including parent passed, full real DB206=201pass/5 optional paid or HTTP skips/0fail. First new client tests had incorrect SessionSchema fixture fields; corrected to kind/csrfToken, new pure/client6/6 pass. Earlier full check633/633 passed (before additional2 client tests/latest scene place guard); final joint check must rerun after UI. Backend build currently running. No paid model/production mutation/world/upload/image.

Root feedback followups b0c8174/bcdf8d6 accepted as60169ec/bbb7351; optional unknown original resubmit ready. I map/client.ts/operation.ts/use-map.ts now implement storage-before-POST gate, original receipt verification, world key persistence, unknown->read-only-check->unconfirmed flag->explicit same-command resubmit. working protects phone auto-advance. F should consume3802674 types, no own localStorage. Backend scenePlanning and commit now verify stable place equals current physical location and canonical location string. Legacy bindings verify unique original names+relationships and invitation title/source actor/text/participant set, including reversed actors real-PG pass. Failed modified/unknown source remains empty; no ordinal identity guess.

## Backend and public phone freeze candidate

Latest full check635/635 passed; build passed before last guard, spatial real PG8/8 rerun after canonical scene guard passed. Full DB206=201pass/5optional skip previously passed. Navigation expected desktop list had one known old assertion failure after map addition, updated exact active app list then635passed. Root can forward forthcoming source commit to F: navigation declares map (desktop and deep links), phone-shell title and optional map ctx, phone-icons map glyph, world-phone-app owns useWorldMap + busy propagation. apps/index will be wired to F MapApp only after its own source freeze. No intermediate deployment.

Backend/public-phone freeze commit follows the latest source log; all registered source is now frozen except pending F MapApp registration and evidence-based fixes. Root/F can inspect or accept this commit without editing I-owned files. No HTTP/production paid calls or new worlds.

Freeze correction: 3ad3118 staged the registered API/domain/controller/public phone sources but omitted the new space-repository.ts from the explicit allowlist; immediately following commit includes that repository before any downstream integration/deployment. Both commits are required; no source package is claimed complete from3ad3118 alone. Current local checks ran against the combined working tree, not the incomplete commit.
