# WRITER-LIBRARY-28-M · 地点场景图私有引用

## 身份与范围

- Agent：`/root/history_media_storage`；独立工作树 `codex/writer-library28-scene-media`，基线 `138f3043`。
- 任务：编导可为地点选择已核验的私有图片；试演与正式玩家只看到自己世界当前已知地点的图片，未公开地点与其他作品素材不可读。
- 文件范围：新增 `0065_publication_scene_image_refs.sql`、场景图纯 URL helper 与读取仓储；窄改 genesis 的旧媒体阻断、私有媒体玩家读取 fallback、试演空间代理及专项测试。
- 独占测试数据库：独立工作树本地 PostgreSQL `127.0.0.1:55568`；无真实模型、无图片生成、无生产数据修改。

## 当前接续

- 已实现：0065 对发布版本及世界绑定的场景图同作品 READY 图片约束；玩家只能读取绑定原稿中且已出现在本人真实地图内的地点图片。新素材复用已上线的 `publication-media` 私有上传，不使用外链或作品图片注册表。
- 地图返回值调用 `readPublicationSceneImages(sql, worldId, visiblePlaceIds)` 后，在同一 owner-scoped transaction 内将 Map 中的 URL 投影到 `places[].sceneImageUrl`。这一步由拥有 `space-repository.ts` 的集成人/导演完成。
- 试演代理转换只接受本试演世界的精确 `/api/v1/worlds/:worldId/media/:assetId`，不转换外部 URL。
- 公共 `places[].sceneImage` 作者契约、默认值和 `WorldSpaceSchema.places.sceneImageUrl` 由集成人串行处理；本工作树不另立公共契约。

## 验证

- 隔离 PostgreSQL 实际应用迁移 0065：通过。
- `tests/integration/publication-scene-images.test.ts`：通过，覆盖 READY/待确认、跨作品、跨玩家、未关联图片、地图尚未显示的地点和绑定阻断。
- `tests/publication-genesis.test.ts` 与 `tests/publication-scene-images.test.ts`：39 项通过；未引用的旧场景媒体行不再阻断编译，实际引用旧 `sceneMediaKey` 仍诚实阻断；新私有引用可编译而不会把素材 ID 或外链塞入世界初始地图。
- `npm run typecheck`、`npm run check:boundaries`、`npm run build`：本独立工作树均通过；集成人仍需在完整共享契约合并后复核。

## 集成注意

1. 生产应用迁移顺序 `0063 → 0064 → 0065`；不能先部署调用新函数的业务代码。
2. 玩家素材读取先沿用 0063 的聊天及朋友圈授权，只有未命中时再由独立场景图函数判断；隐藏朋友圈图片不会因该 fallback 获得权限。
3. 地点照片只在实际世界地图已有的 place key 上投影；仅原稿提及、不在玩家地图中的地点不会提前显示图片。
4. 首个公开发布及私有试演应在公网完成图片显示和他人世界不可读验收，随后由集成人更新主任务表。

## 过程记录

- 接入集成人冻结的场景图契约后，初次构建发现专项测试直接访问了可选地图属性且误把投影 URL 当成持久字段；修正断言为检查私有素材不进入创世世界快照，再次构建通过。
