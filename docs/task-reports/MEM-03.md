# MEM-03 访谈问题接线

状态：[x] 已完成。负责人：codex-main-01a0c73b。工作目录：主登记目录。

## 已完成

- 访谈单问题状态机：`open / answered / skipped / dismissed`。同一时刻最多一个 open 问题；跳过不等于永久封锁。
- 主题屏蔽支持：用户明确屏蔽主题后持久化到 `interview_question_blocks` 表，并在后续 Planner prompt 中排除。
- 候选资料机制：模型提取的 fact / event 只以 `status='suggested'` 写入 `memory_candidates`，不直接写入 Profile。
- 用户确认驱动写回：用户在前端点击确认后，通过 `MemoryCandidateRepository.confirm` 事务写入现实档案，并保持幂等命令回执。
- 前后端 API `/api/v1/interview/questions` 与 `/api/v1/memory/candidates` 完整支持查询、回答、跳过、拒绝与确认。

## 验证证据

- `npm run check:boundaries`：通过。
- `npm run typecheck`：通过。
- `npm test`：81/81 单元测试通过，涵盖单问题状态机、主题屏蔽、候选生成与决策。
- `npm run test:db`：`tests/integration/interview.test.ts` 通过，覆盖了用户消息持久化、模型候选建议、用户确认入库、并发版本冲突处理及主题屏蔽。
