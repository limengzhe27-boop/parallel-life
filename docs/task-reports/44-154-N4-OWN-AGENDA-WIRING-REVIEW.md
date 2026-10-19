# 44-154-N4 · own_agenda review 接线审查（方案，未实现）

负责人 codex-agenda154-n4；root唯一公共源、SQL、预算、模型额度、集成和部署负责人。2026-10-19 主登记目录短锁登记后开始。独占本NEW报告及本人登记行/主镜像，源码与SQL只读；0模型、0数据库执行、0部署、0全量测试。本报告不代表功能完成，不改旧N2/N3冻结包。

## 1. 固定基线与可复用 / 待集成 / 需修改 / 需新增

审查公共源码固定为 **46a8d5118d6675f68ba927312719bba5f0cb9ca6**（root集成工作树），通过git show固定版本逐段读，不把root之后在制修改混入结论。本人文档分支自N3报告4ead106f；N2 a65eace5 + 单一身份helper补丁edd3a4a5、N3源码08fc3c14/报告4ead106f仍冻结、待root集成。正式版本和候选部署由root报告，不从本分支部署。

| 类别 | 内容与边界 |
|---|---|
| 已有可复用 | 原 `npcAgentAdvanceServices.advanceOne`、`createAgentScheduleSources`、`scheduleAgents`、`agentWakeCommandId`、原accept/claim/mark/runNpcAgent、原snapshot/内核、原0082零发送恢复、原rate_limits及RLS、M batch公平/本请求预算、O作者开场及paid Director精确候选frame。 |
| 待集成 | N2纯资格和单一family身份；N3原commit只读认证、跨policy全family证据及独立actorBlockers。两者均不是发送许可。 |
| 需修改 | 原collector候选来源白名单、advance的review输入分支、accept/claim/pre-send/commit原回执认证、WithSources强制入口、rate_limits单调/三层原子预留、预算等待零发送收尾、F/O后备优先级及Director恢复frame。 |
| 需新增 | 原链路内review输入discriminator、只读ready/recovery投影、阶段化authority检查和预算adapter/配置；针对性PG验收。不是第二套事件/任务/消息引擎，无新人物台词、默认用户责任或事实。 |

## 2. 逐段实际调用及断点

1. `src/server/npc-agent-advance-services.ts`：`advanceOne` 的原read事务读取states/results/prior及 `readAgendaInitializeGrantsInTransaction`。随后先恢复protected response、原continuation、`dispatchPendingAgentEpisode`，再读各本人 `readPrivateAgentSnapshot`，交 `createAgentScheduleSources`。这里尚无review证据/预算读取。
2. `src/modules/world/application/agent-schedule-collectors.ts`：`SchedulingView`只有可选agendaInitializeGrants；`createAgentScheduleSources`的每人物source含actor_plan、responsibility、按需observation和F。F priority=10；计划60、责任50、实际观察通常40/45。没有“没有任务仍复盘”的source。不能把已有计划的 `planReconsiderations` 误当空议程review。
3. 原advance source包装只按 **candidate对应commandId** 找prior；这对原候选可复用，但不足以取代N3跨policy/transport的全family围栏。
4. 原 `execute(candidate,guidance)` 仅对F使用 `agendaInitializeInputText`；其余全部写 `npc_own_condition_ready`。review若直接塞进这里，会丢失N2 canonical envelope并绕开专用认证。
5. `acceptAgentInputInTransaction`：world锁、既有immutable receipt幂等、世界版本和收件人检查；新receipt仅特殊调用F `requireAgendaInitializeInputInTransaction`。`claim`有原receipt/epoch/version/actorRev/活跃人物检查，但 `requireInputAuthority` 的private分支仅本人scope及遗忘来源，不认证review family/anchor。
6. `runNpcAgent`：claim→发送前标记→模型→protected raw→原kernel；WithSources强制条件有F、episode、观察/结果等，无review。不得假定snapshot带definition就一定走WithSources。
7. `PostgresAgentRuntimeRepository.markRequestSentWithSources`实际调用 `mark(...,'request_sent',snapshot)`；其world/attempt锁、F认证、snapshot/角色状态、source、delivery、lease、epoch/version检查可复用，但目前没有持久owner/world/actor预算；request-local `batch.reserveModel`不能防跨请求/多世界超预算。
8. `PostgresNpcAgentKernel.commit`→`beginAgentCommitInTransaction`→真正行动/消息/事件/状态/回执/Outbox原事务；receipt/snapshot/source/版本检查可复用。新增review必须在此重验输入身份，不能为了通过paid检查再次要求N2 ready或重收预算。
9. O `admitDirectorCandidates`仅把 `agenda_initialize` 视作可裁掉的fallback。新review若不显式登记，会让paid pending精确scope/顺序不匹配；同时不能把review当新bootstrap或作者新机会。

## 3. 建议的最小契约（名称为建议，尚未写源码）

### 3.1 保持两种身份

- **业务family**原样使用共享 `ownAgendaReviewFamilyId`，candidate.id建议直接等于familyId（agenda-review:<hash>），`source='agenda_review'`，episodeId/actionId均null，resourceIds加入该family，sourceIds仅已认证definition来源；原expectedWorldVersion/actorRevision仅CAS，不进family。
- **首个执行command**仍 `agentWakeCommandId(worldId,candidate.id)`，receipt.text必须为N2六字段review envelope的单一canonical serializer，不使用普通condition_ready，不往envelope混guidance/指令/“玩家答应了”等材料。policyVersion不进业务ID，换policy不会产生新family。
- 无anchor继续原F准入。F paid-invalid/unknown且无真实commit不能伪造review锚；F quiet确实提交后才有后续review资格。episode_participation仍只交其专用合同，不以own_agenda恢复已拒绝事件。

### 3.2 一个阶段化authority边界

建议在原world infrastructure增加 `requireOwnAgendaReviewAuthorityInTransaction(sql,owner,receipt,{phase,expectedAttempt?})`，并可用小型domain discriminator识别服务器wake review；完整结构/身份/来源认证在infra。阶段仅内部固定枚举，不暴露任意allowAttemptId或客户端allowPaid开关。

| 阶段 | 必须检查 | 不能做 |
|---|---|---|
| accept（新receipt） | 同owner/world/epoch/actor/current definition；N3真实anchor+完整family；当前server policy、story/real窗口、暂停/优先工作、遗忘/可见来源、当前预算读；canonical envelope/command身份一致。 | 不扣预算，不生成消息，不把ready当原子许可。既有receipt重放不改body，不因当前policy重写原输入。 |
| claim / 原零发送resume | 原receipt正文+family/anchor仍合法，原epoch/CAS/actor状态、其他actorBlockers；新工作无paid family；恢复走原identity/token机制。 | 不仅凭“存在receipt”放行，不更改原attempt.expected版本，不放宽0082身份。 |
| send（当前reserved holder） | 在原world/attempt锁下核验下节holder；再读N3全family、priority/clock/source与预算，三预算预留和首次request_sent同事务。 | 不默认排除所有reserved、不按policy过滤历史、不在read/accept扣费、不因已有paid row改ID重买。 |
| commit（protected response） | 原beginAgentCommit的锁/lease/CAS+真实receipt和family/锚/source；只允许本次已sent且有protected raw的原attempt；业务提案仍由原kernel校验。 | 不重算N2 ready（本次自身已paid会必被挡）、不再次收预算、不把模型结果当已发生事件、不因当前预算耗尽丢弃已购raw。 |

新receipt只允许当前server policy；已接受旧policy输入按明确保留的server policy注册/兼容规则处理，绝不信任客户端指定任意旧弱policy。历史paid证据无论该policy是否仍运行都不删除；预算上限使用当前运营配置，不能用旧policy借小桶/新桶逃逸。若停用旧未发送合同，明确返回受保护的不可执行状态，不重写旧receipt冒充新授权。

### 3.3 reserved 当前holder：只做经过认证的精确排除

N3会返回本次刚claim的reserved，所以原样喂N2将得到unsent_pending；直接加allowAttemptId会产生鉴权漏洞。建议只在原 `mark` 当前锁区：

1. 原 `loadAttempt` 已逐一比对 world/actor/command/inputReceipt/hash/epoch/expectedWorldVersion/actorRevision/token/lease；再要求实际row.status=reserved、live、sent_at/response/response_hash/event_id全部null。当前world/actorState/CAS及snapshot要精确相等。
2. 原immutable receipt.id/body与当前row完全匹配，envelope.family/anchor通过N3和source认证，command符合本family执行身份。并确认N3中这个self evidence确实reserved且零发送，不是只按ID过滤。
3. **仅在本内部送审视图排除这一条self**后重算N2；N3原始结果不改。其它policy/transport的paid/raw/unknown/committed/zero-send证据全部保留。其它actorBlockers先处理；不将同人物旧epoch unknown当成可忽略历史。
4. row已经request_sent时不得再次返回“新发送许可”；同token重复mark也只能重放状态或明确in-flight，由runner防止第二次decide。对review建议明确非reserved拒绝prepare，不把原mark同status幂等当再发资格。
5. commit核验的是response_received/current protected holder，采用source身份验证，不复用send阶段“未发送”或N2授权门槛。原committed replay继续优先返回原event。

## 4. 三层持久预算：原rate_limits内原子完成

固定ownerId为RLS owner，不把world/actor伪装成账号。bucket建议分别为常量命名空间owner、含规范化world标识的world、含world+actor标识的actor；后两者可用canonical hash避免分隔歧义。**bucket不含family/policyVersion/tick/CAS**，否则每次换身份都清空上限。窗口/上限独立配置，正安全整数且缺配置fail closed；不把旧generation-day=120默认当本功能产品预算。此处限制发送次数，不声称等同tokens或金额。

### 4.1 原helper静态缺口与最小修正

46a `src/modules/storage/infrastructure/limits.ts::consumeLimit`：

```sql
window_start=EXCLUDED.window_start
WHERE rate_limits.window_start<EXCLUDED.window_start OR rate_limits.count<$3
```

使用事务 `now()`；较早事务延迟竞争较新窗口时，在count仍未满的情况下可把window_start退回旧窗口。**这是源码静态风险，本轮未实际复现PG，不报告为已修复。**建议共享helper保持“只有更晚窗口才reset”，窗口更新改为：

```sql
count=CASE WHEN rate_limits.window_start<EXCLUDED.window_start
           THEN 1 ELSE rate_limits.count+1 END,
window_start=GREATEST(rate_limits.window_start,EXCLUDED.window_start)
WHERE rate_limits.window_start<EXCLUDED.window_start
   OR rate_limits.count<$3
```

发送事务使用数据库当前时间采样，不从浏览器/收到请求时刻决定预算；一次采样再按各窗口归桶。即使采样因锁等待落后，GREATEST也保证不回拨，保守计入已存在更晚窗口而不是获得额外额度。改共享helper影响interview/task既有消费者，需原用例回归，不能只验证新调用者。

### 4.2 同事务、同顺序、失败全部回滚

在原mark的全部scope/source/lease/CAS/delivery检查之后、首次request_sent之前，顺序固定owner→world→actor预留；任何一级耗尽均撤销此前级别。不得分别 `db.transaction(consume...)` 或在model.complete里扣。所有调用遵守同一锁序，业务world/attempt锁后预算三桶固定顺序，不在模型请求期间持锁。

外部模型仅在该事务**提交成功后**调用。request_sent与三个计数一起落库，崩溃后保留原sent/unknown围栏；不承诺“标记已发送但网络实际未出”可退款或自动重新购买。

`readOwnAgendaReviewBudgetInTransaction`只读投影各桶剩余额度/窗口结束，按真实stored窗口与当前时间计算；未到期按stored count、已过期可算下一窗口额度但实际发送仍原子重验。不能因policy升级切新桶。N2 budget_wait.nextCheck取所有耗尽桶的恢复条件；它不是预约期限，也不是再次调用模型的许可。

### 4.3 budget_wait 必须结束reserved但不能部分扣费

推荐在mark原锁区对三预算+send更新设SAVEPOINT：

1. 世界/attempt等身份锁在SAVEPOINT之前取得；只对确切当前零发送reserved holder开始send准备。
2. 任一预算不足：ROLLBACK TO SAVEPOINT，撤销所有预算预留；同一外层事务把本reserved改 `cancelled_before_send`，保留原receipt/family/token及sent/raw全null；原0082恢复身份继续适用。
3. 外层事务**成功提交取消记录后**，才向runner抛/返回typed `NPC_AGENDA_BUDGET_WAIT`（建议名称）及只读nextCheck；不要在提交取消前throw导致取消也被回滚。不新增数据库attempt.status=budget_wait，不改状态机和SQL枚举。
4. run-agent/advance将此作为“服务器预算等待”，不是NPC quiet、paid failure或unknown，不记已消费candidate、不调用模型、不损失其它人物的合法执行机会；若耗尽owner/world桶可直接结束本批，actor桶不足可继续其它actor。request-local reservation按原finally释放。
5. SQL/取消落库失败不是budget_wait成功；回滚并明确失败/保留busy接续，不能catch后假称安全取消。原delivery在send后再次检查若失败，外层整个事务回滚预算和send，再沿原安全零发送收尾。

若选择原runner在mark回滚后另事务cancel的较小代码改法，须验证cleanup失败和进程崩溃留下reserved的恢复入口；不把 `.catch(()=>{})` 当已保证零发送收尾。SAVEPOINT方案较易保证没有部分预算/永久reserved。

## 5. 零发送恢复的真正接续缺口

**仅接原0082仍不能保证跨CAS活性。** `resumeCancelledAgentAttemptInTransaction`硬性要求原worldV/actorRev，0076/0082禁止修改attempt身份；budget_wait后其他NPC/玩家改变世界版本，即使确证零发送，本family也仍是N2 unsent_recovery_required。不能删除记录、换policy/anchor或命令后缀就称“新grant”；不能用0076 protected raw recovery替代未发送授权。

最小安全首版：collect/accept先做预算只读检查，尽量不在已耗尽时建立slot；发生send前竞争时安全取消；原CAS未变就走原0082恢复**同receipt/attempt**。跨CAS保持明确受阻，不伪造可运行成功。这可以先验安全，但尚不满足持续世界中的完整恢复活性，应作为root接线验收阻断之一。

若root要补齐跨CAS恢复，建议在原零发送恢复职责中**显式定义同family transport恢复合同**，而非新增剧情引擎：

- 原全family任何sent/raw/unknown/committed都禁止新付费；只有每条历史都能认证为零发送终态、无其他活跃holder，且原anchor/definition仍合法，才考虑恢复。
- 保留旧receipt/attempt不可变，新transport必须仍用原grantId/anchor/policy正文，显式绑定其原零发送前驱；候选业务ID不变。新command仅为可认证的transport lineage，不是新grant。可由确定性command链推导并验证前驱；不能任意随机suffix，不能只检查最后一条。
- 此授权是经过认证的 `unsent_recovery_required`专用执行路径，不把所有旧cancelled从N2证据里删掉以制造ready；可增加小型纯恢复判定器，但原paid围栏始终先执行。
- 当前表没有跨attempt前驱列；原0082记录只支持同attempt换token/lease。确定性command链能否作为充分不可变lineage，以及原claim能否抽transaction helper一次原子建立receipt/attempt，需root明确设计和新增真实PG证据；本报告不声称现有SQL已支持，不自行新增迁移。
- 原reserved超时也不是自动可接管：原零发送确定性证明+独占token恢复必须有协议；不能仅lease过期就换身份发送。

## 6. F/O优先级、collector与手机入口

推荐逻辑顺序：protected raw合法恢复→原已派发episode/实际结果/到期计划责任→当前合格作者机会（O保持原有时机）→无anchor的F→有anchor且无本人更高优先合法工作的低优先review。这是情境优先，不强制所有线串行；B quiet不会挡C，单actor预算不冻结别人。world/owner持久预算与已paid Director精确世界frame是独立全局约束，不能为多NPC把CAS检查拆掉。

- `SchedulingView`新增server-attested `agendaReviewGrants`/受保护的recovery投影；建议在原read装配里调用N3+预算读，不在纯collector做数据库访问。
- `createAgentScheduleSources`给该actor登记agenda_review source，priority低于F10与真实事项，requiresCoordination=false，episodeId=null；现有本人source/definition/可见材料鉴权继续。无ready grant不生成candidate；预算等待/unknown不能变成模型接触理由。
- hasPriorityWork须由**实际合格且未阻塞**的现有候选/episode派发/待恢复结果判断，不是“数组里存在未完成任务”即永久挡住；另一方面已有open question不是计时器一到就可重问。建议先收集原sources，再做本人review资格，避免review把自己算priority。
- `execute`明确识别review，查当前认证grant、canonical text；batch公平/reserveModel/ActorAdvanceBlocked仍原逻辑，无另一个for循环直接model.complete。
- 原三处候选source白名单与Director repository schema必须同步；`admitDirectorCandidates`将review归入明确fallback，在合格作者opening bootstrap优先评估时排除。paid pending frame仍保持原candidate内容、顺序、world/epoch；只裁掉明确新增fallback，不裁真实新condition、不替换保存过的候选。不把“时间到review”制造成全局Director narrative wake，每次review无需重新审批导演。
- `readAgentPhoneEntryProbe`可复用轻量进入/返回检查和M的稳定work key；若增加ready理由，使用认证family/恢复身份，不用Date.now、worldV或lastTick生成一串付费机会。在线仍走原advance批次入口，不新增手机计时/独立后台引擎。protected Director frame yield优先，不能为了派新review而写世界使其失效。
- `npc-agent-model`现有server wake已区分非玩家输入、稳定人格及责任/问题协议。最多补review语义说明；主要实现来自上述执行接线。既有questions/focus/replyAssessments/questionWithdrawals/responsibilities/decisions/实际结果继续提供去重与选择依据，不把冷却当联系理由。

## 7. N3证据能力限制与需补验证

N3锚仅是原private `agent.state_committed`，**不是最新任意人物消息**，也不是连续quiet计数。这个event可以合法修改计划、责任或执行行动，不能按类型累加quietStreak。当前N2退避若要启用，需从原runtime proposal/results/实际消息投递及相邻提交推导可验证quiet streak；否则只用明确下界0且说明未实现退避，不虚报“连续quiet指数退避已接通”。建议原只读adapter最小追加可审计的quiet/progress摘要，界限由root定，不做持久重复计数。

如最近消息为turn.resolved但旧state-commit锚已到review窗口，调度仍须实际对话/投递节奏守卫；不能宣称N3锚已保证按用户最近收到消息计时。若需要以真实带stateAfter的消息提交为新锚，应显式扩展对应事件认证路径并补PG，不让无stateAfter的普通message伪装anchor。

## 8. Root应改文件与建议验收门槛

| 文件/职责 | 最小修改 | 主要风险/证据 |
|---|---|---|
| world/domain/agent-runtime.ts；application/schedule-agents.ts；infrastructure/director-runtime-repository.ts | agenda_review source枚举/严格schema | 少改一处导致collector有候选却被拒；不删strict鉴权。 |
| 新小型domain review discriminator；N2原纯module/helper（先集成冻结包） | 统一envelope识别与canonical写入，不复制family hash | 普通玩家JSON不能变授权；畸形wake不能降级generic绕预算。 |
| application/agent-schedule-collectors.ts；server/npc-agent-advance-services.ts | 只读证据装配、无更高工作时review、专用receipt文本、预算等待/恢复接续 | 自阻、query失败不能fallback成ready；批次公平和全局paid frame保护。 |
| infrastructure/own-agenda-review-repository.ts（先集成冻结N3）；新增小authority/budget adapter | phase认证、真实holder排除、遗忘source、预算读/原子预留 | 原N3错误fail closed；history_limit4096不能截断后授权；不输出private/raw。 |
| infrastructure/agent-runtime-repository.ts | accept/claim/resume/pre-send/commit身份接点，source强制，SAVEPOINT预算取消 | 幂等重复mark不能多发；owner/world/actor预算同时成功或零增量；旧token不能偷slot。 |
| application/run-agent.ts | review强制WithSources；typed budget_wait处理、不启动decide | 不把预算等待记为paid/quiet，不重发unknown，cleanup失败显式。 |
| infrastructure/npc-agent-kernel.ts / beginAgentCommitInTransaction | protected response的review source/receipt验证，仍走唯一kernel | 不二次预算、不要求paid self重新ready、不放宽原世界版本。 |
| storage/infrastructure/limits.ts；预算配置的原server装配 | monotonic窗口、三层同TX、固定锁序和独立正整数配置 | 旧消费者回归；跨窗口旧tx、并发多世界共享owner、3桶第3级失败。 |
| application/director-candidate-admission.ts | review明确fallback，原saved frame优先 | 精确scope/顺序不可因新timer review改变；bootstrap仍作者事件优先。 |
| infrastructure/agent-phone-entry-probe.ts（仅确有需要） | 复用原轻检查的稳定review/恢复工作标识 | 不新增paid timer，不破坏真实返回/双标签/导航去重。 |
| infrastructure/agent-zero-send-recovery.ts（若root授权跨CAS完整性） | 明确原family零发送恢复合同 | 当前0082不支持跨CAS；必须先定义lineage再实现，不默改身份。 |

建议针对性真实PG（本报告0执行）：

1. F真实quiet→时间条件到→原collector选review→canonical receipt→原runner/NPC→原kernel commit→真实后续family；无时间到不调用。F paid-invalid/unknown无anchor不能转review。
2. owner/world/actor各自耗尽；第三桶失败前两桶不增长，attempt取消且sent/raw为null，恢复窗口后原CAS只恢复原身份；跨CAS按明确合同或如实受阻。
3. 两事务同family竞争、多世界同owner并发，最多一次实际decide/完整三桶增长；另actor可执行且不会因A unknown/quiet丢唤醒。
4. 旧事务跨窗口延迟对新预算行：window_start从不退回且cap不超；保存/发送更新失败三个计数均回滚；重复mark/receipt/标签切换不重复扣费。
5. 伪holder ID、错token/lease/receipt/hash、old epoch、伪definition、forgotten basis、另一family unknown/raw全部拒绝；完整跨policy paid/raw保护不因新policy、transport后缀或预算窗口而失效。
6. 原response_received断点恢复0新模型/0新增预算，commit期间预算耗尽不阻止已有合法提案；CAS改变走原恢复/拒绝，不造预期结果。
7. 作者opening与review/F同时ready，O仍作者优先；paid pending Director候选顺序不变且deferred yield不被review世界写入破坏；已有accepted/declined/quiet episode不重开。
8. quiet/progress/streak和实际最新投递节奏有来源；玩家不动/无关/拒绝不当同意或违约，不靠重复问句制造联系。真实模型最终验收继续用root登记额度，纯/PG不能代替自然聊天质量。

接续：本包是只读设计审查，root确认采用的合同后在公共范围实施、跑check/build/真实PG/已批准模型和手机/PC关键流程，通过才部署并公网复验。报告冻结并交root不表示N4或整体44-154业务已交付。
