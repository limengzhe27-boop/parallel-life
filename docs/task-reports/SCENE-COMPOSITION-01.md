# SCENE-COMPOSITION-01 · 已确认在场人物与地点的统一场景画面

2026-10-26；scene-composition-20261026；独立 `.local/worktrees/scene-composition` / `codex/scene-composition`；基线606927b4；root唯一集成。本批只本地，不部署，不占3218/3219，不写用户原档、不调用付费模型。

## 已接通

1. epoch2原确定性 `scene.opened` 的 environment 增加一个可选 `renderRequest`，没有新增表、列或事件种类。只在实际位置证明中确有NPC、人数不超过6且每个人都有合法绑定参考时，登记一次产品呈现请求。没有NPC或没有可靠素材时继续原地点图，文字与现场开场不受影响。
2. 请求id由原event/scene/实际人物稳定计算；纯重放验证任务、地点、人物和原请求内容，旧event没有该字段仍可重放。原scene.opened同事务保存原world_media_requests与原outbox，不冒充人物action、用户输入或新的世界事实。
3. 原场景task执行接口在响应之后用Next after调用原runCommittedChatMedia。新执行完成与已succeeded的原请求重放均可接续已有Outbox；不重演开场，不在GET读取时购买，不自动重买unknown。
4. 原媒体worker从已保存source event/command/scene定位实际在场区间，只取这些人物的授权参考及地点参考。已离场/重入/结束的来源在付费前拒绝。参考图片服务端组合为一张contact sheet，供同一次图生图统一人物/地点/光线/视角，输出9:16；contact sheet不会作为场景成品展示。原地点名称及虚拟当地时间同时进入构图依据。
5. SceneRepository只读投影已完成scene媒体为现有media_reference entries。校验原场景进入event/command、媒体来源event/command/原render或原scene-channel media action、实际ready生成asset和approved delivery。当前presence区间与源时不一致则不投为当前图，刷新不会生成工作。
6. 私有作品素材store组装抽到server/publication-media-store.ts。原publisher-media-http重导出兼容；worker不再引入整包HTTP/services，并修正本地作品地点/人物图片读盘路径，云图仍走原签名读取。

## 验证

- 独立真实PostgreSQL55682，原scene environment与新旅程共18/18。
- 新旅程：两名有独立历史位置的NPC→真实epoch2进入与开场→pending render/outbox→原dispatch→原media task lease→受控provider一次→原worker保存ready→scene read media_reference→原albumPhotos→worldAppData运行图URL→scenePhotoUrl→AssetRepository.readForWorld字节读取。匿名其他owner不可读，离场/重入旧图被过滤，重复读取不新增请求/购买。
- 原media pipeline与local store相关13/13；新contact-sheet规则单元1/1；原media handler真实DB单元3/3。类型检查通过，boundaries744通过；生产build通过。
- 首轮全量check因独立PG的dev数据库尚未迁移，旧media-pipeline-handler测试报缺表且清理未关闭pool而挂起；停止本人进程，迁移本人dev后该文件3/3，最终全量check重新运行。未放宽断言。
- 以上受控provider不证明真实图生图画面质量。最终真实provider与手机/PC页面由root集成后验收。

## root真实图验收最小替换

复制 `tests/integration/scene-composition-render.test.ts` 为忽略脚本/fixture，保持真实DB、原开场、outbox、lease、worker和scene/album读链路。仅将两份合成颜色参考替换为项目已有虚构人物实际图片，并将pipeline的providerAdapter换为YibuMediaProviderAdapter。sceneReferenceReader继续由原sourceSceneComposition核验人物，再读取其已授权参考，调用composeSceneReference；有真实地点图时传place，没有时必须传source.placeName/storyAt，不能硬塞参考图里的餐厅作为已发生地点。输出可用PrivateDiskStore保留并查看，不能以memory map当成产品持久化成功。

预期商业调用：1次图片，0次文字；计数可包裹submitImage。unknown不得重发，恢复原outbox不得重新购买。真实provider原始返回未收到时保留未知，不能通过再跑整个test暗中购买第二次。

## 明确未覆盖

- 历史scene.opened已经保存且没有renderRequest时，不改写旧event、不重演开场。本批不会自动为全部旧现场补图。现有合法NPC现场media action仍可走同一组合/呈现链路。
- 初次打开后NPC新到场/离场的后续新构图资格尚未另接：旧图会因区间变化撤出当前背景，但不能靠刷新反复付费。后续应由真实presence变化驱动有记录的呈现重评命令，复用同一媒体队列；不能伪造NPC行动或无记录插任务。
- 最大6个可识别参考人物；超过不丢人、不偷偷截取，跳过自动渲染。没有合法参考不付费购买身份不可靠的替代图。
- 只接epoch2原确定性开场自动render；旧epoch1 planner开场未另建一套媒体系统。
- 本批不修改UI。root须消费既有media_reference并在照片ready时做一次只读scene刷新；已有worldVersion不因图片完成增长，不能仅靠版本变化判断新图。
