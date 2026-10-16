# 44-99 人物知情传播与唤醒专属任务报告

- **负责人**: codex-followup94-b
- **任务基线**: `c1a5cb996b34176c6a098d023da1290fe919bb1e`（44-98 LIMITED FINAL READY）
- **开发工作树**: `/Users/limengzhe/.codex/worktrees/npc-followup94/人生剧本`（分支 `codex/actor-observation99-b`）
- **交付状态**: 待验收（纯领域与仓储组件完成，真实 Postgres 集成验证通过，待主 Agent 冻结 SQL 迁移及核心接线）

---

## 一、实现目标与范围收敛

上一轮 4f16a7d7 中的 `projectCommittedEventObservations` 存在盲目信任调用方传入现场、私聊接收人和位置说法的问题，本轮彻底废除调用方伪造可能，收敛如下：

1. **复用 44-98 真实现场认证**：
   - 不再自行设计第二套现场或私聊检索逻辑，直接复用已上线的 `readActorSceneObservationSourcesInTransaction`；
   - 依赖其底层强校验：真实 succeeded 命令与事件来源、精确 producer 映射、真实入场依据（`joinedVersion <= eventVersion`）、`observableTo` 与遗忘过滤；
   - 杜绝不在场角色、晚入场角色及未授权角色获得待处理观察。
2. **待处理观察仓储结构与状态流转**：
   - 实体 `ActorPendingObservation`：记录 `sourceId`、`kind`（如 `scene_entry`）、`evidenceKind`（如 `scene_present_utterance`）、`eventOccurredAt`、`storyAt`、`retrievedAt` 及 `status: 'pending' | 'consumed' | 'omitted'`；
   - 重放幂等性保证：同一来源再次摄取时，若已有记录为 `consumed` 则不覆写回 `pending`，严格保证状态机单向流转。
3. **确定性候选生成与防重复唤醒**：
   - 稳定候选 ID：`candidate:observation:${actorId}:${sourceId}`，完全由权威观察条目确定，普通聊天、刷新或时钟跳变无法生成虚假候选；
   - 显式消费确认机制：提供合法且非空的 `consumedTurnReceiptId` 才能核销；
   - 上下文预算溢出保护：因 token 预算裁剪而被省略的观察（`omittedSourceIds`）绝对不标记为 consumed，保持 pending 供后续回合重新处理；
   - 明确支持 `quiet` 决策消费：NPC 评估观察后决定安静也是合法回合，提交成功有真实 receiptId 即可核销，彻底消除“安静导致不断重复唤醒”的死循环；
   - 绝不使用 `projectedWorldVersion` 替代条目级消费核销。

---

## 二、交付文件范围（严格限制在 B 专属文件，0 公共修改）

1. `src/modules/world/domain/actor-pending-observation.ts`:
   - 纯领域类型与状态机逻辑；
   - `deriveObservationCandidates`: 基于 pending 观察提取确定性调度候选；
   - `filterSuppliedObservations`: 排除上下文预算省略项。
2. `src/modules/world/infrastructure/actor-pending-observation-repository.ts`:
   - `ActorPendingObservationRepository` 接口规范；
   - `InMemoryActorPendingObservationRepository`: 参考实现，含幂等写入、按时序与版本读取、带回执与预算过滤的核销逻辑；
   - `ingestSceneObservationsToPendingRepository`: 适配器函数，调用 44-98 `readActorSceneObservationSourcesInTransaction` 并在同事务中将合法观察写入仓储。
3. `tests/integration/actor-pending-observation-wake.test.ts`:
   - 真实 Postgres（`parallel_life_test`）环境下的 5 组关键规则聚焦集成测试。

---

## 三、真实 Postgres 验证证据

执行测试：`node --experimental-strip-types --test tests/integration/actor-pending-observation-wake.test.ts`

```text
▶ actor pending observation repository and wake integration (real Postgres)
  ✔ Rule 1: Present hearer A receives pending observation; absent B receives zero observations and zero candidates (271.491083ms)
  ✔ Rule 2: Late joiner Charlie (joinedVersion > eventVersion) receives zero backfilled past scene observations (48.643584ms)
  ✔ Rule 3: Replaying the exact same scene source produces zero duplicate observations and an identical candidate ID (49.301417ms)
  ✔ Rule 4: NPC turn handling observation (even quiet) acknowledges consumption upon success and avoids repeated wake-up (39.3435ms)
  ✔ Rule 5: Observations that are uncommitted, unknown, or omitted due to budget limits are NOT acknowledged as consumed (37.554791ms)
✔ actor pending observation repository and wake integration (real Postgres) (527.149334ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 899.488333
```

质量检查：
- `npm run check:boundaries`: 590 files passed.
- `npm run typecheck`: 0 errors.

---

## 四、区分“纯组件已实现”与“运行时已接入”

- **纯组件与仓储已实现（本 PR 交付）**:
  - 待处理观察定义与确定性候选生成算法；
  - 44-98 真实现场认证摄取适配；
  - 防重复唤醒、预算省略保护及静默合法消费状态机；
  - 真实 Postgres 数据库集成测试。
- **运行时待接线（需主 Agent 统一接入）**:
  - 生产持久化表定义（建议新增 `actor_pending_observations` 表，由主 Agent 统一定义 SQL 迁移，不挪用已有的 `actor_position_knowledge`）；
  - 调度器接入：在 `scheduleAgents` 中注入待处理观察候选，与私聊/原规划候选竞价；
  - 回合结束钩子：在 `runNpcAgent` 事务提交成功并生成真实 `turnReceiptId` 后，触发 `repo.acknowledgeConsumed`。

---

## 五、合规与约束声明

1. **无大模型调用**: 验证全程使用领域断言和模拟回执，消耗 0 模型 token，产生 0 费用；
2. **无生产数据与环境篡改**: 测试使用本地 `parallel_life_test`，未碰触生产库，未启用 `epoch2`；
3. **无公共契约与 SQL 冲突**: 遵循分工约定，仅编写独立组件，等待主 Agent 统筹合并与部署。
