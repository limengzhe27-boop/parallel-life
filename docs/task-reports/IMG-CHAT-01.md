# IMG-CHAT-01 交付报告：图片回到聊天与相册展示

**负责人**: Agent IMG-CHAT-01 (`codex-img-chat-01a0`)  
**状态**: 待验收  
**交付范围**: 手机消息与相册同源素材契约绑定、非阻塞生成占位、诚实失败展示、相册资产无缝回看与壁纸设定

---

## 1. 业务目标与闭环设计

落实媒体管线生成素材与前端手机端（消息、相册、大图预览）的完整闭环：
$$\text{同源回合事件} \xrightarrow{} \text{消息/媒体双向关联} \xrightarrow{} \text{非阻塞生成态} \xrightarrow{} \text{私有资产回填} \xrightarrow{} \text{聊天与相册同源查看}$$

### 核心改进与设计约定

1. **同源事件附件契约 (`src/contracts/world-build.ts` & `src/modules/world/infrastructure/build-repository.ts`)**:
   - 角色回复消息与 `media.requested` 在同一个推演回合产生，共享唯一的 `sourceEventId`。
   - `BuildRepository.phone()` 在投影消息时，通过 `sourceEventId` 精确关联 `state.mediaRequests`：
     - 若状态为 `ready` 且持有合法 `assetId`（且 `deliverToChat` 未被拦截），注入 `photoId: media.assetId`、`mediaStatus: 'ready'` 及 `mediaTitle`；
     - 若状态为 `pending`，注入 `mediaStatus: 'pending'` 与 `mediaTitle`；
     - 若状态为 `failed`（或 `deliverToChat: false`），注入 `mediaStatus: 'failed'` 与 `mediaTitle`。
   - 纯文本中提及书名号或照片标题（如《【事件纪念】...》）**严禁凭空造出附件**，杜绝文本幻觉造图（继承并强化 `tests/character-image-flow.test.ts` 防御反例）。
   - 用户发送的消息（`role: 'user'`）绝不被反向绑定附件，仅针对 NPC 发出的助手消息绑定。

2. **相册端同步映射 (`src/modules/media/infrastructure/album-projection.ts`)**:
   - `albumPhotos()` 增加对 `parallel_life.world_media_requests` 的联合查询。
   - 凡状态为 `ready`、资产表 `status = 'ready'` 且 `deliveryDecision.deliverToAlbum !== false` 的剧情照片，自动作为 `kind: 'generated'` 资产投影到 `world.photos`。
   - 与 `world_album` 原图及 `world_person_bindings` 引用照片做联合去重，确保相册与聊天内引用的是**同一个 `assetId`、同一个故事时间与版本**。

3. **前端数据适配器映射 (`src/features/phone/world-app-data.ts`)**:
   - 解析 `message.photoId`，从相册列表中关联匹配 `matchedPhoto`；若未在相册列表中，则直接依凭契约生成 `PhonePhoto` 对象。
   - 当 `mediaStatus === 'pending'` 时，构造 `status: 'generating'` 的纯占位对象（不包含任何虚假 URL）。
   - 当 `mediaStatus === 'failed'` 时，构造 `status: 'failed'` 的诚实失败对象（不包含任何虚假 URL）。

4. **手机消息界面诚实展示 (`src/features/phone/apps/messages.tsx`)**:
   - **非阻塞阅读**: 角色台词文字完整渲染在上方，图片状态卡片呈现在台词下方，彻底不堵塞玩家阅读与后续回复。
   - **生成中态**: 优雅渲染 `📸 正在记录画面...`，标注标题与“AI 摄影记录中，生成后将在此展示并同步至相册”，彻底杜绝使用 `/art/first-window.webp` 等预设假图冒充。
   - **失败态**: 诚实渲染 `⚠️ 画面记录未完成`，标红提示“生成未成功或已取消”，绝不伪装成功。
   - **完成态**: 渲染真实私有素材缩略图，点击可弹出大图预览 Modal，支持设为手机壁纸以及一键跳转至相册应用（`open('photos', photo.id)`）。

---

## 2. 自动化测试验证

### 专属测试套件 (`tests/img-chat-flow.test.ts`)

| 测试用例 | 模式 | 结果 | 验证要点 |
|---|---|---|---|
| 1. successful turn-generated media attaches to assistant message and album with same asset | 单元 | PASS | 同源回合 NPC 回复成功绑定附件，用户消息不绑；相册与消息持有同一 `assetId` 与私有 URL |
| 2. pending media displays non-blocking generating status without fake images | 单元 | PASS | 生成中消息台词完全无阻，附带 `status: 'generating'`，`url` 为 `undefined`（无假图） |
| 3. failed media displays honest failed state without fake fallback | 单元 | PASS | 失败状态如实标记为 `status: 'failed'`，`url` 为 `undefined` |
| 4. plain text mentioning photo titles never manufactures attachments | 单元 | PASS | 台词中提及照片标题绝不凭空生成附件（反幻觉契约守卫） |
| 5. Postgres integration - buildRepo.phone projects ready/pending/failed media to messages & album | 真实 PG 集成 | PASS | 真实 PostgreSQL 库：`buildRepo.phone` 投影消息与相册、`deliverToChat: false` 拦截附件、`deliverToAlbum: false` 拦截相册 |

### 整体工程质量检查

1. **边界检查**: `node scripts/check-boundaries.mjs` -> 323 个模块源文件通过，0 违规。
2. **类型检查**: `npm run typecheck` (`tsc --noEmit`) -> 0 错误。
3. **全量测试**: `npm test` -> **688/688 项测试全数通过**（包含全部 35 项媒体与图片专项用例），0 失败。
4. **生产打包**: `npm run build` -> Next.js 生产环境打包顺利完成，全部 24 个静态页面和动态 API 路由顺利生成。
