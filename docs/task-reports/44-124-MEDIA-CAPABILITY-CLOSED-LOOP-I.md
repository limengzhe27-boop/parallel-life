# 任务报告：44-124-MEDIA-CAPABILITY-CLOSED-LOOP-I (任务 R6 / R7)

## 一、任务背景与目标

在本项目中，媒体系统（图片生成、视频生成与素材分享）此前已有基础适配器与流水线定义，但存在关键断裂：
1. **Worker 注入缺口**：`src/server/worker-composition.ts` 中仅传入无参数的 `mediaHandler(queue)`，未注入具体的 `MediaPipelineService`；
2. **NPC 能力清单缺口**：NPC 能力仅定义了预约与行程相关能力，未接入 `media.generate_image`、`media.generate_video` 和 `media.share`；
3. **内核执行与存证断裂**：NPC 无法将媒体生成与分享提议转化为落库的 `world_media_requests` 与 `outbox_jobs`。

本任务（编号 44-124，对应收口规划 R6 与 R7）完成了媒体工具与执行流的全链路真实接通。

---

## 二、代码实现清单

1. **Worker 装配与延迟初始化** (`src/server/worker-composition.ts`)：
   - 注入 `readMediaService` 惰性工厂，组装 `PostgresCharacterVisualAnchorRepository`、`createPrivateAssetStore`、`ReplicateMediaProviderAdapter`；
   - 提供 `referenceAssetReader` 查询 `parallel_life.assets` 并通过私有资产仓读取字节；
   - 传递给 `mediaHandler(queue, readMediaService)`。

2. **媒体 Handler 延迟工厂适配** (`src/modules/media/infrastructure/media-handler.ts`, `src/modules/media/infrastructure/media-pipeline-handler.ts`)：
   - 支持传入 `MediaPipelineService | (() => MediaPipelineService)`；
   - 保证只有在 Worker 处理 `media` 租赁任务时才按需构造服务实例，避免提前拉起重资源。

3. **Node.js Strip-Types 语法兼容** (`src/modules/media/infrastructure/character-reference-resolver.ts`)：
   - 移除 TypeScript 构造函数参数属性（`constructor(private readonly executor)`），显式声明属性并赋值，杜绝 Node `--experimental-strip-types` 报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。

4. **NPC 媒体能力注册与模型指令** (`src/modules/world/domain/agent-capabilities.ts`, `src/modules/world/infrastructure/npc-agent-model.ts`)：
   - 注册 `'media.generate_image'`、`'media.generate_video'`、`'media.share'` 到 `NPC_AGENT_CAPABILITIES`；
   - 在模型提示词中加入对图片生成、视频生成与已有素材分享的输出格式规范。

5. **领域输出引用与事件规约** (`src/modules/world/domain/agent-runtime.ts`, `src/modules/world/domain/agent-state-event.ts`)：
   - `AgentActionResult.outputRefs` 扩展支持 `'media' | 'asset'`；
   - 状态规约与日历效果支持 `media.requested`。

6. **内核端到端执行与事务存证** (`src/modules/world/infrastructure/npc-agent-kernel.ts`, `agent-channel-projector.ts`)：
   - `media.generate_image` / `media.generate_video`：核验参数（场景描述、角色动作、用途等），在同一事务中写入 `parallel_life.world_media_requests` 并生成 `parallel_life.outbox_jobs`（类型为 `image.generate` 或 `video.generate`）；
   - `media.share`：核验目标素材是否存在于 `parallel_life.assets` 且状态为 `'ready'`；未就绪或不存在时严格拒绝；就绪后记录动作存证。

---

## 三、测试与验证证据

1. **真实 PostgreSQL 专项集成测试** (`tests/integration/actor-media-capability.test.ts`)：
   - `1. media.generate_image proposal creates world_media_requests and outbox_jobs atomically`: PASS
   - `2. media.generate_video proposal creates video request and outbox job`: PASS
   - `3. media.share reports ASSET_NOT_READY when asset is not ready`: PASS
   - `4. media.share succeeds when asset is ready and whitelisted`: PASS
   - **4/4 全部通过**（真实 pg 数据库交互，零假数据）。

2. **关联能力与前置回归测试**：
   - `tests/integration/actor-appointment-cancellation.test.ts`: 3/3 PASS
   - `tests/integration/actor-appointment-fulfillment.test.ts`: 2/2 PASS
   - `tests/integration/legacy-world-migration.test.ts`: 6/6 PASS

3. **全工程门禁**：
   - `npm run check:boundaries`: PASS (616 files)
   - `npx tsc --noEmit`: PASS (0 错误)
   - `npm test`: 3277/3277 PASS (0 fail)
   - `npm run build`: Next.js 生产优化构建打包成功，27/27 路由生成完毕。

---

## 四、结论与交付状态

- **已实现**：媒体工具端到端闭环（Worker 注入、NPC 能力、内核事务落库、Outbox 派发与素材分享权限检查）；
- **已验证**：本地真实 PostgreSQL 集成测试与全量构建通过；
- **后续**：由主 Agent 统一更新主表并部署上线验证。
