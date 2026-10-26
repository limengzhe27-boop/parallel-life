# SETTLED-SCOPE-04 · quiet 交接按事项释放调度容量

负责人 settled-scope-04-20261027 / 子任务 scene_input_experience。独立工作树 `.local/worktrees/settled-scope-04`，分支 `codex/settled-scope-04`，基线 `08a0c2b6`。root 唯一集成；用户要求仅本地，不部署。

## 实际断点

`readSettledUnpresentedHandoffs` 原先以某位参与者 **任意** active goal/plan/responsibility/action、**任意** pending attempt 阻止全体 quiet 交接释放有限的下一作者目录窗口。旧索图、另一事项问题或结果未知调用既没有本事件来源，也可能把该 quiet 交接长期占用。不能通过删除旧目标/清除 unknown 或强制人物开口修复。

## 修改

仅修改原只读 helper：

- 原 proposed/参与人数、同 origin decision/epoch、consumed request、quiet receipt、无呈现消息、committed attempt、source event/version、成功 command/result event、episodeDecision.requestId/choice 的核验全部保留。
- 同一次查询只向内部 helper 投影 id/status/sourceIds/subject、goal/plan/action/responsibility/question 依赖 ID 与结构化条件；没有问题全文、summary、persona 或整份人物 state，最终输出仍是原 episodeId 和 receipt id/version。
- 跟进范围从本 `episode-intent:<requestId>`、原 input receipt source，或明确本 episode/request subject 出发，按已有 goal/plan/action 依赖、responsibility handling、问题责任和结构化 result/player-decision 依赖求闭包。闭包内任何非终态工作仍阻止 quiet proof。终态锚点不会掩盖其仍活动的依赖。
- pending 只阻止本 q input receipt 或原 `agent_episode_attempt_bindings` 认证的本 q attempt；同 actor 不同事项的 unknown 不冒充已完成、也不再阻止另一个 quiet 证明。原每 actor 领取/未知执行栅栏不变。
- 此读取不产生新资格付款，不重评原 q、不删除/结清人物工作，不更新任何业务状态。

## 验证

- NEW `tests/settled-handoff-scope04.test.ts` **3/3**：无关旧索图/问题不相关；本 input/intent 和 episode/request subject 精确匹配；goal-plan-action-responsibility-question 跨终态锚点与循环依赖仍保留活跃跟进，读取不变更状态。
- NEW `tests/integration/settled-handoff-scope04.test.ts` 真实本地 PostgreSQL **3/3（2 子旅程及父汇总）**，复用既有发表合成内容→原导演/人物受控模型→原 kernel 产生两人 quiet/defer 的真实事务闭环，不直接插 quiet receipt：
  - receipt 不齐不能释放；quiet+defer 不释放；全 quiet 无呈现保持 proposed，允许另一未评估目录一次。
  - 合成测试 savepoint 内加入本 q active goal、明确 episode subject responsibility 仍阻止释放；加入无关旧索图 goal 不阻止。
  - 合成测试 savepoint 内构造不同 input 的 unknown attempt 不阻止 quiet proof；同 q input 的 unknown 仍阻止；读取后 unknown status 和人物 document 精确保持。
  - outsider 不可读取、反复读取稳定；后续有限目录走原 kernel 一次后耗尽，不重复原 quiet/paid assessment；0虚构消息。
- `npm run typecheck` 通过；`npm run check:boundaries` 757 files 通过；`git diff --check` 通过。

真实 PG 只写独立合成 fixture 所在 `parallel_life_test`，状态与 unknown 注入均是明确测试 savepoint，并非生产状态转换证明；没有连接/写实际克隆存档，没有模型上游请求。实际原档4953、后台推进/弹窗正向效果由 root 统一真实验收，不能以本测试宣称用户体验已通过。

本任务 0新业务字段/迁移、0真实模型、0原档/端口/部署。未重跑无关全量 check/build，root 最终集成构建。
