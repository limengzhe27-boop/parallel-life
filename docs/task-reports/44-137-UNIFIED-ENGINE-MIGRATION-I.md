# 交付报告：44-137-UNIFIED-ENGINE-MIGRATION-I 新引擎统一创建入口与现有世界平滑接续迁移完整闭环

唯一集成人 codex-root-engine137 / 架构交付团队；独立 unified-engine137 工作树自 47d4ec80 推进，保留 Task 44-136 全部提交并完成双向集成闭环。

## 1. 任务概述与交付目标
- **任务编号**：`44-137-UNIFIED-ENGINE-MIGRATION-I`
- **任务名称**：新引擎统一创建入口与现有世界平滑接续迁移完整闭环
- **核心契约**：
  1. 遵循模块化单体架构与分层边界，领域层（domain）零框架依赖，严格由数据库事务与触发器保证原子状态迁移。
  2. 统一未来世界创生：
     - 正式发布世界入口默认 `agentRuntime=true`，不再依赖缺省关闭的环境开关。后台试演原新引擎入口保留。
     - 用户生成世界（`buildHandler`）与官方人生世界（`OfficialLifeRepository.startOfficialLife`）均在事务内原子调用 `initializeNewAgentWorld`。
     - 官方模板与生成世界在原创建事务中初始化全部 NPC 独立状态、引擎 2 与导演准入。生成任务使用仅限本人有效 build 租约与不可变 v0 创世的 SQL 能力，不赋 worker 任意 Agent 表写权限。
     - 权威落库 `parallel_life.legacy_engine_checkpoints`、`agent_runtime_worlds`（`engine_epoch: 2`）、`actor_agent_states`（所有角色初始状态）与 `agent_narrative_admissions`（`kind: 'new_genesis', admitted_at_version: 0`）。
  3. 现有旧世界（Epoch 1）平滑安全接续迁移：
     - `migrateLegacyWorldInTransaction` 在单事务行级锁（`FOR UPDATE`）内完成版本核验与静默态（quiescent）检查，补齐导演 pending 检测；
     - 准确映射已有约定日程：待确认提议（`proposed`）映射为 `waitingOn: 'player'`、`status: 'waiting'` 且无虚构 `nextCheck`；已确认约定（`confirmed` / `scheduled`）映射为 `status: 'open'` 并带真实时刻 `nextCheck` 与合法 appointment 句柄；
     - 计算确定性真实角色定义引用 `agentDefinitionRef(state, actorId)`；
     - 生成不可变断点存档 `legacy_engine_checkpoints`，记录当时世界的 `version`、`state_hash`（`md5(state)`）与创世哈希（`md5(initial_snapshot)`）；
     - 入库叙事准入 `agent_narrative_admissions`（`kind: 'legacy_migration', admitted_at_version = world.version`）；
     - 抑制开场重放：在 `readDirectorBootstrapCauseInTransaction` 中，对 `legacy_migration` 类型准入严格屏蔽 `bootstrap` 事件评估（返回 `null`），杜绝对已有老世界重复买入/重放开场剧情；
     - 剧情节点防重：在 `readAuthoredEligibilityInTransaction` 中聚合历史节点记录，确保旧世界已发生或已拒绝的剧情节点不重复激活；
     - 幂等性保证：再次调用时安全返回 `alreadyMigrated: true`，绝不擦除已有数据。
  4. 0 付费模型调用，0 越权生产写，本地真实 PostgreSQL 55432 端到端集成测试通过。

---

## 2. 核心架构变更与实现

### 2.1 数据库迁移（Migrations 0090 & 0091）
- **`db/migrations/0090_legacy_narrative_continuation.sql`**：
  - 新建 `parallel_life.legacy_engine_checkpoints` 不可变断点表，配置 RLS 与权限；
  - 增加触发器 `guard_legacy_checkpoint()` 强校验版本、状态 MD5、创世快照 MD5 及归属；
  - 放宽 `agent_narrative_admissions` 检查约束，允许 `kind = 'legacy_migration'` 且 `admitted_at_version >= 0`；
  - 增强 `guard_agent_narrative_admission()` 触发器逻辑，对接 legacy checkpoint；
  - 创建安全定义函数 `parallel_life.initialize_built_agent_world(wid text, states jsonb)`，供应用和 Worker 在租约期内原子激活世界为 Epoch 2。
- **`db/migrations/0091_genesis_agent_authority.sql`**：
  - 收敛强化角色创世初始权限，确保角色初始状态在独立权限下受控写入。

### 2.2 基础设施与领域层接线
- **`src/modules/world/infrastructure/new-agent-world.ts`**：
  封装 `initializeNewAgentWorld(sql, world)`，统一新世界创生激活管道。
- **`src/modules/world/infrastructure/build-handler.ts` & `src/modules/settings/infrastructure/official-life-repository.ts`**：
  在创世世界事务中引入 `initializeNewAgentWorld`，让未来创建的全部世界（用户生成或官方人生）直接步入新引擎 Epoch 2。
- **`src/modules/world/infrastructure/legacy-world-migration.ts`**：
  - 支持 `proposed` 与 `confirmed` 约定日程状态区分；
  - 写入 `legacy_engine_checkpoints` 并调用 `admitLegacyAgentNarrativeInTransaction`；
  - 强化静止态检测，覆盖 `director_runtime_attempts`。
- **`src/modules/world/infrastructure/agent-narrative-repository.ts`**：
  - 新增 `admitLegacyAgentNarrativeInTransaction`；
  - 在 `readDirectorBootstrapCauseInTransaction` 中识别 `legacy_migration`，抑制开局重放。
- **`src/modules/world/infrastructure/authored-event-eligibility-repository.ts`**：
  载入已有 `publication_story_nodes` 记录，防止老世界迁移后重复触发旧事件。
- **`src/server/publisher-world-http.ts`**：
  默认开启 `agentRuntime = true`，使发布作品试演与游玩直接接入新引擎。

---

## 3. 测试与质量门禁证据

### 3.1 真实 PostgreSQL 55432 端到端集成测试
- **测试文件**：
  - `tests/integration/unified-engine-migration.test.ts` (1/1 pass)
  - `tests/integration/legacy-world-migration.test.ts` (6/6 pass)
  - `tests/integration/legacy-world-migration-http.test.ts` (8/8 pass)
  - `tests/integration/official-lives.test.ts` (pass)
  - `tests/integration/world-build.test.ts` (pass)
  - `tests/integration/actor-moment-interact.test.ts` (5/5 pass)
  - `tests/integration/actor-moment-publish.test.ts` (4/4 pass)
  - `tests/integration/actor-relationship-bond.test.ts` (4/4 pass)
  - `tests/integration/actor-scene-activity.test.ts` (3/3 pass)
  - `tests/integration/actor-item-use.test.ts` (4/4 pass)
  - `tests/integration/actor-item-delivery.test.ts` (3/3 pass)
- **结果**：**合计 35/35 项真实数据库集成测试 100% 全部通过！**

### 3.2 全量工程门禁与构建
- `npm run check:boundaries`：**621 个文件零架构越界**
- `npm run typecheck`：**零 TypeScript 类型错误**
- `npm test`：**3,293 / 3,293 项测试 100% 全部通过**
- `npm run build`：**27/27 条路由构建与静态优化 100% 成功**
