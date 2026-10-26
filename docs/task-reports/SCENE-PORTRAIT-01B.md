# SCENE-PORTRAIT-01B · 人物现场图授权与读取

2026-10-26；scene-portrait-authorization-20261026；root唯一集成。
基线 b754790c；独立工作树 `.local/worktrees/scene-portrait-authorization`，分支 `codex/scene-portrait-authorization`。

## 实现

1. 新增迁移0117：没有新表/列。作者`actors[].publicCard.stageImage.assetId`通过两份独立trigger在发布版本及trial/published binding建立时核验：UUID、同work、ready、image MIME；不改旧0065地点函数。
2. 新增`publication_actor_stage_images_for_world(world)`与精确单图函数。owner绑定→原pinned draft/publication+hash→原`publication_story_source`验证contacts actorKey/actorId→当前world实际actor。没有stageImage的旧稿直接空返回，不修改旧稿。
3. 可见性：knownAtStart=true，或当前有效scene中玩家与该NPC均有当前world version有效的presence。仅有state actorId不代表已公开；已离场、future joined/过期left不授权隐藏人物。由scene projection与原source权限决定，不通过人物姓名或客户端声称在场。
4. 新只读repo `readPublicationActorImages(sql,worldId,visibleActorIds)` 返回`Map<actorId,authorizedUrl>`；caller传实际presence，仓储再过滤。URL复用原world media route。
5. `PublicationMediaRepository.playerAsset`原历史/朋友圈与地点两级授权保持；仅在都没有结果时调用人物精确授权，不开放全部作品素材。

## 本地真实PG证据

独立端口55671，独立runtime/password/数据库，仅该树`parallel_life_test`应用迁移；未改root本地配置/远程数据库/3218/3219。

`PUBLICATION_ACTOR_STAGE_TEST_PORT=55671 node --experimental-strip-types --test tests/integration/publication-actor-stage-images.test.ts`：1/1通过，包含：
- 同work ready PNG读取；foreign owner/foreign work/pending/video/未引用图片拒绝。
- 只按原actorKey/id映射；repo调用方visibleActorIds过滤，空list不查询。
- 新draft改图不替换既有pinned图；旧pinned资产仍可读，新图不能读。
- 未公开角色即使存在world.state也不可读；当前现场玩家与NPC均在场时可读；有效leftVersion后再拒绝。
- malformed assetId失败；pending/foreign/video来源失败。
- 真正INSERT publication_versions及publication_world_bindings均触发`PUBLICATION_ACTOR_STAGE_IMAGE_NOT_READY`，不是只检查trigger存在。

场景通过原SceneRepository.enterPlace产生；NPCpresence和结束区间由明确SQL夹具构造，用于授权投影验收，**不是模型移动/自主赴约实测**。没有模型调用或生产写。

`npm run typecheck`通过。

## root接线

- 先将0117按原流程应用到目标本地运行库，再启用playerAsset新fallback（否则旧库缺函数）。不改旧迁移。
- SceneRead.actorImages由root统一契约；scene-repository用原owner事务，`scenePresent`实际actor IDs传给helper。
- trial媒体URL代理由root统一，复用原readTrialPublicationMedia路径。
- 本任务没有实现stageImage作者UI、生成、图片透明处理、SceneRead/UI、旧稿升级或任何自动素材补写。
- knownAtStart=false的人物仅当前合法现场presence可读；如果后续要“见过以后离场仍长期解锁形象”，需有明确持久认识/揭示证据再扩展，不能只因world.state含人物而公开。

## 交付边界

无全量check/build/浏览器/真实模型/部署；root整包统一执行。无本地运行端口变动。冻结提交后停止独立PG进程。
