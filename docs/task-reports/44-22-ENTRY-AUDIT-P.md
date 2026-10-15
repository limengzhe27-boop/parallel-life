# 44-22-ENTRY-AUDIT-P｜真实入口只读审查与 44-24 恢复设计

状态：待 root 集成验收；本报告为静态调用链审查和设计提案，不是数据库或公网实测。2026-10-15。

执行者 codex-ma44-entry-audit-p，线程 01a11a84-9572-7ab0-92fb-967f963dfc20。工作树 publication-story-02/人生剧本，分支 codex/agent-entry-audit44。基线严格为 root **326762b84907a4f4cf55cc377f5c273d2c0e871c**；根随后修复不在本报告原始结论内。只新增本报告、主目录报告镜像及本人登记行。源码/SQL/生产/模型/PG/全量 check/build 均为零。

## 结论与剩余 P1

已先逐项发主集成人；root 已确认，负责全部源码修复及真实 HTTP/PG 验收。

### P1-1：GET 剧情进度仍进入旧进度写事务

- 真入口 `src/app/api/v1/worlds/[id]/story/route.ts:3` → `src/server/publication-story-http.ts:30` → `s.story.progress`，没有 epoch2 分流。
- `PublicationStoryRepository.withContext`（`src/modules/settings/infrastructure/publication-story-repository.ts:170`）锁 world；没有 plan 时 **183–189** 调 `publication_story_store_plan`，读取也会初始化旧 plan。
- `progress:1226` → `reconcile:1229` / `progressContexts:1230`；后者 **242–246** 调 `publicationGoalContexts` 和 `PublicationProgressBeatStore.reconcile`。
- `publication-event-goal-context.ts:331–355` 在无 ledger 时 `ledger.apply`，`publication-event-progress-repository.ts:137–151` 初始化旧 `publication_story_progress`；beat store **34–55** 还可更新该表。已有旧节点也会经 reconcile 保存旧 receipt/node。
- 0072 的 `agent_world_epoch_fence` 只围 world UPDATE/DELETE，不能阻止这些独立旧 story 表写入；一部分 reconcile 若再写 world 则可能整轮失败，不应把报错视作只读功能合格。
- staff trial allowlist 接收 `world/story GET`，同一实际代理入口可达。
- 修复建议：真实 GET epoch2 返回明确的新引擎只读状态；旧仓储公共 withContext 在锁 world 后检查资格，阻止其它旧 context 入口隐式初始化/写 ledger。旧数据保留，不能假称新 authored-event 已实现。

### P1-2：native 群聊/现场已有 raw 无法经用户真实重试入口恢复

- `nativeAgentCommandId(taskId, actorId)` 在 `src/server/npc-agent-channel-services.ts:29–33` 派生；handler **298–324** 只查当前 lease.id 对应 child command。
- 模型 raw 已存 `response_received`，kernel SQL / parent task 最后更新失败 → `run-worker.ts:85–119` 把 parent 标 failed/unknown（若 lease 已丢失可能仍等超时成为 unknown）。
- `/tasks/[id]/run/route.ts:15` 只接受 queued/running，terminal task 直接返回，不能重新进 handler。
- `/tasks/[id]/retry` → `TaskRepository.retry:128–135` 调 enqueue 创建**新 task ID**，沿用 input 不等于沿用 native child identity。
- 新 task 查不到原 raw，原 actor 的 `response_received` 被 `agent-runtime-repository.ts:498–504` 和 0072 active 索引挡住，不能恢复；同 lease fixture 中直接重跑成功不证明真实 API 可达。
- 通用 advance **180–182** 仅枚举 private response_received，不是 group/scene 的恢复入口。
- 未发现此状态会直接自动重付：当前通常先 ATTEMPT_PENDING；问题是持久死锁和恢复路径缺失，不能解除索引或新付调用来“修好”。
- 另需恢复过期的 **Agent attempt 独立 lease**，不是只改 parent task 状态。首次 attempt 为约 240 秒；`beginAgentCommitInTransaction:644`、0074 native group policy 都要求 attempt live。人工恢复超过该时间即使原 task 重新排队也会 stale。

### P1-3：导演 known raw 在世界/候选变化后无法回到原 attempt

- `npc-agent-advance-services.ts:263–267` director command ID 包含 world.version 与候选 ID；lookup 只查当前 ID。
- 导演已保存 response_received，但 decision 事务失败；另一人物真实提交令 worldV 改变 → 下次 coordinate 用新 ID。
- `director-runtime-repository.ts:581–589` 和 0075 **25–26** 的 world pending 唯一索引仍被原 response_received 占用，新 claim 返回 DIRECTOR_ATTEMPT_PENDING。
- advance 没有遍历导演 durable pending attempt 并恢复/判 stale 的入口；相同 worldV/候选能原 raw 恢复，但变化后占位不释放。
- 建议先按 world 找原 pending：known raw 仅原 identity 恢复；若 world/actor/boundary 等原 CAS 已过期，原 attempt 明确 stale_discarded 并保留 raw。unknown 保留且不能自动换 ID 付费。补实际 advance 故障→B真实 commit→再 advance 用例。

### 迁移阻断：旧同步私聊 in-flight 没有持久 model 前占位

- `/messages` 先 `sendMessageIfEnabled` 读 epoch1 返回 null，后走旧 `resolveTurn`。
- `resolve-turn.ts:34–95` receipt/get/context 后直接旧 planner.propose；至 **133** 才 world commit。没有模型调用前持久 queued/running command。
- 1→2 切换检查 `agent-runtime-repository.ts:196–208` 的 commands/tasks/director/opening busy 不能一定看见此同步付费窗口。若迁移发生在窗口内，旧模型仍被付费，最后 SQL fence 拒绝结果。
- 已是 epoch2 的正常私聊入口有前置 guard；这不是稳定 epoch2 每次都会绕过。当前生产 epoch2=0，风险列为旧存档迁移启用前的阻断。
- 需要共享的 durable pre-model reservation 和原子切换门槛；重复一个无锁 SELECT 不能彻底消除竞争。此项 root 已明确纳入迁移门槛。

## 真实入口核对表（326762b8）

|入口|实际调用|epoch 资格与模型前 guard|结论|
|---|---|---|---|
|私聊 POST /worlds/:id/messages|route:27 npcAgents.sendMessageIfEnabled → runNpcAgent|npc-agent-services:106–118；epoch2 后先 accept/claim/request_sent，持久 CAS 后才模型|稳定 epoch2 不进入旧 Planner；迁移窗口见上|
|私聊消息回执 POST /messages/receipt|npcAgents.lookupMessage|只查原 input receipt/attempt/event，不执行旧引擎或模型|只读恢复核对，不等于 unknown 可自动重试|
|通用 POST /advance|services:259 agentAdvance，然后才旧 opening/story/advanceWorld|advance-services:106–121 检查世界与 epoch，非 null 即停止旧路径|已接新内核；不是仅存在未调用类|
|手机 GET /opening|publication-opening-http:19–23 优先 readNpcAgentOpeningStatusIfEnabled|返回 epoch2 runtime agents 只读状态，短路旧 opening.read|root326修复已存在|
|手机 POST /opening|services.advanceOpening:232–235|先新 advance；显式旧 retry 对 epoch2拒绝|不进入旧开场付费|
|staff story advance|publisherTrialRoute 对固定 world/story/advance 特例 → services.advanceStoryOnly|services:201–205 优先新引擎；旧 retry 明确拒绝|权限与私有 trial owner 仍独立|
|story retry POST|publicationStoryRetryRoute → services.advanceStoryOnly|旧 claimId+epoch2 拒绝，不擅自重新付费旧剧情|保留旧引擎显式恢复语义|
|story GET 与 staff proxy GET|s.story.progress|无 epoch，context lazy init/reconcile 写入|P1-1|
|cron /api/cron/worlds|runScheduledWorlds → services.advanceWorld|同上统一新 advance gate，不另建旧导演调用|scheduler 本身不另付模型|
|群消息 POST + PUT runner|GroupRepository.send 接受真实输入 → runGroupOwnedTask|group-services:56 nativeNpcTaskHandler 先走；仅 epoch1 false 后旧 group planner|epoch2 检查/失败不会 fall through|
|常驻 worker / task run|createWorker → worldTaskDispatcher → env handler → nativeNpcTaskHandler|worker-composition:47–48；二者 epoch2 不合法抛错，false 仅授权 epoch1|旧 Scene/GroupPlanner 仍服务 epoch1|
|现场 enter/input API|SceneRepository enter/input 保存真实 command/receipt/task|world-command UoW；epoch2 skip seedSceneMatters，派发同 worker|现有确定性环境+真实输入后NPC，不是新 travel 能力|
|现场 GET/detail/view/history|SceneRepository read/context，readPublicationSceneBrief 只 SELECT|无模型；readPublicationSceneBrief:98–121 明确无初始化|未发现本链旧进度隐式写|
|普通索图私聊|epoch1 resolveTurn:108–118 添加 media.requested；epoch2先native parser/kernel|新 kernel capability 无 media request 接线，未回旧 Planner 补图|功能迁移待办，不得取消或冒充支持|
|media task/图片生成|worker media:mediaHandler(queue)，未传 synthesizer|media-handler:75 可选分支目前不可达；实际 fallback status failed UNAVAILABLE|当前无图模型付费；素材上传/已存图读取仍独立可用|
|上传相册/作者媒体 GET/POST/finalize|AssetRepository / publisher media repository|真实授权素材处理，不调用 NPC/导演 Planner|不是旧 AI 推进入口|
|通用 task retry|TaskRepository.retry → 新 enqueue|新ID，未识别epoch2 knownraw的原task恢复|P1-2；unknown当前不应因新ID被自动再付费|
|resolveInteractTurn|仅定义、无 src 调用点（全src搜索）|没有真实API/worker接线；内部构造虚拟queued media和响应版本|不能当可用入口，也不能据它断言实际入口泄漏|
|services.worldPlanner|构造 WorldTurnPlanner，无 src 业务引用|构造不是 model.complete，未发现实际调用点|不凭类存在报绕过|

补充：旧 `publicationCharacterPlanner.prepareContext:26–38` → readActorEventGoals → publicationGoalContexts 具有 ledger 初始化可能；services.characterPlannerFor.propose:355–359 invitationContext 也经旧 withContext。当前稳定 epoch2 私聊前置分流挡住这些；旧仓储资格保护仍必要。readPublicationSocial/presentedStory/readActorSituation 的读取查询未发现额外写。memoryHandler 是已有记忆确定性任务，不等于旧 Planner；当前 Outbox executor 仅 image.generate，没有发现从真实世界 Outbox 误派旧人物进度 memory task 的链路。

## 44-24-NATIVE-RECOVERY-DESIGN-P：最小恢复 UoW 提案（未实现）

### 先明确现有 SQL 允许什么

- 0001 tasks 表只有 status 枚举 CHECK、lease_token/lease_until 成对非空 CHECK、owner+command唯一、每 owner/scope 一条 queued/running 的 active 唯一索引；未见统一 task 状态转换 trigger。
- 0002 claim_task / 0008 claim_task_for_owner：expired running→unknown；只 queued→running，生成新 task lease token，attempts+1。不会自动 claim failed/unknown。
- renew_task 只续当前 live running；finish_task 只让当前 live running 变 succeeded/failed/conflict/unknown/cancelled，不清原 lease 字段。
- TaskRepository.retry 有 owner account lock，检查旧 task terminal/newest 后 enqueue新ID；它没有原 task 恢复 receipt。不能偷偷复用新 task 的 command 参数当原任务主键。
- 原 Agent 输入回执不可变；原 attempt id/world/actor/command/inputReceipt/expected版本与 raw 是原执行身份。task lease 与 Agent attempt token/lease 是两个不同的 fence。
- withLeasedAgentDatabase 已明确 `task FOR UPDATE → world FOR UPDATE → epoch FOR SHARE`，回调结束再检查 task/epoch，恢复应与此保持相同锁序。

### 最小接口与不变项

建议 app-only application port：`recoverNativeTask(ownerId, { taskId, recoveryCommandId })`，结果为带明确模式的 `queued_original | already_committed | busy | unknown_blocked | stale | unavailable`，引用**原 taskId**。授权仅来自真实 owner/session 或已绑定 staff trial；不接受客户端 actor/world/input/raw/childCommand。

同一短事务的步骤：

1. 按 owner 取原 task **FOR UPDATE**，核 scope_kind=world、原输入完整形状/哈希；只接受 native group/scene 玩家输入。先按 owner+recoveryCommandId 查 receipt，命令重放返回相同原task与分类；相同命令绑定别的task必须冲突。这里不锁全owner account以免引入与既有task→world的反向锁。
2. 取原 world **FOR UPDATE**、runtime control **FOR SHARE**。核 epoch2，原输入的 world/thread/source事件/已接受receipt不变。
3. 由原 taskId + 当前世界全actor IDs派生 child commands 找**唯一**原 attempt，FOR UPDATE；核 actor/command/inputReceipt/response_hash/受保护completion封装及原snapshot一致，不能重新选响应者。若未来需持久映射，迁移中显式保存 task→child 身份；不能仅相信新的客户端 actor。
4. 验证 original expectedWorldVersion / expectedActorRevision / engineEpoch 与当前匹配，并重新核原 input authority、群成员/现场presence/遗忘来源。世界已变、角色已离开或来源失效时，不把 raw 套用到新版本；原attempt标 stale_discarded、parent标conflict并保存恢复receipt，保留raw，0模型。不能把 expected版本改为当前值使旧输出“通过”。
5. 对合法 response_received，只轮换**原 attempt token/leaseUntil**到新的有限恢复租约；原attempt ID/command/receipt/inputHash/snapshot/raw/responseHash/expected版本不变。SQL按旧token/status/responseHash CAS，旧执行者即失去保存权。需要同task当前未live；live running返回busy，不抢占。
6. 原 task terminal failed/unknown→queued，清旧 task token/leaseUntil（二者一起NULL）、error/result字段按明确规范清理；task id/owner/scope/input/requestHash/original command/createdAt不改。检查同world已有其它queued/running task时返回busy，保留原状态；不能触犯one_active_task后留半张receipt。
7. 同事务插入恢复receipt及必要sameidentity绑定。提交后，原 task 由现有 queue claim获得**新task lease**；handler依据receipt只允许读取原protected raw，不构造/调用模型。还要验证该次恢复的attempt token/responseHash/epoch身份，不能让新claim走普通无raw分支。
8. 再次执行仍走原 kernel/原childcommand与 finalizer，native event、state、task succeeded同事务；失败后保留knownraw，可再次显式恢复。不要把“恢复请求已入队”伪装成剧情已成功或新增对白。

若排队时间超过恢复attempt租约，handler拿到新task lease后可在同 `task→world→control→attempt` 短事务续租原 **response_received**，重新核CAS及scope并旋转token，再读原raw。不得在HTTP排队时预置永不过期租约。仅更新parent lease不会修复0074的a.lease_until检查。

### 状态处理矩阵

|parent / child 状态|处理|模型|
|---|---|---|
|succeeded / committed|核实际event+command+native投影，返回原结果；若缺投影明确数据错误|0|
|failed或unknown / response_received 且raw完整、CAS当前|显式receipt后原task重排、原attempt续租，原raw恢复|0|
|running且live / 任意|busy；不轮换token、不抢原执行者|0|
|running已过期 / response_received|在同锁中确认过期后按可恢复knownraw处理，可记录expired→unknown→queued的来源；勿先自动新付费|0|
|failed或unknown / request_sent或unknown_after_send且无protected raw|unknown_blocked，仅核对原请求结果；不创建新task，不释放active actor去再付费|0|
|terminal / response_received但world/actor/scope已变|原attempt stale_discarded、parent conflict、保留raw与原因；不自动续演旧输出|0|
|failed / invalid_output或cancelled_before_send|不是knownraw重放入口；返回原明确失败。要新模型必须独立显式新请求策略，不能借恢复接口暗付费|0|
|terminal / 无child attempt|区分确定性scene env与未发送/损坏输入，不假称有raw；不自动改成NPC请求|0|
|queued / 有当前恢复receipt|幂等返回原queued；不能累计重复recovery token变更|0|

`parent unknown`不等于`child unknown_after_send`：parent可能仅lease丢失，而child raw已持久；必须检查具体子记录。反之，不能仅靠parent failed推定“上游没付过”。

### 无模型 scene environment 与 stale 导航须分开

当前 env handler `agent-scene-environment.ts:195–196` 仅 `actionId=null`，**218** 要求worldV与进入事件expectedVersion相同，**227** 当前scene一致，**228–229** scene尚无entries/actions/matters，**230–257** 关联原scene.entered command/requestHash/receipt。环境0模型，成功时真实确定性事件+parent succeeded同事务。

- 原 env事务故障且worldV/scene仍完全匹配：可显式重排**原task**，保留原task.command_id，否则230–237按task.command_id联原进入事件会丢来源。没有Agent child raw，不创建attempt或续Agent lease。
- 玩家已离场/切换scene、已有内容或进入事件已经过期：返回明确stale/conflict与实际当前scene；不改input.expectedVersion来硬跑，也不把它转成NPC反应。新导航需走新的真实进入/建立命令，保持旧receipt与现有记录。
- 仅“worldV因另一条无关事件改变、scene仍空”能否安全重建环境，是单独受验证的确定性rebase规则；现代码没有该规则。本最小修复先明确stale，不假装已支持。若产品需要，root需新实际current场景授权命令，完整校验原entered来源及presence后实现0模型重算，不能复用过期NPC snapshot。
- 已实际环境事件成功但客户端没收到：先由原command/event/task投影读回，而不是再生成第二条环境事件。

### 新迁移与 root 修改范围建议

**建议新增77（编号最终由root统一），不改0072/0074/0001已应用文件。** 现有tasks枚举已经允许failed/unknown→queued所需字符串，故不是添加status值；迁移主要提供显式恢复命令receipt及同identity约束，而不是宽松改状态。

最小新receipt：owner_id + recovery_command_id唯一，original_task_id+owner FK；world_id+owner FK；mode枚举native_raw/env_replay；immutable original task command/request hash/input hash；可选 original_attempt_id/actor_id/child_command_id/input_receipt_id/response_hash（native_raw必填，env必空）；原epoch/worldV/actorRev（native）及分类/时间。native原attempt组合FK或严格trigger验证同world/owner，receipt不可修改；RLS只owner app，不给worker新全表权限。

若receipt只供trusted app UoW读取，可沿用当前app写权限+严格typed store；若要SQL强制terminal→queued仅凭receipt，应在新迁移中精确限定**epoch2 native world task**，核原task/receipt/scope/raw/tokenCAS，不能对全部旧interview/build/media任务套通用禁令。允许正常claim queued→running、renew、finish及过期running→unknown；不要意外阻断既有queue函数。schema规则须做真实PG/权限回归，不能只测mock。

root建议独占：新 `native-task-recovery` application+infra/服务接口（或现TaskRepository精确分支），`tasks/[id]/retry`接线，`npc-agent-channel-services`原attempt选择/原raw-only路径，`agent-runtime-repository`已知raw续租CAS，必要leased facade/finalizer，env恢复分支，新77及contract/phone显示。普通retry保持epoch1原行为；staff proxy同一服务，不开第二套实现。若本批先只做raw恢复，env stale重建与普通媒体新kernel能力继续任务清单，不标完成。

### 必须新增的真实验收（本报告未执行）

1. 实际HTTP/runner：fault后parent真实failed/unknown，调用真实recover/retry，拿**相同taskId**再run；原raw成功、模型总调用仍1，originalchild/receipt/hash未变。
2. 超过4分钟的attempt expiry；旧task token及旧attempt token都被fence，新lease能恢复，0新模型；恢复queued再延时过期同样处理。
3. parent unknown但child knownraw可恢复；child unknown无raw明确blocked，重复点/换recovery命令都不重付。
4. 同recoveryCommand重复返回同原task，跨owner/同命令换task/input/actor拒绝；并发两恢复请求只一轮queue/lease。
5. 恢复时worldV/actorRev/presence/忘记来源变动，原rawstale不写业务；不把actor阻塞转移至别的无关任务。
6. 原task→world锁序并发、parent最后更新失败全事务rollback；没伪造succeeded或消息。
7. env原事务失败可0模型重跑；离场/换场景/旧导航任务为stale，不硬改expected版本；成功环境重读不重复生成。
8. 77 RLS/worker不可读/触发器精确函数清单/旧tasks retry与queue全回归；全check/build与受控部署由root完成。

所有新增接口/表/恢复状态分类均为设计建议，未添加未接线模块。任务表仍是唯一状态源，root集成/READY/公网与真实模型多轮质量验收未完成，不能由本报告勾选整体交付。
