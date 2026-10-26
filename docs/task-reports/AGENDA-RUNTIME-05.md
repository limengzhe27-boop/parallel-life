# AGENDA-RUNTIME-05 · 原议程旅程夹具接续

负责人 agenda-runtime-05-20261027 / scene_input_experience；独立 `.local/worktrees/agenda-runtime-05` / `codex/agenda-runtime-05`，基线 `c23688f0`。root 唯一集成。本任务只改原 `tests/integration/own-agenda-runtime.test.ts` 及本报告；无生产代码/模型/原档/运行端口改动。

## 修正

1. 原 v12 complete quiet 子例不再断言“1ms fast窗口过后永远null”。在真实非零退避配置下，先验证窗口前没有新候选；等待原权威anchor导出的窗口到期后，新grant必须指向这次已完整提交的anchor，且family不同；重复读取保持同一新command，重放原paid command模型计数仍1。最终仍没有任何被强迫的消息。
2. 运行原PG时发现更早的共享fixture过期：当前调度能在新世界发出认证的 `npc_own_condition_ready`，旧mock只认initialize/review，因此所有7子例都在prime失败。经root追加授权，仅为这个明确grant添加合法quiet模型响应，未知grant仍触发原assert。prime继续要求两个不同人物、恰好两个实际初始模型计算，允许的只能是initialize或这个认证条件grant，不把condition伪称initialize。
3. 旧fixture的 `p.sources` 已从当前模型transport移除；依照实际wire来源目录将4处读取改为 `p.wireCatalog.sources` 的authored `ref`。没有放松production source checks。

未改其他6个子例的计划编译、不同人物unknown隔离、预算race与零发送恢复、protected response免重购、短source恢复和伪造family拒绝等业务断言。没有删除、skip或todo用例，没有旁路初始化器，始终走原advance/grant/runner/kernel。

## 验证

- 独立临时PostgreSQL **55587/parallel_life_test**，与原存档克隆库和3218/3219隔离；全套原文件 **8/8（7子例+父）通过**。完成后关闭此专属PG，不影响root服务。
- `node --conditions=react-server --experimental-strip-types --test tests/integration/own-agenda-runtime.test.ts`，实际日志在该worktree忽略的`.local/agenda-runtime-updated3.log`。
- 0真实上游模型、0用户原档写、0生产配置/迁移、0部署。
- 必要类型与diff检查见最终冻结；root不必为本纯测试修正再次构建运行代码。

最终：typecheck0、diff-check通过；独立55587 PG已停止。所有7个原子例（含更新的quiet窗口例）均通过，父汇总也通过；没有遗留本文件红项。仅测试/报告提交，不影响root正在构建的生产代码。
