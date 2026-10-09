# SPACE-01Q · 地点、移动与现场规则审查

负责人：codex-space01q-20261009（I 指定 `/root/play_contracts`）。基线 `13634ad73c7f46c7c2cd5e05a68d3a100bfa7353`。主登记目录纯只读业务审查；本批只写本文和 DEVELOPMENT 本人状态行。状态：自审完成，待 I 验收。未修改 PLAYER 旧提交、业务、迁移、公共组装或 UI；未部署。本文的类型、事件名和文件划分都是后续实现建议，不是已经发布的 API。

结论：现有现场提供了可保存的观察、行动尝试、裁定结果、事项和在场记录，可以继续复用。缺的是有来源的稳定地点、玩家实际位置、跨地点旅行及其与全局时钟的一致提交。**现有 enter 代表加入现场的参与状态，不证明玩家物理到达。** 不应以现场开场模型给出的地点文字、手机页面切换或旅行动画补上这个证明。

## 1. 需求与决定的界线

已确认（主任务最新授权及 PLACE_SCENE_TRANSITION_PLAN）：地点、人物、时间和现场要有因果联系；到达后有环境、在场人物、可参与事情和自由行动/结果；旅行细节可以略过，以短过渡提示经过的故事时长和到达。片场去医院可能影响拍摄安排，具体影响必须有来源。例子中的半小时不是全部路线的默认值。返回手机不离场，切换页面不搬动身体；保留内部导演、既有时间管理、多人生和旧需求。

建议：地点使用稳定 ID；位置与视图分开；到达与进入当地事件分开；旅行采用服务端校验的耗时依据及幂等命令；位置、时间、参与状态与回执同事务；地图只投影玩家已知地点/人物信息。首批不接真实地图、GPS、交通或天文服务，也不另建一套世界引擎。

仍未决定：耗时来源/计算政策、交通方式、跨地点权限、地图形态、跳过与现实 1:1 如何共同计时、暂停时能否显式旅行、途中关键选择/取消/改道、长行为是否与旅行统一。下文给可实现的选择及推荐，不能把这些建议当成用户批准的所有细则。

已读 AGENTS、PROJECT_BRIEF、主 DEVELOPMENT、ARCHITECTURE_REVIEW、PRODUCT/ARCHITECTURE、SCENE_GROUP_RETURN_PLAN 第十一节、EXPERIENCE_IMPLEMENTATION_HANDOFF、最新 PLACE_SCENE_TRANSITION_PLAN 和 SCENE-02 报告。旧架构文档部分“尚未实现”描述已过时；现状以基线代码和最新验收报告为准。

## 2. 代码证据与缺口

|依据|当前行为|空间开发含义|
|---|---|---|
|`domain/clock.ts:24–94`|clock 保存 storyNow/speed/paused/lastTickAt；读取按现实差值×speed 投影；暂停不走；每次最多三拍，30 分钟是导演节拍单位|没有路线时间 API；BEAT_MINUTES 不是通勤常数，旅行不能再乘一次 speed|
|`infrastructure/clock-repository.ts:20–43,119–143,271–309`|advance 专用 advisory lock；setClock 先 read 再另事务 write；finishAdvance 同事务写 world.time 与 clock，并用 GREATEST 防倒退|既有 finish 的原子锚点可借鉴；当前控制操作没有完整旅行并发栅栏。不能先旅行更新位置再单独 setStoryTime；只靠 world.version 也发现不了所有 clock 控制变化|
|`application/advance-world.ts:44–62,146–213`|有界补算、稳定 beat 命令、未知尝试检查、实际回执后 finish；读取每个人可知事实|复用既有有界调度及 unknown，不为旅行启动常驻 NPC 或逐分钟模型。跳时跨过约定的调度适配仍需实现，不能宣称现 advance 已会消费旅行区间|
|`contracts/world-experiences.ts:111–119,179–184,236–245`|SceneSession 没有 placeId；time_place 只有文字 location；PlayerExperience 只有当前 sceneId 和 view|缺少稳定地点、实际玩家位置、途中状态、旅行记录；currentSceneId 不能作为身体坐标|
|`domain/types.ts:6–12,36–47,105–123`|Actor 无位置；Appointment 只有时间/标题/参与人；WorldState 无地点/旅行|日程不能靠标题直接匹配医院；联系人、群成员和约定人不能全部显示为在医院|
|`scene-repository.ts:331–392`|enter 查所属世界、版本、暂停、单一当前现场、confirmed 且到时，之后保存玩家 presence 和开场任务|已具备真实参与来源；未验证地点/物理位置，也不证明陈旧日程仍有效。不能把此入口改名“已到达医院”而不加领域规则|
|`scene-planner.ts:43–65,99–105,132–151` 与 `scene-repository.ts:599–678`|开场模型提出地点文字，从约定人选择在场者；后续动作冻结地点与在场人，move 只在现场内部移动；保存时有来源事件|可做观察/局部走位，不支持离片场到医院。模型获准的人物子集不是跨地点实在位置证据；来源事件存在也不等于模型文字语义已获证明|
|`domain/scene-runtime.ts:25–59` 与 `experience-rules.ts`|按加入/离开版本及 observableTo 裁剪发言/上下文；计划/假设不等于尝试|保留在场、可听见、实际位置和知情四层边界；不能因为共处医院就知道病情/私聊|
|`scene-repository.ts:481–543`|view_changed 仅切换；明确 leave 结束现场、关闭玩家参与，取消 queued/running 回应，历史可读|返回手机不改变位置；离开“活动”也不能直接给出下一身体地点。现结束单玩家现场不能被解释为所有 NPC 一起离开片场|
|`0037_scene_runtime.sql:2–25`|scene_sessions/items 有真实 world/event FK，player_experiences 每世界一行，scene_receipts 关联 command|复用 scope/FK/RLS/回执模式；当前位置列和 FK 还没有。不要写无来源临时 JSON，再让地图绕过事务读取|
|`scene-repository.ts:217–304`|command、world_event、world version/time、回执和投影同调用事务|此模式适合位置事件；现 event helper 不更新 clock 锚点，照搬会产生双时钟差异|
|`0001_foundation.sql:60–74`|world_events 有 UNIQUE(world_id,command_id)，command 绑定唯一 result_event|一条用户命令不能随意写三条“scene.left/travel.started/travel.arrived”世界事件；需要单复合事件或有稳定派生命令 ID 的阶段协议，不放松唯一性|
|`world-history.ts:14–105`|接受现有 scene 事件时只推进 World version/time；重放输出 World/groups/messages，不恢复 scene/空间投影|新旅行事件必须进同一 history 校验，并增加确定性空间投影重放；不能复制当前位置当作历史某版本的位置。目前不能宣称已有完整现场重放/分支恢复|
|`server/services.ts:157–182,199`|clock、advance、scene 在同一模块化单体组装；源码仅 domain 定义 replayWorldHistory，未见生产历史分支消费路径|后续公共接线由唯一集成人串行；空间重放是必需的纯规则，完整玩家分支 UI/用例另行核实，不在本批宣称已存在|

以上路径除 contracts/db/server 外均相对于 `src/modules/world/`。

SCENE-02 报告记载联合版 `26ba6b7`、Production344kdxj3a READY、393 check/63 PG（3 可选跳过）/build、公网 46 项和 390/1440；这些是执行者历史证据，本审查没有重跑库、模型或公网。其报告明确未实现全局地点/旅行引擎，且一次 21:12 叙述夕阳，有限心理词防护不是完整语义保证。

## 3. 最小领域边界与可落地字段

这些是设计候选，复用既有 Id、UTC Timestamp、Version、ExperienceScope/Source。生成 ID、鉴权、数据库由外层负责，domain 不访问数据库/网络/框架。

|候选记录|最低字段和规则|
|---|---|
|WorldPlace|`id, ownerId, worldId, label, source`；稳定实体，可选 parentPlaceId 表示医院/大厅等区域；名称可变不换 ID，两个同名医院不可合并。开放/访问资格有独立已知来源，不能从“医院”名字推出允许探视。首版无坐标/距离要求|
|PlaceBinding|真实设定快照地点键或后续事件绑定到 placeId；已有公开起点/已收到地址/实际观察分别保存来源类别和引用。genesis 来源校验不可变 snapshot/seed 键，运行事件校验 eventId/version/owner/world；不能伪造不存在的 genesis world_event FK|
|PlayerPosition|`unknown`（未建立可信位置）或 `at_place {placeId, source}`；若采用持久分段旅行，增加 `in_transit {travelId, fromPlaceId, toPlaceId, source}`。身体位置独立于 experience.view/currentSceneId；模型不得直接写。unknown 是领域缺资料，不是 HTTP 提交结果不确定|
|TravelRecord|`id, scope, originatingCommandId, fromPlaceId, toPlaceId, durationEvidence, departureAt, arrivalAt?, status, source`；状态至少能区分未执行意图、实际途中（若采用）、已提交到达，失败/unknown 另属命令回执。已到达不可改回途中；不能给 unknown 记录填成功 arrivalAt。计划本身不是位置转移来源|
|DurationEvidence|`policyId, policyVersion, durationStorySeconds, from/to绑定, route/mode(若政策采用), sourceRefs`；服务端耗时端口返回 `known` 或 `undetermined`，校验有限非负值和配置边界（边界值仍需定）。客户端/模型自填分钟不能变成权威证据，不能从导演节拍推通勤|
|ScenePlaceBinding|现场绑定 `placeId` 与真实创建/到达/活动来源；同一医院可有多次探视现场，arrival 不自动加入所有活动。新带空间能力的 scene.enter 校验玩家 at_place 与绑定一致、真实资格/活动状态。开场使用权威地点，模型仅补可观察环境|
|ActorPosition / Knowledge|人物实际位置独立保存时段和来源；玩家已知位置另有 `knownPlaceId/observedAt/source/visibility`，可陈旧或仅自述。每个 NPC 的位置/可知内容分别裁剪，地点事件不自动广播。个人 persona 仍只给合法本人上下文，隐秘行动不进地图/锁屏|

玩家地点列表同样只读玩家已知地点。模型提出一个“地址”可以保存为人物的原话/未核实信息，不能任意带出隐藏地点、锁门权限、内部病房/人物坐标。公开起点可以绑定可信地点，但整座城市名不足以认定人在某医院。来源不仅验证真实行存在，还须验证“该来源是否支持此绑定/此读者是否已知”。

场景观察与行动结果保持现有类型，不新增第二套任务引擎。旅行结果仅证明位置及耗时；不自动 completed 拍摄/探视 CurrentMatter，不自动 missed/attended 所有约定，不凭“去医院”完成救治或开药。对拍摄的影响仍由有来源的参与/责任/人物回应推进，长目标和奖励规则不在本任务定下。

## 4. 提交方式、途中与计时政策

### 推荐首批：完整跳过旅行的单事务提交

在用户接受完整跳过、没有中途需要选择、耗时有权威依据的条件下，一次 `travel.completed` **复合事件**包含离开起点活动、departureAt、到达终点、arrivalAt、耗时来源。其投影同事务关闭玩家旧 scene presence/取消未完成现场回应、更新玩家位置为目的地、更新 world.time 与 clock 锚点、保存命令回执及必要 Outbox。实际 NPC 位置不随之改变。这样既符合每命令一事件，也没有“已离场但尚未出发”中间坏状态。

`in_transit` 在此模式是同一事件内有起止的历史区间，不在两次 HTTP 之间暴露为已持久状态；UI 本地提交中只显示“正在处理前往请求”，不能把 spinner 伪装成已出发。回执成功后展示有依据的“经过 X 分钟，到达 Y”。HTTP 丢失就按原 commandId 查回执，不再次跳时。此最小模式尚需 I 确认与用户未定时间政策一致，不强称已经批准。

示意计时（候选政策，非现实现）：服务端取得锁后固定一次 realNow，先结清旧 anchor 对应现实推进，并以 `departureAt = max(projectStoryTime(oldClock, realNow), world.time)` 保持单调。`arrivalAt = departureAt + 已校验的故事耗时`；同事务写 `clock.storyNow = world.time = arrivalAt, clock.lastTickAt = realNow`。倍速只作用现实时间差，不再将路线的 30 分钟乘 2；网络及动画不提供路线耗时。提交后现实时间继续从新 anchor 流逝。事务 rollback 时没有旅行事件/位置/回执/跳时；原有正常现实投影仍可继续，不能声称失败世界完全冻结。

必须由 I 协调所有相关写路径：统一 world/clock 锁顺序与操作栅栏，clock 控制在锁内读改，不用读后另事务覆盖；既有正在 advance 的过期计算、付费现场回应和聊天结果都要重新校验状态/时钟，不得在旅行后用旧 anchor 覆盖。复用现有队列的单活跃/租约规则；是否先拒绝繁忙命令或显式结束当前现场，由 I 定协议，不能静默丢掉 pending/unknown 付费任务。数据库短事务内不调模型。

若同时间希望保存独立 scene.left 事件，则服务端必须用可恢复的派生命令 ID 并定义阶段；不能同 commandId 多事件，也不能先独立 leave 成功再在 travel 失败时假称原子完整移动。

### 需要真实途中时：必须另定阶段协议

不能一边宣称是完整跳过，一边用本地动画缓存维持世界 in_transit。若首版就需途中被打断/刷新时确在路上，应采用 `travel.started`、`travel.arrived` 两个稳定阶段命令（源用户 commandId+travelId 固定绑定，arrival 派生 ID 幂等），各自只有一个 World event。start 事务设 in_transit/关闭旧现场；arrival 事务在同旅程/同 scope/合法时钟状态下设 at_place 并保存结果。到达前不得执行医院的本地动作，也不能重新开片场现场；通信不会改变位置。

阶段模式还必须裁定：现实故事时间先达到预计到达点时是否自动 materialize arrival、跳时按钮推进哪个区间、离线恢复如何认定实际到达时刻、途中暂停/取消/改道。不能在几天后重读时把“固定半小时路程”又加到当前 clock，或回填旧 arrival 事件使全局时间倒退。所有会改变剧情/位置的请求先核对或结算到期旅程；历史到达有效时间与记录提交时间分开，不能用无版本的 GET 私自改变在场状态。上述未闭合前，建议首批仅开放单事务完整跳过，分段能力保留待实现。

### 暂停、倍速与跳时后的事情

- 当前暂停是新现场进入/行动拒绝，查看和明确离场可用。建议先延续“暂停不开始/完成新旅行，查看及回执核对可用”；若用户选择暂停也允许主动跳时，必须显式另定规则，不能偷改。speed=0 与 paused=true 在存储上不同，但都不能被模型当作已流逝时间。
- 路线耗时是故事时长；speed=2 不是两倍路程时间。旅行是否应消耗现实等待尚未定；短过渡不代表等待 d/speed 秒或分钟。
- 到达后的全局时钟已经跳过区间，沿途约定/幕后活动不能再次把同一区间作为现实 elapsed 重算。给既有有界 advance/agenda 增加可恢复的区间接续标记或 Outbox；不额外 launch 全量 NPC 模拟。补算与已提交旅行结果分开；补算 unknown 仍可确认身体已到达，但不可伪称所有消息/事项已结算。
- 是否遇到关键选择阻断跳过需要政策；没有该实现时，只接受被政策判定可完整略过的旅程，不让模型偷替玩家通过途中选择。出发前不足的依据保留意图/说明尚不能确定，不默认 0 或 30 分钟。

## 5. 地点时间与环境叙述的一致性

`domain/display-time.ts:1–2` 当前手机固定 UTC+08，不受浏览器时区或历史 DST 影响。`turn-planner.ts:118` 已给 timeZone；`scene-planner.ts:59–65,201–214` 给的是 ISO storyAt，没有等价的当地展示日期/时间及时区。21:12 出现夕阳的可能原因之一是模型误按 UTC 解读，但本批没有模型复现，不能确认因果；也可能是普通语义幻觉。

建议 runtime 给 scene/turn/arrival 同一 `storyAt` 和明确 `displayDateTime/timeZonePolicy`，来源为同一世界展示政策。场景叙述、过渡文案、手机日期和结果时间统一渲染该上下文；不能把手机 UTC+08 当成人物真实地理时区证据。首版不因模型地点名自由改时区；若以后允许跨时区，保存可信地点绑定及政策来源，UTC 全局时间不倒退，世界显示政策与当地墙钟分别说明。现固定 UTC+08 可以继续兼容旧世界；新增世界时区规则须由 I 决定，不能本报告替用户重设所有世界。

夜间/夕阳这类环境只应使用可靠上下文可支持的描述，未知天气/天文状态不要补成事实。有限词表、上下文补齐或静态 test 不能宣称全年日落时段正确，更不能引入未经要求的 GPS/天文服务。后续真实两身份样例应保留原始模型输出，检查时间语义，失败如实记。

## 6. 两条片场→医院因果正例（未来验收样例）

共同前提：合成玩家是导演，已在稳定地点 F 的片场现场，14:30 有拍摄安排；朋友真实私聊发来 H 医院的可公开地址；F→H 耗时由测试政策明确给为 30 分钟，**只对这条测试路线**。初始 14:00 是测试数据，不是产品固定开场。

1. **先交接再离开。** 玩家当面告诉确实在场的助理“我去医院，你先做灯光准备”，助理真实回应接受准备，不意味着已完成试拍。玩家明确前往 H；事务保存从 F 出发、F 参与结束、14:30 到达 H 和同一个全局锚点。助理知道玩家说过医院，制片人只有在助理合法转告后才知道目的地。医院大厅已有可信开放/地点资料，展示现场可观察环境；探视有实际资格与活动才能进入。回手机看到有来源的片场安排消息，身体仍在 H；拍摄 CurrentMatter 保留未完成或已获证据的进展，不能因为交接一句话直接完成。

2. **未告知目的地离开。** 玩家只明确前往 H，没有说医院。片场在场助理观察离开；制片人因 14:30 需要导演且有约定/转告来源，发消息询问是否回来或如何调整。双方不能自动知道医院/朋友病情。14:30 已保存到达，朋友若只手机约好而实际位置未知，医院现场不能自动把朋友列为在场；玩家可联系朋友或观察大厅。随后玩家明确联系/获准探视，真实行为才产生探视结果。地点变动可能影响安排，但不必统一处罚、强制错过或制造奖项；两个样例因告知/交接差别产生不同可知内容和后续。

两例均检查事件、位置、clock、现场参与、手机消息和任务证据一致；以真实模型生成合法回应，不能用上述示范文案替代真实成功。首版无当地事件时应提供有来源的地点观察/询问/联系/等待/离开能力，现单纯 appointment-only enter 尚不能覆盖这一点。

## 7. 验收反例与必需断言

|反例|最低断言（未来测试）|
|---|---|
|A 用户传 B 用户 world/place/route 或同用户另一世界医院|鉴权/真实来源拒绝，原始 HTTP 和 SQL FK/RLS 都不能读写对方；位置/时间/回执无旅行写入|
|两个医院同名；模型把片场文字改医院|稳定 ID 不按标题/数组下标猜；模型不得改权威绑定/位置；不知道目的地则不出发|
|“我想去医院”“如果去了会怎样”、只看地图/返回手机|保留计划/假设/视图；不生成已出发/到达，不追加通勤时间，不关闭在场|
|路线耗时缺失，模型/客户端写30，BEAT_MINUTES恰为30|undetermined，不能补默认数。相同策略版本同路线可重现，不靠第二次模型随机决定|
|paused 或 speed=0；客户端动画跑完|沿用暂停门槛；不能因动画把时间/位置推进。speed=0语义需政策明确，不能作为偷偷跳时入口|
|2×时同路线30分钟；请求等待/动画2秒|交通政策仍30故事分钟，现实旧锚点只结算一次；不是60分钟，也不是2秒路程|
|同 commandId重放；同ID换医院；两个command并发去不同地方|旧请求同内容返回原回执不再跳时；换内容IDEMPOTENCY_CONFLICT；同版本最多一条移动成功，另者冲突，不复制途中/到达|
|到达写clock后在位置/回执写前故障|强制PG事务故障注入：全部旅行相关写回滚；不留下 clock已跳/仍在片场或有回执无事件|
|HTTP超时、刷新、离线返回；阶段arrival重试|查原旅行/阶段回执，不自动新付费调用/新旅程；unknown无已到达提示，成功回执即便HTTP丢失仍恢复原结果。途中模式不会从现在重复加原耗时|
|advance、暂停/改速、私聊/群/scene回应与travel同时提交|真实PG两连接竞争：统一锁/CAS/租约，clock不倒退、暂停不被覆盖、过期现场结果不再提交，无死锁或泄漏锁；不能仅客户端disable验证|
|confirmed+due医院日程，但玩家仍在片场；过期日程|新空间模式拒绝“已到达/已在场”；旧规则不伪称物理证明。到达不会让陈旧活动变成今日有效，也不自动attended/missed|
|片场NPC/群成员/医院约定人全部被带到H|玩家移动不改其actual position；只有真实出现依据加入presence。医院当面发言由在场/可听见验证，通信身份不授予在场|
|制片人未获告知却说医院地址/病情；地图列秘密NPC医院坐标|原始公开序列化及各NPC模型payload用秘密标记断言：无隐藏位置/私聊；共同地点不自动知情；允许有来源的转告而不是全禁联动|
|“去医院并让医生治好朋友”，结果unknown或计划|只裁定可执行移动/下一必要步骤；不完成探视/救治事项、不替医生同意；CurrentMatter需实际结果及合法状态转移|
|scene.left关闭全部NPC物理位置；回看旧片场后位置回片场|离活动与物理位置分别校验；回看历史不改变当前位置，不能拿历史presence作为当前实际在场|
|旧世界无placeId；旧scene只有location；已绑定但当前实际位置无法确认|保留历史/私聊/照片/原现场读取与现有行动，不重建/改文。空间能力标未建立或unknown，不把旧文本解析成可信到达。新的跨地点旅行须一次有来源绑定后才启用；新规则只作用完成空间绑定的记录，不全面锁死旧玩法|
|重放到出发前/途中/到达后；未来分支从途中复制|确定性还原该版本位置与clock事件锚点，不取当前projection/现实now；阶段命令不复制父世界未完worker任务/receipt引用，重新绑定scope。完整branch未接入前不宣称功能可用|
|手机21:12，scene仅见13:12Z，模型叙述夕阳；换设备时区|同一展示政策context/到达clock/时间标签一致，不按浏览器或地点名偷偷换时区；真实语义抽样记录失败，不声称一个词表证明太阳状态|

## 8. 最小实现清单及串行申请

建议依赖顺序：地点/来源及纯规则 → 原子旅行/clock协调 → 到达后的地点现场 → 玩家可见投影和短过渡 → 有界区间后续。SCENE-03/TRANSITION-01可先继续复用现有真实现场入口，不冒充任意旅行。

|后续候选范围|职责及申请边界|
|---|---|
|新增 `contracts/world-space.ts`、`world/domain/space-rules.ts`、`application/space-ports.ts`|最小有来源地点/位置/旅行/耗时端口和纯规则；不改旧私聊 API 范式，不冻地图 UI。首版提交模式由 I 先裁定；专属 contract/space-rules tests|
|新增 `infrastructure/space-repository.ts`、`application/travel.ts`、专属 space HTTP routes|鉴权、scope/真实来源、请求哈希/幂等、版本/租约、事务/投影/回执；模型不可持有clock写端口。不得在worker租约外读私有NPC位置|
|新增迁移，具体编号由 I 另申请|地点表及真实scope约束、位置投影、旅行/回执、空间source/binding；FK/RLS/worker最小权限/删除约束/单当前旅程；旧记录缺能力正常。0037/0038不改、不抢39或其他号；精确表/列由所选提交模式确定|
|唯一集成人：clock-repository、advance-world、ports、world-history、必要domain types/scene contracts、scene-repository、services/worker|共享写栅栏、同事务clock、空间事件/replay、现场绑定与来源/在场、必要有界区间Outbox。不得由独立执行者泛领整个world目录；现有私聊/群/暂停/unknown回归必需|
|build-handler/build-repository/授权seed及创建协议（另精确协调）|仅可靠起点绑定新可选空间能力；拒收模型自报playerPosition/内部坐标，不重写不可变旧snapshot。前述PLAYER投影范围已释放，后续修改须重新登记|
|scene-planner、turn-planner、display-time上下文；玩家space read投影|权威时地、玩家可观察环境、各NPC自己的实际位置与合法知情裁剪；地图公开GET不能原样serialize内部空间模型。无约定普通到达的本地体验用同scene内核新增有来源地点入口，不另做故事引擎|
|UI/导航（当前唯一UI集成人另领取）|已知地点/当前身体位置、当前活动、真实命令状态、跳过短过渡及原始故事时长；返回手机/历史回看不移动，尊重减少动画；地图形态未定不先冻结|
|新增 tests/integration/space.test.ts、space/scene/clock/history回归与报告|真实PG atomic/FK/RLS/竞争/故障/重复/恢复；两身份真实模型因果及私密标记原始HTTP/payload；390/1440/断网刷新。生产迁移一致、干净提交、READY、公网关键流程均通过后才算业务交付|

无需在本报告先决定任务总数、所有交通耗时、所有地点地图形式或新世界全年时区。三项实施前阻断决定是：耗时权威政策；单事务略过或持久途中阶段；暂停/跳时与旧时钟协调。业务执行者先把这三项选型写为具体契约供 I 审阅，再按授权实际开发。

## 9. 本批验证及接续

静态复核全部证据与原始约束；亲自运行既有纯规则测试 `world-clock / scene-runtime / world-history / experience-rules`：49项通过、0失败/跳过。它们证明已有基础规则仍可用，不证明本报告中的旅行已实现。未使用数据库、预览端口、模型、公网；没有业务改动，未跑全量check/build以免共享构建写入/干扰当前集成，不以历史393项记录代替本次测试。

自审确认本文含2条因果正例、18组反例及验收；明确enter/参与与物理到达区别、命令唯一事件约束、原子时钟缺口、位置/知情/视图分离、途中方案及未定政策、旧世界兼容、时区原因候选和语义限制。全部建议均未包装成已实现。交 I 验收及精确分工；本批待验收，不自行提交主目录混合改动、部署或动旧PLAYER代码。LIB-04B和其他任务改动保留。
