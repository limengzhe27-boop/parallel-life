# 44-154-A：NPC 自主议程与持久调度契约（待集成设计）

负责人：`codex-opening-fix-scheduler154a`；唯一集成人：root。
日期：2026-10-19。工作树：`scheduler-contracts154-a`，分支 `codex/scheduler-contracts154-a`。
代码审查基线：集成工作树 `e4f0eb91b4c04e6c3ab8635547359974ea2ca5d6`；原提示附件提及的 `650e2d90` 已不是最新基线。本报告不包含集成工作树尚未提交的修改。

本任务只交付此文档。以下接口与表结构均为**待开发提议**，不是已经新增的 API、数据库或运行能力。158 媒体／回复修复继续由原负责人处理；本报告不重复占用其源码。

## 1. 输入、事实与设计边界

已读取用户原始附件：`/Users/limengzhe/.codex/attachments/f34c05ff-b6ef-4d68-a57b-837a6447f674/已粘贴的文本.txt`，以及主 DEVELOPMENT、PROJECT_BRIEF、ARCHITECTURE_REVIEW 和相关架构文件。

当前源码可确认：

- `publication-agent-trial-bootstrap.ts` 用 `emptyActorAgentState()` 初始化人物，再登记 epoch 与叙事准入；这保证独立状态存在，**不保证人物已经有生活议程**。
- `agent-schedule-collectors.ts` 已有 `actor_plan`、`responsibility`、`observation` 候选；候选身份已绑定语义内容和来源证明，不应退回按轮询次数／全局版本生成身份。
- `agent-plan-next-step.ts` 已区分行动、重考、等待、受阻／缺下一步；旧无下一步计划不会因为本次设计被悄悄补齐。
- 条件解释器在 **application/agent-condition-checks.ts**，不是附件写的 domain 路径。它经原 `evaluateAgentActionEligibility()` 使用旧数组语义；当前没有任意 all/any 树。
- `schedule-agents.ts` 已可让不冲突普通人物候选直接入选；共享事件、资源、群／现场冲突才协调。不能把所有正常人物工作重新串行交给导演。
- `runNpcAgent()` 已有调用前校验、持久 claim、request_sent、原始响应保存、原内核提交；必须保留，不能新增一个“自主人物调用器”。
- `requireActiveAgentDeliveryInTransaction()` 已经通过统一时钟门禁区分持续运行与显式暂停；仍存在注意力与回复提交的耦合，不能称三阶段完全分离。
- `scheduler-repository.ts → claim_due_worlds()`、`runDailyScheduler()`、`server/scheduler.ts` 仍是按世界的每日入口。0092 中全局每日最多 2 世界、约 20 小时资格、world 级未知／进行中排除仍存在；`vercel.json` 仍为每日一次 `0 4 * * *`。

本报告没有读取／核验 Stanford Generative Agents、AI Town、Concordia、pg-boss、Graphile Worker 的固定版本、许可证或实现文件。附件将它们列为参考方向，**不得将本文当作这些外部机制已完成调研、可直接复制的证据**。真正引用其代码前另行固定版本、文件与许可。

目标只有一套写入链：

```text
已授权初始化／真实事件／有界运行策略
  → 原人物业务状态 + 可重建工作索引
  → 到期／相关条件领取 → 原候选资格检查
  → 原 NPC 决策（必要时原导演协调）
  → 原内核事实／行动／状态／回执事务
  → 原消息、日历、地图、现场、朋友圈投影
```

不恢复 epoch1 写入，不把旧 `beatCue()` 当成新的自动对白模板，不给事件添加无稿件依据的两小时期限。

## 2. 旧能力到新架构的迁移对照

| 旧能力 | 可信来源与旧入口 | 新链承接 | 仍需补齐／验收 |
|---|---|---|---|
| 首次无输入开场 | 初始局面，旧 advance/agenda | 原叙事准入、作者机会、人物独立选择 | 初始化议程工作登记；首次进入不需先聊遍人物 |
| 待回复问题 | 具体问题与后续回话，agenda | 本人 questions、明确答复评估、responsibility | 特定问题及请求修订绑定，天气闲聊不消费 |
| 已提出邀请 | 来源明确的 proposed 日程 | 原邀约与本人责任 | 没答应不算失约；没有硬截止不凭空制造 |
| 已确认约定 | 明确接受与日程来源 | 当前决定、责任、行动资格 | 到时只重评，不能替玩家到场 |
| 人物承诺 | 原消息／承诺记录 | 本人 goal/plan/action/responsibility | 不仅保存摘要，当前下一步必须可解释 |
| 结果跟进 | 实际执行结果 | action results、episode outcomes、观察 | 有来源的依赖工作登记，不能以“后来发过消息”核销 |
| 新信息联系 | 本人合法收到的信息 | observation inbox、可见事实 | 私人或秘密变化不全图唤醒 |
| 沉默后的安排 | 未决事项、本人目标 | 本人调整计划或有状态安静 | 没有统一催问→生气模板；事后能解释去向 |
| 聊完后的下一步 | 原事项及本次选择 | 原人物提案同次提交 | 当前事项结束后可建立自己的下一安排 |
| 没有未决事项 | 人物背景与当前局面 | 新增有界 agenda review 工作，仍调用原 NPC | 空状态≠完成，quiet≠失败；不固定轮流联系玩家 |

旧版普通消息过滤、固定 R17 规则、回复数量收尾等不作为要继承的正确能力。比较基线要固定同一时钟、来源和受控输出，不能比较“谁发消息多”。

## 3. 状态所有权：哪些是业务真源，哪些只是索引

| 对象 | 权威维护者 | 可以承载什么 | 不能承载什么 |
|---|---|---|---|
| Persona／人物定义 | 原作者与人物定义版本 | 身份、边界、习惯、初始关系 | 不能由调度器修改性格来满足提醒 |
| 本人目标／计划／责任／决定 | `ActorAgentState`，原内核提交 | 当前下一行动、等待、撤回、结果引用 | 不放入 belief 假装执行状态 |
| 实际位置、到达、行动结果 | 原世界内核及事实投影 | 真实执行及发生时间 | 台词“我到了”不能成为到达证据 |
| 本人认知 | 原观察／记忆／知情投影 | 获知时间、来源、最后已知状态 | 不给每人传玩家真实全局位置 |
| 初始议程／复盘生命周期 | 人物状态中的小型版本化元数据（待增） | 本定义版本是否已评估、合法复盘授权／上次结果引用 | 不复制一份 goals/plans，不让 index 成为人物计划 |
| due 与依赖索引 | 原事务生成的可重建投影（待增） | 谁何时因何有运行机会、修订、claim 与处理引用 | 不保存新的剧情事实或模型对白 |
| 付费调用身份与原始结果 | 原 `agent_attempts`／Director attempts | 已发送、原响应、unknown、明确失败 | 索引租约失效不能等于允许重买模型 |
| 全局编排 | 原导演状态与观察游标 | 跨人物因果、冲突、机会与节奏 | 不替所有人物作私人决定 |
| 玩家可见呈现 | 原渠道投影及受控投递状态 | 已确认的消息／附件／现场表现 | 排队或决定联系不等于消息已呈现 |

建议仅向人物状态新增 `autonomy` 小型元数据，老档缺失时表示“尚未建立”，而非完成：

```ts
type ActorAutonomy = {
  schemaVersion: 1;
  initializedDefinitionRef: string | null;
  status: 'not_initialized' | 'established' | 'quiet' | 'blocked';
  lastReviewReceiptId: string | null;
  nextReviewGrant: RuntimeReviewGrant | null;
};
```

`unknown`、`invalid_output` 是调用／执行记录状态，不写进业务状态冒充人物决定；由工作诊断联查原 attempt。成功 quiet 可以 established，但必须有原响应回执与安静策略，不能只因容器为空就标 established。

## 4. 初始议程与无任务复盘接口

### 4.1 初始化不是给人物强塞任务

在现有正式发布／生成世界／官方世界初始化事务、旧档合法准入迁移事务中，依据**原人物定义与世界准入**登记 `agenda_initialize` 工作，不在创建请求中串行调用全部人物。

每个 `worldId + engineEpoch + actorId + definitionRef + admissionRef + policyVersion` 只有一个初始化身份。优先安排有开场关联的人物；其他人物有界轮转，不都默认发消息。状态初始化失败或无预算时工作保持待建立／预算等待，玩家不必逐个激活。

NPC 输入仍由原快照组装：本人的定义、合法记忆、已知局面、已有状态、本次 runtime grant、允许动作；只规划当前一步。导演建议可以成为本人已收到的意图，不能被当成事实或命令人物必须配合。

建议权限信封（服务器签发／持久，模型不可自产）：

```ts
type RuntimeReviewGrant = {
  id: string;
  kind: 'agenda_initialize' | 'idle_agenda_review' | 'post_resolution_review';
  worldId: string;
  actorId: string;
  engineEpoch: number;
  definitionRef: string;
  policyVersion: string;
  basisRefs: string[]; // 原准入／本人实际结果／已授权运行策略
  window: { notBeforeStoryAt: string | null; expiresAtStory: string | null };
  maxPaidDecisions: 1;
};
```

它是“允许考虑自己的安排”，不是世界事实、玩家消息或邀请截止。可沿原 `AgentInputReceipt(origin='wake')` 接受为调度输入，保持 `origin` 区分；不能因此生成 `AgentPlayerDecision`，也不能赋予位置／知情权限。原 kernel 的来源校验需明确区分 runtime authority 与事实证据，不在提示词中含糊混用。

### 4.2 无任务≠永不运行，也不等于固定发消息

只有满足下列之一才产生后续复盘工作：

- 原目标／事项实际结束，存在本人后续安排需要考虑；
- 原有模型决定保存了合法等待／重新考虑条件；
- 服务器的版本化运行策略给予有界日常复盘机会，且未决负担、注意力、预算和冷却允许。

策略窗口是运行机会，不是让所有人准时联系玩家。一次复盘仍沿原 nextStep/executions 输出：合法行动、明确等待、条件成立重考、受阻原因、结束／撤回。成功安静可保存“等外部变化”或下一合法策略窗口，不能返回 quiet 后把工作与去向删掉。

首期合成双人物验收可固定一个初始化 grant 与一个后续 review grant／人，验证重放不会多买。生产复盘频率由 root 单独定策并与有效预算一致；本设计不擅自设定高频生产数值，更不每分钟固定调用。

## 5. all／any 条件：一个解释器，保留旧档含义

当前旧数组行为必须保留：

- action.preconditions 的数组是全满足；空数组表示没有附加动作前提。
- plan.triggers、responsibility.nextCheck 用于主动唤醒，空数组在现 adapter 中**不产生唤醒**。不能归一成 `all([])=true` 后让所有旧空计划醒来。

建议在公共契约一次性新增可选、版本化表达式，不让各 collector 自己解释：

```ts
type WakeExpressionV2 = {
  version: 2;
  expression: { op: 'all' | 'any'; children: WakeNode[] };
};
type WakeNode = AgentCondition | { op: 'all' | 'any'; children: WakeNode[] };
type ConditionEvaluation = {
  status: 'satisfied' | 'waiting' | 'invalid_basis';
  satisfiedLeafRefs: string[];
  evidenceRefs: string[];
  dependencyRefs: { kind: string; id: string; revision: string }[];
  earliestTimeCandidate: string | null;
};
```

建议深度最多 2、总叶子最多 16、每组 1～8 项；空组拒绝。新字段缺失继续原数组解释。新字段与非空旧数组同时出现时拒绝歧义；正式写入前先让所有 parser/kernel/collector 支持双读，开启新写受 feature policy 控制，不在旧部署尚未支持时生产写新结构。无需批量改写旧档。

“玩家回答该请求 **或** 原稿明确的订位期限到达”应是 `any`；没有真实期限来源时，只能等待回答，不能为补齐示例造期限。运行策略复盘窗口不自动成为订位期限。

条件解释必须返回证据：

- player_decision：相关责任当前修订的明确决定，旧接受不能批准改期后的请求；不得用任意后续消息替代。
- result：原 action_result 及 outcome，不能使用台词自称。
- at_place：内核确认的本人位置／到达证据，不用玩家或其他人的未知位置。
- observation：本人合法收到的来源及获知时刻，不能用全局事件绕过可见性。
- at_or_after：代码投影的世界时刻加该合法条件来源；达到时刻不等于赴约／完成。

all 返回所有满足分支的证据；any 返回实际满足分支的稳定证据集合。等待中的合法分支是 false，越权／不存在／撤销或变造来源是 invalid_basis；不能在 any 中静默忽略越权分支而掩盖坏条件。去重使用条件身份与证据，不使用“当前时间戳”。

提案验证、collector、执行前 eligibility 统一复用这个解释器；数据库索引仅提取依赖，不再实现一份语义。

## 6. 可重建 due 索引与原事务更新

建议新增一套**原调度的执行投影**，不是另立人物引擎或替换已有付费队列：

```ts
type WakeWork = {
  id: string; ownerId: string; worldId: string; actorId: string | null;
  engineEpoch: number;
  reason: 'agenda_initialize' | 'idle_agenda_review' | 'post_resolution_review'
    | 'actor_plan' | 'responsibility' | 'observation' | 'arrival' | 'director_coordination';
  subject: { kind: string; id: string; revision: string };
  conditionHash: string;
  basisRefs: string[];
  dueStoryAt: string | null;
  availableAtReal: string | null; // 可重算，不是剧情事实
  clockGeneration: string;
  status: 'waiting' | 'ready' | 'leased' | 'settled' | 'superseded'
    | 'blocked_unknown' | 'blocked_invalid' | 'budget_wait' | 'paused';
  attemptRef: string | null; resultRef: string | null;
  leaseToken: string | null; leaseUntil: string | null;
};
```

具体 SQL 名称由 root 统一设计迁移，本文不占迁移号。`subject.revision` 对责任用原 revision，对没有独立修订的旧 plan 用规范化内容 hash，不能用每次无关对话递增的全局 worldVersion 当业务身份。

依赖索引记录 `workId → actor/plan/responsibility/question/result/observation/place/clockGeneration`，只用于定位受影响工作。问题 ID 与来源不能互换，事件参与请求 ID 不能伪装责任 ID。

原内核事务增加内部接线，候选接口为：

```ts
projectActorScheduling(sql, { before, after, event, trustedResults, consumedWork });
projectAffectedScheduling(sql, { event, legalObserverDeltas, clockTransition });
rebuildActorScheduling(sql, { identity, definitionRef, businessState, authorityReceipts });
```

位置：沿 `npc-agent-kernel`／原世界命令 UoW／world-awareness 事件事务中，状态与真实结果落库后、外层提交前更新索引、消费原 work、登记下一 work／Outbox。不得在模型调用期间持有此事务。事务失败则状态与索引一起回滚；不能“先保存计划，稍后尽力登记”。

索引重建从业务状态、原准入／复盘回执、真实观察与执行结果派生，不能从缓存索引逆向修改人物计划。重建保留既有 work 的原 attempt/result 关联，不把已消费机会重新变成 ready；部分索引漏写可用 upsert 修复，未知尝试不能靠删索引恢复收费资格。

时钟转换必须单独处理：dueStoryAt 保持世界语义；availableAtReal 用同一 clock 投影函数按 12 倍浏览、1 倍对话、1 倍离线求下一可检查点，跨 activeUntil 分段。速度／活动租约／显式暂停／恢复／快进变化只重建相关时钟索引。执行时再次看真实世界时刻，不信任过时的现实闹钟；显式暂停没有执行资格，正常离线不暂停。

## 7. 公平领取、租约与付费 unknown 隔离

继续复用 PostgreSQL、原 tasks/outbox、原 attempt 与 Worker。due 是索引，原任务系统仍负责执行租约；不要同时创建第二份拥有独立 retry 语义的工作队列。

建议调度端口分清廉价领取与原执行：

```ts
claimWakeWork({ now, budgetClass, limit, perOwner, perWorld, perActor, leaseSeconds });
resolveWakeWork({ token, currentEpoch, subjectRevision, clockGeneration });
executeDeterministicContinuation(work); // 原到达／已收结果恢复，不调用模型
runOriginalActorDecision(work);       // 原快照→runNpcAgent→原kernel
coordinateOriginalDirector(conflict); // 只在确需全局协调时
```

领取采用有限批次、owner→world 轮转与最老 due aging；先各 owner 一个，再分剩余额度，避免仅按 UUID/最新活动排序。人物并发上限首期 1，world 内不同人物可先后决策；原内核短事务仍串行事实版本，不在模型全程锁整个世界。

确定性工作、付费人物工作、导演工作分别计量。先处理真实到达／已收响应恢复，再按预算允许模型；没有模型预算不妨碍已授权确定性续接。现有每日两世界预算不能原封不动成为所有工作的硬上限。生产预算上限、触发频率、部署执行者由 root 明确，不擅自升级套餐、安装扩展或购买服务。

| 中断／状态 | 恢复方式 | 禁止做法 |
|---|---|---|
| work 已租约、尚未发送，租约失效 | 核查原 attempt 未发送／无 raw，取消或同身份恢复资格 | 单看时间到就重买 |
| request_sent 或结果未知 | 关联原 attempt，隔离同人物／真实共享资源；可查询／接收原结果 | 新 commandId 自动再调用 |
| response_received | 优先原响应重放与当前权限／版本验证 | 重新调用模型“拿更好结果” |
| invalid_output／明确供应商拒绝 | 原已知失败保留；等待新合法输入／显式重评授权 | 每次 tick 修复尝试 |
| 状态已提交、调度执行者崩溃 | kernel 回执／消费 work 与下一索引已原子保存；幂等核对 | 把 lease 丢失当业务没发生 |
| 请求改期／撤回／来源失效 | 旧 subject revision work 标 superseded，重建新依赖 | 旧闹钟继续执行 |

目前原 attempt 仍有 expectedWorldVersion。允许 B 运行可能使 A 的晚到响应 stale；不能直接改写 A 已付费快照版本。首期按原规则保存原始响应并诚实标 stale／待核对，保留原业务责任；不能声称已实现任意跨版本响应重基。若后续要无模型重新应用独立原结果，必须新增显式内核再验证协议，保留原 attempt 与来源，不能在索引层擅自 rebase。

一个 A 的 unknown 不应直接排除整个 world（当前 claim_due_worlds 正有此缺口）。但“缩小阻断范围”也不等于允许冲突执行：同 actor、同 action、同 episode／共享资源有明确 blocker；B 完全无关的计划可运行，B 不得因此知道 A 的秘密。

## 8. 唤醒、决定、投递三个独立阶段

1. **唤醒资格**：有实际条件／初始化／运行策略 grant；只表示允许考虑，不要求说话。
2. **人物决定**：沿原 NPC 一次调用形成本人计划、行动／等待／退出；quiet、失败、预算等待、unknown 分开记录。自己的普通计划不必再请导演批准。
3. **渠道投递**：检查原受众、渠道、注意力与当前有效性。决定联系不等于已经给玩家送达；延迟投递要能说明因何延迟、依赖哪个决定与何时失效。

不能靠把 `requireActiveAgentDelivery` 简单删除来拆分。若允许人物独立安排先提交、玩家呈现暂缓，需在原 kernel 显式保留 `planned_contact / pending_delivery` 与原响应／行动依赖，原事务写 Outbox，后续无模型发布器再核受众与有效性。依赖未执行行动的“已处理”对白不能先发。暂缓内容失效后标失效，不自动重买改写台词。

A 深聊时，B 可以处理自身合法不冲突事项，不一定插入聊天；真正影响已确认安排的变化可以获得明确高优先级呈现，不能被普通焦点永久封住。冷却结束只解除限制，不构成重复邀请的原因。

导演 observed/evaluated 与 work leased/settled 分开；读取不推进“已评估”游标，投递不伪装共享事件已完成。一次导演安静只解决该次编排判断，不消费所有人的独立 due。

## 9. 最小分期：先一世界、两人物形成实证闭环

### 154-1：公共契约与受控双人物单步（第一交付）

- root 统一合入 all/any 双读解释、authority grant、autonomy 元数据与 due 投影接口。
- 两个 Persona 由合法初始化源各得一次 agenda 初始化机会，沿原 NPC 选择不同安排；允许其中一人安静。
- 同次内核提交计划及下一 work；执行器可以先使用既有真实 HTTP／Worker 单次入口，不宣称持续后台已完成。
- 固定时钟触发其中一个真实下一步，执行原支持能力并保存结果；结果生成另一相关 follow-up。重复入口零额外调用。
- 此阶段不接回 epoch1，不先做 100 世界吞吐，不用媒体或复杂新物理能力阻塞闭环。

### 154-2：持久执行与时间转换（第二交付）

- due/dependency 索引及原事务接线迁移、重建、短租约、确定性／付费预算隔离。
- 使用已获授权的实际生产触发设施；当前每日 cron 无法保证分钟级，不在未解决执行频率前宣布完成。
- 验证崩溃恢复、暂停／恢复、改期、12/1/离线转换、unknown 只隔离相关工作。
- 100 世界受控公平性测试后给出最老到期延迟、覆盖人数／世界数与预算等待证据，不用 API200 代替。

### 154-3：导演与投递分离、真实连续体验（第三交付）

- 验证 A 深聊时 B 的安静安排或合法行动、共享冲突按需导演协调、消息失效与注意力策略。
- 有效授权范围内一次双人物真实模型连续旅程；受控 JSON／PG 与自然人物质量分开报告。
- 达标后删除重复 epoch1 推进写路由／重复条件解释，只保留旧档读取与不可变重放需要的代码。

每一交付都要 root 按项目规定集成检查／数据库证据／部署／公网验证后再勾选；本文没有替这些交付标完成。

## 10. 双人物首批验收与诊断出口

| 旅程 | 必须同时看到的证据 |
|---|---|
| 无玩家输入初始化 | 原准入＋两人物各自 grant／work＋原调用回执；不是两个空 state |
| Persona 不同安排 | 本人原提案与计划；无强制同一模板，无伪造位置 |
| A 接受、B 暂缓／安静 | 当前修订决定、工作去向与下一条件；不能统一关事件 |
| 明确拒绝／换话题 | 拒绝不重邀，普通闲聊不消费原责任 |
| any：回答或真实期限 | 一个分支成立即可唤醒；同一个证据只消费一次，旧数组仍按全满足 |
| 改期／时钟转换 | 旧 work superseded，新 due 正确；不倒退、不误算 offline12倍 |
| 行动与结果 | 原 capability/resultIds，非台词完成；子步骤非整事件完成 |
| 观察隔离 | B 没有 A 的私聊／真实去向，只有合法 observer delta 能使其获得新依据 |
| 重启／并发／unknown | 原 attempt 身份保留；A 未知不重买、B 无关工作可续；晚到 stale 不假应用 |
| 读取与投递 | 真实投影出现才通知；pending_delivery 不算已呈现；没有模型调用也可以是正确安静 |

内部只读诊断建议返回：`wakeReason / basisRefs / subjectRevision / dueStoryAt / availableAtReal / blockerScope / waitingConditions / lease / originalAttemptStatus / lastDecisionReceipt / actualResultRefs / deliveryStatus / budgetClass`。界面可解释“等待玩家回答”“人物另有安排”“已知执行失败”“结果尚未确认”，不要用一个 quiet 覆盖所有状态。

指标至少有 due→claim 延迟、owner/world/actor 最久等待、积压年龄、候选消费与实际结果比、重复主动联系率、无效提案率、每段体验调用成本。日志只写 ID／类型／计数，不输出私人对白、密钥或带凭证链接。

## 11. 本文交付状态

只读设计已完成：原附件与代码定位核对、具体状态和接口、兼容方案、最小分期、恢复与验收标准。没有新类、迁移、模型、执行者、生产配置或发布，不能据此声称 NPC 自主生活能力已经上线。实现与冲突合并由 root 后续分派；主 DEVELOPMENT 是唯一状态源。
