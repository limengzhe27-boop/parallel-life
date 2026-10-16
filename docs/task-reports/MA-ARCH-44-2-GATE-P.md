# MA-ARCH-44-2-GATE-P：真实玩家命令UoW授权

负责人codex-ma44-gate-p（辅助2）；root唯一集成/实际调用入口/部署负责人。复用publication-story-02，基线45e7b1e，公共/已有writer文件只读。只新增world-command-uow.ts、integration/world-command-uow.test.ts和本报告。0072、AgentRuntimeStore、既有API/repository/worker均未改。

## 精确接口与边界

`authorizeWorldCommandInTransaction(sql, ownerId, {worldId, expectedWorldVersion, commandId, kind}): Promise<{engineEpoch,worldVersion}>`

kind固定白名单11项：note_save、invitation_respond、space_travel、scene_enter、scene_input、group_input、group_membership、story_wait、clock_control、world_branch、world_delete。导出PlayerWorldCommandKind类型与只读PLAYER_WORLD_COMMAND_KINDS；运行时同样拒绝其他值、额外字段和非法标识/版本。

该helper只授权真实玩家命令的同SQL事务边界，不执行动作，不保存事件，不创建模型调用/输入receipt，不推断人物态度，也不代替调用者的对象/渠道/来源/幂等及业务语义校验。调用者必须用同一个SqlClient完成自己的实际命令和回执，不可拿返回值去另一事务冒用授权。

处理顺序：验证形状；核有效数据库role是pl_app成员且非pl_worker、当前app.user_id等于ownerId；拒绝已处于NPC commit marker的混合事务；world→control按序FOR UPDATE；核owner与expectedWorldVersion；读取当前真实epoch（无control为1）；只SET LOCAL app.agent_world_id与app.agent_engine_epoch；前后pg_current_xact_id一致才返回。不会设置app.agent_commit_attempt_id，不伪造AgentAttempt，也不把unknown/NPC/导演旧路径包装成玩家命令。

epoch1不初始化控制面、不更改world版本或时间。epoch2及以上仅使本事务中的真实玩家能力通过已有最终world写围栏。旧NPC/planner writer不接此入口，继续受epoch围栏拒绝。有效Worker租约不是玩家权限，pl_worker即使设置app.user_id/task_id也拒绝。Worker桥0073仍待root单独契约，不在本项私定。

## 验证

独立合成本地PostgreSQL18.4，55566启动前确认无人监听；已应用0072保持原校验和。真实PG11/11通过：

- 白名单全部类别取得同一真实epoch，不创建attempt/input/result。
- epoch1兼容且无隐式控制行/版本更新。
- epoch2同SQL真实写入成功；注入失败整体回滚；授权不泄漏到下一个事务的旧writer。
- 同owner另一world也不能借用授权。
- 跨owner、伪造事务owner和stale版本拒绝。
- NPC/director/未知kind/非法形状拒绝。
- Worker无法把task或app.user_id变成玩家身份。
- 已有NPC commit事务不能改走玩家入口。
- autocommit不能把每条语句的本地设置带到后续写入。
- world/control锁与epoch切换序列化，切换后新命令读取新epoch。

typecheck及模块边界516通过。按root要求没有重复fullcheck/build；没有启动浏览器、模型、生产操作或新迁移。冻结后停止本地PG。用户界面未改，不以这些数据库测试宣称实际玩家全能力/所有渠道已接好或已上线。

## 接续

root将此helper接入既有真实玩家能力的原事务，保留各自回执/来源与版本验证；禁止传入模型产生的kind、禁止在模型网络请求期间持锁。生产世界何时切换epoch2由完整入口迁移与验收决定，本项没有激活生产world，也不提供新旧NPC fallback。
