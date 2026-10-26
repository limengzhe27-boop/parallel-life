# CPU-GUARD-01 · 零体验影响的 CPU 治理

- 负责人：dsh-cpu-guard-01-20261026
- 基线：`0f563f59`
- 日期：2026-10-26
- 状态：待验收（本地实现/测试/对比完成，未推送、未部署）
- 用户约束：暂缓“世界 GET 快速返回/change token”和“客户端轮询间隔/可见性策略”；本轮四项不得改变正常用户体验。

## 1. advance 轻量预检前置

**改动**
- 新增 `src/modules/world/application/advance-preflight.ts`：只判断 `paused` / `model_cooldown` 两个权威否定状态；未知状态一律返回 `null`，保留完整路径。
- `src/modules/world/infrastructure/clock-repository.ts` 抽出 `readClockInTransaction()`，允许在既有事务里读时钟，避免多一次往返。
- `src/server/npc-agent-advance-services.ts`：把 epoch、世界时间、删除标记、模型冷却和时钟合并为一次小查询，放在 `worlds.get()`（完整 hydrate）之前；命中预检时默认只记录 `advance-preflight`（每世界/原因一次），`ADVANCE_PREFLIGHT=on` 才真正跳过。
- 默认 `shadow`；`off` 完全关闭；`on` 才返回 quiet。重试路径、非 epoch2、状态不明确一律走原完整路径。

**证据（本地串行、同一 PG/世界）**

| 场景 | 基线 CPU/请求 | 预检 `on` CPU/请求 |
|---|---:|---:|
| 暂停世界 advance（1500 条消息 + 1500 条事实） | 21.0ms | 4.0ms |
| 暂停世界 advance（短历史基准世界） | 5.0ms | 7.0ms（请求开销主导，事务数 12→8） |

短历史世界 CPU 在噪声内，但事务数从 12 降到 8；大世界 hydrate 成本被完全省掉。响应字段 `played/folded/storyNow` 与基线一致。

## 2. 定时入口去重

- `.github/workflows/proactive.yml` 去掉 `*/15 * * * *`，保留 `workflow_dispatch`。
- Supabase 的 `parallel-world-proactive` 每 5 分钟任务保持不变；接口幂等/租约未改。
- 上线后生效；当前未 push，线上仍是旧 workflow。手动入口保留，Supabase 故障时可临时在 GitHub UI 恢复定时。

## 3. 402/503 退避

- `ApiFailure` 新增可选 `status`；`LifeClient` 在响应体不是 JSON（Vercel 402 纯文本）时也保留 HTTP 状态。
- 新增 `src/features/phone/poll-guard.ts`：明确 `402` 立即暂停后台轮询 15 分钟；连续 3 次 `503` 暂停 60 秒；成功后清零。其它错误、网络错误、正常轮询节奏不变。
- `world-phone-app.tsx` 的世界轮询、advance 检查、手动 `load()`，以及 `use-world-time.ts` 的 15 秒心跳接入该门闩；手动加载成功会立即恢复。
- 单元测试覆盖 402、503 连续计数、成功清零、其它错误不误停、真实客户端纯文本 402 保留状态。

## 4. world 请求内去重/减少序列化

- `hydrateInTransaction`/`get` 新增可选 `includeFacts`；`BuildRepository.phone` 传 `false`，手机响应不使用 `facts`，跳过 fact 投影的 UNION 分支、去重/裁剪与分配。默认仍加载 facts，其它调用方不变。
- `albumPhotosWithPersonBindings()` 把相册与人物绑定历史合成一次投影；`BuildRepository.phone` 复用绑定行生成 `personPhotos`，删除原先重复的 `historyPersonPhotos` 查询。`historyPersonPhotos()` 保留给其它调用方。
- 只做请求内复用，未引入跨请求缓存。

**证据**
- 世界 GET 事务数（同一世界，20 次串行）：`9.20 → 8.05`（约 -12.5%）。
- 1500 条消息 + 1500 条事实的构建世界 GET：基线 26.0ms CPU、当前 22.0ms CPU（约 -15%）；响应 **565,472 字节，逐字节一致**（`cmp`）。
- 短历史/暂停世界响应除 `time` 正常推进外无其它差异。

## 测试与检查

- `npm run check`：**4015/4015 通过**，boundaries + typecheck 通过。
- `npm run build`：通过。
- `tests/integration/album.test.ts`：1/1；`tests/integration/advance-preflight.test.ts`：1/1（真实 PG 时钟读取）；`tests/poll-guard.test.ts`：5/5；`tests/advance-preflight.test.ts`：3/3。
- `tests/integration/person-avatar-update.test.ts` 子测试 9/9 通过，父级收尾仍失败/挂起（基线同样存在，非本批引入）。
- `tests/integration/world-build.test.ts` 仍失败（`AI_FAILED INVALID_BUILD` / cancel 期望 `queued`），与本批文件无调用关系，未在基线隔离环境中复现（基线工作树缺 `.local/runtime.json`），保留为既有失败。

## 顺带修复的既有阻断

`src/modules/media/infrastructure/asset-repository.ts` 的相册上传读取了不存在的 `world_clock.clock` 列（2026-10-17 `1f11767c` 引入），本地真实 PG 下 `uploadToAlbum` 直接 `42703`。已改为按现有 `story_now/speed/paused/last_tick_at` 投影故事时间；`album.test.ts` 从失败转为通过。该修复与本批 CPU 目标独立，建议单独复核。

## 未做与依赖

- 未做：世界 GET 快速返回/change token、客户端轮询间隔/可见性策略、跨请求缓存、任何 schema/迁移。
- 未推送、未部署。上线依赖：Vercel 团队恢复；生产先应用 `0113`/`0114`（既有待办）再发本批代码。上线后建议先以 `ADVANCE_PREFLIGHT=shadow` 观察 `advance-preflight` 日志，确认与完整路径一致后再切 `on`。
- GitHub workflow 去重也随本批 push 生效；Supabase 任务无需改动。

## 资源

- 本地 55432 PG、3219 生产构建服务器（最终版）用于验证；基线 3220/预检 3221 已停止，基线工作树已删除。
- 合成大世界已通过 DELETE API 删除；无生产写入、无模型调用、无 push。
