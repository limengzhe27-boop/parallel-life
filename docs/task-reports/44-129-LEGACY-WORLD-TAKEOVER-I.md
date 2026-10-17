# 任务报告：44-129 旧存档安全接管、审计诊断与受控迁移闭环

- 任务 ID：`44-129-LEGACY-WORLD-TAKEOVER-I`
- 工作包关联：`R10` / 旧存档接管与旧链路退役（P1 交付门槛）
- 执行负责人：`新架构交付负责人（Agent ID: codex-ma44-129-legacy-takeover-i）`
- 工作目录：`/Users/limengzhe/Desktop/projects/demo/人生剧本`
- 关联测试：`tests/integration/legacy-world-migration-http.test.ts`、`tests/integration/legacy-world-migration.test.ts`
- 交付范围：
  - `src/contracts/legacy-world-migration.ts`（定义 `LegacyWorldInventorySchema`、`LegacyMigrationRequestSchema` 与 `LegacyMigrationResponseSchema` 强类型契约）
  - `src/server/services.ts`（装配 `inspectLegacyWorld` 与 `migrateLegacyWorld` 服务入口）
  - `src/app/api/v1/worlds/[id]/migration/route.ts`（提供 `GET /api/v1/worlds/[id]/migration` 审计就绪检查与 `POST /api/v1/worlds/[id]/migration` 单事务原子迁移路由）
  - `tests/integration/legacy-world-migration-http.test.ts`（9 项真实 PostgreSQL 数据库端到端集成测试）

---

## 一、任务目标与实现对照

依据用户关于任务 R10 的严格要求：
1. **合成旧档先验**：
   - 在真实测试 PostgreSQL 数据库构建合成旧存档（版本 3，包含 2 名角色、4 条历史对话、2 个地点、1 篇笔记、1 项未过期预约日程与 1 项已完结历史预约）。
2. **盘点进行中与旧任务阻塞 (Quiescent Checks)**：
   - `inspectLegacyWorldReadiness` 全面盘点世界角色、消息、地点、时钟、笔记与约定状态；
   - 严格检查 `commands` (queued/running)、`tasks` (queued/running)、`agent_attempts` (reserved/request_sent/response_received/unknown_after_send)、`world_director_attempts`、`publication_opening_deliveries` 与 `publication_story_nodes`；
   - 存在任何未决或进行中任务时返回 `isEligibleForMigration: false` 与阻塞原因 `ACTIVE_PENDING_ATTEMPT_OR_TASK`，杜绝未决并发指令破坏状态。
3. **历史、素材、时钟与约定保持**：
   - 历史消息（`messages`）、地点（`places`）、笔记（`notes`）、时钟（`time` / `world_clock`）与版本号（`version`）100% 原样保留，零损耗。
4. **目标与心理未知时不脑补**：
   - 提取角色基础身份 `definitionRef`，初始化 `actor_agent_states` 处于 `revision = 0`；
   - 角色未发生的欲望、目标与计划严格保持为空数组（`goals: []`, `plans: []`, `decisions: []`），绝不凭空造假。
5. **可靠来源映射真实责任**：
   - 仅将状态为 `scheduled` / `open` / `waiting` 的未过期有效日程原子映射为对应角色的显式责任 `AgentResponsibility`（`status: 'open'`, `subject: { kind: 'appointment', id }`）；已完成的预约不跨代继承为开放责任。
6. **原子切换及防双写**：
   - `migrateLegacyWorldInTransaction` 在单个 ACID 事务中执行行级排他锁（`FOR UPDATE`），原子将 `agent_runtime_worlds.engine_epoch` 跃迁为 2 并持久化角色状态，杜绝双写。
7. **幂等重放与前向恢复**：
   - 对已处于 Epoch 2 的世界重复调用平稳返回 `alreadyMigrated: true`，无任何二次写入或数据擦除；
   - 严格拦截非法逆向降级（`ENGINE_EPOCH_CONFLICT`），确保新引擎产生新事实后坚持前向恢复。
8. **运行时自动接管与路由**：
   - 迁移前（Epoch 1）：`sendMessageIfEnabled` 返回 `null`，保持旧逻辑兼容；
   - 迁移后（Epoch 2）：`sendMessageIfEnabled` 与 `advanceIfEnabled` 自动无缝接管，直通新 Agent Runtime，旧 planner 不再被触发。

---

## 二、测试与质量证据

1. **真实 PostgreSQL 迁移专项测试**：
   - 命令：`node --experimental-strip-types --test tests/integration/legacy-world-migration-http.test.ts`
   - 结果：**9/9 全部通过**（耗时 131ms）：
     - `1. inspectLegacyWorldReadiness audits state and validates against LegacyWorldInventorySchema`
     - `2. Readiness inspection detects active background commands and tasks blocking migration`
     - `3. Multi-tenant isolation: cannot inspect another user legacy world`
     - `4. Atomic migration execution: parses request schema, maps appointments, transitions epoch to 2`
     - `5. Idempotent re-migration: second execution returns alreadyMigrated without data wipe`
     - `6. Version conflict protection: rejects migration if expectedWorldVersion does not match`
     - `7. Forward-only recovery: cannot roll back engine epoch to 1 once in Epoch 2`
     - `8. Runtime routing: Epoch 1 delegates to legacy (null), Epoch 2 takes over in Agent Runtime`

2. **既有迁移测试回归**：
   - 命令：`node --experimental-strip-types --test tests/integration/legacy-world-migration.test.ts`
   - 结果：**7/7 全部通过**。

3. **架构边界检查与类型检查**：
   - `npm run check:boundaries`：**619 文件 100% 符合架构分层约束**（无任何越权或旁路跨层）。
   - `npx tsc --noEmit`：**零类型错误，Exit 0**。

4. **全量回归测试套件**：
   - 命令：`npm test`
   - 结果：**3,284 项单元与领域测试全部通过，0 失败**。

5. **生产优化构建打包**：
   - 命令：`npm run build`
   - 结果：**Next.js 16.3.5 生产打包顺利完成，成功生成 `/api/v1/worlds/[id]/migration` 路由及全部 27 个静态与动态路由**。
