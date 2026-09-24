# Agent 编排设计（交接与讨论用）

本文描述「人生剧本」后端 Agent 的**目标架构、调用契约与分期规划**，供其他执行者阅读、讨论、按任务 ID 领取实现。

**权威来源**：需求以 [PRODUCT.md](../PRODUCT.md) §7（持续体验/导演一致性）、§8（导演调整）、§10（1:1 时间与离线补算）为准；任务状态**只以** [docs/DEVELOPMENT.md](DEVELOPMENT.md) 为唯一总表；本文只描述架构与契约，不记录状态、不替代任务表。已登记的对应任务：**L-04**（时间锚点/暂停/倍速/跳事件/离线分块摘要）、**W-04**（导演调度）、**L-03**（导演控制角色/主题/冲突/节奏）、**W-02/W-03**（记忆与真实角色回合）、**AUD-03**（outbox 消费者与入口接线）、**M-01..M-03**（媒体）、**G-04/G-05**（共享时钟与相遇）。

---

## 0. 一句话架构

**三层 + 一条流水线**：导演只**提案**，运行时**校验并落库**，执行层**按 outbox 执行**；所有人都读同一份事件历史与记忆库。

```
用户（唯一主角）
   │
   ├─ 导演层（新增；确定性时钟 + 有界决策）
   │    world_clock：1:1 / 倍速 / 暂停 / 跳到下一事件 / 离线补算（有上限）
   │    beat_planner：这一刻该发生什么（每次 ≤1 次模型调用）
   │    agenda/注意力预算：谁在场、谁欠你回应、冷却、每拍 ≤2 个角色发言
   │        ↓ 只输出 BeatProposal（提案）
   ├─ 运行时（已有，保持稳定）
   │    validate → applyEvent → 事务：command 回执 + world_event
   │         + 投影表（消息/约定/便签/事实/素材）+ worlds.state + outbox_jobs
   │        ↓
   ├─ 执行层（缺，Phase 0 必须补）
   │    outbox 消费者 → 任务队列（world / media handler）→ NPC 回合 / 图片
   │        ↓
   └─ 角色层 + 认知层
        NPC 角色 Agent（一次一个角色，只说自己的人设的话）
        记忆服务（提取/合并/纠正/遗忘/来源/作用域/按预算检索）
```

**角色边界（不可越）**：AI 只提出变更；状态由运行时校验后写入；角色只接收经裁剪的可见事实；私人访谈永不进入世界。

---

## 1. Agent 名册：6 个模型 Agent + 2 个引擎

> "引擎"是不调模型、必须确定性与可重放的组件。把引擎误做成 Agent 是本项目最容易犯的错。

### 1.1 个人向导 Agent（访谈）

| 项 | 内容 |
|---|---|
| 职责 | 陪你聊天，理解经历、兴趣、愿望、重要选择；问下一个问题 |
| 不做什么 | 不生成分支、不建世界、不写世界事实 |
| 触发 | 你在访谈里说话（SSE 流式） |
| 任务种类 | `interview`（handler：`interviewHandler`） |
| 输入 | 访谈历史 + 现有资料摘要（长度与预算受限） |
| 输出 | 下一个问题 + `facts[]` / `events[]`（结构化 JSON） |
| 模型调用 | 每次用户发言 1 次 |
| 落库 | 抽取结果经确定性过滤（长度/问句/临时性/重复）后写入 `profiles.document`（已自动写入，不再要求反复确认） |
| 失败语义 | 保留用户消息，可重试；不产生"假成功" |
| 现状 | ✅ 已有：`src/modules/profile/infrastructure/interview-planner.ts`（prompt `interview-1.3.0`）、`interview-handler.ts` |

### 1.2 人生探索 Agent（分支）

| 项 | 内容 |
|---|---|
| 职责 | 依据资料生成多个「如果」方向，标明源自哪些经历 |
| 不做什么 | 不预设固定故事池、不建世界 |
| 触发 | 你点"生成分支" |
| 任务种类 | `profile`（handler：`discoveryHandler`） |
| 输出 | 3–5 个分支提案（假设 + 依据 + 大致走向） |
| 模型调用 | 每次生成 1 次（失败可重试，重复 commandId 幂等） |
| 现状 | ✅ 已有：`src/modules/discovery/infrastructure/discovery-planner.ts`、`discovery-handler.ts` |

### 1.3 世界创建 Agent（建世界）

| 项 | 内容 |
|---|---|
| 职责 | 生成身份、人物、关系、开场（开场消息 / 便签 / 日历）与开场素材 |
| 触发 | 你采纳某个分支 |
| 任务种类 | `world-build`（handler：`buildHandler`） |
| 输出 | 世界初始事件 + 开场内容（写入 `world_initial_snapshots`，不可变基线） |
| 模型调用 | 每次 1 次（含一次纠错重试；`AI_TRUNCATED` 可诊断） |
| 现状 | ✅ 已有：`src/modules/world/infrastructure/world-planner.ts`、`build-handler.ts` |

### 1.4 导演 Agent（核心缺口）

| 项 | 内容 |
|---|---|
| 职责 | 决定**这一刻该发生什么**：谁出场、什么事件、什么节奏与冲突；维持总体一致性；不让全体角色每轮都调用模型 |
| 不做什么 | 不直接写状态、不替角色说话、不做无上限调用、不重写历史（改写走分支） |
| 触发 | 时钟推进（恢复时的离线补算、倍速、跳下一事件、用户主动"推进一点"） |
| 任务种类 | `world`（**当前无 handler**，Phase 0 补齐） |
| 输入 | `world_clock` + `world_agenda`（未了结的线与承诺、谁欠你回应）+ 在场角色 agenda + 近期事件摘要 + 记忆检索结果 |
| 输出 | **一个节拍**：`message.received`（≤2 个角色）/ `appointment.proposed` / `belief.recorded` / `media.requested`（图片）——复用现有 effect 词表 |
| 模型调用 | 每拍 **0 或 1 次**（无事可决定时 0 次）；离线补算最多补 N 拍，其余合并成摘要 |
| 幂等 | 每拍有唯一 `commandId`；重复恢复不重复推进（L-04 验收项） |
| 失败语义 | 失败保留世界状态不变；`unknown` 不自动重付 |
| 现状 | ❌ **完全没有**。无时钟、无调度、无 agenda（`state.time` 只在建世界时写入，全仓无推进点） |

### 1.5 NPC 角色 Agent（角色回合）

| 项 | 内容 |
|---|---|
| 职责 | 一次一个角色的一轮：按人设回话；只能记录**自己的印象** |
| 不做什么 | 不替用户行动、不改真实档案、不把印象写成世界事实、不声称是真人 |
| 触发 | 你发消息（直接）；或导演点名（受冷却与注意力预算约束） |
| 任务种类 | 当前走同步链路（`POST /api/v1/worlds/:id/messages` → `resolveTurn`）；Phase 0 后同时支持 `world` 队列执行 |
| 输入 | `actorContext` 裁剪后的可见事实 + 该角色的记忆作用域 |
| 输出 | `message.received`（≤500 字）+ 可选 `belief.recorded` |
| 模型调用 | 每个被点名的角色 1 次 |
| 现状 | ⚠️ 链路已有但**两套实现**：线上 `turn-planner.ts`（唯一被调用）；另有 `interact-turn.ts` + `ai/dialogue-reviewer.ts`（意图路由/草稿/复核）**只有自测在跑**，需归并（Phase 0） |

### 1.6 记忆提炼（作为**服务与契约**，不是第 7 个平级 Agent）

| 项 | 内容 |
|---|---|
| 职责 | 提取、合并去重、冲突取代、纠正、遗忘、来源与作用域校验、按预算检索 |
| 关键判断 | 抽取**不新增模型调用**：挂在已读原文的 Agent 上（访谈/NPC 的结构化输出带 `memories[]`）；只有"片段 → 摘要"这种跨时间合并才用模型，且按需批量（离线补算时顺带） |
| 作用域（已定义） | `profile`（真实侧，永不进世界）/ `branch` / `character` |
| 种类（已定义） | `preference` / `commitment` / `belief` / `summary` / `correction` / `episode` |
| 状态 | `active` / `superseded` / `forgotten` |
| 触发 | 访谈落库后、世界回合落库后、你手动纠正、离线补算 |
| 任务种类 | `memory`（handler 已注册：`memoryHandler`，含 derive/correct/forget） |
| 现状 | ⚠️ 模块完整（契约/领域/仓储/handler/算法），**零触发**：全仓无任何地方入队 `memory`，主流程也未调用；当前唯一路径是访谈直写 `profiles.document` |

### 1.7 引擎 A：世界时钟与调度器（不调模型）

| 项 | 内容 |
|---|---|
| 职责 | 时间推进（1:1/倍速/暂停/跳事件）、离线按经过时长分块补算、每拍发言人数与冷却、在场判定 |
| 为什么不是 Agent | 必须确定性、可重放、可测试、成本可预测 |
| 数据 | `world_clock(world_id, story_now, speed, paused, last_tick_at)`、`world_beats(...)`、`world_agenda(...)`（Phase 1 迁移） |
| 领域纯函数 | `advanceClock`、`planBeats`（有上限、确定性）、`applyBeat` |
| 对应任务 | **L-04**（时间/离线摘要/重复恢复不重复推进）、**G-04**（共享时钟，多人阶段） |
| 现状 | ❌ 不存在（`vercel.json` 无 cron，无 clock 字段） |

### 1.8 引擎 B：运行时校验器 + 执行器

| 项 | 内容 |
|---|---|
| 职责 | 校验提案（角色权限/可见事实/输入长度）、事务落库（回执+事件+投影+快照+outbox）、消费 outbox、执行 `world`/`media` 任务 |
| 现状 | ⚠️ 校验与事务已有（`domain/character-policy.ts`、`postgres-world-repository.ts`）；**outbox 只写不读**、`world`/`media` **无 handler** |
| 对应任务 | **AUD-03**（Phase 0）、**M-01..M-03**（媒体，Phase 3） |

---

## 2. 调用契约（统一规则）

1. **只提案**：任何 Agent 的输出都是事件/效果提案；写入前必须过 `parseProposal` + `validateCharacterEffects` + 领域校验。
2. **统一 effect 词表**：`message.received` / `belief.recorded` / `appointment.proposed` / `fact.established` / `media.requested`（新增能力先扩词表，再让 Agent 用）。
3. **一个 commandId 一次**：重放返回原回执；内容不同则 `IDEMPOTENCY_CONFLICT`。
4. **版本**：世界版本由运行时递增；角色/便签各自有独立版本做乐观并发。
5. **有界成本**：每拍 ≤1 次模型调用；每拍 ≤2 个角色发言；离线补算 ≤N 拍；上下文按预算裁剪（`rankAndBudgetMemories` + `actorContext`）。
6. **失败语义**：可重试的失败如实显示并可重试；`unknown`（上游可能已完成）**永不自动重付**，必须用户决定。
7. **隔离**：`profile` 作用域记忆与真实照片永不进入世界上下文；角色只知道"自己的认知 + 被允许可见的事实"。
8. **不假装**：没有真实状态就不显示（禁止硬编码"在线"、禁止伪造日历提醒、禁止预设故事冒充 AI 成功）。

---

## 3. 分期规划（映射到已登记任务 ID）

### Phase 0 · 执行层（前置，无产品决策依赖）
- outbox 消费者：`queued` → 任务队列（幂等）；失败不吞、unknown 不自动重放。
- 注册 `world`、`media` handler（媒体未接入时**如实失败**，不造假图）。
- 归并 NPC 两套实现（`interact-turn` + `dialogue-reviewer` → 线上 `turn-planner`）。
- **任务**：AUD-03（+ AUD-13 索引已就绪）。
- **验收**：真实库测试——同一条 outbox 只执行一次；失败重试不重复扣费；unknown 不自动重放；媒体未接入时返回明确错误；同步与队列两条角色链路结果一致。

### Phase 1 · 记忆接线（提前，因它是最早暴露的痛点）
- 写入：访谈 Agent / NPC Agent 结构化输出带 `memories[]` → 运行时校验 → 记忆库（不新增模型调用）。
- 纠正/遗忘 API + 合并去重（替换临时关键词近似）+ 检索替换临时裁剪。
- **任务**：W-02（长期记忆与预算）、W-03（真实角色回合）、AUD-05（资料结构化）、AUD-18（文档/计数同步）。
- **验收**：说"这条不对/忘掉"能真正 `superseded`/`forgotten`；重复表述不再产生重复记录；角色上下文只含允许的可见事实（真实库含越权用例）。

### Phase 2 · 时钟 + 导演骨架（楚门感的关键）
- 迁移：`world_clock` / `world_beats` / `world_agenda`。
- 领域纯函数 + `director/run-beat.ts`（复用 `worlds.commit`，自动获得回执/投影/outbox）。
- 接口：`POST /api/v1/worlds/:id/advance`（离线补算带上限）；`GET` 返回真实故事时间。
- **任务**：**W-04**（导演调度）、**L-04**（时间锚点/暂停/倍速/跳事件/离线摘要）、L-03（导演控制面）。
- **验收**：关掉页面 6 小时再回来，按规则补算且**最多补 N 拍**（其余合并摘要）；暂停/倍速/跳事件生效且遇关键选择停下；重复恢复不重复推进；每拍发言人数与冷却可测；无角色发言时如实说明。

### Phase 3 · 媒体与导演深化
- 媒体 Agent（M-01 先做可行性实测 → M-02 适配器 → M-03 素材持久化），由导演/NPC 的 `media.requested` 触发。
- 导演控制面（L-03）：调角色/主题/冲突/节奏；重大改写**先展示影响再建分支**，保留原人生。

### Phase 4 · 多人生与多人（保持"一世界一主角"）
- L-01/L-02/L-05（多人生与面板）、G-04（共享时钟/幂等分发）、G-05（相遇与缺席/退出）。
- 设计前置：clock/beat 从一开始就按"可按世界共享"设计。

---

## 4. 待产品决策（实现前需确认，附推荐默认值）

| 决策 | 推荐默认 | 影响 |
|---|---|---|
| 离线补算上限 | 恢复时最多补 **3** 拍，其余合并摘要 | 成本与"时间流逝感"的平衡（PRODUCT §10 要求不持续调用模型） |
| 每拍发言人数 | 普通拍 **1** 人，关键拍 **2** 人 | 楚门感来自"被围绕"，不是群聊刷屏 |
| 默认时间速度 | **1:1**，可暂停/2×；"下一事件"仅用户主动点 | 避免时间自行乱跑 |
| 导演改写历史的边界 | 历史不可改写，只能建立分支 | 与 §8 一致，保留原人生 |

---

## 5. 当前差距（已核实，供讨论）

| 差距 | 证据 |
|---|---|
| 导演/时钟 0 代码 | `state.time` 无推进点；无 `clock/cron` 字段；`vercel.json` 无定时任务 |
| 执行层缺口 | `worker-composition.ts` 只注册 `interview/profile/world-build/memory`；`world`/`media` 任务种类存在但无 handler |
| outbox 只写不读 | 全仓仅 world 仓储写入 `outbox_jobs`，无消费者 |
| NPC 两套实现 | `resolveInteractTurn` 仅被自测引用 |
| 记忆零触发 | 无 `enqueue(..., 'memory', ...)`，主流程无记忆调用 |
| 生产运行方式 | 无常驻 Worker，靠 `POST /api/v1/tasks/:id/run` 同步执行 |

---

## 6. 其他执行者如何参与（沿用仓库约定）

- 状态一律登记 [docs/DEVELOPMENT.md](DEVELOPMENT.md)：先用主登记目录 `.local/agent-board.lock` 短锁领取任务 ID，写明 Agent ID、工作目录、文件范围，完成写报告并标"待验收"，集成验证后才勾"已完成"。
- 一个任务一个主负责人；**同一文件、同一迁移目标、同一公共契约不同时写**。新增能力先扩 effect 词表/契约，再改 Agent。
- 交付前跑 `npm run verify`（单元 + 真实库），SQL/权限/队列改动必须补真实库集成测试；完成后按常驻要求部署并在公网实测。
- 不要把本文当作状态表；发现架构与任务表不一致时，以任务表为准并更新本文。
