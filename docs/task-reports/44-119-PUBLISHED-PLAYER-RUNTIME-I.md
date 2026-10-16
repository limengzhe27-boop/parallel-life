# 44-119-PUBLISHED-PLAYER-RUNTIME-I 交付与发布准备报告

## 一、发布事实核实与边界澄清（纠正过度结论）

在此前阶段的报告中，部分描述出现了“全部解决/线上运行正常”等过度推断。本轮经生产只读核查，纠正为如下严格事实：

| 维度 | 当前真实状态 | 事实依据与证据 |
| :--- | :--- | :--- |
| **代码部署** | 已部署至生产（READY） | 生产域名 `parallel-life-nu.vercel.app` 对应 Deployment `dpl_FRzLYgy5LmDwJ1NdCcXrWzUGkFwV`（源码 commit `8b0bfb96dbd0811eef449ba326b4859a56247c1b` / `413ee9e2`），包含 113—118、NPC-AVATAR-UNIFY-03B、BRANCH-CATEGORY-01 及 NPC-PROFILE-02 全部代码变更。 |
| **数据库迁移** | **生产仅应用至 0086**（86/86）<br>**0087 尚未在生产执行** | 生产数据库 `public.pl_migrations` 只读核实记录共 86 条，最新为 `0086_publication_agent_trials.sql`。0087（角色初始位置与 version 0 允许 NULL source_event_id）及本轮 0088 仅在本地开发/测试数据库已迁移。 |
| **真实模型表现** | **未做生产实测**（旧额度已闭账） | 本轮严格遵守“0付费调用”纪律，未调用生产模型接口；所有自动化集成测试均基于本地纯净编译器与结构校验。真实模型验收方案已编排完毕，等待主 Agent 获得新授权后实测。 |
| **正式玩家档状态** | **当前所有正式玩家档均为旧引擎（epoch 1）** | 生产中所有 `kind = 'published_work'` 的绑定记录其 `engine_epoch` 均为 1。仅有 2 个处于暂停状态的私有测试档记录为 epoch 2。旧玩家世界从未被自动升级或篡改。 |

---

## 二、正式玩家真实调用链与接点审查

追踪真实链路：
`编剧保存 → 发布版本 → 公开目录 → 玩家选择体验 → 独立世界实例化 → 微信开场 → 人物聊天 → 导演推进`

### 1. 详细调用链路
1. **编剧保存与审核**：编剧在编辑台完成剧本并发布版本，`parallel_life.publication_versions` 保存不可变快照，包含 `protagonist`、`world`、`actors`、`phone`（历史聊天与开场来信）、`space`（地点与路线）、`history`（事实与知情）。
2. **公开目录**：玩家通过 `GET /api/v1/publications` 浏览公开作品卡片，包含作品标题、简介、版本、封面。
3. **玩家选择体验**：玩家点击卡片，前端生成幂等 `commandId`，发起 `POST /api/v1/publications/[id]/start`。
4. **独立世界实例化**：
   - 依赖服务端开关 `AGENT_RUNTIME_PUBLISHED_ENABLED`：
     - 若为 `false`（默认），调用 `parallel_life.publication_admit_published`，实例进入 epoch 1（旧引擎，纯兼容保留）；
     - 若为 `true`，调用 `parallel_life.publication_admit_agent_published`，在单个事务内原子完成世界提交与 Agent Runtime 初始化（`actor_agent_states`、`agent_runtime_worlds` 设置为 2、`agent_narrative_admissions` 准入）。
5. **微信开场**：前端加载 `/worlds/[worldId]`，世界时间根据剧本 `startAt` 对齐，微信聊天列表呈现作者编写的联系人与初始消息（`sourceEventId = publication-genesis:[worldId]`），历史聊天与开场新消息严格区分。
6. **人物聊天**：玩家在私聊发送消息时调用 `POST /api/v1/worlds/[id]/messages`。
   - 若 `engine_epoch === 2`，由 `npcAgents.sendMessageIfEnabled` 处理；基于真实 `actor_agent_states`、世界权威位置、记忆与剧本事件推进，生成确切的事件回执与增量事件版本；
   - 失败时返回结构化 `NpcMessageError`，绝不混跑或静默回退旧引擎。
7. **导演推进**：
   - 前端定时请求 `/api/v1/worlds/[id]/story/progress`，新架构下由 `readNpcAgentStoryProgressIfEnabled` 读取真实 `agent_narrative_admissions` 与 `director_narrative_wakes`，不依赖旧版 author-progress 表。

### 2. 关键属性核对
- **完整内容保留**：人物设定、公开介绍、历史聊天、朋友圈、媒体引用、事件、地点及初始权威位置在纯编译器编译后均写入 `worlds`、`world_builds` 及 `world_authoritative_positions`。
- **玩家独立性**：每个玩家独立持有一个 `world_id`，其 `actor_agent_states`、`world_clock`、`agent_attempts` 和记忆库互不干扰。
- **失败恢复**：前端 `publication-controller.tsx` 在 5xx 时保留 `commandId`，幂等重试直接复用服务端 receipt，不会产生重复扣费或半成品世界。

---

## 三、受控启用机制（最小实现）

已补齐的 0088 迁移与最小代码实现：
1. **数据库迁移 `db/migrations/0088_published_agent_worlds.sql`**：
   - 调整 `parallel_life.publication_admit_internal`：移除此前仅允许 `k = 'trial'` 拥有 epoch 2 的限制，使 `published_work` 也能准入 `runtime_epoch = 2`；
   - 新增 `parallel_life.publication_admit_agent_published(w uuid, v bigint, c uuid)`，授予 `pl_app` 执行权；
   - 新增 `parallel_life.publication_agent_world_source(w text)`，提供给 `pl_app` 校验本用户属下的 epoch 2 实例（包括试演和正式世界）；
   - 保持所有 internal 函数的权限收紧，`pl_worker` 及 `PUBLIC` 无权限。
2. **原子化引导 `bootstrapPublicationAgentWorldInTransaction`**：
   - 位于 `src/modules/world/infrastructure/publication-agent-trial-bootstrap.ts`；
   - 在 `PublicationWorldRepository.startPublished` 的同一数据库事务中执行。一旦任何角色 Agent 状态初始化或转换失败，整笔事务全部回滚，数据库不留半成品存档。
3. **受控环境变量开关**：
   - 在 `src/server/publisher-world-http.ts` 中读取 `process.env.AGENT_RUNTIME_PUBLISHED_ENABLED === 'true'`；
   - 代码默认未配置或为 `false`，生产保持旧架构不变；由主 Agent / 集成人统一部署或在环境变量中开启。
4. **幂等与回退保证**：
   - 幂等重放：同一 `commandId` 再次请求时命中 `publication_world_receipts`，返回 `replayed: true`，不重复初始化；
   - 历史存档隔离：已存在的世界再次请求时命中 `publication_world_bindings`，返回 `resumed: true`，保留原有 `engine_epoch`，绝不修改已有世界的历史、时间与状态；
   - 熔断停用：若将 `AGENT_RUNTIME_PUBLISHED_ENABLED` 切换回 `false`，仅阻止**新玩家实例**使用新引擎，**已创建的新引擎实例**保持在 epoch 2 运行，绝不会发生强行降级混跑。

---

## 四、时间与主动推进规则遵守

正式入口接入新架构后，严格遵守以下时间与交互准则：
- **时间速率**：手机浏览为 12 倍速（`phoneTimeMode = 'browsing'`），进入聊天或现场为 1 倍速（`'conversation'`）。
- **空闲检查**：75 秒（`PHONE_IDLE_CHECK_MS`）空闲检查为轻量评估机会，绝非强制调用大模型。
- **离开暂停**：离开前台时时钟自动暂停，不产生无玩家参与的虚假时空漂移。
- **交互边界**：
  - 同一请求不重复催问；
  - 角色未承诺不视为违约；
  - 玩家暂缓、明确拒绝、转移话题分别对应不同的事件感知与计划响应（由 113—118 架构支撑）。

---

## 五、真实模型端到端验收方案（待主 Agent 授权后执行）

### 1. 验收环境前置条件
- [ ] 生产或预发数据库已应用迁移 `0087` 与 `0088`。
- [ ] 环境变量设置 `AGENT_RUNTIME_PUBLISHED_ENABLED=true`。
- [ ] 模型 API 账户配额已就绪，具备真实的文本与图像调用凭据。

### 2. 连续操作步骤与检查矩阵

| 步骤 | 操作入口 | 玩家输入 / 行为 | 期望前端可见结果 | 必须满足的后台只读证据 |
| :---: | :--- | :--- | :--- | :--- |
| **Step 1** | 公开作品目录 `/publications` | 选择作品点击“开始体验” | 正常进入微信开场界面，展示历史消息与开场首条来信。无报错提示。 | `publication_world_bindings.engine_epoch = 2`；`actor_agent_states` 记录齐全（revision=0）；`world_authoritative_positions` 玩家在 startPlaceKey。 |
| **Step 2** | 微信私聊（首位 NPC） | 针对开场来信中的事件，提出实质合作或约定：“今天下午在图书馆见，把资料给我。” | NPC 以自己的角色身份回复，给出实质承诺并表示会去。 | `parallel_life.world_events` 产生新版本；`actor_agent_states.document` 中的 plans / commitments 包含约定时间与地点。 |
| **Step 3** | 微信私聊（第二轮交互） | 针对 NPC 的提议回复暂缓：“我手头还有事，等我消息再定。” | NPC 回应理解，表示等待玩家进一步通知，不强制催促。 | 事件记录为暂缓态度；角色计划处于 defer 状态，不产生失约惩罚。 |
| **Step 4** | 切换不同会话与浏览 | 切换至朋友圈与地图，浏览其他人物 | 时间以 12 倍速前进，75s 后触发空闲检查；无突兀弹窗。 | `world_clock.story_now` 推进；无报错日志，无额外模型浪费调用。 |
| **Step 5** | 地图与现场入口 | 移动至现场地点与 NPC 碰面 | 到达现场后 NPC 触发现场交互开场，结合此前聊天承诺推进。 | `world_authoritative_positions` 玩家位置更新为现场；`agent_episode_manifests` 记录到达唤醒。 |
| **Step 6** | 异常与重试测试 | 弱网断开重试或刷新页面 | 聊天历史与当前状态完整保留，无重复发送，不丢失未决承诺。 | 相同 `command_id` 的请求命中 receipt 缓存，返回 `replayed: true`。 |
| **Step 7** | 第二玩家隔离测试 | 另一个账号（玩家 B）进入相同剧本 | 玩家 B 从第一天开场重新开始，完全看不到玩家 A 的任何互动与承诺。 | 不同的 `world_id`；独立的 `actor_agent_states`。 |

---

## 六、工程验证结果

本轮在独立工作树 `/Users/limengzhe/.codex/worktrees/published-player-runtime119-i/人生剧本` 完成了聚焦验证：
- **边界检查**：`npm run check:boundaries` 检查通过（609 files）。
- **静态类型**：`npx tsc --noEmit` 零类型错误。
- **数据库集成测试**：
  - `tests/integration/published-player-runtime.test.ts`：8/8 全部通过（验证开关、原子性、幂等重放、旧档隔离、双玩家独立、权限矩阵）。
  - `tests/integration/publication-worlds.test.ts`：29/29 全部通过（验证全套发布世界、契约与权限）。
  - `tests/integration/publication-agent-trial-bootstrap.test.ts`：9/9 全部通过（验证试演引导兼容性）。
- **代码格式**：本次变更文件均通过 Prettier 格式化规范。

---

## 七、三类清单（交付交接状态）

### 1. 已完成并可集成清单
- [x] `db/migrations/0088_published_agent_worlds.sql`：放开 `published_work` 准入 epoch 2，新增 app 专用的 `publication_admit_agent_published` 与 `publication_agent_world_source`。
- [x] `src/modules/world/infrastructure/publication-agent-trial-bootstrap.ts`：新增事务内原子引导函数 `bootstrapPublicationAgentWorldInTransaction`。
- [x] `src/modules/settings/infrastructure/publication-world-repository.ts`：`startPublished` 支持 `options.agentRuntime`，事务内原子准入、提交与 Agent 引导。
- [x] `src/server/publisher-world-http.ts`：`publishedStartRoute` 接入 `AGENT_RUNTIME_PUBLISHED_ENABLED` 环境变量开关。
- [x] `tests/integration/publication-worlds.test.ts`：权限矩阵测试对齐 0088 新增函数。
- [x] `tests/integration/published-player-runtime.test.ts`：8 项专项集成测试。

### 2. 待集成清单（交由主 Agent 执行）
- [ ] 将集成分支 `codex/published-player-runtime119-i` 合并至主目录。
- [ ] 申请短锁并更新 `docs/DEVELOPMENT.md` 中 `44-119-PUBLISHED-PLAYER-RUNTIME-I` 状态为已完成。

### 3. 待上线与验证清单
- [ ] **生产数据库迁移**：按顺序在生产执行 `0087_actor_initial_positions.sql` 与 `0088_published_agent_worlds.sql`。
- [ ] **代码部署**：合并后推送到生产并等待 Vercel 部署 READY。
- [ ] **开关评估**：在生产环境变量中设置 `AGENT_RUNTIME_PUBLISHED_ENABLED=true`（主 Agent 统筹决策）。
- [ ] **真实模型验证**：主 Agent 获取模型调用预算后，按照第五节验收方案执行全流程黑盒测试。
