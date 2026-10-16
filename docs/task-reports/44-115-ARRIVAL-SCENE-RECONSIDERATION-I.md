# 44-115 真实到达与现场进入后未演作者事件重新考虑接线报告

负责人 codex-ma44-115-arrival-i，独立工作树 arrival-scene115-i，基线 6514bd5ed1386fa528f15b1dc18dff4c366efb96。

## 核心解决的问题

111 实现了相关人物出现真实新计划（`plan_changed`）、玩家决定（`player_decision`）或行动结果（`action_result`）后的未演作者事件重新考虑。
但 111 保留了 OPEN：玩家或 NPC 真实到达相关地点、进入相关现场后，若未改变原作者 qualificationKey（例如事件前提中未配置 at_place 条件，但事件本身属于该地点现场），系统无法识别该物理事实作为新依据，导致事件在首轮 quiet 后永久失去重评机会。

本轮完成了物理到达与现场进入的端到端真实接线：
玩家或 NPC 真实到达相关地点（`travel.completed` / `agent.arrival_committed`）或进入相关现场（`scene.entered`）后，即使原作者事件前提资格未变，系统也能认证新的实际物理依据，触发一次稳定的导演重新考虑机会。

## 严格四阶段语义区分

1. **获得重评资格**：真实物理到达/入场后，仅代表作者材料获得一次导演评估机会；
2. **导演提出机会**：导演在 snapshot 评估中决定提出 `bounded_opportunity`，允许安静（quiet）或暂缓；
3. **人物独立参与**：相关角色独立根据自身状态决定 engage 或 quiet，不强迫参与；
4. **事件实际完成**：进入 shared episode active 状态，由后续实际演绎与条件满足推进，绝不在到达或机会提出时自动标为已演或完成。

## 真实调用链与技术实现

1. **来源认证器（`src/modules/world/infrastructure/authored-reconsideration-evidence.ts`）**：
   - 严格认证原内核已提交的真实物理事件：`travel.completed`、`agent.arrival_committed`、`scene.entered`；
   - 强校验 `world_events` 与 `commands` 关系：`c.status = 'succeeded'` 且 `c.result_event_id = e.id`，杜绝伪造事件；
   - 物理证据核验：
     - `travel.completed`：核验 `fromPlaceId`、`toPlaceId`、`departedAt`、`arrivedAt` 及 `storyAt`；
     - `agent.arrival_committed`：核验 `data.actorId`、`journeyId`、`route.toPlaceId`，并通过 `parallel_life.npc_journeys` 校验实际行程状态 `status = 'arrived'`；
     - `scene.entered`：核验 `parallel_life.scene_sessions` 现场记录、地点及 `presence` 实际在场参与者；
   - 过滤口头说法：玩家在聊天中说“我到了”只产生 `turn.resolved`，不具备物理到达认证，绝不触发到达依据；
   - 过滤非到达 `new_condition`：普通时钟 tick、离开出发（`in_transit`）等不作为到达依据。

2. **领域精准匹配（`src/modules/world/domain/authored-reconsideration.ts`）**：
   - 扩展 `authoredReconsiderationEvidence` 接收 `placeIds: readonly string[]`（来自材料中 `placeRefs` 状态为 `resolved` 且 `availableInWorld` 的地点）；
   - 双向严格匹配：
     - 玩家到达：必须 `places.has(reason.placeId)`；
     - NPC 到达：必须 `actors.has(reason.actorId)` 且 `places.has(reason.placeId)`；
     - 无地点事件：`places` 为空，任何地点的到达均不触发重评（“没有明确关联依据时，不猜测、不自动给所有事件绑定地点”）；
     - 无关地点/无关人物移动：`places.has` 或 `actors.has` 为 false，严格隔离。

3. **稳定去重与防循环（`src/modules/world/infrastructure/narrative-wake-repository.ts`）**：
   - 同一物理到达生成稳定原因 ID（`${event.id}:new_condition:${event.id}`）；
   - 自然融入 `contextToken([token(q), evidenceIds])`，一旦在某版本被导演评估（无论 quiet 还是 propose），即落入 `paidReviewContexts`；
   - 后续时钟推进、普通闲聊、页面刷新等不会改变上下文 token，彻底杜绝死循环重买与重复唤醒；
   - 当玩家离开后再次返回该地点时，产生全新版本事件 ID，允许合法获得再次重评机会。

4. **位置事实与知情隔离**：
   - 导演仅在全局 narrative wake 边界内使用物理到达作为重评触发依据；
   - 不修改 `actor_position_knowledge`，不知情角色不接收玩家实时坐标下发，知情传播继续严格受限于现场在场与获准通报。

## 验证证据

- **领域单元测试** (`tests/authored-reconsideration.test.ts`):
  - 2/2 通过。覆盖语义变更、NPC 到达匹配、玩家到达匹配、现场进入匹配、无关地点过滤、无关人物过滤、无地点事件过滤、未认证 tick 过滤。
- **本地真实 PG 聚焦旅程测试** (`tests/integration/arrival-scene-reconsideration.test.ts`):
  - 1/1 通过（本地 PostgreSQL 55432）。
  - 旅程完整覆盖：
    1. 启动并 bootstrap -> 导演初始 quiet -> wake cause 为 null；
    2. 玩家口头发送“我到了，就在门口” -> 验证 wake cause 保持 null（口头聊天不等于到达）；
    3. 玩家真实 travel 到 `away` -> 验证仅 `meeting_at_away` 唤醒（`meeting_at_shop` 与无地点事件不唤醒）；
    4. 导演评估 quiet -> 推进时钟/刷新 -> 验证无重复唤醒；
    5. 玩家返回 `shop` -> 验证触发 `meeting_at_shop` 重新考虑；
    6. 导演提出 opportunity -> NPC 独立 engage -> episode 变为 active；
    7. 再次推进 -> 不重复购买、不循环调用；
    8. 检查 `actor_position_knowledge` -> 证实 NPC 无任何玩家位置数据泄露。
- **既有回归集成测试** (`tests/integration/director-semantic-wake.test.ts`):
  - 18/18 全部通过，无任何破坏性回归。
- **架构与类型检查**:
  - `npm run check:boundaries`: 600 files passed.
  - `npx tsc --noEmit`: 0 errors.

## 资源消耗与上线约束说明

- 0 真实大模型调用，0 真实费用。
- 0 生产环境改动，0 生产数据操作。
- 0 新增 SQL 迁移，复用现有 `parallel_life` 表结构。
- 交付范围严格限定在已声明的 6 个文件。
