# SPACE-02E · 普通自建世界也有可靠的空间

负责人：codex-space02e-20261011。2026-10-11。
工作目录：`/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/space-02e`
分支：`codex/space-02e`
提交：`382bf4f`
生产部署：`https://parallel-life-fm6rur8js-limengzhe27-boops-projects.vercel.app`（Ready，公网地址 `https://parallel-life-nu.vercel.app`）

---

## 1. 任务背景与核心要求

之前普通自建世界和部分已经发展的旧世界，没有可靠的地点来源，展示为空态。
本任务将空间可靠初始化接入正常世界创建与旧世界核验链路：

1. **世界创建可靠推导**：
   - 从被采纳的分支设定（`seed.setup.place` 或 `seed.settingContent.setup.place`）与开场情境、角色、日程中，纯函数推导起始地点（`primary_place`）、周边生活街区（`community_area`）及开场日程约定地点（`appointment_venue`）。
   - 双向生成路线，耗时明确（15/20/25 分钟），方式标注（步行/车程），进入世界后统一使用故事时间。
   - 空间数据经过运行时严格校验（`validateSpace`），在 `buildHandler` 中与世界开场结果原子性持久化。
   - 不从现实 IP、完整私人访谈或朋友照片推测位置。
   - “与该地点有关的人物”（`contactActorIds`）与“此刻就在这里的人”严格区分。
2. **已发展旧世界保护与诚实空态**：
   - 只有在存在可核验依据时（`world.version === 0`、拥有有效初始快照 `world_initial_snapshots` 与 `world_builds` 开场设定），才允许用户显式建立空间（`POST /api/v1/worlds/:id/space/establish`），并记录 `space_established` 事件。
   - 已经产生游玩进展的历史世界（`world.version > 0`）不可修改其不可变的初始历史，禁止静默回填或重置，保持清楚诚实的空态。
   - 重复建立请求幂等返回原始回执；跨用户操作严格 RLS 拦截。

---

## 2. 修改文件清单

- `src/contracts/world-space.ts`：扩展 `SpaceSourceSchema`，新增 `seed_genesis` 来源类型，使自建世界空间来源可追溯；泛化 `world_event` 来源。
- `src/contracts/world-build.ts`：增加 `SpaceOpeningDraftSchema`，允许世界开场模型或预设携带显式空间草案（可选）。
- `src/modules/world/domain/space.ts`：
  - 新增纯函数 `deriveInitialSpace`，从种子设定与开场数据生成符合物理与时间约束的地点与双向路线。
  - 支持 `authoredSpace` 转换为只读契约，提供严格 `validateSpace` 校验器。
- `src/modules/world/infrastructure/build-handler.ts`：在普通世界创建 handler 中挂载空间生成逻辑，校验后持久化到 `state.space`。
- `src/modules/world/infrastructure/space-repository.ts`：
  - 在 `read()` 中：非官方世界当 `version === 0` 且快照中有可核验依据时，`canEstablish` 设为 `true`。
  - 在 `establish()` 中：支持通过 `world_event` 事务性建立空间，防范版本冲突与非法输入，重放返回原回执。
- `tests/world-space.test.ts`：补充 `deriveInitialSpace`、缺省地点保留空态、非法路线与非法当前位置校验测试。
- `tests/integration/world-space.test.ts`：增加普通世界空间创建、空地点保持空态、旧档 v0 核验后建立、v1 已发展旧档不可建立及跨用户隔离的真实 PostgreSQL 集成测试。

---

## 3. 验证结果

1. **架构边界与类型检查**：
   - `npm run check:boundaries`：313 个文件全部通过。
   - `npm run typecheck` (`tsc --noEmit`)：零错误通过。
2. **单元与集成测试**：
   - `npm test`：658 项测试全部通过（0 失败）。
   - `npm run test:db`：205 项真实 PostgreSQL 集成测试全部通过，0 项失败，5 项可选跳过。
3. **生产构建**：
   - `npm run build`：Next.js 16.3.5 webpack 生产构建成功，生成 23 个路由。
4. **线上生产环境部署与实测**：
   - 提交 `382bf4f` 推送到 GitHub `main` 分支。
   - Vercel Production 部署 READY（耗时 1m，域名 `https://parallel-life-nu.vercel.app`）。
   - 公网实测：
     - 健康检查 `GET /api/health` 200 OK。
     - 获取访客 Session 200 OK。
     - 查询官方分支并开启实例 201 Created。
     - 查询空间端点 `GET /api/v1/worlds/:id/space` 返回 200 OK，包含完整地点、双向路线、故事时间与当前位置。
