# ACTOR-ARRIVAL-03 · 人物真实到场与既有现场接续

负责人 actor-arrival-03-20261027（/root/arrival_continuity）。独立 `.local/worktrees/actor-arrival-03` / `codex/actor-arrival-03`，基线64535181。主Agent唯一集成和启停3218/3219；本任务0真实模型、0原存档写、0生产写、0部署、0新SQL/字段。

## 实际断点与保留

- `position.establish` 已有完整一次性未知创世位置政策、来源和内核执行，snapshot确实提供能力；不能称能力不存在。六NPC为何尚未选择使用，由root在人物意图/调度验收处理，不手补位置。
- `scene.opened` 仅在首次建立现场时读取人物真实位置。之后 `position.establish` 或 `agent.arrival_committed` 虽更新真实位置，却不把人物加入已经打开的现场；玩家先到会永久看不到后到NPC。
- 原行程原子性、ETA、时钟/赴约保护、位置/权限/幂等保留；本任务只补已确认结果的现场投影与实际观察。

## 实现

1. `agent-scene-arrival.ts` 纯领域规则：真实到达凭据转换为当前位置；共享位置规则只允许已确认at/正版本/有真实来源的人物加入玩家当前active、同地点现场。核验玩家实际at位置、时间与有效presence，不根据地点名称/邀约名单/自称入场。只追加一个真实source/version区间，旧区间保持；同源幂等、既往关闭区间允许真实重返。
2. `agent-scene-presence-repository.ts` 共享UoW helper：原事务内锁定玩家当前现场，必须已有time_place（已开场），核对真实玩家位置，再保存presence。尚未opened时不改变环境任务的初始roster；既有环境任务随后读取真实位置。没有现场、玩家已走/位置未知、不同地点均只保留人物位置，不造场景或NPC。
3. `agent-arrival-continuation.ts` 原行程到达事务调用helper；`npc-agent-kernel.ts` 经root明确授权，仅在成功initialPositions提交后调用同helper。首次虚构位置是从当前时刻确立，不伪造travel、早先到达、赴约完成或玩家承诺。
4. `world-awareness.ts` / `world-awareness-repository.ts` 从确实新建立、来源吻合的scene interval传播当下可见知识：新在场者看到现有参与者；现有NPC看到新在场者。保留occurredAt/learnedAt=真实提交世界时间，sourceKind=direct仅表示当下现场观察，不把初始位置政策变成既往目击。场外人物保持未知，不广播私聊/全地图位置。重放按历史joined/left区间和确切source查，不用当前roster重新猜。

## 验证

- 独立PG55673 / parallel_life_test，原arrival continuation旅程+扩展initial-position共20/20通过。覆盖实际到达→位置+现场+知识原子提交、重复不增；初始位置no_scene/same_place/other_place/player_away/unknown_player；没有生成journey/邀约/人物台词；原权限、暂停/ETA/并发CAS/回滚守卫保留。
- 领域/观察专项61/61通过；typecheck 0。
- `npm run check`4059/4059通过（含边界/类型）；`npm run build`通过；diff-check通过。
- 首次完整check因本独立dev库尚未迁移失败（accounts等关系不存在）；补齐本任务隔离dev库原117迁移后重新完整check通过，未触及共享clone/线上。
- PG中scene/旧player位置为明确合成夹具，不能冒称真实人物自发赴约或用户原档验收。真实NPC选择、后台调度、模型表现、用户原档现场及两端页面，由root最终验证。

## 接线与剩余

根只需集成本提交，无新migration/env/worker/队列。初始位置与真实arrival均已接共享helper，不需再手工接kernel。未修改scene-repository/channel/模型/调度/前端。人物后续入场会使旧构图按原presence签名失效；自动重构图仍属于既有backlog，不在本任务另造请求。
