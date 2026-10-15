# 44-76-NPC-ACTIVITY-PG-D

2026-10-16，codex-ma44-npc-activity76-d，**待根集成验收**。根唯一公共源、SQL82、CI、集成和发布负责人。本树 `/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`，分支 `codex/npc-activity76`，基线 `7ff278abeb65daf392eea22abe2df781cad0c65c`，依赖根 `97ab3b34`（本树等价 `49ff9469`，根无需重复集成）。

本人代码冻结 **`0dfb33174c7788da9039fb81ee414e1b5d73ba78`**，只新增 `tests/integration/npc-agent-delivery.test.ts`。仅另改本人报告、主报告镜像和主表本人行；未修改源、SQL、既有测试、CI 或 UI。

## 实际数据与调用边界

使用专属 PostgreSQL18.4、实际 pl_app/pl_worker 角色、真实 owner RLS 和迁移执行。82 在接入根 97 后才首次应用，未修改已应用校验和。测试读取实际 public.pl_migrations 并逐字比对根最终 SQL82 SHA256：`5897a38865261c6415a813523c6507f9ac42197bae23b5af59b6c0d682231769`。

合成世界由实际 WorldRepository 初始化，Agent state 经实际初始化和 epoch 切换。普通玩家私聊走 `npcAgentServices.sendMessageIfEnabled`、实际 input receipt/attempt/NpcAgentModel/runNpcAgent/PostgresNpcAgentKernel；wake 走 actual npcAgentAdvanceServices 和实际 DirectorSnapshotRepository。wake fixture 只声明有合法起点事实来源的本人起始计划，不伪造已执行结果。群走实际 groups.create/send、worker queue claim/runOne/nativeNpcTaskHandler、TaskRepository.retry/recoverAgentTaskInTransaction；不手改 queued/succeeded 以假装恢复。

所有 TextModel.complete 均是明确的本地测试替身，分别产生正常提案、格式错误或故意 transport unknown；模型调用时断言应用连接池无被持有事务。没有真实模型、生产写入、主原稿、公共源码变动。

## 12 项真实 PostgreSQL 验收（含父测试）

1. SQL82 实际 checksum、owner 读取、worker 拒绝（42501）；恢复后真实 ledger 还验证他人 owner 看不到、pl_app 无 UPDATE（42501）、admin 也被不可变触发器拒绝（23514 IMMUTABLE_AGENT_RECORD）。
2. 普通玩家私聊的真实 claim BEFORE INSERT 中暂停 clock：0 模型，cancelled_before_send，sent_at/response_hash/response/event_id 全 NULL，全部业务对象不变。继续后原 command/input/attempt 和 epoch/V/revision/hash 全保持，token/lease 旋转一次，仅 1 次模型提交；旧 token readResponse 为 ATTEMPT_STALE。已提交后即使暂停，原命令仍只是读同一回执，不再购买。
3. 同一个取消请求并发恢复：首个真实模型挂起期间，再次同 ID 调用为 BUSY，旧 token 不能 request_sent；仅一条 ledger、一个 attempt、一次模型，原请求成功提交。
4. actual own-plan wake 在真实 claim 中暂停：advance 返回 played0，0 NPC 模型、取消且 NULL send/raw。继续后同 wake command/input/attempt 旋 token，一次 NPC 模型执行本人 plan.record；后续 tick 不再购买该 NPC wake。普通全局 Director 安静评估单独计数，不伪称其为 NPC 重买。
5–6. 已付费 unknown_after_send 和 invalid_output：原 claim 仅 replay、不旋 token；原 facade 重试为 UNKNOWN/INVALID_AI_OUTPUT，模型仍各 1 次。真实 SQL 不能抹 sent_at（23514 IMMUTABLE_AGENT_SEND）、不能重置 reserved（AGENT_ZERO_SEND_RECOVERY_REQUIRED）；已有 raw 不能清除（IMMUTABLE_AGENT_RESPONSE），整行证据不变、0 zero-send ledger。
7. 另一角色实际提交改变 worldV，使第一个已付费回复成为 stale_discarded：sent/raw 保留，原命令不可重开，0 recovery ledger，付费各仅一次。不是手写 stale 状态。
8. request_sent 实际 UPDATE 后 scoped SQL 延时跨 active_until：序列证明 UPDATE 已到达，发送事务回滚，0 模型、取消 NULL send/raw；执行 lease 仍在未来两分钟以上。恢复 activity 后原身份仅一次模型提交。
9. 最终 commit 的实际 SQL UPDATE 入口 activity 仍 live，延时到数据库 active_until 之后才返回：中央最终门槛拒绝，状态 response_received，原 sent/raw 保留；world/actor/command/message/result/note/group 业务写入全部回滚。执行 lease 仍大于两分钟，明确不是执行租约失效。恢复 activity 后同原 command、token、attempt、input 和原 raw 免费提交，0 zero-send 旋转。
10. 群任务 claim 后暂停：真实 runOne 将原 task 失败为 INVALID_STATE，NPC attempt 取消且 0 模型；暂停时 retry 被拒绝。继续后 TaskRepository.retry 只把**原 task**入队并留审计，不提前旋 token；重复 retry command 不重复入队/审计。下一实际 worker claim/run 同一 task、同一 native child command/input/attempt，旋 token 后仅一次模型成功，原 task succeeded，总任务始终 1。
11. 群任务在任何 actor attempt 之前暂停：真实 runOne 因 WORLD_PAUSED 失败、0 attempt/0 模型；恢复后 TaskRepository.retry 保留原 task，实际 null-attempt/null-token ledger、同一恢复 command 幂等。真实 worker 再 run 选择原人物并提交，原 input receipt 不替换，child command 由原 task ID 派生，总任务仍 1，不伪造 queued/succeeded。

回滚断言逐行比较 world state/version、world_events、world_messages、actor_agent_states、agent_action_results、commands、world_notes、world_group_messages；attempt/send/raw/ledger 单独核对。activity clock 与实际接受输入是合法的边界变化，不伪装成完全没有记录接受行为。

## 验证结果与资源清理

`node --experimental-strip-types --test tests/integration/npc-agent-delivery.test.ts` **12/12 通过，0 fail/skip**；`NPC_AGENT_DELIVERY_TEST_PORT` 默认55505。`tsc --noEmit` exit0、模块边界567文件通过、专项 Prettier check 和 git diff --check 通过。日志为 ignored `.local/npc76-{test,type,boundary}.log`。

初轮 fixture 使用了不存在的 world_plans 表，相关回滚前置未运行；仅纠正本人新文件为真实 world_notes。最初缩短可控时钟参数未构成最终 SQL 真实到期，未据此声称产品缺陷；最终沿既有72夹具方式，真实 activity.update 后在专属世界设置 active_until，SQL 入口确认 still-live 并睡到实际数据库到期。最终所有边界与模型次数断言保留，公共源码未改。

所有 scoped npc76 触发器、函数、序列均 finally 清理；最终 pg_trigger/pg_proc/sequence catalog 各0。开服前 lsof 确认55505空闲；正常终止本树专属 local-db 父进程后原会话 exit0，55505再次无监听，未触及根55564。

未运行 fullcheck/build、真实模型、生产迁移或部署。根负责 SQL82 生产应用、总检查、部署 READY 与公网验证，本子任务不能代称已上线。无 actual NPC position 的场景不伪造 presence/scene.opened，本文件仅负责私聊、wake 与真实群任务恢复；原生场景的既有专项证据由根另行汇总。69/整体44仍有其他边界，未宣称完整重构完成。
