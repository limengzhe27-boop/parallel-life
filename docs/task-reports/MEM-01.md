# MEM-01 统一记忆与访谈领域契约

状态：已完成（领域阶段）。负责人：codex-main-01a0c73b。工作目录：主登记目录。

## 1. 范围与交付标准
* 范围：`src/modules/memory/domain/**`、`src/contracts/memory.ts`、清理重复 memory 算法。
* 不修改：数据库迁移、HTTP 路由、World 生产写入口或其他 Agent 正在操作的文件。

## 2. 完成的核心工作
1. **统一公共契约 (`src/contracts/memory.ts`)**：
   - 规范化 `MemoryRecordSchema`（属性统一使用 `scopeType`，对应数据库字段 `scope_type`，支持 `profile | branch | character` 三层作用域）；
   - 规范化 `InterviewQuestionSchema`（包含 `interviewId`、`version`、`target`、`status`：`open | answered | skipped | dismissed`）；
   - 规范化 `MemoryCandidateSchema`（`suggested | confirmed | rejected`）与 `MemorySourceRefSchema`。
2. **纯净领域模型与错误定义 (`src/modules/memory/domain/`)**：
   - `types.ts`：纯 TypeScript 原生类型，无任何第三方库或上层依赖，完全通过 `scripts/check-boundaries.mjs` 模块边界检查；
   - `errors.ts`：领域错误类（`NOT_FOUND`、`FORBIDDEN`、`CONFLICT`、`INVALID_STATE`、`INVALID_COMMAND`）。
3. **记忆算法与状态机实现**：
   - `algorithms.ts`：实现级联遗忘（沿调用链和请求 ID 屏蔽助手回声与派生认知）、来源门禁（全为 assistant 来源强制降级为 `belief`，严禁伪造用户事实）、24,000 字符预算裁剪；
   - `question-state-machine.ts`：实现单问题状态机，确保单一 `open` 互斥；普通跳过只关闭当前问题，只有显式 `blockTarget` 才会屏蔽一个主题，避免把一次跳过误解为永久拒答。
4. **清理重复记忆实现**：
   - 彻底删除 `src/modules/world/domain/memory.ts`，消除冗余 duplicate 逻辑；
   - 更新 `tests/world-interaction-native.test.ts` 统一从 `src/modules/memory/domain/` 引用。

## 3. 验证与测试结果
- **模块边界检查**：`npm run check:boundaries` 通过（124 个文件）。
- **类型检查**：`tsc --noEmit` 0 错误。
- **单元测试**：`npm test` 72 项测试全部通过（包含 `tests/memory-system-comprehensive.test.ts` 与 `tests/world-interaction-native.test.ts`）。
- **生产构建**：`next build --webpack` 成功（13/13 静态页面与 API 编译无异常）。

## 4. 边界说明（诚实交代）
- **当前已验证**：内存纯领域模型、Zod 契约校验、算法与状态机纯逻辑；
- **当前仍为原型**：尚未连接真实 PostgreSQL 数据库（`0009` ~ `0011` 迁移尚未在生产库执行，无物理 Repository）；
- **后续验收边界**：数据库、Repository 和 HTTP 接线由 MEM-02/MEM-03 负责；这些不属于本任务完成条件。

## 5. 下一位 Agent 接续点
- **MEM-02（数据库与持久化，角色 B）**：基于本任务冻结的 `src/contracts/memory.ts` 和迁移草案（`0009_memory_records.sql`、`0010_memory_source_refs.sql`、`0011_interview_question_state.sql`），实现真实 PostgreSQL 仓储与集成测试；
- **MEM-03（访谈问题接线，角色 F）**：接线 `src/modules/profile/infrastructure/interview-*` 与 API；
- **MEM-04（上下文编译器接线，角色 B/F）**：打通 `compile-context.ts` 与已有的 `actor-context.ts`；
- **MEM-05（记忆提取与纠正遗忘，角色 B）**：实现异步任务 Handler 与 unknown 状态恢复。

## 6. 本次验证记录

- 2026-09-23：`npm run check` 通过，模块边界、TypeScript 类型检查和 72 项单元测试均通过。
- 2026-09-23：`npm run build` 通过，Next.js 生产构建完成（13/13 页面生成）。
- 2026-09-23：未执行 `npm run test:db`；MEM-01 不修改数据库，真实 PostgreSQL 验收留给 MEM-02。
