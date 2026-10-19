# 44-154-I · 手机连续入口与统一调度链核查

负责人 codex-continuity154-i；唯一集成和部署负责人 root。用户本轮要求实际完成统一主动调度，本文不将局部前端或架构报告冒称完整交付。

## 基线、范围与冻结

2026-10-19 首次核查 unified-engine137 为 efd95f21，存在 root NPC model/protocol WIP，未覆盖。此前定位 f62005dd 已过时。主登记目录 DEVELOPMENT 已先读取、短锁登记。已读 PROJECT_BRIEF、ARCHITECTURE_REVIEW、PRODUCT、ARCHITECTURE、DEPLOYMENT；改前端前读 DESIGN 和本树 Next use-client 文档。

root 顺序合并154-B/F/G/H后明确授权以 **bf9f2140** 开发。复用干净 author-eligibility63/人生剧本，分支 codex/phone-continuity154-i。源码冻结 **1d3a7d8cda697a643fdfe85713578a1df7cc8cce**，仅 world-phone-app.tsx、use-world-time.ts、time-experience-policy.ts、NEW tests/phone-continuity-policy.test.ts、旧 tests/time-experience-policy.test.ts 三处时序断言。原公共协议、server、SQL、NPC模型/内核、后台、clock仓储全部只读。无模型调用、数据库或生产写入、独立部署。

上线状态由 root 核验：root 后续通知158图片正式087b1f00已部署，不把154分支当线上版本。本人仅对正式health做200只读探测，未独立核验该部署SHA或改别名。root同时接入154-J/158-Q/154-K等后继，本文定位以bf9f2140为准，不修改并行文件。

## 开工清单

| 分类 | 核对事实与处理 |
|---|---|
| 已有可复用 | AuthoredAgentMaterialCatalog及纯资格判断、真实proof仓储；Director cause/attempt/decision及opportunity；参与人物请求和原始响应；本人裁剪快照/actor intents；runNpcAgent与唯一kernel；问题、责任、决定和episode outcome；消息/相册等真实投影；paid/unknown围栏。没有新增剧情引擎或调用器。 |
| 待集成（开工时） | merge-base实际证明72a5df0f(B)、f77ce6fc(F)、2b11af07(G)、054aa717(H)均不在efd95f21；root随后已集成到bf9f2140。F是原source-backed议程初始化，不能再实现一份；G只读媒体结果上下文仍需root154-K接snapshot/source/collector/ACK。 |
| 需修改 | 首个NPC执行后即返回；无冲突候选也只选首条；返回与APP切换重置客户端窗口；ready去重混入随机entry；全局focus阻挡他人；quiet无新因果时长期没有重新考虑入口。前三类手机缺口本批已改，公共执行/注意力仍归root。 |
| 需新增 | 原引擎内的有界多人物批次接续、公平/预算与可恢复游标；真实有界agenda_review授权；严格的内部决定与玩家投递分离；真正阶段结果proof接入。既有154-A已给设计，需最小落地而非复制新队列。 |

## 实际调用链与剩余断点

以下路径省略 src/modules/world/ 前缀；行号按冻结bf9f2140附近定位，root可依函数名核对，不据后续行号偏移推断缺陷已修。

| 链路 | 实际职责/证据 | 结论 |
|---|---|---|
| 事件目录→资格 | infrastructure/authored-agent-material-repository.ts → authored-event-eligibility-repository.ts → domain/authored-event-eligibility.ts | 真实source/epoch/version/位置/历史/outcome证据决定资格，不把稿件当发生事实；可复用。 |
| 资格→导演机会 | narrative-wake-repository.ts:69,141-163 / server/npc-agent-advance-services.ts:coordinate | 未占用eligible+未评过真实上下文可唤醒；focus暂缓；同证据付费quiet抑制重买是正确围栏，但不能充当永久没有议程复盘的产品策略。 |
| 导演→持久派发 | director-runtime-repository.ts commit → agent-narrative-repository.ts:264-330 sync/readPendingEpisodeRequests | 已落库真实decision、参与者请求；请求不是玩家承诺/已演出。158-D stagingIntent裁剪到本人，不能广播全稿。 |
| 请求→NPC | server/npc-agent-episode-dispatch.ts:75-178 → actor-episode-intent-repository.ts → readPrivateAgentSnapshot → runNpcAgent | 循环可跳过被暂缓者，但第一个成功提交立即return；其余pending仍在库，不代表同批完成。需要明确同次有界续接。 |
| 独立候选→执行 | application/schedule-agents.ts:475-478 / server/npc-agent-advance-services.ts selectedCandidateIds[0]、scheduled.selected[0] | 无冲突分支也只取首个；Director一次选多个人不等于每个人获得执行机会。B只修quiet不饿死独立候选，不是完整批次。 |
| NPC本人决定→kernel | application/run-agent.ts、infrastructure/npc-agent-kernel.ts | 原快照、租约、raw、版本、权限/知情/行动结果守卫继续复用。不能并行付费准备后直接覆盖新版本，也不能将stale当未付费。 |
| kernel→可见变化 | world_messages等事务投影→LifeClient.world→WorldPhoneApp→notification projection | 本批只观察持久消息ID，未插入台词/消息；读投影与叙事调度分开。原未读/通知系统继续呈现真实记录。 |
| 进展→后续事件 | episode-outcome-repository.ts → authored-event-eligibility-repository.ts:163-164 | nodeProgress已有真实outcome，**stageProgress仍硬传[]**。带afterStageKeys的后续资格不能靠时钟或全部节点结束推断。需显式、真实、有来源的stage proof契约/加载；无completion规则不可瞎补。 |
| quiet/焦点→其他人 | agent-episode-attention.ts:episodeAttentionAllows/requireEpisodeDeliveryInTransaction | 当前合法focus只允同private interlocutor；其他人的内部计划与玩家投递仍耦合。删除注意力校验会放宽事实提交，需原kernel结构性分离。 |
| 离线执行 | server/scheduler.ts → run-daily-scheduler.ts → scheduler-repository.ts → claim_due_worlds；vercel.json每日cron | 每日/全局2世界不是持续调度。手机返回即时检查不等于离线期间已执行。root需原executor/due投影与实际已授权触发频率，不能声称前端修复完成后台。 |

## 本批手机行为

- 统一 PHONE_RUNTIME_POLICY：轻量检查5s，观察到消息的目标55s、预留排队/生成/投影20s，因此沉默35s开始资格检查；quiet检查重试间隔15s。三者与世界12x/1x分别配置。**55s是产品目标，非已测SLA；无资格允许安静，实际后端延迟可能超目标。**
- useWorldTime只将实际玩家交谈动作、观察到的新持久NPC消息计入互动。initialRead/fictional_history/user消息不算新NPC来信；第一批历史只建立基线。重复投影、消息顺序重复、附件ready变化不冒充新来信。
- 本地有限metadata只存时间和至多256消息ID，原projection按时间顺序读取；刷新/重挂载/跨tab共享历史，不反复从零计时。不保存文本或凭证，不把本地时间当世界事实/服务器授权。读取损坏/未来值不能永久压住检查。
- APP/hash切换保留会话生命周期和慢速规则，移除conversation→browsing随机entry更新。实际resume/首次ack仍有前端entry标识，仅用于唤醒UI，不作为模型command/source。
- hidden→visible立即读取已有世界投影，然后检查原服务；BFCache pagehide/pageshow也续接。有真正返回标记才恢复，不把每个visible事件或APP切换当重返。返回不重置沉默时长；独立immediateCheck用于实际返回/等待完成/边界继续，避免monotonic存储吞掉立即检查。
- 原服务ready work key去掉随机entry成分，跨刷新/标签使用有限64条本地去重journal；内存上限256。Navigator Locks以world互斥整个检查/原advance，ifAvailable避免排队放大。浏览器存储/锁失效时只有本地best-effort抑制，最终正确性仍靠原服务器付费source/unknown/版本围栏。
- 同一个已尝试key不会因进出页面而当新机会；新真实服务key可立即接续。普通idle时隙是检查身份，不是付费演绎source；代码未生成NPC消息。已有通知和未读投影未改，提交后只读取真实变化。
- 当前公开continuation只有opaque key，无work kind。continuity fallback绑定last_tick_at，心跳可能改变key，因此会获得更频繁的原advance便宜评估；客户端不能猜key种类。需root在真实工作索引接入后控制轻量探测成本，不能让该key本身创造模型资格。

## 必要验证与真实边界

- 新纯策略9项+原时钟策略5项+时间导航3项：**17/17，0skip**；typecheck/build成功，focused Prettier/diff通过。
- 实际执行完整npm run check：3456项，3446pass/10fail/0skip；失败均既有媒体/RLS PostgreSQL连接127.0.0.1:55505 ECONNREFUSED。未删测试、未改密码/DB、未擅启别人端口。root明确不用重复整套或排查旧PG环境，集成后统一全检。
- ego-browser Space215，本地3279只托管忽略fixture。编译并实际渲染**原useWorldTime React Hook**，client为明确合成的时钟端口，未调模型/数据库。首入blockedfalse/12x；设持久50s沉默→刷新后立即due；进入真正private hash后entry和activity不变、speed1、focus准确；新持久ID后idlefalse。
- 受控派发visibility hidden→visible：实际Hook按away→conversation恢复，entry变化、立即due、lastActivity完全不变；受控pagehide/pageshow persisted也通过。双受控Page读取相同metadata。真实浏览器未给tab切换可靠visibility事件，因此不将受控DOM事件宣称真机后台切换验收。
- 390×844与1440×1000受控Hook页可操作、无横溢出，截图视觉检查。**这是Hook测试壳，不是完整WorldPhone产品页面，也不是自然NPC质量或45–60秒真实送达验收。**产品布局本批未新增结构；root接线后仍须正式手机/PC完整旅程。
- fixture脚本和截图仅忽略.local/phone154i-browser，不提交。没有伪造模型成功、用户承诺、事件结果或生产存档。

## 最小后续独占开发范围与验收

| 批次/建议唯一负责人 | 最小文件职责 | 不可省略验收 |
|---|---|---|
| root公共批次调度 | 原 npc-agent-advance-services.ts、npc-agent-episode-dispatch.ts、schedule-agents.ts及必要原ports；有界步数/模型预算/执行时长、每actor公平、真实pending接续点 | 一事件两NPC同次调度；A quiet/unknown/等待不吞B；每次提交后重新读取真实版本；重复入口0额外付费；不得只for循环用原世界快照发多人。 |
| root或明确独占review | 原agenda grant/state生命周期、collector/runtime repository/phone probe；复用154-F，新增有界复盘授权而非复制goals；必要SQL仅root统一 | 无任务也可依据人物/已演事件/真实时间条件有限复盘；quiet不永久停机，不每5/15s重买；已知失败/unknown不假装quiet；拒绝不换NPC重邀。 |
| rootkernel投递分离 | 原kernel/attention/attempt/raw/既有Outbox；明确本人计划提交与玩家呈现延期的权利边界 | A深聊期间B的合法计划/行动可提交，当前A不频繁打断；依赖行动成功的通知等真实结果；延期过期不重买；跨私聊/群/现场知情隔离。 |
| root事件阶段proof | episode-outcome/真实stage证据、资格仓储、必要Director公共协议/SQL | 接受、拒绝、跳过、事件完成分别进正确分支；阶段只有显式目标与真实证据完成；stageProgress非永空，无隐式时钟/消息数完成。 |
| root154-K及原executor | G接snapshot/resolver/collector/ACK；原due/dependency投影、原tasks/Outbox、合法生产触发器 | 已入队不等于已完成；媒体ready真正推动本人后续；跨owner/world公平和有界积压，保留游标/原顺序；真实离线返回不编造发生记录。 |

集成终验必须走用户的完整目标：首次无输入→两人物实际分别决策→持续在线无输入→真实离开返回先读已提交变化→接受/拒绝/暂缓/沉默四条不同后果→原事项收尾→下一合格事件/阶段→A聊天时B可处理独立事项；加并发标签/刷新/恢复/unknown反例。真实模型、存档、媒体预算由root唯一账本管理，本分支不挪用过去余额。

本人源码冻结后只写报告/登记，不擅自追加公共修改。主表标待验收而非已完成；root需统一全检、迁移确认、正式READY和公网关键流程后才算交付。总体44/154目标仍未完成，本批手机入口接线不能代替持续调度、真实人物内容质量和后台验收。
