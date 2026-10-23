# 44-205 advance 读取竞态与 VERSION_CONFLICT

状态：本地代码与回归完成，待部署后观察原档/定时任务。root 唯一集成。

## 根因

`npc-agent-advance-services.ts` 先在事务外读取 `worlds.get()`，再在一个读事务里比较当前 `worlds.version`。玩家私聊或另一人物在这两个读之间提交时，当前版本会大于事务外快照，旧代码直接抛 `VERSION_CONFLICT`，批处理因此中断。

生产记录对应 `world 278 vs 批 268`；这是可安全重读的 stale pre-read，不是已支付结果或真实提交冲突。

## 修复

- 新增内部错误 `ADVANCE_READ_STALE`，只表示“事务外快照过期”。
- `retryAdvanceReadOnce` 只对这个内部错误重读一次；其他 `VERSION_CONFLICT` 原样返回 409。
- 批处理在每个 `advanceOne` step 内重试，不重跑整个 batch；此前已提交的前缀保留。
- 显式导演复查、legacy advance、retry-director 路径同样只重读一次。
- 不吞 paid/unknown，不重买模型，不新增表/字段/迁移。
- 日志 `advance-read-stale-retry` 只记录 `worldId` 与路径，不输出用户内容或密钥。

## 验证

- `tests/agent-advance-batch.test.ts`：stale 只重试一次；连续 stale 第二次失败；真实 `VERSION_CONFLICT` 不重试。
- `tests/agent-schedule-collectors.test.ts`、`tests/npc-agent-model.test.ts` 通过。
- `npm run check` **3992/3992**。
- 无生产写、无真实模型调用、无迁移。

## 尚未完成

- 部署后需确认原档 advance 不再出现 `VERSION_CONFLICT`，并观察一次真实连续推进。
- 若真实提交阶段仍冲突，应保留 409 给客户端重读，不做无限重试或静默重买。
