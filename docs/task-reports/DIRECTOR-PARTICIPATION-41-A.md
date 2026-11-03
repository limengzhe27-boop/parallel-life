# 41-A 导演认证人物参与回执读取

- 基线 98c89d7a，分支 codex/director-participation41，独立工作树 current-work39；执行 current-work41-a，root 唯一集成。
- 独占修改：director-snapshot-repository.ts、新 tests/integration/director-participation41.test.ts；不修改模型协议、共享helper、运行时提交或持久JSON。

## 根因与接线

人物普通提交已移除 document.episodeParticipations，导演仍读取 document，导致正常聊天之后遗漏人物先前 quiet/decline/need_information 及理由。本次在导演原 REPEATABLE READ READ ONLY 事务内，完成原人物身份/版本检查后调用现有 readActorEpisodeParticipations，并覆盖读取对象的 episodeParticipations；不信任旧JSON副本，也不写回。

认证仍由已有 request→receipt→committed attempt→world event→succeeded command 链承担。reason/choice/sourceIds 必须与事件中的 episodeDecision 一致。参与被消费不等于活动发生或完成。

同一事务逐人物读取，不在单个 PoolClient 上 Promise.all。当前 helper 是单人物接口，本次没有复制批量SQL或另建状态源；增加每个角色一次认证查询，未来如测量需要批量应在共享 helper 一处实现，NPC及导演复用。

## 集成依赖（root改动，不包含在本提交）

1. episode-lifecycle-repository.ts：readActorEpisodeParticipations JOIN agent_runtime_worlds 当前 world/owner/engine_epoch，排除旧epoch。
2. director-runtime-repository.ts：current() 对新版snapshot同样从认证回执读投影再比较；否则第一次claim就因 [] 与旧无字段不等报 DIRECTOR_ACTOR_STATE_CONFLICT。旧受保护snapshot保留原比较形状，由root处理。

本轮复制上述两处root WIP仅运行测试，冻结时从本工作树还原，未提交。合并须同时包含root这两处，不能单独宣称已修完整链路。

## 必要验证

独立 PostgreSQL 55641 / parallel_life_test；合成世界、受控模型，0真实模型，0用户/生产数据改动。

聚焦旅程 4/4（含父项），boundaries 766通过，typecheck通过：
- 实际导演claim/commit→两人物quiet/decline参与→人物普通聊天commit：导演前后choice/reason/sourceIds/version一致，人物JSON没有参与副本。
- 给测试人物JSON插入伪engage不混入导演；同一带认证参与的导演快照可正常claim。
- need_information真实提交后导演可见；实际switch至epoch3后同helper不返回epoch2回执，历史回执仍在。
- 修改测试receipt.reason但不改真实事件，读投影拒绝EPISODE_LIFECYCLE_SOURCE_CONFLICT。
- 其他owner不能读取世界。

限制：epoch3完整导演读取还受旧narrative admission限制，会报INVALID_NARRATIVE_BASIS，所以epoch隔离在实际switch后验证同认证helper，不冒充epoch3完整叙事已迁移。未重跑全量check/build；根任务集成负责。未启动/重启用户3218/3219及worker，未部署，未原档真实演绎验收。
