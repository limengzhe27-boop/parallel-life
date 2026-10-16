# 任务完成报告：NAR-03S 按需静态媒体联动

## 一、任务背景与设计原则

本任务遵循《人生剧本：图片与视频工具模块开发任务》与 `docs/DEVELOPMENT.md:748` 规范，衔接已有 `NAR-03`，实现按需静态媒体（图片）的完整闭环，涵盖来源校验、额度控制、去重幂等、unknown 异常恢复、人物参考安全、以及成功素材在消息和相册中的一致性呈现。

### 核心约束与要求
1. **衔接已有 NAR-03 / return-messages 规则**：
   - 严厉拦截无现成资产却宣称“拍好了/发给你了”等虚假返还台词（`unsupportedReturnClaim`）。
   - 仅当且仅当角色或其参与的行程拥有已就绪的媒体资产时，才允许进行真实的返还说明。
   - 返还对白绝不自动反向派生未经玩家请求的媒体任务。
2. **意图路由与人物参考安全**：
   - 玩家明确请求照片时（`imageRequest` 或匹配照片意图）才路由至 `turnMode: 'image'`。
   - 角色参考图严格通过 `world_person_bindings` 查找对应 actor 的授权头像资产；若无授权资产则诚实降级为纯文本特征锚定，**绝不冒用玩家肖像（player portrait）作为 NPC 参考**；场景插图不绑定玩家肖像。
3. **硬预算与配额保护**：
   - 单世界图片严格执行 12 张硬上限（`DEFAULT_MEDIA_BUDGET.maxImagesPerWorld = 12`）。
   - 超过配额时优雅拒绝，更新 `world_media_requests` 为 `failed`（`errorCode: 'QUOTA_EXCEEDED'`），并结束 Outbox 任务，绝不阻塞玩家正常文本对白。
4. **幂等与去重**：
   - 对于已成功执行（`status: 'ready'` 且存在 `assetId`）的媒体生成任务，重复触发重放时直接跳过外部供应商调用，不重复生成、不重复扣费、不产生重复资产。
5. **未知结果与诚实失败**：
   - 格式不合规或配额超限标记为 `failed`。
   - 提交外部供应商超时（`STATUS_UNKNOWN`）或网络不确定状态标记为 `unknown`，绝不无脑重试或二次扣费。
   - 前端非阻塞呈现生成中或失败状态，绝不使用伪造素材冒充成功。
6. **素材、消息与相册三端一致性**：
   - 成功资产落入 `parallel_life.assets`（`image/webp` 或 `image/png`）。
   - `parallel_life.world_media_requests` 绑定 `assetId` 与 `ready` 状态。
   - `buildRepository.phone()` 消息投影中对应消息携带 `photoId`、`mediaStatus: 'ready'` 与 `mediaTitle`。
   - 相册投影 `albumPhotos()` 呈现同款 `assetId`，且相册时间与剧情时间（`storyAt`）精确对齐。

---

## 二、具体改动清单

### 1. 领域层与规则（Domain）
- `src/modules/world/domain/return-message-policy.ts`:
  - 增强照片声称检查正则：`/(?:照片|图片|合影).{0,8}(?:拍好了?|做好了?|生成了?|发你了?|发给你了?|给你看看?)|(?:已经|刚).{0,6}(?:拍|生成|发).{0,6}(?:照片|图片|合影)/u`。
  - 支持检查当前消息关联的 sourceEventId 是否拥有就绪资产，或角色参加的约会行程（`participantIds.includes(actorId)`）是否存在就绪媒体，确保诚实说明。
- `src/modules/world/domain/types.ts`:
  - `MediaRequest.status`: 支持 `'pending' | 'ready' | 'failed' | 'unknown'`。
  - `MediaRequest.deliveryDecision`: 支持 `approved?: boolean; deliverToChat?: boolean; deliverToAlbum?: boolean; channel?: string; reason?: string;`。
- `src/modules/media/domain/types.ts`:
  - `ProviderTaskReceipt`: 增加可选 `outputUrls?: string[]`，支持同步返回成品的适配器。

### 2. 基础设施层（Infrastructure）
- `src/modules/media/infrastructure/media-pipeline-service.ts`:
  - `executeImagePipeline` 与 `executeVideoPipeline`:
    - 修复初次提交即返回完成时的 `outputUrl` 初始化（`receipt.outputUrls && receipt.outputUrls.length > 0 ? receipt.outputUrls[0] : undefined`），避免误判为 `GENERATION_INCOMPLETE`。
    - 完善 `deliveryDecision` 返回结构，填充 `deliverToChat` 与 `deliverToAlbum` 逻辑。
- `src/modules/media/infrastructure/media-pipeline-handler.ts`:
  - 增加 Phase 2 错误捕获处理：当 pipeline 抛出异常（如 `QUOTA_EXCEEDED` 或 `STATUS_UNKNOWN`）时，在短事务中将 `world_media_requests` 更新为 `failed`（或 `unknown`），并将关联的 `outbox_jobs` 标记为 `failed`，附带错误详情，防止任务无限死循环重试。
- `src/modules/media/infrastructure/album-projection.ts`:
  - 优化相册投影故事时间解析：`COALESCE(NULLIF(e.payload->>'storyAt', '')::timestamptz, e.occurred_at, a.created_at) AS story_at`，确保生成图片与剧情故事时刻一致。
- `src/modules/world/infrastructure/build-repository.ts`:
  - `phone()` 消息投影：
    - `isPending` 支持 `media?.status === 'unknown'`。
    - 安全判定 `deliverToChat`（兼顾 `deliverToChat` 与 `approved` 属性）。

### 3. 测试验证套件
- `tests/nar-03s-media-flow.test.ts`:
  - 包含 4 大专项测试用例：
    1. **Return message policy guards**: 虚假照片声称被拦截拒绝，诚实引用放行。
    2. **Intent routing & character reference**: 按需拍照请求精准路由，绝不冒用玩家肖像给 NPC。
    3. **Hard media budget quota**: 严格执行 12 张配额限制并优雅拒绝。
    4. **End-to-end PostgreSQL integration**: 真实数据库下静态媒体生成、去重幂等、失败处理、以及消息和相册双端一致性联动。

---

## 三、质量与验收证据

### 1. 架构边界检查
```bash
node scripts/check-boundaries.mjs
# Module boundary checks passed (323 files).
```

### 2. 类型检查
```bash
npm run typecheck
# tsc --noEmit: 0 errors
```

### 3. 单元与集成测试全量通过
```bash
npm test
# 701 tests pass 100% (701 passed, 0 failed)
node --experimental-strip-types --test tests/nar-03s-media-flow.test.ts
# 4 tests pass 100%
```

### 4. 生产构建验证
```bash
npm run build
# Next.js 16.3.5 production build completed successfully (Exit Code: 0)
```
