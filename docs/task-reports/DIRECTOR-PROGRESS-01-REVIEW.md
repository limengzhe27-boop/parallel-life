# DIRECTOR-PROGRESS-01-REVIEW

只读审查冻结候选 `9cd3570`，未集成、未部署。对照现有 API 与候选实现；没有调用模型、改业务文件、运行生产写入。

## 需修的实质问题

1. **手动推进绕过拒绝后的节奏限制（阻断）**。`src/app/api/v1/worlds/[id]/advance/route.ts:18-28` 的普通调用传 `automatic=false`。`src/server/services.ts:203-207,233-247` 再传给现场和手机续拍。现场 `src/modules/world/infrastructure/scene-repository.ts:440-446`、手机 `src/modules/settings/infrastructure/publication-story-repository.ts:303-308` 将 false 当 `world_change`；`src/modules/settings/infrastructure/publication-progress-beat-store.ts:125-143` 只为 `idle` 实施间隔。而 `src/modules/settings/domain/story-event-progress.ts:318-324` 在 `participation='declined'`、`refusal='defer'` 时每次返回 `advance_without_player`。玩家刚拒绝后连续点推进，每次都可能立即调度一次 NPC 新发言，甚至 `seek_closure` 若模型不产生 closure 会无限重复。应把普通主动推进视作受间隔约束的 idle；仅已提交的具体世界变化使用 world_change，并给拒绝后/达到段落上限的主动续拍确定的硬上限或非成功收束。
2. **现场空转阻断其他自主剧情（若产品允许现场同时收手机消息，则阻断）**。`src/modules/world/infrastructure/scene-repository.ts:405-510` 对任何仍有效的现场返回 `handled:true`，包括现场无在场角色、无可续目标的末尾。`src/server/services.ts:203-233` 随即返回，不再运行手机出版事件与普通世界调度。玩家留在普通场景时，即使该现场已无内容，其他 NPC 的微信来信和时钟/Agenda 都被抑制，直到退出现场。应确认是否有意暂停整个世界；若否，仅确有现场任务或明确忙状态时拦截，空闲场景让其他调度继续。

## 已核对但不另报阻断的边界

- 自主现场 `scene-repository.ts:401-473` 仅从真实当前现场与在场演员建 task；`scenePlanning:935-1078` 在付费前复核世界版本、当前现场、在场演员和持续目标，并在提交时重检。`scene-planner.ts:698-714` 不造玩家输入，自主提案只有该 NPC 真实对白；保存为 `scene.reaction_recorded`，无玩家行动结果。
- 每位 NPC 的五维设定通过 `publication_actor_life_modules(world, actor)` 分别取；`scene-planner.ts:942-959,1240-1267` 当前调用仅送本人模块与裁剪后的本人 context，没有把全体模块喂给单个角色。SQL 的 lease 限制见迁移 `0064_publication_scene_goal_worker.sql:3-26,65-103,125-147`。
- 手机 `postgres-world-repository.ts:519-618` 的成功 event、projection、command receipt、进度 reconciliation 同一事务。现场 `scene-repository.ts:1359-1369,1532-1585,1778-1796` 亦同一事务；`publication-event-progress-repository.ts:231-314,341-395,475-503` 再核真实来源、逐字 quote、criterion 与 CAS。晚结果经 `scenePlanning:950-958` 的版本栅栏，导航/私有思想例外不当行动。
- `publication-progress-beat-store.ts:171-325` 区分 queued/running/succeeded/failed/unknown；unknown 不自动二次生成，通用 task retry 可显式请求并凭当前 lease 校验。尚未看到越权重试路径。

该审查基于代码推演，未宣称真实模型质量或公网验收。候选仍需 root 集成验证后才可交付。
