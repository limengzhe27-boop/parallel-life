# STORY-CHAIN-55 · Agent 运行时故事计划与开场/阶段门

状态：进行中（本地实现，原档只读证据已取得；真实剧情体验与新故事包未完成）
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

## 4. 还没有完成

1. **新故事包**：18 个节点全部呈现/终结后，`eligibleNodeKeys=[]`，尚未生成第 19+ 个事件；下一批应新增 `story_pack` 生成/作者追加路径。
2. **真实开场体验**：导演是否实际选中 opening、NPC 是否真实开场、玩家是否看到、后续幕是否自然推进，尚未用真实模型验收。
3. **事件终结**：本批把“呈现”作为当前幕推进依据；非邀请类 director_event 的 `resolved` 语义仍需后续按玩家决定/结果补齐。
4. **本地运行**：已生成 `.local/build-story55`（BUILD_ID `fs2VMAynOq-sYybo8nVJu`），3218 已切到该构建并健康；worker PID 70702 已从同一构建启动。真实强制复盘仍被上面的旧 `committed_source` 断点阻断。
5. **生产**：0127/0128/0129 尚未应用到生产 Supabase；未推送/未部署 Vercel。不能把本地迁移当线上完成。

## 5. 最终提交

- 业务/迁移/报告提交：`fix(story): gate authored events by runtime plan and actual presentation`（main 最新提交）
- 本地地址：`http://localhost:3218`
- 本地构建：`.local/build-story55` / `fs2VMAynOq-sYybo8nVJu`
- 集成检查：4272/4272，build 通过

## 5. 接续点

先完成一次真实 opening 验收：

```text
2fb → 下一次正常导演复盘 → window 只有 opening
→ NPC opening 任务 → 玩家看到开场
→ 下一拍 window 进入 runtime_stage_1 的其余事件
```

若 opening 没有被选中，优先检查 `evaluationCause` 与 `selectDirectorDeliberationWindow`，不要手工补消息或改旧 episode。
