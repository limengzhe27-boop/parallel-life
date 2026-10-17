# 任务报告：44-127 手机各 App 衔接与时间草稿一致性全闭环

- 任务 ID：`44-127-APP-LINK-TIME-CONSISTENCY-I`
- 工作包关联：`R8` / `APP-LINK-AUDIT-45` / 手机端跨 App 链接与一致性审计缺陷整改
- 执行负责人：`新架构交付负责人（Agent ID: codex-ma44-127-app-link-i）`
- 工作目录：`/Users/limengzhe/Desktop/projects/demo/人生剧本`
- 关联测试：`tests/phone-app-links-consistency.test.ts`、`tests/notes-records-ui.test.ts`
- 交付范围：
  - `src/features/phone/apps/messages.tsx`（聊天附件选择器传实体相片、顶部约定智能优先活跃项、相册跳转保护、草稿保护）
  - `src/features/phone/apps/calendar.tsx`（跨 App 邀约带入草稿追加保护、日历约定挂载地图导航前往按钮）
  - `src/features/phone/apps/photos.tsx`（相册聊聊照片带入草稿追加保护）
  - `src/features/phone/apps/provider.tsx`（`usePhoneApps` 提供 `bringDraft` 跨 App 安全合并写入器）
  - `src/features/phone/apps/notes-records.tsx`（人生记录列表点击直达详情，免除便签过渡中转）
  - `src/features/phone/apps/moments.tsx`（背景轮询更新保留旧数据，消除世界分钟切换时的闪烁全屏空白）
  - `src/features/phone/apps/appointment-link.ts`（抽取独立强类型的约定匹配与草稿合并算法）
  - `src/features/phone/apps/types.ts`（`PhoneActions.sendMessage` 支持可选实体 `photo` 载荷）
  - `src/features/phone/world-app-data.ts`（相册分享文本消息自动解析实体卡片映射、防护空 notes 字段）
  - `src/features/phone/world-phone-app.tsx`（消息发送透传 `photo` 卡片实体、持久化草稿隔离）
  - `src/modules/media/infrastructure/asset-repository.ts`（相册图片上传时间优先采用世界时钟投影时刻，修复跨日时间不一致）
  - `src/modules/world/infrastructure/build-repository.ts`（日历约定按场所自动关联地图地点导航链接）
  - `tests/phone-app-links-consistency.test.ts`（7/7 单元与回归测试）

---

## 一、审查缺陷与整改对照矩阵

| 缺陷编号 | 等级 | 审计现象 | 根因定位 | 整改实现与验证 |
|---|---|---|---|---|
| **B1** | P1 | 聊天“分享照片”仅发标题文本，不传图片引用 | `messages.tsx` 在相册选取后仅构建纯文本字符串发送，未向 `sendMessage` 传递 `photo` 实体 | `sendMessage` 协议扩展 `photo` 载荷并透传至 `deliverMessage`；`world-app-data.ts` 增加分享文本正则匹配相册卡片；即时渲染带封面与标题的照片实体卡片 |
| **B2** | P1 | 跨 App 带入聊天内容会直接覆盖已有草稿 | `calendar.tsx`、`photos.tsx`、`messages.tsx` 直接使用 `setDraft(key, text)` 替换旧草稿 | 引入 `bringDraft` 与 `mergeIncomingDraft`；存在未发送旧草稿时换行追加，已包含内容时幂等忽略；聊天内相册分享使用独立操作 key，不擦除输入框草稿 |
| **B3** | P2 | 聊天顶部关联日程按联系人取首项，持续指向旧约定 | 直接取 `invitations.find` 第一条，旧的 `cancelled` 或过期项排在前面时永远占位 | 实现 `findRelatedInvitation`；严格优先匹配 `confirmed` / `proposed` 活跃约定；按故事时间就近排序；无活跃项时安全降级至最近历史项 |
| **B4** | P2 | 历史聊天图片有“在相册中查看”，目的地却不存在 | 历史附件投影为媒体 URL 但不在相册中，用户点击后相册找不到显示缺失 | `messages.tsx` 预览浮层严格校验 `data.photos.some(p => p.id === photo.id)`，仅真正存在于相册的照片才提供相册跳转，避免报错落空 |
| **B5** | P2 | 日历“进入现场”与地图位置资格不一致 | 约定已到期但玩家未到场时，日历仅提供“进入现场”按钮，点击被后端拒绝 | `build-repository.ts` 将约定地点自动挂载为地图导航链接；日历详情提供显式“📍 前往【约定地点】（打开地图）”引导按钮，形成完整闭环 |
| **B6** | P2 | 相册上传时间使用叙事快照时间，与当前手机世界时间不一致 | `asset-repository.ts` 读取 `world.state.time` 写入 `story_at`，忽视了时钟流逝 | `asset-repository.ts` 读取 `parallel_life.world_clock`，通过 `projectStoryTime` 计算实际当前故事时刻，确保上传时刻与手机/日历时间对齐 |
| **O1** | 优化 | 人生记录详情错误绕到便签兼容页多一次跳转 | `notes-records.tsx` 列表项点击事件调用 `open('notes', record.id)` | 修改为 `open('records', record.id)` 直达 `RecordsApp` 详情页，保留旧外部路由兼容的同时消除技术中转提示 |
| **O2** | 优化 | 倍速下朋友圈反复清空加载闪烁 | `moments.tsx` 在 `storyMinute` 每次变化时执行 `setResult(null)` | 增加同世界数据保留机制：仅当跨世界切换时重置结果，同一世界内背景拉取更新并无缝替换，消除全屏加载空白 |

---

## 二、测试验证证据

1. **专项单元与逻辑一致性测试**：
   - 命令：`node --test tests/phone-app-links-consistency.test.ts`
   - 结果：**7/7 全部通过**（耗时 175ms）：
     - `findRelatedInvitation prioritizes active confirmed/proposed appointments over old cancelled ones`
     - `findRelatedInvitation falls back to most recent terminal appointment when no active ones exist`
     - `findRelatedInvitation returns null when no appointments match the actor`
     - `cross-app draft mergeIncomingDraft preserves existing message drafts without overwriting`
     - `album photo upload projected story time advances with world clock`
     - `album photos check prevents invalid navigation from non-album chat media attachments`
     - `worldAppData attaches photo card when message shares an album photo title`

2. **UI 与便签/人生记录回归测试**：
   - 命令：`node --test tests/notes-records-ui.test.ts`
   - 结果：**17/17 全部通过**（耗时 657ms）。

3. **全量自动化测试套件**：
   - 命令：`npm test`
   - 结果：**3,284 项测试全部通过，0 失败**（耗时 27s）。

4. **架构边界与类型检查**：
   - `npm run check:boundaries`：**617 文件全部符合模块边界**。
   - `npx tsc --noEmit`：**零类型错误，Exit 0**。

5. **生产构建打包**：
   - 命令：`npm run build`
   - 结果：**27/27 静态与动态路由成功编译，Exit 0**。

6. **真实 PostgreSQL 集成测试**：
   - 40 项 PG 数据库端到端集成测试全数通过（包括预约履约、撤销、接受、媒体流及玩家运行时受控准入）。
