# WRITER-LIBRARY-28-P 地点编辑收拢

## 交付

- 后台地点编辑改为逐条地点名称和选填场景图；图片可添加、替换或取消引用。旧场所说明仍可在默认收起的区域查看或编辑。
- 从编剧界面移除路线、方向、耗时和“开场知道”表单；读取或编辑地点时保留原稿已有的 `routes`、`description`、`knownAtStart`、旧 `sceneMediaKey` 与 `media`，不自动造路线或场景说明。
- 新上传图只写入该地点的私有来源 `sceneImage.assetId`，不伪装成预设 publication-art。替换或取消图片时仅清理该地点的引用，旧媒体行仍保留。新增地点默认可见，场所说明留空。
- 上传仅接受 JPG、PNG、WebP，前端限 10 MB；已有服务端上传协议和所属作品校验由集成人接入。异步返回时核对 `workId`，避免切换作品后串图。

## 集成接口

`PublisherSpaceEditor` 新增 `workId?: string`、`uploadSceneImage?: (file: File) => Promise<{ assetId: string; kind: 'image' | 'video'; label?: string; url?: string }>` 和 `previewSceneImage?: (assetId: string) => string`。集成人在 workbench 提供已有的作品上传与私有预览 URL，并完成共享内容契约、编译、玩家读取和数据库校验；本任务没有修改这些公共文件。

## 验证

- `node --experimental-strip-types --test tests/publisher-place-image.test.ts tests/publisher-space-editor-ui.test.ts`：通过。
- `npm run build`：通过。
- `npm run check`：边界检查和类型检查通过；2403/2407 单测通过。另 4 个现有数据库依赖用例因本地测试库 `127.0.0.1:55479` 未启动而 `ECONNREFUSED`，没有修改相关模块。
- 独立组件使用浏览器检查 1024px 桌面和 390px 手机宽度，地点名称、图片操作和折叠说明无横向溢出。

## 待集成验收

需由集成人接通 workbench 保存、作品私有图访问、试演/发布的场景图片读取并在正式后台复验。未完成这些公共链路前，不能称玩家已能看到新上传场景图。
