# 44-164-CHAT-LATENCY-STAGE2 进度与交接报告

- **任务 ID**：`44-164-CHAT-LATENCY-STAGE2`
- **当前状态**：`[x] 已完成`（生产迁移 0100 已应用，上线业务提交 `a5fce517`，Vercel `dpl_HprcPBKsRwScBb4h9SNGNvaGMsfA` READY，公网别名 `https://parallel-life-nu.vercel.app` 实测验证全部通过）
- **独立工作树**：`/Users/limengzhe/.codex/worktrees/chat-latency163/人生剧本`（分支 `codex/chat-latency163`，基于 `145b2ab3`）
- **主登记表**：`/Users/limengzhe/Desktop/projects/demo/人生剧本/docs/DEVELOPMENT.md`

---

## 一、已完成并落盘的文件与能力（阶段二 `44-164`）

1. **数据库迁移 [0100_agent_attempt_stream_segments.sql](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/db/migrations/0100_agent_attempt_stream_segments.sql)**
   - 新建 `parallel_life.agent_attempt_stream_segments` 表，含 RLS 策略 `agent_stream_segment_owner`、`UNIQUE(world_id, segment_id)`、`UNIQUE(world_id, message_id)`、外键绑定 `worlds` / `agent_attempts` / `world_events`，以及强约束 `CHECK((status='committed')=(source_event_id IS NOT NULL AND source_version IS NOT NULL))`。
   - 已在本地嵌入式 PG 执行 `npm run db:migrate` 验证通过。

2. **增量分段领域契约 [npc-stream-segment.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/domain/npc-stream-segment.ts)**
   - 定义 `NpcStreamUnitKind`（`independent_statement` / `dependent_statement`）、`NpcStreamSegmentStatus`、`NpcStreamCompletionStatus`、`NpcStreamSegmentCredential`、`CommittedStreamSegmentEvent`、`NpcStreamTurnSummary`、`NpcParsedStreamEvent`。
   - 确定性 ID 生成器：`deterministicStreamEventId`、`deterministicStreamSegmentId`、`deterministicStreamMessageId`、`deterministicStreamUserMessageId`（全部满足 `validateEventId` `<=64` 字符及 `id()` `<=100` 字符）。
   - `classifyNpcStreamStatement` 与 `claimsUnboundActionCompletion`：严格区分可流式提前提交的 `independent_statement` 与必须等待全回合动作执行成功的 `dependent_statement`。

3. **闭合 JSON 语句增量解析器 [npc-stream-parser.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/infrastructure/npc-stream-parser.ts)**
   - 字符级追踪引号、转义与括号深度，识别顶层 `"executions"` 与 `"statements"` 数组。
   - 绝不向外发射未闭合 JSON 片段；仅当 `statements[i]` 的 `{...}` 完整闭合并通过 `StatementWireElementSchema` 校验后才发射 `NpcParsedStreamEvent`。

4. **分段持久化与前缀提交/封存引擎 [npc-stream-segment-repository.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/infrastructure/npc-stream-segment-repository.ts)**
   - `persistAndCommitStreamSegment`：先落库 `agent_attempt_stream_segments` 分段凭据，对前缀连续 `independent_statement` 在同一事务中提交 `world_events`（`version = expectedWorldVersion + 1`）、`world_messages`、`commands`、`worlds`，再返回 `CommittedStreamSegmentEvent` 供前端呈现（Persist-Before-Present）。
   - `sealCommittedStreamPrefix`：当后续流中断、JSON 损坏、动作失败或用户发送新消息打断时，若已有 `M >= 1` 条前缀分段已提交，将已提交前缀正式封存为完整合法的 `committed` 回合（更新 `world_events` 的 `agentRuntime`、写入 `storeTurnMemories`、满足 `agent_attempts` 的 `response_hash` 与 `actor_agent_states` 的 `R + 1` / `V + 1` 触发器要求），并将未提交余量标记为 `superseded_by_interrupt` 或 `aborted_error`。
   - `readStreamSegmentsForCommand`：按 `(worldId, commandId)` 查询已持久化分段凭据与 `NpcStreamTurnSummary`。

5. **世界仓储、运行器、模型与内核前缀合并支持**
   - [postgres-world-repository.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/infrastructure/postgres-world-repository.ts)：`commitInTransaction` 支持 `finalizePrefixEvent` 与 `skipMemories`。
   - [agent-runtime-repository.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/infrastructure/agent-runtime-repository.ts)：`beginAgentCommitInTransaction` 允许当前 `attempt` 自己已提交前缀（`w.version === expectedWorldVersion + 1` 且 `agent_attempt_stream_segments` 证明归属该 `attempt`）继续完成全回合 `commit`；`saveResponse` 兼容被用户打断提前封存的 `committed` 状态。
   - [npc-agent-kernel.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/infrastructure/npc-agent-kernel.ts)：复用前缀 `eventId` 与每个 `segment_index` 的确定性 `message_id`，全回合提交时传 `finalizePrefixEvent: committedSegmentRows.length > 0` 并同步更新 `agent_attempt_stream_segments` 状态为 `completed`。
   - [agent-runtime-ports.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/application/agent-runtime-ports.ts)、[npc-agent-model.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/infrastructure/npc-agent-model.ts)、[run-agent.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/modules/world/application/run-agent.ts)、[npc-agent-services.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/server/npc-agent-services.ts)、[world-interaction.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/contracts/world-interaction.ts)、[message-receipt-lookup.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/contracts/message-receipt-lookup.ts)：已接入 `decideStream`、`onStreamStart`、`onStreamEvent`、`onPrefixFailureSeal`、`activeActorStreams` 用户打断封存及 `sendMessageIfEnabled(..., { onSegment })`。

6. **HTTP 路由、客户端与手机聊天 UI 增量呈现**
   - [world-message-http.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/server/world-message-http.ts)：当带 `x-message-stream: 1` 时以 `application/x-ndjson` 实时逐段输出，全回合结束输出 complete receipt。
   - [route.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/app/api/v1/worlds/[id]/messages/receipt/route.ts)：支持 `x-message-receipt-projection: 1` 恢复已提交前缀消息与 `streamSummary`。
   - [client.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/features/api/client.ts)：支持 NDJSON 流式读取与逐段回调。
   - [send-projection.ts](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/features/phone/send-projection.ts) & [world-phone-app.tsx](file:///Users/limengzhe/.codex/worktrees/chat-latency163/%E4%BA%BA%E7%94%9F%E5%89%A7%E6%9C%AC/src/features/phone/world-phone-app.tsx)：实现 `applyStreamSegmentToWorld`，支持打断（`canInterrupt`），记录首段呈现耗时。

7. **测试与质量证据**
   - 单元测试：`tests/chat-latency-stage2.test.ts`（5/5 通过）。
   - 真实 PG 集成测试：`tests/integration/chat-latency-stage2.test.ts`（全部 14 项故障边界 100% 通过）。
   - 全量回归测试：`npm test` 3,821 项全部通过（0 fail, 0 skipped）。
   - 边界检查与编译：`npm run check:boundaries` 通过（687 files），`npm run build` Next.js 16.3.5 编译成功（27/27 路由）。

8. **生产公网实测证据（https://parallel-life-nu.vercel.app）**
   - 生产迁移 `0100_agent_attempt_stream_segments.sql` 成功应用，`public.pl_migrations` 中记录 `checksum=6f2a9cb2e92247cf22e2edca8c5bd23caa47284e8233176c1a48ec495fd1fca7`。
   - 生产部署：Vercel `dpl_HprcPBKsRwScBb4h9SNGNvaGMsfA`（commit `a5fce517`）READY，公网别名生效。
   - 运行 `scripts/verify-chat-stream-live.mjs` 实测官方人生《县城黄毛》（worldId: `c45c01d6-8734-4142-807b-f5e137b13a42`）：
     - 发送 `x-message-stream: 1` 私聊给 NPC 林悦，HTTP 状态 200，`Content-Type: application/x-ndjson; charset=utf-8`；
     - 首段增量对白在 `firstMeaningfulReplyMs: 8006ms` 到达，内容为 `[Segment 0] "饭局还没太具体准备，就是家里会有人多一点。你来了别赌气，刘航也会来的，我爸让我告诉你。他挺难相处别让气氛尴尬了。"`（`unitKind: independent_statement`）；
     - 全轮耗时 `fullTurnMs: 8545ms` 完成并收到 `type: complete` 事件；
     - 生产数据库审计：`parallel_life.agent_attempt_stream_segments` 查得 1 条已持久化分段凭据（`segment_index: 0, status: committed, v: 1`），外键强约束及 RLS 安全有效；
     - 验证 `/receipt` 路由带 projection 成功支持断连刷新消息投影。
