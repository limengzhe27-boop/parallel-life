# 44-154-N · quiet 后的有预算议程再考虑（代码级方案）

负责人 codex-agenda154-n；root 唯一公共契约/源码/SQL/部署负责人。独立 author-eligibility63/人生剧本，codex/agenda-review154-n，准确基线117b9c48（L已集成）。本包**只交付本报告**；所有公共文件、数据库与生产只读，0模型/PG/新增业务代码/全check/build/部署。主表先短锁登记。M的推进/批次/0094和phone journal不属于本人。

后续root通知M23950201已通过PG/check3495/build，0094生产94checksums和旧内容hash一致、候选READY验收中；这些为root提供的集成证据，本人不重复验收或声称已正式部署。以下基线调用链与M叠加边界分开描述。

## 1. 真实断点与已有能力

| 位置（src/modules/world/，另注server） | 实际行为 | 需要保持/补齐 |
|---|---|---|
| infrastructure/actor-agenda-initialization-repository.ts:18,58,82,87 | F从当前epoch准入、初始hash、同一人物定义授权一次初始化；任何goals/plans/actions/responsibilities/decisions/episodeParticipations非空或open questions都会跳过；同初始化command已committed（含quiet）或付费失败/unknown也跳过。 | once-only正确，不能删paid围栏“让它再试”。历史数组全finished/fulfilled仍非空，因此F也不是事项结束后的新议程入口。 |
| 同文件:130；infrastructure/agent-runtime-repository.ts:285,561-617；application/run-agent.ts | accept/claim/send前验证F原始输入；原attempt/receipt/raw/kernel提交，quiet仍为真实已消费决定。 | 新review也必须接这条原准入与发送前核验，不能只向collector追加候选。 |
| application/agent-plan-next-step.ts；application/agent-condition-checks.ts:20 | 无nextAction且无triggers可能是missing_next_step；空conditions明确false。 | 没有明确下一步时不猜执行；需允许本人重新规划的独立运行授权。 |
| application/agent-schedule-collectors.ts:396-460 | planReconsiderations只在明确triggers可证明满足时生成候选；goal/plan必须当前可见且活跃、source可用。 | 不能把triggers空数组改true，否则每次空闲都会成为付费原因。 |
| 同文件:464-520 | responsibility需要真实nextCheck/currentPlayerDecision/到时真实appointment等；没触发就没有候选。 | 玩家没回复不是accepted/declined/违约。只是等玩家不能阻止NPC调整自己的其他安排。 |
| 同文件:237-304,711,805；server/npc-agent-advance-services.ts:346-380 | candidate按语义/source证明稳定指纹；不含当前世界版本/秒数。consumedCandidateIds参数存在，主组装传[]，实际靠稳定commandId对应的原attempt committed去重。 | 这是隐式消费索引，不是不存在去重；同条件一旦处理而未产生新计划/新依据就不会再次付费。不得改成时间桶ID洗掉消费。 |
| observations、episodeResults、media result collector（K） | 新合法观察/邀请真实答复/本人媒体完成可形成新语义候选，原证据只消费一次。 | 它们是优先的真实新依据；新review不是它们的替代，也不因没收到新消息就造新观察。 |
| narrative-wake-repository.ts:141-163；agent-narrative-repository.ts:388-418,568-662；authored-event-eligibility-repository.ts:136-142 | Director已评同证据quiet抑制重买；人物quiet考虑请求会consumed；shared_episode常仍proposed且占用作者节点。 | **第二层断点**：普通own_agenda复盘不能冒充该事件新的参与请求。该事件再考虑需要单独的同事件review契约，不能换request/episode ID绕过已付费身份。 |
| db0092 claim_due_worlds；server/scheduler.ts/run-daily-scheduler.ts | 每日cron、20h资格、全局每日2世界，活跃/unknown按world排除。 | 没有持续actor due/dependency索引。仅加在线review仍不等于完成分钟级离线执行；root后续统一改执行设施和索引。 |
| root M application/agent-advance-batch.ts/0094 | 请求内多人物公平、model次数/时限预算；原world短租约去重。 | 不会自动创造缺失的review资格；不等于跨world/owner的持久预算或due索引。 |

因此不是简单“quiet永久屏蔽所有工作”：真实新观察和计划条件仍可唤醒。确定缺口是：F已消费、没有其他真实ready候选、本人又没有后续安排时，没有受预算控制的**重新想一想**入口。

## 2. 两种family必须隔离

1. **own_agenda_review**：本人基于性格、已知经历、当前计划/责任重新安排自己的生活。可继续安静、修复missing_next_step、另作打算；不要求发消息，不核销玩家责任。它不是原事件再次考虑/重新邀请许可。
2. **episode_participation_review**：明确指向同一sharedEpisode、原request、原参与决定和新增可考虑依据。原request永久consumed、原paid记录保留。要改参与立场须由root另定追加review receipt/修订准入，不复用旧request冒充未付费，也不创建“新事件”重复原节点。

第一包建议只实现第一种；遇到第二种返回needs_episode_review_contract，不伪装own_agenda推进。当前shared_episode写约束只有proposed/active/真实whole结果resolved；即使domain曾列withdrawn，也不能宣称DB已支持关闭quiet提案。root如需撤下编排机会，必须区分“该机会暂不演”与“作者事件完成”，另冻结原episode生命周期契约，必要SQL由root占号。

Director已有合格机会/未消费人物请求、真实结果跟进和普通到期计划优先；own review不能用即兴目标覆盖未满足的作者前提，不能把原事件的quiet、decline改名成另一新邀请来重买。同一作者事件是否已呈现/结果仍由L/原episode真实证据判断。

## 3. 最小持久化：复用原账本，不新增业务状态库

首包可以**0新增业务字段/0新剧情表**，但不是没有持久化：新增review envelope存现有不可变agent_input_receipts.document.text，原attempt和rate_limits仍是权威账本。建议root冻结的内部形状：

```ts
type OwnAgendaReviewInput = {
  type: 'npc_agenda_review';
  family: 'own_agenda';
  grantId: string;
  anchorAttemptId: string;
  policyVersion: string;
  basisSourceIds: string[]; // 仅本人已授权definition/真实来源
};
```

- owner从服务端身份取得，不读客户端grant；receipt必须同owner/world、origin=wake、channel=private、recipient/thread均是该actor。原F只处理初始化，新guard专门验证此type，不能让任意wake text自动获得review权利。
- **anchor可重建**：同owner/world/currentEpoch/actor的原committed attempt，必须关联成功command、真实agent.state_committed事件和对应stateAfter/原快照；定义与当前合法源一致。不能用最后一条消息、actor数组非空、投影时间或index存在代替。旧quiet是实际已提交选择，不是新增世界事实。
- 优先锚定上次本人成功review或真正本人已提交回合；读集新旧判定不能仅取全局最新worldVersion。首包仅处理有原epoch2已提交anchor的存档；没有anchor的空状态仍走F。旧档扩展若需特别adoption，root另外明确准入，不伪造历史committed。
- stable **familyId** 绑定world/epoch/actor/definition/own_agenda/anchor；不含当前秒数、时间桶、global worldVersion、刷新entry。policyVersion是快照解释/预算绑定，不能单因部署升级给已paid family换新身份。先检查同family所有历史policy/transport记录的sent_at/response_hash，再判断当前版本可否发送。
- 只在原kernel真正提交新决定后，后继family才可锚定这个新committed attempt。quiet提交也是真实下一次政策锚点；次数受现实预算和quiet退避约束。读候选、到期、预算窗口切换、索引重建均不推进anchor。
- claim/accept仍用原command/receipt。可将grant family绑定放原规范化envelope并由server helper精确重建核验；不把text自称grant当认证。SQL JSON字段/owner RLS/immutable只提供存储边界，新准入校验尚需root接线，并非现SQL自动认识此type。
- 新输入和已有state变化若使prepared视图旧了，原CAS/受保护raw规则仍有效。无关world提交不改familyId。已付费stale必须走root既定读集重验，不能“又到时间了”重买；尚未实现重验时诚实保留该阻挡。

缺省不为每次review追加autonomy字段或复制goals/plans，也不从read操作写状态。审计/disposition从原前后状态、实际message/action result和receipt派生：quiet、changed_plan、actual_action、actual_message、预算等待、已知失败、unknown分别记录诊断；played=0或statements=[]本身不足以证明quiet。

## 4. 两套时间的资格与节奏

```ts
ready = admitted && validOwnAnchor && noOriginalPaidFence
  && projectedStoryAt >= anchorStoryAt + policy.reviewStoryGap
  && dbRealNow >= anchorRealAt + quietBackoff(policy, actualQuietStreak)
  && policyBudgetAvailable && !explicitlyPaused;
```

这是**计算许可**，不是故事发生、角色发现新信息、作者事件not_before或用户deadline。review不得生成fact/observation、responsibility.deadline或“你不在时已经发生”的摘要。显式暂停不运行；连续离线1x/浏览12x/交谈1x按原clock分段投影，切速只影响何时达到story门槛，不改grant身份。恢复只核原ready/已有结果；不回填离线多轮虚构演绎。

配置分开：轻量checkEvery、初次真实消息45–60s目标及处理预留（I）、reviewMinStoryGap、reviewMinRealGap、quiet退避上限、owner/world/actor预算、M batch人数/调用数/时限、投递节奏。只满足现实冷却不等于有联系理由。快进一整天不会瞬间购买一整天review；现实预算仍有限。故事未流逝也不能每次现实闹钟到就推进同一安排。

首包数值应由root按成本/延迟实测配置，不把“每分钟所有人物思考”写死。建议quiet连续时逐步退避，但有有限的maxReviewGap和可续窗口预算，避免永久quiet；有真实新结果时仍走原高优先候选，不等quiet退避结束。不要求每个review都联系玩家；达到预算上限明确budget_wait并保留同family接续。仅靠此政策不保证55s必有消息，持续后台执行设施也尚未完成。

## 5. 可复用预算与必须冻结的原子边界

已有storage/infrastructure/limits.ts consumeLimit()操作0003 rate_limits(owner_id,bucket,window_start,count)，RLS为同owner、PK=(owner,bucket)，原tasks也用它。**不复用guest创建额度，不新造剧情预算表。**可给owner总量、world、actor设置独立review bucket，在同一原request_sent短事务按固定顺序预留，任一失败整事务回滚，避免跨world并发均看到“尚有余额”。M world租约只防同world批次，不能替代此跨world原子预算。

现helper不能未经检查就声称满足严格窗口并发：使用now()（事务开始时间），冲突时window_start直接EXCLUDED；较早事务迟到、较新事务已推进窗口且count未满时，旧窗口可能回写并导致后续重置。root应定向采用不倒退窗口（如GREATEST与对应count逻辑）或冻结专用review reserve适配，仍用原rate_limits表；服务器采样real时间，不能接受客户端时间。固定窗口也应如实标为固定窗口，不宣称滚动预算或金融计费上限。

原attempt状态/租约行锁下，必须先认证准入、排除paid/replay，再只在首次合法reserved→request_sent消费预算；无network前的失败不能吞世界更新或预订多份余额。unknown/结果丢失照原保守计费处理，不因窗口过期就解锁。这里的预算只覆盖fallback review，不谎称原普通消息/所有商业调用均已统一受限。

预算不足与原恢复必须完整接线：不能抛RATE_LIMITED后把reserved遗留成永久busy。仅证明sent_at=null且response_hash=null的原尝试可记录cancelled_before_send并返回budget_wait，使用既有resumeCancelledAgentAttemptInTransaction的原fence。原CAS尚有效则同receipt恢复；若旧不可变receipt/CAS已过期，root必须明确零发送新transportTry授权，保留同family和旧receipt，且所有历史同family均未发送才允许。任何paid/unknown/已收raw不得因新try/policyVersion洗白。暂未冻此边界时不实现自动重试。

## 6. 不重问、拒绝与不同NPC的边界

复盘输入提供本人原questions/focus/replyAssessments/questionWithdrawals/responsibilities/decisions和实际事件结果；不将未回复看作同意/失约、不将暂缓或换话题核销旧责任。允许NPC改变自己的安排、做合法非玩家依赖动作、改等候条件或保持安静，但不能自动让用户承担新任务。

原 AgentQuestion 已有responsibilityId，statement已有requestsPlayerReply/questionForResponsibilityId；这些可复用。现kernel仅验证链接存在，发问时会按新event生成新question ID，不能据此承诺已防同业务重复提问。root需对review-origin限定旧请求的业务身份/修订/新依据：已回答/拒绝/暂缓范围未变且无新结果时不重新提出；不能把新question ID、新responsibility ID或换NPC当新请求。旧R同ID身份固定不等于跨ID业务去重已实现。

对真实appointment可用原appointment ID和请求修订/来源；自由request/episode则需root冻结足够精确的业务联系凭证，不能一概把同episode所有不同问题都当重复，也不能将AgentEpisodeRequest的“请NPC考虑”ID当玩家责任ID。跨人物判断由server查原业务身份与合法来源，只向NPC提供经裁剪的结果，不广播别人私聊。新提问/再邀请必须有明确新理由，冷却与review grant都不属于新理由；语义自然性仍须真实模型验收，不靠标点/关键词过滤冒称解决。

原paid quiet episode的再参与需要第二family契约；own review不允许输出旧consumed request的episodeDecision或重建同作者机会。共享冲突仍交原Director，仅普通本人安排可独立；review不变成每条消息重新审批，也不允许跳过作者资格/L真实阶段证据。A深聊不应冻结B独立计算，玩家投递须等root内部规划/投递分离契约，不简单删除attention守卫。

## 7. 最小调用链与独占实施建议（均待root冻结）

```text
原首次/返回/在线/Worker便宜检查
 → 原due/真实candidate（优先）或重建own-review grant
 → 原collector source=agenda_review → 原schedule/M批次
 → 原accept/claim/send前revalidate+原子预算
 → 原snapshot/NPC本人决定 → 原kernel/state/receipt/Outbox
 → 已提交anchor可导出下一次review；消息按原投影呈现
```

需要root冻结的公共面：AgentCandidate.source枚举与source payload、review grant/准入、原send预算等待与零发送恢复、模型收到的运行授权语义、跨业务重复请求校验、后续投递权限。未冻之前不提供孤立、未接线的“已实现policy”来冒充能力。

| 包/建议唯一负责人 | 精确范围建议 | 交付边界 |
|---|---|---|
| N1 root公共契约 | domain/agent-runtime.ts candidate枚举、application/agent-runtime-ports.ts、原collector/schedule/runtime repository/run-agent、必要模型wire/source适配、limits事务单一归属 | root先冻结接口/失败码/锁序及budget处理，不与M同时写。 |
| N2 独立纯规则负责人（可派本聊天） | NEW domain/actor-agenda-review.ts、NEW tests/actor-agenda-review.test.ts | 纯判断grant身份、story/real阈值、已有状态结果，不自行决定发送；读取证明和预算预留由root端口提供。 |
| N3 独立只读证据/准入负责人 | NEW infrastructure/actor-agenda-review-repository.ts、NEW tests/integration/actor-agenda-review.test.ts；原runtime repository唯一root接线 | 最少原账本读取、owner/epoch/definition/anchor认证、跨family paid围栏、原clock，原schema可支撑时不加新表；先回签名后实现。 |
| N4 root原执行/呈现 | 原advance/probe/M batch/kernel/问题业务权利/后续Outbox | 同一NPC不连刷、budget_wait不quiet、无新条件不发旧问句；不直接插入消息。 |
| N5 后续root due/dependency | 原事务可重建索引、原scheduler/任务执行设施与真实触发频率 | 索引是缓存不是第二工作/重试真源；由业务变更和时钟转换更新，不从index重建人物事实。 |

首包可在原前台入口上先验证，不会因此宣称离线持续调度完成。若单次廉价检查需扫描无限原attempt/receipt，必须给有界查询和索引预算；原JSON文本type仅作为定位候选，应用精确parse并认证，不直接任意SQL text::jsonb。发现必须新增durable binding/index时先交root申请迁移号，而非偷偷新建阶段/剧情库。

## 8. 正负验收门槛

1. 原F一次成功quiet→无新玩家输入、真实story和real门槛到→原NPC获一个有界review；同family刷新、两个tab、Worker并发最多一次发送/提交。下一review仅由真实新committed anchor产生。
2. 旧goals全fulfilled/plans全finished的真实状态可重新考虑自己的安排；活跃ready计划/媒体结果优先，未到条件不提前执行。未记录的到达/子步骤/时间跳跃不成为完成证明。
3. quiet再次quiet允许有限退避；played0但实际计划变化/执行结果不能错标quiet。预算不足明确budget_wait、无残留reserved、当前family未丢；预算恢复不创建新ID。跨world同owner并发、窗口边界迟到事务、原事务回滚均不能超额/倒退/重复扣。
4. unknown/response_received/paid invalid/stale依原保护；窗口更新、重启、policy升级不重买。已收raw只走保护重验，模型calls=0；仅真实零发送取消可按原CAS/明确新transport规则恢复。
5. 时间对照：显式暂停、连续离线1x、浏览12x、私聊1x、快进、改期/切速、现实钟回拨与跨预算边界；相同family key不随tick/无关worldVersion变化。返回有界处理并保留未追平接续点，不编造过去。
6. 已回答/拒绝/暂缓/沉默四种状态分别验证；无新依据不再问同请求，不换R/question/NPC重复施压；无关聊天不结清责任。新实际结果可更新安排，但必须引用它。
7. quiet proposed episode与ownagenda分别测试：后者不得重发consumed request、复制作者节点或假完成；允许本人无关合法生活安排，旧episode暂停/再参与只能走另行核准family。
8. 两人物公平，A unknown/quiet不阻B合法review；A深聊时B计划与投递遵守root分离契约；跨owner/私聊/群/现场来源隔离，日志不含正文/身份/密钥。
9. 最终真实模型样本分别记录“不强制消息”的正确quiet与有意图的新消息/计划；按实际可见投影计时和成本，不把纯函数/PG合成输出当自然人物验收。额度由root唯一账本，本包0调用。

## 9. 当前交付状态

本报告完成代码级断点核对、最少持久化/预算与恢复契约、实施归属和验收场景。没有新增运行能力、迁移、付费配额或部署，不能据此标整个154完成。root审核冻结公共契约后再分配N2/N3等明确文件，本人不触M/0094/phone公共在制文件，不复测已通过L或整套check/build。
