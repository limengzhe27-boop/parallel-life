# CHARACTER-HISTORY-MEDIA-24 后端存储与权限

## 交付范围

- 编剧可在作品下申请图片或 MP4 视频的私有直传地址。图片支持 JPEG、PNG、WebP，单个不超过 10,000,000 字节；MP4 单个不超过 50,000,000 字节。首版不接受 MOV、WebM。
- 上传后必须完成核验，服务端从私有存储读取对象元信息及文件头，核对申报大小、MIME 和真实格式，再将素材标为可用。作品最多申请 100 个素材，总申报大小不超过 500,000,000 字节。
- 编剧预览需要该作品查看权限；玩家读取需要拥有对应存档，并且固定的试演草稿或正式发布版本中确实有一条历史聊天引用该素材。读取返回 302，跳转到 60 秒有效的私有签名地址。
- 数据库在正式发布版本写入、试演或玩家存档绑定时核对每条 `phone.messages[*].attachment`：素材必须属于同一作品、格式一致且已完成核验。迁移为新增 `0061`，无需替换既有 `0056` 函数。

## 前端接入协议

1. `POST /api/v1/publisher/works/:workId/media`，正文 `{ "mimeType": "video/mp4", "byteLength": 12345 }`，返回 `201` 与 `{ assetId, kind, mimeType, byteLength, uploadUrl, uploadToken }`。图片的 `mimeType` 为 `image/jpeg`、`image/png` 或 `image/webp`。
2. 将原始文件字节以 `PUT` 发送到 `uploadUrl`，请求头 `Content-Type` 与申请值一致，并加 `x-upsert: false`。令牌已在 URL 中，无需另加令牌请求头。
3. `POST /api/v1/publisher/works/:workId/media/:assetId/finalize`，空正文，成功返回 `{ assetId, kind, mimeType, byteLength }`。完成后才能把 `{ kind, assetId, label? }` 放进历史聊天附件。
4. 编剧查看 `GET /api/v1/publisher/works/:workId/media/:assetId`；玩家查看 `GET /api/v1/worlds/:worldId/media/:assetId`。两者均跳转到短时签名地址；视频播放由存储服务支持 Range 请求。

## 上线前存储配置

集成人应用迁移后，在**本项目独立 Supabase 项目**创建私有 Storage bucket `publication-media`：`public=false`、`fileSizeLimit=50000000`、`allowedMimeTypes=["image/jpeg","image/png","image/webp","video/mp4"]`。同时确认项目全局上传大小上限不小于 50,000,000 字节。生产环境需已有服务端 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`（或 `SUPABASE_SERVICE_ROLE_KEY`），只能作为服务端环境变量。**本工作树未创建生产 bucket，也未操作生产数据。**

## 验证与接续

- 独立本地 PostgreSQL 应用迁移并运行 `tests/integration/publication-history-media.test.ts`：通过。覆盖待核验素材不可引用、跨作品或跨玩家不可读取、未被固定原稿引用的素材不可读取、发布/绑定守卫和 player 角色无法直接读素材表。
- `tests/publication-media.test.ts`：通过。覆盖大小、类型与文件头判断。
- `npm run build`：通过，四条新增 API 路由生成成功。
- `npm run check`：边界检查与类型检查通过；全量并行测试因共用本地测试库出现 `parallel_life.accounts does not exist`，运行约三分钟后中断。此结果不能算全量通过；与本次媒体修改直接相关的单测及隔离端口真实数据库集成测试均已通过，集成人在集成分支应单独重跑适合当前环境的检查。
- 尚需在集成分支完成前端直传接入、生产 bucket 建立、迁移部署和公网体验。当前后端提交本身不能独立上线。
