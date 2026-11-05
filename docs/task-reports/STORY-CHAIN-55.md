# STORY-CHAIN-55 · Agent 运行时故事计划与开场/阶段门

状态：待验收（本地真实开场/第1幕任务已跑通；新故事包、事件终结与生产未完成）
负责人：dsh-story55-20261105（root 集成）
基线：main `2512cf8d`
工作目录：主目录
日期：2026-11-05

## 1. 目标与边界

把编剧的 18 个人工事件从“全部 eligible、被旧 episode 全部占用”改成：

```text
编剧事件库 → agent 运行时 plan（6 幕，每幕 3 个事件）
→ 开场未呈现时只允许开场
→ 开场呈现后只允许当前幕
→ 真实呈现过的节点才计入 occupied
→ 旧 episode 保留为历史，不删除、不改状态
```

本批不生成第 19 个以后的新故事包，也不把“已呈现”冒充“已完成”。

## 2. 已实现

### 2.1 运行时故事计划

新增迁移：

- `db/migrations/0127_agent_story_plan.sql`
  - `publication_story_plans.runtime_cutover_at`
  - `ensure_agent_story_plan(w,o)`：只对 agent epoch>=2、已有 publication binding 的世界生效
  - 无显式 `timeline` 时，按编剧候选顺序编译为 6 幕，每幕最多 3 个非 editorial 事件
  - 自动选择第一个 director_event 作为 opening（若源稿未提供）
- `db/migrations/0128_repair_agent_story_timeline.sql`
  - 修复 0127 对 JSON null timeline 的处理
  - 仅对 0127 生成的、`timeline` 为 null 的 plan 做一次性文档修复；不碰 episode/receipt
- `db/migrations/0129_agent_story_cutover.sql`
  - 已有世界（除 2fb）的 cutover 回退到 world.created_at，避免升级时把真实玩家历史清空
  - 只对 2fb 执行一次新 run cutover；旧 episode/receipt 保留

### 2.2 开场/阶段门

新增 `src/modules/world/domain/authored-story-gate.ts`：

- `openingPresented=false` → 只允许 opening
- opening 在途但未呈现 → 不允许其他事件
- opening 呈现后 → 只允许当前幕
- 当前幕所有事件呈现/终结后 → 下一幕
- `presented` 节点进入 occupied，不再重复提议
- 终结状态（resolved/withdrawn/declined/skipped/expired）也视为已处理

快照新增可选 `authoredStory`：

- `director-snapshot-repository` 读取 plan + cutover 后的 episode/node 状态
- `director-runtime` 的 `canConsiderAuthoredEvent` 同时受运行计划门与 occupied 约束
- `director-runtime-repository` 增加快照 schema 和提交时重新校验

### 2.3 占用语义

`authored-event-eligibility-repository` 对已有 plan 的世界改为：

```text
occupied =
  cutover 后真实呈现的 authored episode / story node
  ∪ cutover 后终结的 authored episode / story node
```

不再把 `shared_episodes.status=proposed|active` 直接当作“玩家体验过”。

旧快照没有 `authoredStory` 时保留历史兼容，不在提交时用新 cutover 反向判旧付费快照。

### 2.4 旧 episode 隔离

`director-snapshot-repository` 只把 cutover 之后的 authored episode 纳入导演当前事件视图；cutover 之前的 authored episode 保留在数据库/回执/历史里，但不再驱动新故事。非 authored episode 不受此过滤。

## 3. 本地证据

### 3.1 原档 2fb

- 世界：`2fb97a4a-7282-4d75-8a5c-67faf44a3188`
- plan：18 nodes，6 stages，opening=`event_28910809fd5d1f8b`
- cutover：`2026-11-05T06:42:32.372Z`
- cutover 后 authored episode：0
- 导演快照只读：
  - `authoredStory.eligibleNodeKeys = ["event_28910809fd5d1f8b"]`
  - `occupiedAuthoredEventKeys = []`
  - `deliberationWindow.nodeKeys = ["event_28910809fd5d1f8b"]`
  - `episodes` 只剩 30 条非 authored 旧事件，18 个 authored 旧事件不再进入当前导演视图
- 未修改/未删除任何 `shared_episodes`、`agent_episode_receipts`、`agent_episode_requests`。

### 3.2 本地数据库

- `parallel_life_test` 和 `parallel_life_clone_20261026` 已应用 0127/0128。
- 0127 在原档先写入了 null timeline，由 0128 一次性修复为 6 幕；修复不使用 delete/reinsert，不触碰玩家历史。
- 2fb 的旧 73 个 authored episode 仍在库中，只是 cutover 之前不参与占用/当前视图。

### 3.3 测试

- 新增 `tests/director-story-gate.test.ts`：6/6 通过。
- `npm run typecheck` 通过。
- 在只含本批变更的独立 worktree 执行 `npm run check`：**4265/4265 通过，exit 0**；随后在已合入社交动态提交的主目录执行 `npm run check`：**4272/4272 通过，exit 0**。
- 独立 worktree `npm run build`：通过；主目录集成 build：见任务收尾记录。
- 新建空数据库从 0001 迁移到 0129：0127/0128/0129 全部应用成功。
- 真实快照只读请求通过：`PostgresDirectorSnapshotRepository.read` 返回上述 window/occupied。

### 3.4 真实强制复盘尝试

本批尝试对 2fb 执行一次正常 `forceDirectorReview`，未补消息、未改旧 episode：

- 第一次：`DIRECTOR_EPISODE_CONFLICT`。原因是提交校验仍读取全部旧 episode，而快照已按 cutover 过滤；已把提交校验改成同一 cutover 过滤，属本批修复。
- 第二次：进入既有的 `INVALID_OWN_AGENDA_REVIEW_EVIDENCE(reason=committed_source)`，来自旧 committed attempt 的内部一致性校验，与本批 plan/occupy 改动无关；该断点仍阻断真实开场调用。未产生新消息/新计划，也未重买 unknown。

因此本批已证明“导演快照只暴露 opening”，但还没有证明“真实模型会成功接下 opening 并发消息”。

### 3.5 2026-11-05 接续：真实开场与第 1 幕

#### 旧 committed_source 阻断

- 2fb 有 66 条 committed private turn 含 statements，但 `world_messages` 没有对应投影；全库同类共 260 条，分布 14 个世界，最早可追到 2026-10-20。
- 这不是 0127–0129 的 plan/occupy 改动，也不能把“事件已 committed”当作“玩家已收到”。新增 `db/migrations/0130_agent_unprojected_commit_quarantine.sql`：
  - 新建 `agent_runtime_evidence_quarantine`，只记录 `world_id/owner_id/attempt_id/reason/evidence`；
  - 迁移时一次性登记既有投影缺口，不删除、不改写任何 event/receipt/message；
  - own-agenda 读取时只排除被审计登记的 attempt；**新出现的未登记投影缺口仍 fail closed**。
- 隔离后 2fb 六个 actor 的 own-agenda evidence 全部通过；原测试“native speaking event without projection fails closed”仍通过，并新增“audited quarantine excludes ...”回归测试。

#### 强制导演被旧 actor 工作抢占

- `forceDirectorReview` 现在只做导演：跳过 `actor_plan` 复查和 own-agenda review，旧计划仍保留，在后续正常 advance 中执行。
- 导演 wake cause 的 `qualifications` 按 `authoredStory.eligibleNodeKeys` 重建；快照与提交校验使用同一 gate，避免 `DIRECTOR_EVALUATION_CAUSE_CONFLICT`。
- 上下文达到硬上限时，只对 authored story / authored episode task 做有界的旧问题、旧 follow-up、可选观察裁剪；普通对话仍按原契约 fail closed。相关单测 110/110 通过。

#### 真实结果（未手工补消息）

- `worldVersion=1405` 导演决策生成 opening opportunity：
  - `authoredEventKey=event_28910809fd5d1f8b`
  - 六位参与者全部在 opportunity 中
- `worldVersion=1406` 刘胜男实际发消息，`world_messages` 有对应行；opening episode 的六位参与者分别在 1406–1411 产生 receipt（engage/quiet/defer 均有）。
- 快照 1406：
  - `openingPresented=true`
  - `presentedNodeKeys=[opening]`
  - `activeNodeKeys=[opening]`
  - `deliberationWindow.nodeKeys=["node_1","node_2"]`
  - `occupiedAuthoredEventKeys=[opening]`
- `worldVersion=1412` 导演为第 1 幕生成两个 episode：
  - `node_1`（假扮男友）proposed
  - `node_2`（母亲医院/照护追问）active
  - 欣欣实际发消息 `20ecbb72...`；`worldVersion=1413` 舒雅婷实际发消息 `8eb7c9f1...`
- 快照 1412/1413：
  - `currentStageKeys=["runtime_stage_1"]`
  - `activeNodeKeys=[opening,node_1,node_2]`
  - `presentedNodeKeys=[opening,node_2]`
  - `deliberationWindow.nodeKeys=[]`
- 随后发现两个真实缺口：
  - `node_1` 的 episode 仍为 `proposed`，但已产生 `defer` receipt 和实际消息；旧门把 `proposed` 当作在途并排除出 eligible，形成死锁。
  - 门/占用只读 `sourceEventIds`，没有把 `agent_episode_receipts.presented_message_ids` 当作已呈现证据。
- 修复后：
  - `active` 只认 `active`，`proposed` 可被下一次复盘重新考虑；
  - `presented` 同时认 `sourceEventIds` 和真实 receipt 的 `presented_message_ids`；
  - 未投影的新 commit 仍 fail closed。
- `worldVersion=1415` 青青实际发送“假扮情侣”邀约，node_1 进入 presented；快照：
  - `currentStageKeys=["runtime_stage_2"]`
  - `presentedNodeKeys=[opening,node_1,node_2]`
  - `deliberationWindow.nodeKeys=["event_277761b2379f3db6","node_4"]`
- `worldVersion=1416` 第 2 幕 node_4（夜不归宿/青青情绪危机）由李之之实际发消息；快照：
  - `presentedNodeKeys=[opening,node_1,node_2,node_4]`
  - `deliberationWindow.nodeKeys=["event_277761b2379f3db6","node_5"]`

这说明门禁不是“无限开放 18 个事件”：opening 真实呈现后才进入第 1 幕；第 1 幕节点都取得真实呈现后自动进入第 2 幕；第 2 幕 node_4 呈现后，剩余 `event_277.../node_5` 才进入窗口。

#### 检查与运行

- `npm run check`：**4274/4274 通过**。
- `npm run build`：主目录集成构建通过。
- 聚焦真实 PG：`own-agenda-review-evidence` **18/18 通过**（含新增 quarantine 回归）。
- 0130 已应用到 `parallel_life_clone_20261026`、`parallel_life_test`、`parallel_life_dev`；本地 3218 已切到主目录构建，health 200。
- 未推送/未部署生产；未把本地迁移当线上完成。

## 4. 还没有完成

1. **新故事包**：18 个节点全部呈现/终结后，`eligibleNodeKeys=[]`，尚未生成第 19+ 个事件；下一批应新增 `story_pack` 生成/作者追加路径。
2. **真实开场/第 1–2 幕**：opening、第 1 幕 node_1/node_2、第 2 幕 node_4 均已真实呈现；第 2 幕剩余 `event_277.../node_5` 已进入窗口，玩家回复与事件结果尚未验收。
3. **事件终结**：本批仍以“呈现”推进当前幕；非邀请类 `director_event` 的 `resolved` 语义、NPC 拒绝/quiet 后如何不阻塞剧情，仍需按玩家决定/实际结果补齐。
4. **本地运行**：3218 与 worker 均已切主目录构建并 health 200；旧 `.local/build-story55` 不再作为当前入口。
5. **生产**：0127–0130 已应用到生产目标 Neon `neondb`（迁移记录已到 `0130_agent_unprojected_commit_quarantine.sql`），但该库当前 `parallel_life.worlds` 为 0 行，尚不是可验收的线上故事环境。Vercel 应用尚未部署：`vercel whoami` 返回 `Not authorized`，没有可用的 `VERCEL_TOKEN`；同时 `main` 比 `origin/main` ahead 334 个提交，直接 push 会把其他人的社交/实验提交一起部署，不能作为本任务单独发布。生产发布需要先确认目标环境和统一发布范围。

## 5. 最终提交

- 业务/迁移/报告提交：`048bec3c`（开场/隔离/导演）与 `92a13097`（receipt 呈现/第 1–2 幕）。
- 本地地址：`http://localhost:3218`（主目录构建）
- 集成检查：4274/4274，build 通过
- 迁移：0127–0130 本地 clone/test/dev 及生产 Neon 空库已应用；生产应用未部署

## 5. 接续点

先完成一次真实 opening 验收：

```text
2fb → 下一次正常导演复盘 → window 只有 opening
→ NPC opening 任务 → 玩家看到开场
→ 下一拍 window 进入 runtime_stage_1 的其余事件
```

若 opening 没有被选中，优先检查 `evaluationCause` 与 `selectDirectorDeliberationWindow`，不要手工补消息或改旧 episode。
