# MEM-04 角色上下文编译与隔离

状态：[x] 已完成。负责人：codex-main-01a0c73b。工作目录：主登记目录。

## 已完成

- `src/modules/memory/application/compile-context.ts`：实现基于权限过滤、分支隔离、角色隔离和 24k 字符预算收敛的统一角色上下文编译器。
- `src/modules/world/application/actor-context.ts` 与 `ports.ts`：升级 `actorContext`，支持传入 `memoryRecords` 与 `blockedSources`。
- 遵循多道隔离边界：
  1. 公开事实可见，其他角色的私密事实严格不可见。
  2. 私聊严格隔离：角色只接收自己与用户的对话，绝不泄露与其他角色的私密对话。
  3. 分支隔离：其他分支的记忆不渗入当前分支。
  4. 预算收敛：上下文与输入严格限制在 `ACTOR_CONTEXT_LIMIT` (18,000) 与 `ACTOR_INPUT_LIMIT` (24,000) 字符内。

## 验证证据

- `tests/memory-system-comprehensive.test.ts` 测试 4 与测试 8 通过。
- `tests/world.test.ts` 中涉及角色上下文的全部测试通过。
- `npm run check` 134 个源文件架构边界、类型与 81 项测试全绿。
