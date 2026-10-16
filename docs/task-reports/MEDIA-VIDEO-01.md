# 任务完成报告：MEDIA-VIDEO-01 少量关键片段视频验证

## 一、任务目标与设计约束

本任务遵循《人生剧本：图片与视频工具模块开发任务》与 `docs/SCENE_GROUP_RETURN_PLAN.md:108` 约束，完成项目架构内视频生成链路、关键片段验证与端到端呈现联动。

### 核心设计原则
1. **默认不自动生成视频**：普通闲聊、日常对白与常规现场行动绝不自动发起视频生成，绝不占用用户额度或引入不必要时延。
2. **绝不阻塞文字**：角色对话与现场对白即时返回展示；视频进入持久异步生成状态（`generating`），文字阅读体验完全不受阻碍。
3. **绝不提前决定主角行动**：视频仅忠实记录已发生的剧情事件或明确创作意图，绝不代替玩家做出选择或前置改变世界事实。
4. **硬额度与成本控制**：`DEFAULT_MEDIA_BUDGET.maxVideosPerWorld` 设定为 2（每个视频预估成本 \$0.20，720p 6秒动态片段），超额明确拒绝。
5. **真实格式验证与私有存储**：生成输出经 MP4 容器魔数（`ftyp`）二进制校验，持久化至私有 `AssetStore` 并记录 `mime_type: 'video/mp4'`，不依赖临时第三方外链。
6. **双端诚实呈现**：消息流与相册联动展示视频卡片与原生播放器，失败与取消诚实显示，无伪装占位图。

---

## 二、具体改动清单

### 1. 契约层（Contracts）
- `src/contracts/world-interaction.ts`:
  - `TurnModeSchema`: 扩充支持 `'video'` 模式（`['chat', 'image', 'video', 'world']`）。
  - `InteractRequestSchema`: 新增可选 `videoRequest: z.string().max(1500).optional()`。
- `src/contracts/world-build.ts`:
  - `WorldPhoneSchema.messages`: 新增可选 `mediaType: z.enum(['image', 'video']).optional()`。
- `src/contracts/album.ts`:
  - `AlbumPhotoSchema`: 新增可选 `mimeType: z.string().optional()`，使相册能准确区分图片与 MP4 视频。

### 2. 领域层（Domain）
- `src/modules/world/domain/types.ts`:
  - `WorldEffect`: `media.requested` 支持 `mediaType?: 'image' | 'video'`。
  - `MediaRequest`: 新增 `mediaType?: 'image' | 'video'`。
  - `OutboxJob`: 支持 `type: 'image.generate' | 'video.generate'` 及 `mediaType?: 'image' | 'video'`。
- `src/modules/world/domain/validation.ts`:
  - `parseProposal`: 在解析 `media.requested` 效果时保留 `mediaType`（`video` 或 `image`）。
- `src/modules/world/domain/reducer.ts`:
  - `applyEvent`: 处理 `media.requested` 时正确标记 `mediaType`；视频默认生成任务标题为 `【事件记录】现场动态`，生成任务类型设为 `video.generate`。
- `src/modules/media/domain/consistency-guard.ts`:
  - `DEFAULT_MEDIA_BUDGET`: 设定 `maxVideosPerWorld: 2`，`estimatedCostUsdPerVideo: 0.20`。
  - `checkMediaQuota`: 支持按 `mediaType` 分别校验图片（上限 12）与视频（上限 2）硬额度。

### 3. 应用层（Application）
- `src/modules/world/application/intent-router.ts`:
  - 增加 `EXPLICIT_VIDEO_PATTERNS` 正则识别（如 `"发段视频看看"`、`"拍个视频"`、`"录段视频"`、`"看看现场动态小视频"` 等）。
  - 显式 `videoRequest` 或匹配视频模式时路由至 `turnMode: 'video'`。
  - 普通闲聊严格保持 `turnMode: 'chat'`，不触发任何媒体任务。
- `src/modules/world/application/resolve-turn.ts`:
  - 当 `turnMode === 'video'` 时，为提议追加 `mediaType: 'video'` 的 `media.requested` 效果；角色的文本对白立即生成并返回。

### 4. 基础设施与展示层（Infrastructure & Presentation）
- `src/modules/media/infrastructure/media-pipeline-service.ts`:
  - `executeVideoPipeline`: 基于 Replicate MiniMax Video-01 执行持久化视频生成；校验 MP4 魔数后存入 `AssetStore`。
  - 在额度检查中传入 `'video'` 类型。
- `src/modules/media/infrastructure/media-pipeline-handler.ts`:
  - 独立计算世界内已生成的视频数量（`mime_type = 'video/mp4'`）与图片数量，精准执行配额校验。
  - 视频生成完成后向 `parallel_life.assets` 写入 `mime_type: 'video/mp4'` 并更新 `world_media_requests`。
- `src/modules/world/infrastructure/build-repository.ts`:
  - `phone()`: 消息投影时传递 `mediaType: media.mediaType`。
- `src/modules/media/infrastructure/album-projection.ts`:
  - `albumPhotos()`: 查询补齐 `a.mime_type`，并将视频记录映射为 `AlbumPhoto`。
- `src/features/phone/world-app-data.ts`:
  - 消息转展示模型时正确传递 `mediaType`；针对视频 pending 状态展示 `正在渲染视频片段...`，failed 状态展示 `视频生成未完成`。
- `src/features/phone/apps/types.ts`:
  - `PhoneMessage` 与 `PhonePhoto` 支持 `mediaType: 'image' | 'video'` 与 `mimeType?: string`。
- `src/features/phone/apps/messages.tsx`:
  - 消息流媒体卡片：当素材为视频（`mediaType === 'video'` 或 `mimeType === 'video/mp4'`）时，渲染带控制条的原生 HTML5 `<video>` 播放器与 `🎥 关键片段视频` 标签。
  - 预览弹窗：支持原生长宽比视频自动播放与 `🎥 关键片段` 标签。

---

## 三、验证结果

### 1. 自动化测试套件
新建 `tests/media-video-flow.test.ts`，涵盖 9 项针对性测试：
1. `routeUserIntent`: 显式自然语言索要视频准确命中 `turnMode: 'video'`。
2. `routeUserIntent`: 显式 `videoRequest` 参数准确路由至 `video` 模式。
3. `routeUserIntent`: 普通日常对话严格保持 `turnMode: 'chat'`，零生成副作用。
4. `applyEvent`: `media.requested`（video）正确生成 `video.generate` 外发任务与 `mediaRequests` 状态。
5. `checkMediaQuota`: 严格执行单世界 2 段视频的硬额度上限。
6. `isValidMediaMagicBytes`: 校验真实 MP4 `ftyp` 容器二进制签名，拒绝假冒文件。
7. `createMediaPipelineHandler`: 成功调度 `executeVideoPipeline` 并事务保存 `video/mp4` 资产。
8. `resolveTurn`: 索取视频时即时返回 NPC 文本回复，绝不阻塞对话。
9. `PostgreSQL integration`: 真实数据库验证消息流（`pending` -> `ready`）与相册（`albumPhotos`）中的视频投影联动。

测试结果：
- `node --test tests/media-video-flow.test.ts`: **9/9 全部通过**。
- 全量自动化测试 `npm test`: **697/697 全部通过**（无失败，零回归）。

### 2. 架构契约与类型安全
- `node scripts/check-boundaries.mjs`: **323 个文件通过检查，0 违规**。
- `npx tsc --noEmit`: **0 错误**。
- `npm run build`: **生产构建完全成功**（24 个静态页面与所有动态 API 路由通过打包）。
