# SPACE-02F · 旅行真正影响人物、日程和后续处境

负责人：codex-space02f-20261011。2026-10-11。
工作目录：`/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/space-02f`
分支：`codex/space-02f`
提交：`75c2a07`
生产部署：`https://parallel-life-bgpcgfdbz-limengzhe27-boops-projects.vercel.app`（Ready，公网地址 `https://parallel-life-nu.vercel.app`）

---

## 1. 任务背景与核心要求

地图已有位置与时间变化，但“去了某处之后，世界如何回应”尚未完整交付。
本任务复用现有世界事件、现场、导演与日程机制，交付最小完整链路：

1. **前往与地点现场**：
   - 地图选择目的地仅为查看与路线预览；明确“前往”原子提交成功才改变位置、消耗故事时间。
   - 旅行本身不等于参加活动、完成任务、接受治疗或替用户执行其他行动。
   - 到达地点后，用户可调用 `enterPlace` 明确进入地点现场，查看当地环境、实际在场人物与有依据的可做事项。
   - 地点的关联联系人（`contactActorIds`）严格不等于此刻就在现场的人。仅当该地点有当前故事时间已生效的已确认日程时，其参与者才被允许作为在场候选；无日程时呈现真实的地点公共与环境现场，绝不凭空将角色塞入房间。
2. **目击离开与信息边界**：
   - 离开某处现场后，确实目击离开的角色获得 `departureObservation` 事实（“你亲眼看到主角离开了[地点]，没有获知目的地”），其可见性严格限制在目击者。
   - 未在现场的 NPC 不获得该事实，绝不全员自动知晓目的地或离开。
   - 导演调度与议题编排中引入 `departure_inquiry` 议题：只有目击离开且具备关系的 NPC 才可跟进询问主角去向，且提示词与对话规则严格限定“绝不能假装知道目的地”；回复一次后该议题即消除。未目击角色绝不触发此议题。
3. **约定状态核对与空间位置联动**：
   - 约定是否迟到、失约或已经参与，核对故事时间、用户是否接受、实际行动与活动状态。
   - 未确认的邀请（`proposed`）：时间过后安静失效，绝不自动判定为失约或在来信中责备用户。
   - 已确认的约定（`confirmed`）到达时间点时：
     - 若主角已在约定现场地点（`currentPlaceId === venue.id`），导演指示与角色台词提示为“在现场自然碰面或开启当面交流；绝不能声称主角迟到或失约”。
     - 若主角身在其他地点（`currentPlaceId !== venue.id`），等待者仅可询问是否路上耽搁或需要改期，因不知主角目的地，绝不能无端断定主角故意爽约，更不能声称主角已在现场。

---

## 2. 修改文件清单

- `src/modules/world/domain/types.ts`：在 `Fact` 结构中扩展可选元数据 `departure?: { fromPlaceName: string; eventVersion: number }`。
- `src/modules/world/infrastructure/space-repository.ts`：在 `travel` 离开现场生成的 `departureObservation` 中写入 `departure` 元数据。
- `src/modules/world/domain/agenda.ts`：
  - `AgendaThread['kind']` 增加 `'departure_inquiry'` 类型。
  - 在 `buildAgenda` 中为目击离开且尚未发言的角色派发 `departure_inquiry` 议题；已回复后自动清除。
  - 优化 `appointment_due`：空间存在时，基于主角是否身处约定现场区分在场自然碰面与未到场关切询问两种情境，防止机械指责。
  - `eligibleAgenda` 与 `threadFor` 将 `departure_inquiry` 纳入即时待处理高优先级队列。
- `src/modules/world/domain/return-followups.ts`：`followupAgenda` 支持 `departure_inquiry`，确保单次 advance 批次内不重复投递。
- `src/modules/world/application/advance-world.ts`：`cueAgenda` 增加 `departure_inquiry` 真实可见事实校验，防止未目击角色冒领。
- `src/modules/world/domain/clock.ts`：`selectSpeaker` 引入 `departure_inquiry` 发言人选择优先级。
- `src/modules/world/domain/return-message-policy.ts`：`returnMessageLines` 为 `departure_inquiry` 添加严格提示：“你只亲眼看到主角离开原地点，完全不知道他去了哪里；不可假装知晓目的地”。
- `src/modules/world/infrastructure/scene-planner.ts` & `src/modules/world/infrastructure/scene-repository.ts`：
  - `enterPlace` 检查并关联当前地点已生效的确认日程。
  - `ScenePlanner` 与 `commitSceneProposal` 确保仅关联日程的参与者可被邀请入场；无约定时保持零 NPC 候选，杜绝由通讯录关联推断现场在场的幻觉。
- `tests/world-space.test.ts`：补充目击者离开询问、未目击者沉默、回复后消除、在场相遇 vs 缺席关切、未确认邀请安静失效单元测试。
- `tests/integration/world-space.test.ts`：真实 PostgreSQL 环境验证旅行离开后目击事实元数据持久化、目击者专属议题生成及未目击者严格隔离。

---

## 3. 验证结果

1. **代码检查与类型构建**：
   - `npm run check:boundaries`：313 个文件全部通过。
   - `npm run typecheck` (`tsc --noEmit`)：零错误通过。
2. **单元与集成测试**：
   - `npm test`：660 项单元测试全部通过。
   - `npm run test:db`：205 项真实 PostgreSQL 集成测试全部通过，0 项失败，5 项可选跳过。
3. **生产构建**：
   - `npm run build`：Next.js 16.3.5 webpack 生产构建成功，生成 23 个路由。
4. **线上生产环境部署与实测**：
   - 提交 `75c2a07` 推送至 GitHub `main` 分支。
   - Vercel Production 部署 READY（耗时 1m，部署 ID `https://parallel-life-bgpcgfdbz-limengzhe27-boops-projects.vercel.app`，正式地址 `https://parallel-life-nu.vercel.app`）。
   - 公网实测：
     - 健康检查 `GET /api/health` 200 OK。
     - 获取访客 Session 200 OK。
     - 查询官方分支并开启实例 201 Created。
     - 查询空间端点 `GET /api/v1/worlds/:id/space` 返回 200 OK，包含完整地点、双向路线、故事时间与当前位置。
     - 进入现场 `POST /api/v1/worlds/:id/space/enter` 成功返回 200 OK，生成对应现场 Session，`currentSceneId` 联动更新。
