# SPACE-02D · 保留旧官方存档，显式开启新版副本

负责人：codex-space02d-20261011 (I / 全栈集成)
独立工作树：`/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/space-02d`
分支：`codex/space-02d`
基线：`96e51d1`

## 交付范围与业务目标

当前四个官方分支（县城黄毛、江浙沪独生子、刚回家的真千金、退圈后的顶流）已升级至包含地图空间的第 2 版（`contentVersion: 2`）。为保护老玩家既有经历，不能静默替换、清空或覆盖旧存档。

本次完成以下能力：
1. **默认继续原存档**：有旧存档的用户在人生副本列表中，默认主动作依然是继续原存档，直接进入原世界，原有聊天、照片、日程、记忆和世界进展保持完整。
2. **显式开启新版**：当官方内容存在新版（`hasNewVersion: true`）时，卡片呈现清晰的提示「有新版地图 · 原存档已保留」，并提供「开启新版」入口。用户明确点击后，调用确定性启动流程创建新版独立世界实例，并进入新版地图与初始空间。
3. **支持随时返回旧存档**：开启新版后，原存档与新版在 PostgreSQL `official_life_instances` 与 `worlds` 表中作为相互独立的世界实例完整并存。卡片呈现「新版体验中 · 原存档保留」，提供「继续新版」与「返回原存档」两个明确入口，用户可随时返回旧档。
4. **幂等性与丢响应恢复**：客户端 `OfficialLifeCommands` 按 `(presetId, version)` 独立生成和维护 `commandId`；服务端 `official_life_start_receipts` 严格校验 `commandId` 与请求哈希，重复点击或网络重发安全复用已有回执，绝不重复生成多余世界。
5. **跨租户安全隔离**：PostgreSQL RLS 守卫 `parallel_life.official_life_instances` 与 `parallel_life.worlds`，跨用户完全不可见、不可读写。
6. **双端适配与轻量体验**：卡片排版在移动端（390px 长短屏）与 PC 桌面（1440px / 居中手机壳）自适应，无多余大篇幅说明，文案简练克制。

## 修改文件清单

- `src/contracts/official-lives.ts`：扩展 `OfficialLifeCardSchema`，增加 `hasNewVersion: z.boolean().default(false)`、`legacyWorldId: Id.nullable().default(null)` 与 `currentVersionWorldId: Id.nullable().default(null)`。
- `src/modules/settings/application/official-life-pack.ts`：更新 `OfficialLifePack.card` 的 `Omit` 类型，明确排除实例级状态字段。
- `src/modules/settings/infrastructure/official-life-repository.ts`：`list(owner)` 查询并准确计算用户的当前版本世界、旧版本世界、以及新版本可用状态，保证旧档优先继续。
- `src/features/discovery/official-lives.tsx`：
  - 扩展 `OfficialLifeCardView`。
  - `OfficialLives` 增加 `startNewVersion` 与 `openLegacy` 处理函数。
  - `OfficialLifeCard` 根据 `hasNewVersion` 与 `legacyWorldId` 渲染多版本操作与保留说明，保证普通点击进旧档、明确选择开新版、开新版后仍能返旧档。
- `src/features/discovery/official-lives.module.css`：增加 `.buttonGroup`、`.secondaryButton` 和 `.versionNotice` 样式，保证双端优雅可用。
- `tests/official-lives-ui.test.ts`：增加新版提示与双版本回退渲染单测。
- `tests/integration/official-lives.test.ts`：新增 SPACE-02D 真实 PostgreSQL 集成测试（涵盖旧档优先继续、开启新版、双世界独立共存、回执幂等、以及跨租户隔离）。

## 验证证据

1. **边界检查与类型检查**：
   - `npm run check:boundaries`：313 个文件全部通过。
   - `npm run typecheck` (`tsc --noEmit`)：零错误通过。
2. **单元与无头测试**：
   - `npm test`：655 项测试全部通过（655 passed, 0 failed）。
3. **真实 PostgreSQL 集成测试**：
   - `npm run test:db`：204 项测试通过（0 失败，5 项非本次任务的付费真实模型选测正常跳过）。
   - 专项测试 `SPACE-02D: user with legacy save continues old save by default, can explicitly start new version, and legacy world remains intact`：通过。
4. **生产构建**：
   - `npm run build`：Next.js 16.3.5 生产 Webpack 构建成功，23 个静态/动态页面及所有 API 路由生成成功。
