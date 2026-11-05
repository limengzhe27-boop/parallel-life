# PROGRESSION-IDLE-53：停滞时的具体生活事项与空转消息刹车

2026-11-05；实现人 `astra-progression-idle53-20261105`；基线 `f8f70223`，接续 51/52。

## 1. 这轮真正修的是什么

51/52 已经能保存“接受任务后的计划”，但原档仍出现两类问题：

1. **导演复盘读不出快照**：自动计划允许 `goalId: null`，导演候选快照却把它声明成必填字符串。原档只要存在这种计划，导演复盘就会以 `INVALID_DIRECTOR_SNAPSHOT` 失败，后续只能继续走人物空转复盘。
2. **空转复盘反复发“我在等你”**：无行动、无条件、无缺失条件的计划每个调度 tick 都可被复查；模型每次都能发一条“我安静等你”的消息。这不是新状态，也不是具体下一步，但会持续消耗预算并淹没真正的剧情。
3. **全员等待时没有具体事件来源**：导演在“没有作者入口、没有玩家新消息”时会选择 quiet；单靠提示词要求它编日常事件并不可靠。
4. **原档 NPC 上下文超限**：`transmittedMessages + responseSchema` 贴近 80k 上限，部分人物直接 `NPC_AGENT_SNAPSHOT_LIMIT`，无法参与。

## 2. 实现

### 2.1 导演快照接受无目标计划

`src/modules/world/infrastructure/director-runtime-repository.ts`：候选的 `planReview.goalId` 改为 `Key.nullable()`。这与 `AgentCandidate.planReview.goalId: string | null` 和 52 的自动计划一致。没有目标不等于没有计划。

### 2.2 空转计划复查的每人物冷却

`src/modules/world/application/agent-schedule-collectors.ts`：对“无 nextAction、无 triggers、无 missingConditions”的计划复查增加 **2 个故事小时** 的每人物冷却。刚发过消息的人不再每个 tick 被买一次“等待”回合；计划仍保留，冷却后仍可复查。有行动/条件/缺失条件的计划不受影响；导演机会、约定、观察也不受影响。

### 2.3 停滞时的具体生活事项（idle beat）

`src/modules/world/infrastructure/director-agent-model.ts` 新增一个有界回退：

- 只在周期复盘、且没有合格作者入口、且存在“没有进行中下一步”的人物时触发；
- 用一个小型、独立的导演提示，为该人物生成一件**外部生活事项**（工作/学业/家庭/金钱/健康/行程/契约/朋友求助），要求具体人物/地点/事项/本人第一步/不处理的后果；
- 明确禁止把起床、洗澡、换衣、身体反应、亲密/性、吃饭、天气、设备没电、通勤当作事件；
- 结果仍走原 `DirectorDecision`：一个 `bounded_opportunity`、一个 `future_task`、来源是人物定义；不新建业务表、不替玩家决定、不强制人物接受；
- 人物可 engage/decline/defer；接受后仍由原人物内核形成计划/行动。

`src/server/config.ts` 提供 `directorIdleBeatMode()`，由 server 组装层读取 `PROGRESSION_IDLE_BEAT`（`auto`/`force`/`off`），基础设施不直接读环境。`force` 只用于本地验收；生产默认 `auto`，仅周期复盘触发。

### 2.4 导演上下文对长档的边界

`director-agent-model.ts` 的 `fitWithinBudget` **不截断受保护的业务状态**：问题、目标、计划、行动、决定、episode 和原始 evidence 全部保留；只在预算压力下把可选观察减到 1 条，并沿用既有的世界设定/人物材料/事件描述节选。此前尝试过截断观察文本、过滤 episode、截断 questions，均被 `director-context-budget`/`director-state-budget` 测试拒绝，已回退。没有这些步骤，原档 2fb 的导演请求达到 98788+5419 字符，直接 `DIRECTOR_CONTEXT_LIMIT`；保留业务状态并减观察后可进入硬上限。

### 2.5 人物上下文超限的派生让步

`npc-agent-model.ts` 在原有观察/时间/最近消息/表情裁剪之后，再依次让步派生展示块：`conversationProgress`、`contextSelection`、`planNextSteps`；仍超限时只删 `terminal` 的 episode follow-up，不删除 active 任务。`active event follow-ups cannot silently disappear` 测试保证 active 项不会被丢。原档一次失败快照从 80,532 字符降到硬上限内。

### 2.6 空转消息的最后刹车

`npc-model-protocol.ts` 对 `npc_agenda_review`/`npc_own_condition_ready` 的纯等待台词做最后过滤：没有执行、没有带下一步的计划、没有 open 的 self 责任、没有真实提问，且文本只含“等你/不打扰/安静/慢节奏/守着你”等，就保留状态变化但不把这条“我会等你”发出去。带工作/账目/发票/孩子/医院等具体事项的文本不在此列。测试覆盖“纯等待被抑制、具体工作保留”。

### 2.5 上下文超限的最后让步

`src/modules/world/infrastructure/npc-agent-model.ts`：在已移除观察、可选时间、最近本人消息和表情目录后，若仍超限，先删除派生的 `conversationProgress`。它是展示摘要，不是事实/权限；完整消息、当前状态、来源和 schema 仍保留。

## 3. 验证

- `npm run check`：**4264/4264**，边界/类型/单测通过；`npm run build` 通过。导演提示版本升为 `director-runtime-v48-idle-beat`。
- 聚焦单测：`director-agent-model` 40/40（含 idle beat 解析与模型路径）、`agent-schedule-collectors` 51/51（含 2 小时冷却）、`npc-agent-model`/`npc-model-protocol` 等合计 198/198。
- 真实 PostgreSQL 克隆档 `parallel_life_prog53_clean`（原档 2fb 的快照，不是原档写）：
  - 03:53Z 强制复盘生成 `bounded_opportunity`：青青接到校园活动视频剪辑项目，10 点前决定，自付 200 元订阅费，影响下月帮男主付房租；
  - 人物实际回信：“其实我挺想接下这个剪辑项目……等我联系上课程组长再做决定吧。”；
  - 这证明“停滞 → 具体外部事项 → 人物主动发消息”的链路，不再只是“关心/等你”。
  - 同轮还验证了导演快照不再因 `goalId:null` 拒绝；此前原档直接 `INVALID_DIRECTOR_SNAPSHOT`。
- **原档正式库 04:02Z 已出现真实结果**（不是克隆、不是force）：worker 以 `auto` 周期复盘生成 `bounded_opportunity`「刘胜男被公司财务提醒本周必须交付一份出差账目明细」，含三天期限、发票/住宿缺口、奖金和部门信任代价；刘胜男实际回信「这周出差账目我会尽快核对好，把所有住宿和发票明细整理出来，及时提交财务……」。这是原档首次在本轮出现“具体外部事项 + 人物主动回信”，不是关心/等待。

## 4. 仍未完成 / 边界

- 3218 已切 `.local/build-progression53-final`（health 200），worker 正在原档跑；本轮只证明“停滞→具体外部事项→主动回信”，尚未证明三天账目任务在后续计划/回执中实际完成。
- 受保护状态版本的导演上下文与人物上下文均已在原档运行中不再报 `DIRECTOR_CONTEXT_LIMIT`/`NPC_AGENT_SNAPSHOT_LIMIT`；继续观察纯等待消息是否被抑制。
- 刘胜男的该计划当前为 `waiting`、`missingConditions` 为“需要补全的发票和住宿明细”，下一步仍停在本人补材料；不把一条回信当成事件完成。
- idle beat 仍是“日常事项”生成器，不是完整长线剧情引擎；人物可以拒绝，拒绝后仍需要导演下一拍，当前只保证“不再空转关心”。
- 未部署 Vercel，未改生产库，未新增迁移/表列。

## 5. 接续

1. 合入 main，构建 `.local/build-progression53`；
2. 3218 切该构建，启动队列/主动 worker；
3. 原档只读观察：导演机会、人物消息、计划/行动是否出现具体下一步；不手补消息、不强制参与、不重复购买 unknown；
4. 若原档仍出现纯等待消息，优先检查 plan review 冷却与导演周期是否仍被旧候选抢占，不靠再加提示词。
