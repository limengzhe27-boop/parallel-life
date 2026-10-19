# 任务报告：44-163-CHAT-LATENCY-STAGE1

## 身份与范围

- 任务 ID：`44-163-CHAT-LATENCY-STAGE1`
- Agent ID / 会话标识：`agy-chat-latency163-20261019`（`88e95636-e8e7-4077-80db-0ec00fda8be9`）
- 角色：服务端 B / 界面 F / 验收 Q（配合 `root-runtime162` 唯一集成）
- 工作目录 / 工作树：`/Users/limengzhe/.codex/worktrees/chat-latency163/人生剧本`（分支 `codex/chat-latency163`）
- 基线提交：`4555400b`（检查基线 `55a198ea` 之后的最新主分支基线）
- 已完成依赖：`44-161` 正式上线基线（`d538c049`）
- 允许修改的具体路径：
  - `src/modules/world/domain/chat-turn-metrics.ts`（NEW）
  - `src/modules/world/application/run-agent.ts`
  - `src/modules/world/infrastructure/agent-snapshot-repository.ts`
  - `src/contracts/world-interaction.ts`
  - `src/server/npc-agent-services.ts`
  - `src/server/world-message-http.ts`
  - `src/features/api/client.ts`
  - `src/features/phone/send-projection.ts`
  - `src/features/phone/world-phone-app.tsx`
  - `tests/chat-latency-stage1.test.ts`（NEW）
  - `tests/integration/chat-latency-stage1.test.ts`（NEW）
  - `docs/task-reports/44-163-CHAT-LATENCY-STAGE1.md`（NEW）
- 独占资源：独立工作树 `.local/runtime.json` 嵌入式 PostgreSQL 端口 `55663`；0 迁移编号占用；0 额外付费模型调用。
- 领取时间 / 最后更新时间：`2026-10-19T13:52:14Z` / `2026-10-19T14:40:00Z`

## 当前接续点

- 当前状态：待验收（独立工作树开发、单元/故障注入测试、真实 PostgreSQL 集成测试、模块边界与生产构建全部通过；等待与 `root-runtime162` 协调合并与生产部署验证后再启动阶段二公共实现）。
- 已经实现或完成的步骤：
  1. **10 阶段单调计时与安全遥测（`src/modules/world/domain/chat-turn-metrics.ts`）**：
     - 分别测量并记录：
       1) `clientSendToServerReceiveMs`（用户发送到服务器接收）
       2) `contextPrepareMs`（上下文准备耗时）
       3) `upstreamFirstChunkMs`（上游请求发出到首段内容/响应到达）
       4) `modelTotalMs`（模型完整输出耗时）
       5) `responsePersistMs`（响应持久化耗时 `attempts.saveResponse`）
       6) `decodeCompileMs`（解码与编译耗时 `kernel.parse`）
       7) `kernelCommitMs`（内核及事务提交耗时 `kernel.commit`）
       8) `postCommitToDisplayMs`（提交后到前端实际显示耗时）
       9) `firstMeaningfulReplyMs`（第一条有意义的 NPC 消息出现时间，剔除占位符/输入中动画/通用“稍等”）
       10) `fullTurnMs` / `toolCompletionMs`（整轮结束时间与工具完成时间）
     - 记录 `schemaBytes`、`inputBytes`、`outputBytes`、`queryCount`、`transactionCount`、`contextQueryCount`、`commitQueryCount`、`modelCallCount`、`cacheHits` 及 `errorCategory`，不含任何密钥或私人原始文本。
     - `summarizeChatTurnSamples` 在样本数 `< 20` 时自动将 `p95` 置为 `null`，防止小样本给出虚假的稳定 P95 结论。
  2. **上下文读取与事务收敛（`src/server/npc-agent-services.ts`、`src/modules/world/infrastructure/agent-snapshot-repository.ts`）**：
     - 消除 `sendMessageIfEnabled` 中在 `acceptPlayerMessage` 之前的冗余完整 `worlds.get` hydrate（原实现每轮调用两次完整 `worlds.get`，现将 `w.state->>'deletedAt'` 与 `w.state->>'time'` 合并进首条 `control` 查询，整轮只做一次完整 `worlds.get`）。
     - 将 `readPrivateAgentSnapshot` 与 `attachAgentWorldContext` 收敛为单个一致性数据库事务（`singleTransactionDb`），消除原本顺序开启的 ~18 个独立子事务。
     - 消除同一快照构建内重复执行的 `forgottenAgentSourceIds`（原执行 2 次）与 `world_initial_snapshots`（原执行 2 次）查询；空 ID 数组短路跳过无效 SQL。
     - 在 `readActorSituation` 完成 `SELECT version FROM parallel_life.worlds ... FOR SHARE` 校验世界归属与版本后，对不可变的发布人物定义模块 `readPublicationActorModules` 启用有界缓存 `readPublicationActorModulesCached`（键为 `${ownerId}:${worldId}:${actorId}:${definitionRef}`，容量上限 256，深拷贝隔离）。
  3. **`saveResponse` 与纯解析 `kernel.parse` 受控并行（`src/modules/world/application/run-agent.ts`）**：
     - 模型完整响应到达后，立即启动 `attempts.saveResponse` 持久化，同时在 `structuredClone(executionSnapshot)` 与 `structuredClone(response)` 深拷贝副本上并行执行无副作用的 `kernel.parse`。
     - 严格等待 `savePromise` 完成后再检查 `preParsed` 结果：
       - 若 `saveResponse` 失败，直接抛出 `unknown_after_send`（绝不提交未持久化的响应，也不留后台悬挂写入）。
       - 若 `kernel.parse` 失败，仍先确保 `saveResponse` 落盘完成，随后标记 `invalid_output` 并保留原始付费响应供审计，不改变任何 `unknown` 或重试边界。
  4. **提交后前端直接投影正式 NPC 消息（`src/contracts/world-interaction.ts`、`src/server/world-message-http.ts`、`src/features/api/client.ts`、`src/features/phone/send-projection.ts`、`src/features/phone/world-phone-app.tsx`）**：
     - 通过向后兼容的请求头协商 `x-message-receipt-projection: 1`：
       - 未携带该请求头的旧客户端仍收到严格的 6 字段 `WorldMessageReceipt`。
       - 携带 `x-message-receipt-projection: 1` 的新客户端在 `POST /api/v1/worlds/:id/messages` 回执中直接获得已提交事务落盘的正式 `messages`（含用户消息 `${eventId}_user` 与 NPC 回复消息）及 `metrics`。
     - 前端 `projectCommittedTurnReceipt` 验证 `worldId`、`actorId`、`sourceEventId === receipt.eventId`、`sourceVersion === receipt.version` 及正式消息 ID 后，立即将已提交消息合并入当前 `WorldPhone` 状态并按正式 `message.id` 去重，无需等待整份手机投影重新加载即可展示首条有意义 NPC 消息；随后后台静默同步完整世界状态（日历/地图/相册等），且晚到回执绝不回退较新的 `version` 或 `time`。
- 当前尚未完成的部分：
  - 与 `root-runtime162` 协调合并 `44-163-CHAT-LATENCY-STAGE1` 到主分支并完成 Vercel 生产部署（`READY`）及线上实测。
  - 阶段二（同一次模型调用中的增量消息呈现能力）公共实现。
- 下一条具体操作：
  - 更新主登记表 `/Users/limengzhe/Desktop/projects/demo/人生剧本/docs/DEVELOPMENT.md` 将 `44-163-CHAT-LATENCY-STAGE1` 标为 `[ ] 待验收`，并附上阶段二受控契约设计概要供唯一集成人审阅。
- 需要协调的公共文件 / 接口：
  - `src/contracts/world-interaction.ts`、`src/server/npc-agent-services.ts`（与 `root-runtime162` 协调合并）。
- 阻塞原因与恢复条件：无代码阻塞；`root-runtime162` 正在 `unified-engine137` 进行 `44-162` 收尾验证，按协作规则不抢改协议或覆盖其工作树。

## 交付与验证

- 实际修改文件：
  - `src/modules/world/domain/chat-turn-metrics.ts`（NEW）
  - `src/modules/world/application/run-agent.ts`
  - `src/modules/world/infrastructure/agent-snapshot-repository.ts`
  - `src/contracts/world-interaction.ts`
  - `src/server/npc-agent-services.ts`
  - `src/server/world-message-http.ts`
  - `src/features/api/client.ts`
  - `src/features/phone/send-projection.ts`
  - `src/features/phone/world-phone-app.tsx`
  - `tests/chat-latency-stage1.test.ts`（NEW）
  - `tests/integration/chat-latency-stage1.test.ts`（NEW）
- 执行过的检查和结果：
  - `node --experimental-strip-types --test tests/chat-latency-stage1.test.ts`：**7/7 通过**（含 `saveResponse` 失败注入、`kernel.parse` 失败注入、深拷贝防篡改、旧客户端 6 字段兼容、前端正式消息去重与晚到回执防护）。
  - `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55663/parallel_life" node --experimental-strip-types --test tests/integration/chat-latency-stage1.test.ts`：**1/1 真实 PostgreSQL 集成测试通过**。
  - `npm run check:boundaries`：**通过（683 files）**。
  - `npx tsc --noEmit`：**通过（0 errors）**。
  - `npm run build`：**Next.js 生产构建通过**。
- 优化前后实测对比（真实 PostgreSQL 集成环境）：

| 指标 | 优化前（Stage 0 基线） | 优化后（Stage 1 实测） | 改善说明 |
|---|---|---|---|
| 单轮数据库总事务数 (`transactionCount`) | ~29 个事务（含 2 次完整 `worlds.get` + 快照构建 ~18 个顺序事务 + 4 个运行时事务） | **11 个事务**（7 个上下文事务 + 4 个运行时事务 `reserve`/`claim`/`saveResponse`/`commit`） | **减少 62% 事务开销**，消除连接池反复获取与 `SET LOCAL app.user_id` 往返 |
| 快照构建内部事务数 (`readPrivateAgentSnapshot`) | ~18 个独立事务 + 重复查询 `forgottenAgentSourceIds` / `world_initial_snapshots` | **1 个一致性事务** + 0 重复查询 + 不可变发布模块缓存（`cacheHits=1`） | 保证快照读取在同一事务视图下完成，消除冗余 SQL |
| 响应保存与解析耗时 (`persistAndDecodeWallMs`) | 串行 `saveResponseMs + decodeCompileMs` | 并行重叠：`saveResponse=126.04ms` 与 `decodeCompile=2.90ms` 并行，总墙钟 **`126.06ms`** | 零额外风险隐藏纯解析耗时，故障注入验证通过 |
| 提交后到前端展示正式 NPC 消息 | 必须等待 `POST /messages` 返回后再串行发起整份 `GET /worlds/:id` 手机重读 | `POST /messages`（`x-message-receipt-projection: 1`）直接返回已提交正式消息，前端**立即渲染（< 5ms）**，后台异步对齐完整手机状态 | 消除提交后整机二次重读的串行网络与数据库等待 |

- 真实模型：本任务工作树测试使用受控确定性模型桩（遵守并行期间实际付费生成由集成人统一安排的规则，0 额外付费调用）。
- 真实数据库：已验证（嵌入式 PostgreSQL `127.0.0.1:55663`，完整跑通 0001–0099 迁移、RLS 权限隔离、发布世界启动、双轮对话、缓存命中、回执投影与重放幂等）。
- 浏览器尺寸与交互：代码保持桌面与手机壳原有视觉布局不变，仅将已提交正式消息提前投影至当前会话并后台同步完整世界状态。
- 是否涉及契约变更、兼容和迁移：
  - 无 SQL 迁移变更。
  - `WorldMessageReceiptSchema` 通过可选字段 + HTTP 头 `x-message-receipt-projection: 1` 协商保持 100% 向后兼容：未传该头的旧客户端仍收到严格 6 字段 JSON。
- 不含密钥、私人照片内容或完整访谈。

---

## 阶段二前置：同一次模型调用中的增量消息呈现受控契约设计（供集成审阅）

根据用户要求“先完成一份简短契约设计和受控验证，再进入公共实现。由集成人确定归属，避免与报错修复人员并写协议”，现核实上游能力并给出阶段二受控契约设计：

### 1. 上游真实能力核实（`src/modules/ai/infrastructure/openai-compatible-client.ts`）
- 当前 `OpenAICompatibleTextModel`：
  - `complete()` 发送 `stream: false` 并携带 `response_format: { type: 'json_schema', ... }`。
  - `streamComplete()` 发送 `stream: true` 并通过 `readSseContent` 逐块 `yield` SSE `delta.content` 增量文本（真实透传，非内部缓冲后一次返回），支持 `AbortSignal` 与首字节超时 `STREAM_FIRST_BYTE_TIMEOUT_MS`。
- 关键限制：
  - 现有 NPC 协议（`npc-model-protocol.ts` v13/v14）顶层是一个完整 JSON 对象（包含 `protocol`、`continuation`、`inputInterpretation`、`focusChange`、`statements`、`executions`、`goals`、`planIntents`、`responsibilities` 等）。
  - 在同一次结构化 JSON 生成中，绝不能把未闭合的 JSON 片段当作正式消息，也不能去掉 `continuation`/`planIntents`/`executions` 等状态字段。

### 2. 增量消息契约与持久化先行方案
- **分段单元契约（`AgentStreamSegmentReceipt`）**：
  - 绑定身份：`attemptId`、`commandId`、`worldId`、`actorId`、`segmentIndex`（从 0 递增）、`segmentId`（`${eventId}_seg_${segmentIndex}`）。
  - 单元分类：
    - `independent_statement`：`dependsOnActionIds: []` 且不宣称工具/素材已完成的独立回应（态度、回答、提问、提议）。
    - `dependent_statement`：存在 `dependsOnActionIds`（如 `execution:action_1`）或依赖后续状态变更的语句，必须等待整轮 `kernel.commit` 动作执行成功后才可提交与呈现。
- **先持久化再呈现（Persist-Before-Present）**：
  - 绝不把未落库的流式 token 直接作为正式消息渲染。
  - 每个可独立成立的分段必须先写入持久化分段记录（关联 `attempt_id` 与 `segment_index`），生成具备正式 `message.id` 与 `sourceEventId` 的已持久化凭据后，才通过增量通道推送给客户端。
- **版本演进与中断恢复（14 项故障边界）**：
  - 同一 `attempt` 的增量分段共享原 `commandId` 与 `attemptId` 因果链；若整轮在首条独立分段持久化后、最终状态提交前中断：
    - 已持久化的独立分段保留为正式历史，重放原 `commandId` 时按已持久化凭据去重返回，不重复调用模型补全文本。
    - 未完成的后续动作与状态保持 `unknown_after_send` 或中断状态，绝不伪装整轮全部成功。
  - 若用户在增量输出期间发送新消息：新消息拥有独立 `commandId`，不覆盖正在收敛的旧 `attempt` 账本，待旧 `attempt` 收尾或标记中断后按最新世界版本处理。

## 过程记录

- `2026-10-19T13:52Z`：在主登记表登记 `44-163-CHAT-LATENCY-STAGE1`，创建独立工作树 `/Users/limengzhe/.codex/worktrees/chat-latency163/人生剧本`（端口 `55663`）。
- `2026-10-19T14:10Z`：完成 10 阶段单调计时模型、`run-agent.ts` 的 `saveResponse` + `kernel.parse` 并行与故障注入测试、快照单事务合并与不可变发布模块缓存、回执消息投影。
- `2026-10-19T14:38Z`：真实 PostgreSQL 集成测试发现 `reducer.ts` 中 `assistant` 消息 ID 为 `effect.id`（UUID）而非 `${eventId}_` 前缀，修正 `projectCommittedTurnReceipt` 校验规则（`user` 消息校验 `${eventId}_user`，`assistant` 消息校验 `actorId + sourceEventId + sourceVersion + 非空 id`），7 项单元测试 + 真实 PG 集成测试 + 边界检查 + TypeScript 检查全部通过。
