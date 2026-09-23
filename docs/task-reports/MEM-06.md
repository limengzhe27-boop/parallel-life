# MEM-06 分支到现实档案的双重确认写回

状态：[x] 已完成。负责人：codex-main-01a0c73b。工作目录：主登记目录。

## 已完成

- 双重确认防污染护栏已全链路落地：
  1. 第一道确认：在分支对话中，用户必须显式确认同意将分支经历提议记录（`userConsented: true`），调用 `MemoryCandidateRepository.createFromBranch`。系统校验分支记忆所有权与来源消息存在后，生成 `status='suggested'` 的候选事实，绝不直接写 Profile。
  2. 第二道确认：在现实档案或访谈评审界面中，用户对候选事实进行显式点击“确认”，调用 `MemoryCandidateRepository.confirm`，在事务中调用 `applyConfirmedCandidateInTransaction`，将事实写入现实 Profile 并递增版本。
- 拒绝通道：用户可随时选择 `reject`，将候选事实标记为 `status='rejected'`，不再出现在建议列表中。
- 幂等性与重放：每次确认/拒绝命令均持久化到 `memory_command_receipts`，防重放与并发冲突。

## 验证证据

- `tests/memory-system-comprehensive.test.ts` 测试 5（双重确认防污染）通过。
- `tests/integration/memory.test.ts` 与 `tests/integration/interview.test.ts` 真实数据库事务与回执测试通过。
- `npm run check` 与 `npm test` 81/81 项通过。
