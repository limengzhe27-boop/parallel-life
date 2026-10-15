# 44-47-ARRIVAL-P｜真实旅程到达续演事务

状态：限定实现/专项验证冻结，待 root 接 actual advance 与实际 kernel 联合验收；未上线。2026-10-15。

## 范围与依赖

codex-ma44-arrival-p，线程01a11a84-9572-7ab0-92fb-967f963dfc20；独立 publication-story-02/人生剧本、codex/arrival-continuation44，精确基线 **2e527a5d**，含SQL80/store5b18a657、arrival domain853af2ed、B pure0399b6dc与root实际已arrived journey投影。

root先确认function接口、锁序、clock cap、无due正常anchor允许，以及position mismatch应报已知错误，再开工。精确三个新文件：

- src/modules/world/infrastructure/agent-arrival-continuation.ts
- tests/integration/agent-arrival-continuation.test.ts
- 本报告、主报告镜像/本人登记行

其他source/SQL/旧tests全部只读。没有改SQL80、root kernel/server/scene/reducer、现journey repo/clock/awareness，也没有注册新模型能力或新API/付费任务。

## 冻结接口

`commitDueAgentArrival(db, ownerId, {worldId, engineEpoch, expectedWorldVersion, realNow?:server/testISO})`

返回 `{status:'quiet'}` 或 `{status:'arrived',eventId,worldVersion,storyAt,actorId}`。一次最多结算一个真实due journey，成功后调用方须返回changed并重新读世界，不继续用旧候选快照。realNow只供可信server/独立测试，不能从公开request body传入；默认真实server当前ISO，严格canonical ISO检查。

## 事务与时钟

- 原db.transaction的同SqlClient：验证app owner且非worker，拒任何非空app.agent_commit_attempt_id混入；world FOR UPDATE → control FOR UPDATE → clock → due journey/本人position locks。world id/owner文档与实际scope也核对，epoch至少2且精确匹配control、worldVersion精确CAS。
- 无真实clock、paused、managed失活/away均quiet，不创建clock、不重启、不用离线间隔补到达。明确拒倒退realNow相对原clock anchor。
- 同TX调用原 `capClockAtNextAppointment`，重新读取clock并经 `readableActivityClock`，失活/到约定边界保持quiet。仅对正常active clock投影 `max(world.time, projectStoryTime(clock, realNow))`，锚定story_now/last_tick_at；不拿ETA快进，不改速度/paused/managed，不延active_until。
- 按root确认，无due可仅保存正常clock anchor，但不增加world版本/event/事实。已有赴约cap只收紧active_until，不被本service续租。
- 合法anchor后调用原80 `readDueAgentJourneysInTransaction`，按ETA/id稳定顺序取首个；锁后重读原journey与73本人权威position，再跑 `evaluateAgentArrival`。只接受仍由原departure event/version/time支持的in_transit；不看玩家真实去向、原goal是否撤回，不修改位置来凑条件。
- position mismatch明确 `code=INVALID_PROPOSAL, message=AGENT_ARRIVAL_POSITION_MISMATCH`，其他domain阻断亦使用安全枚举消息，不含私密原文；不quiet掩盖谱系损坏。任何异常使clock cap/anchor连同后续全部回滚。

## 实际写入顺序与证据

稳定commandId沿现 `agentArrivalCommandId(journey.id)`，即arrival_<journeyId>；真实receipt/event ID由server生成。迟到时at/storyAt用当前合法投影，绝不倒填plannedArrivalAt。原旅程路线始终pinned；地图route后来改动不改本次到达。

先 `commitAgentArrival` + `applyAgentArrivalEvent` 生成/校验精确对象；仅在实际world/control验证后设置本TX world/epoch GUC，不调用player authorize，也不伪造NPCattempt。写真实command running、真实world event、world expectedVersion CAS、command succeeded/result_state；event.data严格只有80要求的五项 `actorId/journeyId/departureEventId/route/arrival`。

随后原 `recordAgentArrivalInTransaction` 让80独立验证clock、succeeded command/event/版本、原pinned departure/route、无NPCcommit marker与本人真实position，再调原 `projectAgentWorldChange`。root2e会把80已arrived记录传给pure context，实际投影本人到达位置和pending reason；所有步骤同一短事务。

没有新ActionResult、goal、NPC输入/attempt、对白、约定确认、场景自动入场、外部通知/额外Outbox。pending reason由原durable awareness投影产生。玩家位置/地图路线/个人目标保持原状；到达不是赴约履行或共享事件结案。

fresh replay无due即quiet且不增event；旧expectedVersion重放报CAS冲突，不猜此前哪次调用；同frame并发1成功1VERSION_CONFLICT，无双到达。稳定command已有异常残留则IDEMPOTENCY_CONFLICT，不能换新ID绕过。真实事务失败无半行command/event/arrival可留。

## 验收证据

- 新真实PG **12/12（11子项+父），0skip**；联合原80 journey store实际PG **31/31，0skip**。
- 原travel与travel-awareness pure联合 **80/80，0skip**。
- typecheck0、boundary **555文件**、两新TS Prettier、git diff --check通过。

实际数据库覆盖：正常due后exact五字段event/稳定command/80arrival/73 own at/pending reason；无NPCstate/actionresult/attempt/message/observerknowledge/Outbox增加；空间/约定不变；fresh replay quiet/oldV冲突；too early、真无journey、无clock quiet；manual pause/managedexpired/away不写clock/world；12x正常投影及迟到不倒填；active managed到达不延lease/改速/重启；真实source-qualified confirmed appointment cap先停下，不能穿过约定赶到更晚ETA；current route改动仍用pinned、goal withdrawn不搁置已出发旅程；并发1到达1CAS；wrong73position已知错误且anchor/event/command全回滚；故障注入在80record之后/awareness之前，event/command/world/clock/journey全部回滚且原请求下一次可正常结算；跨owner/worker/epoch/frame/mixedattempt拒绝。

测试基线使用root明确允许的原39/80**authenticated synthetic departure history**：真实app receipt/attempt/finish及SQL80 guard，而非声称走过actual travel.begin kernel/模型。fixture在真实departure同TX完成原awareness投影，再测试后续route/goal变化。original synthetic goal/action/result仅为这段合成历史输入，service没有创建它们，不冒充生成成功。

首轮route用例未在departure当时project，导致改route后历史departure补投影正确拒INVALID_AWARENESS_DEPARTURE；已修fixture顺序，未改pure/SQL放宽保护。错position fixture首轮因document/source列不一致被CHECK拒，后改成合法旧origin position以验证service fresh in_transit fence；不关trigger。原clock/regression保护保持。

忽略证据 `.local/ma44-arrival-{pg,joint-pg,pure,type,boundary}.log`。所有本批合成world clock在after暂停；PG55566已干净停止并无监听。本轮 **0真实模型/生产/浏览器/全check/build**，未消费用户真实模型额度，未改发布状态。

## Root 接续

root将此function接原advance，放在保护NPCraw恢复后/fresh候选前；arrived即返回changed/worldVersion，quiet继续原流程。无新HTTP入口、不以arrival造玩家对话。root随后用其实际 travel.begin kernel + scene departure reconciliation做真实联合验证，确认没有旧scene presence复活位置、无NPC间真实位置泄露。

本批没有改root实际入口，不能声称角色真实出发→自动到达产品链路已上线。root仍负责公共契约、SQL80生产核对、全check/build/真实kernel及公网门槛、部署READY与最终验收；本人只待验收。用户世界保持未发布。
