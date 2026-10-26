# SCENE-PORTRAIT-01C 人物现场形象上传与创作协议

2026-10-26；publisher-stage-image-20261026；独立工作树`.local/worktrees/publisher-stage-image`，分支`codex/publisher-stage-image`，基线b754790c；root唯一集成。

## 实现

- 唯一新增可选素材引用：`actors[].publicCard.stageImage: { assetId }`，严格UUID，不增加表/列，不复用或覆盖微信头像。
- `PublicationContent`与公开创作预览保留引用，仅已知人物出现在预览，隐藏人物的形象ID不泄漏；预览不生成访问URL或授予素材读取权限。
- AI整理的stageImage路径设为immutable：已有引用不可被模型覆盖，无引用时模型也不能凭空增加。普通人物编辑原spread保留该字段，已由测试验证。
- 新纯helper负责绑定、解绑与读取，检查人物唯一key和上传的image/UUID，保留原稿、其他人物、头像、私密设定和历史素材。不嵌入base64、外部URL或图片文件名。
- 新小组件`PublisherActorImageEditor`避免继续扩大workbench，人物页默认折叠的“现场形象（选填）”；复用原`uploadWorkMedia`签名上传/finalize。可预览、更换、移除；缺上传client或失败如实提示，不声明生成成功。
- 上传完成以最新draft合并，不覆盖期间的其他编辑；切换作品/人物后或组件卸载后丢弃晚到的绑定结果，不把旧图绑给当前人物。仅解绑引用，不删除仍可能被旧发布使用的素材。

## 文件范围

- src/contracts/published-world-content.ts
- src/modules/settings/domain/publication-content.ts
- src/modules/settings/domain/publication-preparation.ts
- src/features/publisher/publisher-actor-image.ts (NEW)
- src/features/publisher/publisher-actor-image-editor.tsx (NEW，小组件范围已同步root)
- src/features/publisher/publisher-workbench.tsx (仅接线)
- tests/publisher-actor-image.test.ts (NEW)

## 验证

- 新测试4/4：不可变原稿/头像与他人保留、strict UUID与未知人物预览隔离、普通编辑/AI整理保留引用、默认折叠与原私有媒体URL。
- 聚焦回归合计111/111：新测试 + publication-content-audit + publisher-character-canonical-form + publication-authoring-integrity。
- `npm run typecheck` 0错误。
- 未重复check/build；root统一集成运行。0模型、0生产写、0SQL、0部署。

## 集成责任与未完成

- 本批仅允许引用和复用已有上传。没有创作端真实生图HTTP，未新增假生成按钮；root负责预置素材、现场读取和展示，01B负责发布guard/素材授权SQL。
- stageImage的同work/ready/image授权必须由01B迁移核验；本批strict UUID不代替资产权限。
- 手机/PC真实上传、试演读取、发布pinned隔离由root统一验收；本测试不是浏览器验收，也不代表生图能力已接通。
- 没有改publication-genesis、原始世界人物/地点/事件、PhoneContact/WorldPhone、SceneRead、SQL或后台运行，不会把图片绑定当人物已到场。
