# 44-118 新建世界人物初始位置、位置未知状态与观察资格接线

负责人：codex-ma44-118-actor-initial-position-i，独立工作树 `actor-initial-position118-i`，分支 `codex/actor-initial-position118-i`。
完整提交 SHA：`e09ff5c7ccb23df1f36bf0de1a82eb61f514e8fc`。
整合依赖基线：`6514bd5ed1386fa528f15b1dc18dff4c366efb96`，顺序整合 113 (`a2309e5f`) → 114 (`4d9dd341`) → 115 (`f7eb2ce0`) → 116 (`5e421bc8`) → 117 (`19efaff1`) → 118 (`e09ff5c7`)。
0 付费大模型调用、0 批量生图、0 生产数据库修改、不自行部署。

---

## 一、解决的问题与核心原则

在新世界创建与人物初始化中，以往缺乏对人物空间位置的明确依据，容易出现为了让剧情跑通而把所有人物强制拉到玩家身边，或把作者提及的工作地点/住所/常去地点误当成开场实际在场位置的问题。本任务实现严格的空间状态接线与知情隔离：

1. **严格区分三类空间信息**：
   - **作者明确指定的开场实际位置**（`initialPlaceKey`）：仅在作者显式指定、且地点存在并为合法已知地点时生效；
   - **人物关联/常去地点**（如住所、工作单位、联系地点、候选事件场景）：作为背景设定保留，**绝不自动充当开场实际在场依据**；
   - **当前实际位置未知**（`status: 'unknown'`, `placeId: null`）：未显式指定开场位置时，缺省保持完全未知。
2. **创世来源机制与重放保护**：
   - 权威位置记录表 `parallel_life.world_authoritative_positions` 增加对创世初始位置（`source_version = 0`, `source_event_id = NULL`）的合法支持；
   - 约束规则严格保持：`(source_version = 0) = (source_event_id IS NULL)`；
   - 人物或玩家后续移动（`source_version >= 1`，具有实际事件来源）严格覆盖版本 0；
   - 创世初始化重放采用版本保护（`WHERE world_authoritative_positions.source_version < excluded.source_version`），**绝不覆盖人物后续已经发生的真实移动**。
3. **双入口统一覆盖**：
   - 后台新建私有试演（`trials.startTrial`）；
   - 已发布作品的新玩家世界实例化（`worlds.startPublished`）；
   - 两条入口复用同一套创世编译契约（`compilePublicationGenesis`）与存储过程（`publication_commit_internal`），语义完全一致。
4. **位置与知情严格隔离**：
   - **未知位置人物可合法私聊**：位置未知的人物依然拥有合法的私聊渠道，可正常与玩家收发手机消息；
   - **未知位置无现场与出行资格**：由于缺少实际起点（`missing_origin`），未知位置人物无法合法发起移动，也不能凭空进入现场目击；
   - **同地不等于目击**：即使身处同一地点，没有合法观察条件时不产生亲眼所见的知情记录；
   - **NPC 不获得无来源的玩家位置**：人物仅持有本人位置与有合法来源的他人事实。
5. **保护旧档**：
   - 仅对新建世界应用创世位置接线；不修改历史已存在的世界存档，不破坏已有数据库约束。

---

## 二、修改的文件与工程改动

1. **作者协议与内容校验**：
   - `src/contracts/published-world-content.ts`：`PublishedActorSchema` 新增可选 `initialPlaceKey: key.optional()`；
   - `src/modules/settings/domain/publication-content.ts`：`PublicationContent['actors']` 新增可选 `initialPlaceKey?: string`；增加 `unknown_place` 与 `initial_place_not_known` 边界校验；
   - `src/modules/settings/application/publication-runtime.ts`：`PublicationOpeningMetadata['contacts']` 新增可选 `initialPlaceId?: string`；
2. **创世编译与落库**：
   - `src/modules/settings/infrastructure/publication-genesis.ts`：在编译时将合法的 `initialPlaceKey` 映射至 `world.actors[i].initialPlaceId`；
   - `src/modules/settings/infrastructure/publication-world-repository.ts`：在准备检查（`validatePrepared`）中严格核验 `initialPlaceId` 与作者内容的一致性；
3. **数据库迁移**：
   - `db/migrations/0087_actor_initial_positions.sql`：本地迁移允许 `world_authoritative_positions.source_event_id DROP NOT NULL`，添加 `source_version >= 0` 与 `(source_version = 0) = (source_event_id IS NULL)` 约束；在 `publication_commit_internal` 中写入创世位置；
4. **领域模型与认知隔离**：
   - `src/modules/world/domain/world-awareness.ts`：`AuthoritativePosition` 的 `sourceEventId` 类型放宽至 `string | null`；`checkedJourney` 兼容版本 0 无事件初始起点的行程校验；
   - `src/modules/world/domain/agent-travel.ts`：`ownPositionValid` 允许 `worldVersion === 0 && sourceEventId === null` 作为有效起点；未设位置角色返回 `missing_origin` 拒绝；
   - `src/modules/world/infrastructure/agent-runtime-repository.ts`：`authoritativePosition` 提取适配创世版本 0；
   - `src/modules/world/infrastructure/agent-scene-environment.ts`、`actor-scene-observation-sources.ts`、`agent-snapshot-repository.ts`、`director-snapshot-repository.ts`、`agent-source-authorization.ts`：同步适配版本 0 创世事实读取；
5. **集成旅程测试**：
   - `tests/integration/actor-initial-position-awareness.test.ts`：全链路聚焦测试。

---

## 三、必要验证结果

### 1. 独立聚焦测试（118）
运行命令：
```bash
node --test tests/integration/actor-initial-position-awareness.test.ts
```
测试结果：
- ✔ 1. 作者边界校验：明确设置的开场位置被正确保留；未指定位置保持未知；常去地点未被误当当前所在；非法/未探索地点被拦截报错；
- ✔ 2. 真实数据库双入口实例化（试演 + 正式玩家）：权威位置表中 player 与林木（明确设定）正确写入 `source_version = 0`, `source_event_id = NULL`；小安（未设位置）写入 `status: 'unknown'`, `placeId: null`；不同玩家/试演实例数据物理隔离；
- ✔ 3. 人物认知与私聊隔离：位置未知的人物无法发起行程（拒绝原因 `missing_origin`），无现场参与资格，但可通过私聊渠道正常收发短信，对白上下文保持 unknown 不泄露虚构物理在场；
- ✔ 4. 移动进阶与重放保护：合法移动后权威位置更新为版本 2+；再次重放创世版本 0 时，被原子冲突条件拦截，新位置不被覆盖；
- ✔ 5. 113-118 连续旅程集成：结构化计划承诺落库 → 导演快照安全读取实情 → 实际到达与暂缓再评估 → 认知定向传播，全程真实 Postgres 事务提交。
- **6/6 测试全部通过，耗时 505ms**。

### 2. 114—118 连续测试组合验证
运行命令：
```bash
node --test tests/integration/npc-commitment-journey.test.ts tests/integration/arrival-scene-reconsideration.test.ts tests/integration/episode-defer-reconsideration.test.ts tests/integration/episode-action-outcome-awareness.test.ts tests/integration/actor-initial-position-awareness.test.ts
```
测试结果：
- **10/10 测试全部通过，0 失败**。

### 3. 工程边界与类型检查
- `npm run check:boundaries`：**600 个文件模块边界检查全部通过**；
- `npx tsc --noEmit`：**零 TypeScript 类型错误**。

---

## 四、发布说明与部署影响

1. **数据库迁移**：新增本地迁移 `db/migrations/0087_actor_initial_positions.sql`。在生产部署前必须先应用该迁移。支持向前向后回滚。
2. **配置变动**：无环境变量或密钥变动。
3. **旧数据影响**：无旧存档回填，旧存档不受影响；仅对新建世界生效。
4. **回滚方式**：回滚对应 commit，回退 0087 迁移即可恢复至原结构。

---

## 五、交付结论

- 状态：**[ ] 待验收**
- 完整 SHA：`e09ff5c7ccb23df1f36bf0de1a82eb61f514e8fc`（基于 `6514bd5ed1386fa528f15b1dc18dff4c366efb96`，顺序整合 113-117）
- 分支：`codex/actor-initial-position118-i`
- 无冲突、无阻断，已完成全部本地聚焦验证、真实 PostgreSQL 事务校验与类型检查，移交主 Agent 统一审核、集成与部署。
