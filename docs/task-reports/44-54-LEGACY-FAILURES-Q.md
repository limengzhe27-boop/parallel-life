# 44-54-LEGACY-FAILURES-Q：剩余12个失败叶项的逐项归因

状态：待验收（只读审查交付，不代表修复或全库通过）。负责人 `codex-ma-arch44-54-legacy-audit-q-20261015`，root唯一实现/集成负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-54-legacy-audit-q`，审查基线 `867cc7f6`。主表短锁登记后，仅新增本报告/主镜像/本人行；source/SQL/tests/CI零修改，0PG启动、0测试运行、0模型/生产/fullcheck/build。

## 证据与计数

读取root工作树 `/Users/limengzhe/.codex/worktrees/history-chat-media/人生剧本/.local/ma44-phase7-full-pg.log`：836节点，813pass/18fail/5skip。18是失败节点数，包含3个失败父套件；扣掉44-50/51另行处理的notes、publication-flow、publisher-http三个叶项，余下正是本报告**12个叶项**，不是18个独立新缺陷。

对照同root目录 `.local/ma44-baseline-ci.log`，该日志fetch并checkout的SHA明确为 `1028b06b7cf29dcb46adfcc84a029b4f5a82bff5`（日志216–230行）。12个同名叶项在该真实CI日志全部已失败；其中11个错误签名/栈与phase7一致，scheduler的失败位置和结果不同，单独说明。没有跑旧工作树或把名字相同就当原因相同。

**优先P1是地图发现触发的版本错配（两个叶项，同一根因），不是测试小瑕疵。** 其它安全守卫的提前拒绝、测试假设的自动写入时机、确定的时钟夹具问题不能一概称“旧基线可忽略”，也不能为通过恢复统一催问规则。

## P1：合法回复带地点发现时整轮回滚（叶项4/5）

phase7日志1242–1273，两个hidden-place叶项都在真正提交NPC回复时，落到 `PublicationEventProgressRepository.apply:201` 抛VERSION_CONFLICT。源码因果完整对应：

1. `postgres-world-repository.ts:649`先在同SQL调用PublicationStoryRepository.reconcileInTransaction。
2. `publication-story-repository.ts`的revealAuthoredPlace提交真实space.place_revealed事件，把world.version从NPC回复vN增到vN+1，并更新内部c.world/c.version。
3. 外层WorldRepository仍保留旧的局部state=vN，用它构造ActorContext，随后applyActorEventAssessments→publicationGoalContexts→ledger.apply要求数据库版本等于旧context.worldVersion。
4. 数据库已为vN+1，故拒绝并回滚整个事务，包括合法NPC回复。日志与这条路径相符，不是fixture的wallclock，也不是应吞掉的并发异常。

1028基线日志2548、2581已经同栈失败，说明是**既存真实缺陷**，没有证据归罪44新改。生产epoch2尚未启用的情形下，不能说“旧引擎以后删除就无影响”。

最小修复边界：root在同一事务协调reconcile后的最终state/version、后续评估上下文、首次返回值与原command.result_state的统一语义；NPC source event仍为vN，发现事件为vN+1，不能篡改原source版本或让初次/重放世界版本不同。不得只把ledger版本强改、吞VERSION_CONFLICT或取消真实发现。需保留未知地点只能经真实来源被发现、发现不等于玩家到达、重复发现幂等及回滚原子性。root已要求后续55单独设计，本文不改实现。

## 12叶项清单与最小处理

下表phase7位置均指上述full-PG日志；baseline指1028日志的not-ok起始行。行号为本轮读到的证据，不假称修复后仍相同。

|#|失败叶项与证据|归因、最小建议、能否删除|
|---|---|---|
|1|publication-scene-goal-worker，测试353，phase7:1187，baseline:2122；ledger.load INVALID_STATE|**手写ledger定义与实际已自动初始化定义冲突。** 测试先用真实runtime.commit触发progress初始化，随后拿手写value再次initialize。手写authoredSourceId=`explicit_local_fixture`、want/stance等与当前publicationGoalDefinition生成的publication来源/正文/modules/anchor不一致，hash guard正确拒绝。用同一可信SQL来源记录和正式definition builder/读取已存ledger形成夹具，保未来/外人/过期lease断言；不能放松hash或硬改存量定义。旧worker执行机制可随epoch1迁移退役，来源/lease/RLS覆盖必须转到新native后保留。|
|2|followups“full transaction rollback”，测试545，phase7:1200，baseline:2207；1!=0|**测试在真实producer已自动写成功之后才测另一事务回滚。** later()的runtime.commit已在同事务reconcileFollowups插入1条证据；之后手动INSERT可能先被唯一约束拒绝，assert.rejects没有核ROLLBACK_LOCAL_PROOF，所以并未证明预期抛错发生。不能称这是DB事务漏回滚。最小应把故障插在实际首次producer事务末尾，断言故障原因和前后快照/0半写；不要简单把期望0改1掩盖无效测试。epoch1仍用该sidecar则保；退役后把此原子性不变量移至新kernel测试，不单靠删除测试。|
|3|followups“multiple qualifying actual invitations”，测试654，phase7:1220，baseline:2244；offered!=failed|**顺序夹具并非同次选择的双候选歧义。** 第一个later()已在实际commit中唯一匹配并持久绑定followup，第二次later()之后不可变原绑定仍有效；进度offered符合先前已确认绑定，不能因后来另一条邀约改回failed。若要测歧义，应在同一实际提交提供两条同时合格的邀约，或在自动producer前构造完整合法双候选；另测后来的邀请不能重绑旧证据。不能让生产为了这个断言删除不可变回执。新questions/责任协议不应再用标题相同代替语义归属；旧sidecar机制可在无epoch1后退役，但双候选与不可重绑定不变量保留。|
|4|story“hidden authored place appears”，测试1391，phase7:1242，baseline:2548|**P1真实版本协调缺陷**，见上文。不是可以删除的地图发现验收；换新导演后仍需同一来源/发现/非到达/回放断言。|
|5|story“multiple authored places reveal”，测试1684，phase7:1258，baseline:2581|与#4同一P1根因。保多个地点分别发现、独立稳定route ID、无提前泄漏；不能通过只取第一个地点或不记发现事件消除失败。|
|6|story“wrong actor/command cannot fulfill”，测试1740，phase7:1274，baseline:2608；reconcile INVALID_STATE|**拒绝提前到最终写事务，测试只在后面的finish包assert.rejects。** wrongActor仍使用原claim.commandId；WorldRepository现于commit内就reconcile，并验证proof.actorId与claim.actorId，故错误commit已原子拒绝。安全结果正确，不是需要允许错误人物写入。更新测试去断言实际commit拒绝且无NPC消息/无node完成/无半回执，再核后续合法恢复；不能撤掉守卫来让finish再拒绝。人物/command provenance不可删，新的kernel同样必须覆盖。|
|7|world-clock“advancing…bounded beats”，测试104，phase7:1307，baseline:3524；0!=1|**当前失败首先是固定注入时间与默认真实壁钟锚不一致，另夹带旧1:1和固定催问预期。** setup没有storyAt，没存clock锚；advanceWorld先clock.read()用host当前时间作为lastTickAt，再用deps.now=Sep24，elapsed被正确钳为0，尚未走到agenda就无beats。当前默认speed=12，注释却说1:1，修锚后仍有速度期望问题。最小给测试显式一致的real/story锚和测试速度；保bound/pause/receipt不变量。不能从本失败推断实际邀请失联，更不能为了“每个未答邀请必须1次催问”改生产。固定必催的产品预期应由新NPC责任/问题语义替代，不删时间上限/暂停覆盖。|
|8|world-clock“unknown retry”，测试269，phase7:1325，baseline:3547；[fulfilled,rejected]非双rejected|同样setup无storyAt/未固定clock anchor，首个调用可零beats安静fulfilled，另个被advisory lock拒绝；测试在检查calls之前已经失败，日志**没有证明发生两次付费或unknown后自动重花**。先以一致锚/速度和真实可执行责任使第一次确实到模型，然后测unknown、并发、显式恢复、重放。新attempt原始响应/unknown测试可以替换旧world_director_attempts实现绑定，不能删除不重复花费的安全不变量。|
|9|world-clock“new player result…then settles”（agenda），测试439，phase7:1348，baseline:3579；World time cannot run backwards|**速度夹具错配，不是应放开时间倒退。** 此setup有storyAt=start，落库锚start、默认12x。第一次deps.now=start+30min把世界推进约6h，随后fixture硬写玩家storyAt=start+35min，reducer正确拒绝。最小显式测试速度1并统一real/story锚，或按12x计算玩家之后的storyTime；不能把后续expectedVersion/时间硬往回改。新架构迁移choice→真实责任/结果后仍保新输入不被冷却吞掉、报告不冒充执行结果、世界单调性覆盖。|
|10|world-disclosure-time“五日返回”，测试178，phase7:1361，baseline:3598；Nov23非Sep29|**五真实日×12的精确结果，旧1:1预期不成立。** Sep24+60故事日=Nov23，与实际日志吻合。最小若只测信息选择性传播，明确速度/时钟夹具，保sister→mother有来源且friend无权限；若测真实离线产品，应改用45秒lease/暂停/恢复后的合法推进，不能要求离线五天自动补发固定两人消息。不能为旧测试恢复无输入自动花费。新多人生/时间需求未取消，信息隔离不变量不可删。|
|11|world-message-time“resumed timestamps”，测试44，phase7:1382，baseline:3715；07:00非08:00|**先读不存在clock的真实当前lastTickAt，再向过去的固定realNow投影，elapsed=0。** 且默认12x已非后续全部1:1期望。最小用明确fixture realNow建锚并设测试速度1，或实际conversation heartbeat进入1x后验两个真实消息时刻/保存锚/暂停；不要修改runtime把任意过去wallclock当成一小时前真实发生。可替换旧resolveTurn载体，但输入/回复时刻、保存/重开和暂停不变量保留。|
|12|world-scheduler“two due worlds”，测试60，phase7:1403；返回2条但owner集合不属于本fixture；baseline:3886是0!=2|**两个可证明的夹具隔离问题，不能说同错误签名。** 测试world.time=48小时前，但clock.read空记录的lastTickAt是当前host；ensureAnchor后自己并非20h due。phase7共享库已有别的due世界被全局scheduler正常领走2条，故集合不匹配；1028时则连2条都没有。SQL0030全局每日2条是既有设计，不按这次测试新owner过滤。最小在该测试独占的空白测试库构造明确到期锚、控制每日claim前置状态；不在共享Agent库删除别人时钟/claim。保全局并发限额、暂停排除和scheduler无私有表权限。不应因迁移epoch2直接删quota/RLS覆盖。|

## 额外实际风险与处理边界

- **调度P2候选风险，未通过本轮实测证实**：claim_due_worlds仍只看stored paused/last_tick_at及旧director attempts，不检查managed active_until或新agent/director unknown队列。派发后应用可能按lease暂停安静返回，但全局仅2个名额已消耗。应先用新架构实际scheduler入口验证“过期离线/unknown世界不得挤占需要处理的合法世界”；不能从上述集合失败直接判定新scheduler已经泄漏或重复付费。
- **不属于新44回归的证据**：12个名字全部在1028失败，但只有11个签名相同；这只限定引入时间，不降低P1真实产品缺陷的优先级。无需在旧树再跑一套获得“旧失败免责”。
- **不可草率删除**：生产尚有epoch1存档/入口时，旧reconcile/发布地图/邀约等仍可能实际执行。只有root有明确迁移/只读归档/停止旧writer的证据，才删除旧实现对应的机制型测试。来源、事务、并发、重放、隐私、单调时间和预算不变量必须先由新实际入口覆盖。

建议顺序：先55处理#4/#5版本边界与首次/重放回执；再只修#1/#2/#3/#6的错误测试边界（不撤安全守卫）；之后统一时钟夹具处理#7–#11，并另用新责任语义替换固定催问次数；最后隔离#12并检验新scheduler候选风险。全部修正都应依赖真实入口证据，不能把read-only推断当成新PG通过。

## 交付限制

本轮仅核日志和代码因果，**没有启动PostgreSQL、没有运行任何测试、没有改源码或测试、没有上线**。精确错误与1028对照是既有真实日志证据；最小修法为待实现建议。本任务报告先冻结，55方案由root另行确认登记实施；不自动扩scope。“渣男体验”草稿未动未发布。
