# ARCHITECTURE-SIMPLIFY-37-R1：未 claim 唤醒恢复

基线 d46a9076；执行 wake-recovery39；root 唯一集成。独立工作树 state-prune37，分支 codex/wake-recovery39。

## 根因与删除

原 advance 查询已接收但无 attempt 的旧 wake receipt，并通过 orphanedWakeCandidateIds 永久跳过同一 candidate。这个状态只证明“尚未 claim”，不能证明已经消费。

删除该纯函数及其证明错误行为的测试。新的窄仓储读取 readUnclaimedWakeInTransaction 复用**原 receipt、command、inputHash、原文**，不新增数据库字段、表、伪造 attempt 或第二套 successor 协议。

原 claim 已支持 receipt.expectedWorldVersion <= current attempt expectedWorldVersion，并拥有 worlds 行锁、command 唯一键、actor 活跃唯一键。恢复重新读取当前 snapshot，claim 当前 frame；receipt 历史基线不变。已有 cancelled_before_send 的 successor 保持不变。

## 资格与并发

只有当前调度重新选中的合法 candidate 可调用 helper。helper 锁 worlds，核对 current version/epoch，确认原 receipt 没有任何 attempt，验证 actor/channel/origin/candidate。原 actionId/source/basisSourceIds 必须与当前候选一致；原 basis 和 nudge 来源必须仍在本人的可见来源内。来源或行动变化不得强行改写原 receipt。

helper 不是执行授权。离开事务后若世界继续变化，原 claim 仍重新验证；同 command 双 claim 只有一个 replay=false。旧进程用旧版本 claim 被拒；同版本竞争获得 replay=true。sent/unknown/response_received 有 attempt，不能通过此 helper 重买。

## root 必须接线（公共文件未改）

`src/server/npc-agent-advance-services.ts`：

1. 删除 `orphanedWakeCandidateIds` import、370 附近整个 staleWakeCandidateIds SQL/纯函数块、return 中该字段，以及844附近永久过滤条件。
2. import `readUnclaimedWakeInTransaction` from `../modules/world/infrastructure/agent-orphan-wake-recovery.ts`。
3. 普通 wake（非 initialization、非 agendaReview）原 `attempts.accept` 前，执行：

```ts
const unclaimed = !initialization && !agendaReview && !existing
  ? await db.transaction(ownerId, sql => readUnclaimedWakeInTransaction(sql, ownerId, {
      worldId, actorId: candidate.actorId, commandId,
      candidateId: candidate.id, worldVersion: world.version, engineEpoch,
      candidateSource: candidate.source,
      candidateSourceIds: candidate.sourceIds,
      actionId: candidate.actionId,
      visibleSourceIds: authorized.sources.map(source => source.id),
    }))
  : null;
const receipt = unclaimed ?? (await attempts.accept(ownerId, /* 原 input */)).receipt;
```

4. snapshot 读取原 receipt + 当前 world/actor；attempt.expectedWorldVersion/actorRevision 用当前 frame（现有代码已如此）。保持原 prior lookup/runNpcAgent。
5. helper 返回 null 可表示“已 claim”；竞争时继续原 lookup/replay。不可把 null 解释为确定未发送。若在读 prior 后发生 claim，原 accept 可能 COMMAND_CONFLICT：应定向 lookup 原 command 回到已有 attempt 恢复路径，不新建 command。现有普通 attempt replay 使用当前 accept body 时也存在此历史冲突，root统一处理。
6. helper INPUT_SCOPE_FORBIDDEN 表示原候选依据已变，不能换command重买或强行回填。当前资格收集器应给出实际变化对应的新候选身份；缺少该行为应记录阻塞，不吞掉。

## 实测

独立本地 PostgreSQL 18.4，127.0.0.1:55684，parallel_life_test。0 真实模型、0 用户库写、0 用户运行进程改动。

`node --experimental-strip-types --test tests/agent-wake-recovery.test.ts tests/integration/agent-orphan-wake39.test.ts`：5/5。

PG 原 store.accept → world.saveNote 无关版本变化 → 两次 helper 读取原 receipt → 双 store.claim：一条 attempt，仅一次 replay=false。旧进程在 claim 前 VERSION_CONFLICT、claim后 COMMAND_CONFLICT。当前 snapshot 成功 markRequestSentWithSources，再标 unknown；helper 均不再返回，重复 claim replay=true。原 receipt 文档完整不变。人物/来源/action/basis变化被拒。

尚未完成：root advance 公共接线及该原入口旅程；用户原渣男体验主动演绎验收；全量门禁和本地构建更新。该测试证明恢复/并发原仓储协议，不代表人物自然主动推进已跑通。

边界检查通过：766 files。独立分支 typecheck 唯一错误为公共 advance 仍 import 已删除 orphanedWakeCandidateIds；root 应与上述接线一起集成，不能单独发布本提交。
