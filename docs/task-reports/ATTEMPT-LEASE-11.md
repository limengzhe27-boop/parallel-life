# ATTEMPT-LEASE-11：过期未知请求释放人物执行槽

状态：待集成验收。负责人 `/root/empty_scene_runtime`，独立树 `.local/worktrees/attempt-lease11`，基线 `657d6f78`；root唯一集成人，调度过滤和真实存档验收归root。

## 策略审查

可在现有状态机内执行，无需迁移。claim已经先锁世界/人物，先处理同command replay，再校验新输入、权限、人物revision、epoch及新lease。saveResponse已经规定：过期租约或stale状态只保存晚到raw，不赋予提交权。SQL原状态机允许unknown_after_send→stale_discarded。

因此仅在新的合法不同command即将claim时，把同owner/world/actor、unknown_after_send、lease_until<=clock_timestamp、sent_at非空且response/response_hash均SQL NULL的旧attempt改为stale_discarded。没有删除旧请求，没有宣称未计费或模型未发送；只退役已经失效的执行权。

## 实现

`agent-runtime-repository.ts`仅claim中busy检查前新增条件UPDATE（10行）。同command lookup/replay路径在其前，因此重开原请求始终返回原attempt，不创建新attempt或重买。旧sent_at、输入、receipt/hash/token、原lease与基线保持不变；不触碰actor状态/事件/回执/任务。

活跃unknown、response_received、request_sent均保留原保护；新输入校验失败不能触发回收。现有锁串行化晚到raw和新claim，晚到raw原保存路径仍stale且不能commit。

## 真实PG验证

隔离PostgreSQL 55687，受影响新测试 `attempt-expired-lease11.test.ts` 5/5（含父项）：

- player/wake两类未知：到期后同command首先replay仍unknown；新合法command才释放旧槽并reserved。保留全部sent/receipt/hash/token/lease及版本基线。
- 篡改新输入hash先INVALID_INPUT且旧unknown不变。
- 晚到raw仍完整可读、状态stale，原beginCommit拒绝ATTEMPT_STALE；重开旧command返回同旧attempt；新reserved保留。
- 整段attempt只有2个，世界事件0、actor revision0，不伪造新消息或进度。
- live unknown挡同actor、其他actor可正常claim。
- 已过期response_received及request_sent均不回收，仍挡新claim。

typecheck 0、boundaries 767files、Prettier专属测试及diffcheck通过。0模型/原档/用户端口/SQL迁移。root统一check/build，本树不重复全量。

## 风险与接续

- 调度器必须同步排除相同条件的过期未知占用，同时保留原prior和paid source去重；本任务不改collector，交root。
- stale_discarded表示提交权失效，不表示退款/未计费/上游未完成。旧raw可保存作证据，不能作为新请求结果或恢复原执行权。
- 本次不回收request_sent、known response或其他状态。它们需各自已存在的恢复机制，不能顺带放宽。
- 测试是应用角色+真实PG受控状态机，无真实商业模型/用户存档；最终原档自然空间任务由root验收。
