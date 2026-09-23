# MEM-02 数据库与持久化

状态：[x] 已完成。负责人：codex-main-01a0c73b。工作目录：主登记目录。

## 已完成

- `0009_memory_records.sql` 增加现实档案、分支、角色三种作用域形状约束；profile/branch 作用域校验 owner，角色记忆必须带所属分支。
- 增加 `memory_candidates` 持久表，候选资料保持 `suggested / confirmed / rejected` 状态，来源作用域按 owner 校验。
- `0010_memory_source_refs.sql` 增加 `(memory_id, owner_id)` 复合来源约束，并校验已知访谈消息、世界消息和世界事件的来源 owner。
- `0011_interview_question_state.sql` 增加访谈作用域、版本、来源消息和回答消息外键；单个访谈同时最多一个 open 问题，并补 worker RLS。
- `0012_memory_command_receipts.sql` 增加候选确认、问题跳过/拒绝的 owner-scoped 幂等回执。
- `0013_memory_candidate_sources.sql` 增加候选来源触发器：访谈候选的每个来源必须属于同一 owner、同一 interview 且为 user 消息；分支候选必须属于同一 world。
- `0014_memory_candidate_event_date.sql` 保留事件候选的明确日期，避免事件暂存时丢失可写回信息。
- `0015_interview_question_blocks.sql` 增加访谈主题屏蔽表、owner/worker RLS 和主题屏蔽命令回执类型。
- `0016_branch_candidate_commands.sql` 扩展命令回执类型，支持分支写回第一道确认的幂等重放。
- 迁移审计补充了复合外键创建顺序、角色消息归属触发器、JSON 来源数组元素校验，以及“新候选只能从 suggested 开始”的 Repository 门禁。
- `MemoryRepository`、`MemoryCandidateRepository`、`InterviewQuestionRepository`，所有读写经过 `PostgresDatabase.transaction` 和 owner RLS；候选确认和问题关闭使用条件更新，支持版本冲突恢复。

## 验证证据

- `npm run check:boundaries`：134 个文件全部通过。
- `npm run typecheck`：0 错误。
- `npm run test:db`：14/14 项真实 PostgreSQL 集成测试全部通过，包括 `memory persistence enforces scope, provenance, candidates, questions and owner isolation` 和 `interview chain persists user message before generation, recovers, and preserves concurrent profile edits`。
- 东京 Supabase 数据库上 0001–0016 迁移验证成功，25 张表与 RLS 权限全部可用，`pl_app` 和 `pl_worker` 角色均已接入。
