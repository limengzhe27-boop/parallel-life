# 任务交付报告：44-120-RUNTIME-STATUS-RECOVERY-CLOSED-LOOP-I

## 一、任务背景与目标

当玩家或编剧在试演和体验中感到“没有新消息、事件不推进、人物没有回应”时，系统需要能够准确区分是由于以下哪种真实状态引起的，而不是粗暴地统一报错为“生成失败”或假装成功：
1. **时空静候中（合理安静）**：当前没有需要发生的变化（`quiescent`）。
2. **等待玩家（角色等待）**：角色正等待玩家回应、信息或行动决定（`waiting_player`）。
3. **未到触发时机（条件未满足）**：编剧设定了事件节点，但前置条件尚未满足（`conditions_not_met`）。
4. **角色暂缓或退出**：角色已决定暂缓、拒绝或退出当前安排（`deferred_or_withdrawn`）。
5. **处理中**：导演或角色正在思考与组织推进，请求正在处理（`in_progress`）。
6. **已知校验失败**：模型输出未通过物理校验，存在确定性重试依据（`known_failure`）。
7. **调用结果未知**：网络或中断导致付费调用结果待核验，禁止直接重新购买（`unknown_result`）。
8. **旧提案过期**：世界版本已推进，旧提案被自然废弃，未覆盖新状态（`stale_proposal`）。

并且要求：
- **只读诊断**：状态查询必须是纯粹的 SQL 查询，查询一次绝不推进剧情、绝不调用模型、绝不增加版本。
- **原试演后台无缝接入**：使用编剧语言，紧凑且默认收起，展示最近一次有效变化来源，仅存在合法操作时才展示对应按钮；严禁显示 JSON、数据库字段、堆栈或剧透角色秘密。
- **清晰防重与幂等恢复**：已知失败按原协议显式重试（固定派生 Command ID），未知结果引导核对回执，过期提案不覆盖新状态，多标签重复点击防重。
- **隐私与体验保护**：正式玩家不暴露导演后台和人物私人计划；试演状态只在授权范围内可见。

---

## 二、架构契约与代码变更

### 1. 契约定义 (`src/contracts/publication-worlds.ts`)
- 扩展 `TrialPacingPhaseSchema`：
  ```ts
  export const TrialPacingPhaseSchema = z.enum([
    'quiescent',
    'waiting_player',
    'conditions_not_met',
    'deferred_or_withdrawn',
    'in_progress',
    'known_failure',
    'unknown_result',
    'stale_proposal',
    'legacy',
  ]);
  ```
- 保持向后兼容性扩展 `TrialDirectorStatusSchema`：
  - `phase`: `TrialPacingPhaseSchema.optional()`
  - `summary`: `z.string().optional()`（编剧友好的人类可读说明）
  - `lastEffectiveChange`: `z.string().nullable().optional()`（最近一次有效变化，如“玩家发送消息 (v1)”、“收到来自「...」的消息 (v2)”、“到达现场地点 (v3)”）
  - `actionableRecovery`: `z.enum(['retry', 'check_receipt', 'none']).optional()`（安全可控的操作引导）

### 2. 纯只读内核状态读取 (`src/modules/world/infrastructure/director-trial-recovery.ts`)
- 深度重构 `readTrialDirectorStatus` 为只读状态分析器：
  - **阶段 1：旧引擎检查**：`engine_epoch < 2` 明确标记为 `legacy`。
  - **阶段 2：提取最近有效变更**：倒序查询 `world_events`，准确解析 `message`（玩家/角色）、`travel`、`scene`、`appointment` 及其发生的版本号（如 `玩家发送消息 (v1)`），无事件时显示 `开场初始状态 (v0)`。
  - **阶段 3：导演尝试诊断**：
    - `invalid_output` 且带 hash 与 sent_at：`known_failure`，引导 `actionableRecovery: 'retry'`。
    - `request_sent` / `unknown_after_send`：`unknown_result`，引导 `actionableRecovery: 'check_receipt'`，拒绝盲目重新生成。
    - `reserved` / `response_received`：`in_progress`，处理中。
    - `stale_discarded`：`stale_proposal`，明确提案已过期。
  - **阶段 4：角色行动尝试诊断**：检查 `agent_attempts` 活跃 lease，识别正在处理或核验中的对话轮次。
  - **阶段 5：角色责任与计划诊断**：检查 `actor_agent_states`：
    - `responsibilities` 或 `plans` 正在等待玩家（`waitingOn === 'player'` / `player_decision`）-> `waiting_player`。
    - `responsibilities` 或 `goals` 或 `playerDecisions` 包含 `deferred` 或 `declined` -> `deferred_or_withdrawn`。
  - **阶段 6：编剧节点前置条件诊断**：检查 `publication_story_source` 中的 `nodes` 与 `shared_episodes` 状态，当存在编剧节点但尚无活跃 episode 时判定为 `conditions_not_met`（“当前没有满足前置条件的事件，未到触发时机”）。
  - **阶段 7：时空静候判定**：若全流程平稳无挂起任务，判定为 `quiescent`（“当前没有需要发生的变化，时空静候中”）。

### 3. 原试演后台界面整合 (`src/features/publisher/publisher-trial.tsx`)
- 在微信对话框顶部集成紧凑的运行状态栏：
  - 采用编剧语言展示胶囊状态指示（`director.summary` 与 `director.lastEffectiveChange`）。
  - 操作按钮严格按契约收敛：
    - 仅当 `actionableRecovery === 'retry'` 时才显示“重新编排”按钮。
    - 仅当 `actionableRecovery === 'check_receipt'` 时才显示“核对结果”按钮。
    - 其余阶段隐藏危险操作，避免无意义的重复购买或并发混淆。
  - 零技术堆栈暴露、零数据库字段、零剧透人物未公开秘密。

---

## 三、真实数据库集成验证证据

在完全隔离的真实测试数据库（端口 `55432`）上运行全部相关测试：

### 1. 新增专项测试套件
- **测试文件**：`tests/integration/runtime-status-recovery.test.ts`
- **执行结果**：
  ```
  ▶ runtime status and recovery closed loop handles all pacing phases and guarantees read-only purity
    ✔ phase: legacy when world is on legacy engine (epoch < 2) (73.083209ms)
    ✔ phase: conditions_not_met when authored nodes exist but no active episode (36.22825ms)
    ✔ phase: quiescent when world has no authored nodes and is at rest (22.792542ms)
    ✔ phase: waiting_player when actor responsibility waits on player (20.986917ms)
    ✔ phase: deferred_or_withdrawn when actor deferred or declined (21.442833ms)
    ✔ phase: in_progress when attempt is reserved or processing (22.724167ms)
    ✔ phase: known_failure with actionable retry and deterministic command id (24.789209ms)
    ✔ phase: unknown_result with check_receipt and blocked retry (19.975167ms)
    ✔ phase: stale_proposal when attempt is stale_discarded (16.648125ms)
    ✔ phase: quiescent when active episode is ongoing and no pending tasks (25.6835ms)
    ✔ lastEffectiveChange accurately details events across user, actor, and place (27.609792ms)
    ✔ read-only purity: multiple reads do not mutate version, events, or state (37.284333ms)
  ✔ runtime status and recovery closed loop handles all pacing phases and guarantees read-only purity (422.239083ms)
  ℹ tests 13
  ℹ pass 13
  ℹ fail 0
  ```

### 2. 回归验证既有私有试演引导套件
- **测试文件**：`tests/integration/publication-agent-trial-bootstrap.test.ts`
- **执行结果**：
  ```
  ▶ real publisher private trial initializes native runtime atomically without changing genesis
    ✔ foreign owner and old trial cannot bootstrap (25.860792ms)
    ✔ unpaused fresh trial refuses initialization without writes (4.565333ms)
    ✔ failure after actor initialization rolls back all writes (20.746625ms)
    ✔ concurrent repeats initialize once and preserve author world, clock and history (17.750959ms)
    ✔ same draft reuses only native binding without a new draft or reset (5.36875ms)
    ✔ the real trial continues through original NPC and Director services without resetting author history (504.2405ms)
    ✔ known-invalid director retries once through original authored episode and NPC, without resetting history (578.764791ms)
    ✔ unknown paid director output cannot be replaced through the explicit retry entry (123.005042ms)
  ✔ real publisher private trial initializes native runtime atomically without changing genesis (1435.253208ms)
  ℹ tests 9
  ℹ pass 9
  ℹ fail 0
  ```

### 3. 类型与架构边界检查
- `npm run check:boundaries`: `Module boundary checks passed (609 files).`
- `npx tsc --noEmit`: 零类型错误。
- `npx prettier --write`: 所有修改文件排版规范一致。

---

## 四、只读纯度与防重保障核查表

| 要求 | 实现方案 | 验证证据 |
| :--- | :--- | :--- |
| **只读纯度** | 仅使用 SELECT 语句，不产生任何 INSERT/UPDATE/DELETE | `read-only purity` 测试连续并发调用 5 次 + 串行 3 次，`worlds.version`、`world_events`、`attempts` 行数完全不变 |
| **已知失败显式重试** | `directorExplicitRetryCommandId` 基于 `['director-explicit-retry-v1', worldId, attemptId]` 产生确定性 Command ID | `requireDirectorTrialRetrySource` 重复调用返回相同 ID，防重刷新 |
| **未知结果禁止重购** | `request_sent` / `unknown_after_send` 时抛出 `INVALID_COMMAND`，阻止生成新 Command ID | `requireDirectorTrialRetrySource` 严格拒绝并提示核对回执 |
| **过期提案不覆盖新状态** | 检测 `stale_discarded`，明确提示版本前进旧提案已自然失效 | 纳入 `stale_proposal` 阶段，不展示任何覆盖操作 |
| **编剧语言呈现** | 不暴露 JSON/DB 字段/错误栈，提供平实中文说明与最新进展 | UI 只渲染 `summary` 与 `lastEffectiveChange` |
| **隔离与隐私** | 通过 RLS 及 `owner_id = current_setting('app.user_id')` 隔离租户与世界数据 | 跨租户跨世界数据无法查询，NPC 私人秘密不予展开 |

---

## 五、待主 Agent 统一集成的成果清单

1. **工作树与分支**：
   - 工作目录：`/Users/limengzhe/.codex/worktrees/runtime-status120-i/人生剧本`
   - 分支：`codex/runtime-status120-i`
2. **变更文件范围**：
   - `src/contracts/publication-worlds.ts`
   - `src/modules/world/infrastructure/director-trial-recovery.ts`
   - `src/features/publisher/publisher-trial.tsx`
   - `tests/integration/runtime-status-recovery.test.ts`
   - `docs/task-reports/44-120-RUNTIME-STATUS-RECOVERY-CLOSED-LOOP-I.md`
3. **后续建议**：
   - 主 Agent 统一合入 `codex/runtime-status120-i`。
   - 待主 Agent 获取真实模型额度后，按既定验收方案进行真实模型连续对话验证。
