# AUTHORING-14-LOCK · 事务池中的世界活动锁

2026-10-13；author-events-director-14；工作树 author-events-director-14。唯一状态总表是主目录 docs/DEVELOPMENT.md。

## 修复范围

只改 PostgresClockStore.withAdvanceLock。旧代码独立执行 pg_try_advisory_lock 与 pg_advisory_unlock；transaction pool 的 autocommit 查询可能切换物理backend，导致释放另一backend的session锁，留下真实活动锁。

现在明确 BEGIN → pg_try_advisory_xact_lock → await run() → COMMIT，锁连接在事务期间固定backend；不用任何session unlock。未得锁抛冲突并ROLLBACK；回调/COMMIT失败ROLLBACK，保留原错误；ROLLBACK失败仅将本次client.release(true)丢弃，不放回池。finally只release一次。

run内原有仓储事务仍用独立连接，不改变角色、所有权、版本、世界事件或队列保存。锁事务不承载这些业务写入，不宣称全部写入自动回滚。

## 重入与业务边界

- 同世界、另一连接上的嵌套withAdvanceLock会明确冲突；不是可重入锁。setClock仍使用同key的事务锁，与推进互斥，不改此业务。
- 现有调用检查：messages路由withWorldActivityLock回调为原resolveTurn；advanceWorld与advancePublicationStory回调不调用setClock。未发现有意的同名嵌套。未来不能在advance回调内再setClock而隐藏冲突。
- 不尝试终止生产共享backend，不擅改角色或清除用户数据。旧session锁不会被新事务自动“修好”；root负责既有测试世界cleanup及生产验证。

## 验证

新增tests/clock-transaction-lock.test.ts模拟autocommit backend轮换与事务pinning：复现旧session锁释放失败反例；新锁阻断同世界并发、commit后可重取；回调异常rollback释放；commit失败rollback；rollback失败丢连接；同名重入明确冲突、其他世界独立；release仅一次。

该专项加既有world-clock：25/25通过。typecheck及独立树build均完整通过（exit 0）。没有调用模型、生产、PG或占用新端口；真实PG由root集成验证。本提交不包含本树临时公共publication-content修复。
