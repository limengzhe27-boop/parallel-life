# NOTES-WORLD-03 · 跨现场近期事项与长期追求（世界事项）

2026-10-11，执行人/集成人 codex-notesworld03-i-01a11a84-20261011。
基于主干基线 75c2a07，使用独立工作树 `.local/worktrees/notes-world-03`。

## 需求与设计实现

本任务实现世界事项与追求（World Matters & Quests）：
1. **跨现场事项模型**：
   - 跨场景与跨现场的近期事项（`near_term`）与较长追求（`pursuit`）。
   - 事项状态机支持 `not_started`、`in_progress`、`blocked`、`completed`、`abandoned`、`superseded`。
   - 状态流转规则：前置事项（`prerequisites`）未达成前禁止进入进行中或完成；终态（`completed`/`abandoned`/`superseded`）不可回退，完成不能移动门槛。
   - 奖励领取限制：只有已完成的事项可领取奖励，且严格防止重复领取。
2. **客观事实与主观陈述隔离（真实性边界）**：
   - 区分 `player_statement`（玩家自述）、`world_verified`（世界核实）与 `actor_statement`（角色陈述）。
   - 服务端校验来源与证据：玩家自述汇报（`user_report`）绝不允许冒充为 `world_verified` 客观世界事实。
   - 只有真实世界事件（`world_event`）驱动并核实的事项状态变更才被标记为 `world_verified`。
3. **安全与多事项关联**：
   - 不修改玩家私人 `notes`。
   - 不伪装旧 choice 列表为完整引擎；多项追求和事项按处境自然并存，相互关联而非强制互斥冲突。
   - 私密/隐藏事项（`visibility === 'hidden'`）严禁投影给玩家前端。
4. **投影与终端展现**：
   - 活跃近期事项投影至 `PlayerRecords.current`。
   - 活跃长期追求投影至 `PlayerRecords.about`。
   - 已达成/已放弃/已作废事项归档至 `PlayerRecords.history`。
   - 手机端“系统备忘”界面支持展示“世界核实”标签及地点地图跳转联动。

## 变更文件范围

- `src/contracts/world-matters.ts`：事项 Zod 契约与严格校验（跨边界输入输出验证）。
- `src/contracts/world-records.ts`：扩充 `PlayerRecord` 契约支持 `world_matter`、`world_verified`、`map` 导航及 `span`。
- `src/modules/world/domain/matters.ts`：纯领域事项状态机、流转规则、奖励领取规则（零外部与契约依赖）。
- `src/modules/world/domain/types.ts`：扩展 `WorldState`（`matters`）及 `matter.created`/`matter.updated` 效果。
- `src/modules/world/domain/validation.ts`：领域验证器，校验事项来源、证据、时效及属性合法性。
- `src/modules/world/domain/reducer.ts`：领域 Reducer，原子应用事项创建与状态迁移。
- `src/modules/world/domain/player-records.ts`：投影逻辑，将可见事项安全分类映射至玩家记录。
- `src/modules/world/infrastructure/player-records-repository.ts`：基础设施透传领域事项至投影。
- `src/features/phone/apps/notes-records.tsx`：便签应用 UI 支持世界核实归属与地图地点跳转。
- `tests/world-matters.test.ts`：纯领域单元测试（7/7 通过）。
- `tests/integration/world-matters.test.ts`：真实 PostgreSQL 集成测试（3/3 通过，原子提交、状态迁移、重放幂等、隔离与投影）。
- `tests/integration/notes-world-01.test.ts`：消除硬编码过去时间导致的时间投影边界偶发报错。

## 验证证据

1. **架构边界检查 (`npm run check:boundaries`)**：
   - 315 files passed，0 illegal boundary errors。
2. **静态类型检查 (`npm run typecheck`)**：
   - 0 errors。
3. **单元测试 (`npm test`)**：
   - 667/667 通过。
4. **真实数据库集成测试 (`npm run test:db`)**：
   - 209/209 通过，5 明确跳过（可选付费真实模型）。
5. **生产构建 (`npm run build`)**：
   - Next.js 16.3.5 生产构建顺利通过，所有路由（静态/动态）生成正确。
