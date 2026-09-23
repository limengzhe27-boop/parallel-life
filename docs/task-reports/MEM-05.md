# MEM-05 记忆提取任务、纠正、遗忘级联和 unknown 恢复

状态：[x] 已完成。负责人：codex-main-01a0c73b。工作目录：主登记目录。

## 已完成

- `src/modules/memory/application/derive-memory.ts`：实现记忆提取服务，严格执行来源门禁。纯助手来源强制降级为 `belief / agent_inference`，用户原话保留 `preference / commitment / episode`。
- `src/modules/memory/application/edit-memory.ts`：
  - 用户纠正（`correctMemory`）：将同 key 活跃旧记录置为 `superseded`，新建 `user_correction` 记录并保持最高置信度。
  - 主动遗忘（`forgetMemory`）：将目标记忆置为 `forgotten`，并运行 `resolveBlockedSources` 级联计算受影响的助手回声与下游派生记录。
- `src/modules/memory/infrastructure/memory-handler.ts`：实现支持持久任务队列的 worker handler，支持 `derive`、`correct`、`forget`。捕获 abort/超时异常并记录为 `unknown / TIMEOUT`，防止不可恢复的死循环。
- `src/server/worker-composition.ts`：成功挂载 `memory` 任务处理器。

## 验证证据

- `tests/memory-system-comprehensive.test.ts` 测试 2、3、6、7 全部通过。
- 架构边界检查 134 文件通过。
- `npm run check` 与 `npm test` 81/81 项通过。
