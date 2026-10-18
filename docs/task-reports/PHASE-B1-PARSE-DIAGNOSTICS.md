# PHASE-B1 · 模型输出失败可诊断（字段路径）

执行者 dsh-main-20260923；分支 `phase-a`，基线 `origin/main c7fbb4b46` 之上（实际 `66f64cf9`）。

## 问题
`parseAgentProposal` 失败时只给出四个粗粒度原因：`RESPONSE_LIMIT` / `RESPONSE_JSON` / `RESPONSE_WIRE_SHAPE` / `RESPONSE_SHAPE`。
因此"NPC 演绎失败"在库里只能看到 `invalid_output`，**无法知道到底哪个字段不合规**——这正是 44-150/151 反复出现的排查困难。

## 改动
- `agent-proposal-parser.ts` 新增 `describeShapeIssues(issues, limit=3)`：把 zod 校验失败转成 `actors.0.goal=Required|reply.text=Expected string`；
- `RESPONSE_SHAPE` 原因改为携带该详情（前缀不变，兼容既有 `/RESPONSE_SHAPE/` 断言）；
- 最多 3 条、只含字段路径与校验消息，**不写入模型原文**，避免隐私与体积问题。

## 验证
- `typecheck` 通过；`check:boundaries` 626 文件通过；`build` 通过；
- 新增 `tests/agent-proposal-shape-detail.test.ts` 3/3；既有 `npc-model-protocol` 与 `agent-episode-decisions` 共 14 项通过。

## 下一步（B2）
- 对常见偏差做确定性归一化（缺字段、重复执行包、类型错），并保留原因码；
- 有界重试（≤N，不进付费循环），重放幂等。
