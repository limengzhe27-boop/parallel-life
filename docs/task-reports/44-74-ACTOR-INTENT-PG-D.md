# 44-74-ACTOR-INTENT-PG-D

2026-10-16，codex-ma44-actor-intent74-d，待根集成验收。独立工作树 `/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`，分支 `codex/actor-intent74`。仅本报告及新增 `tests/integration/actor-episode-intent.test.ts`，主表仅本人行；没有修改公共源码、SQL、旧测试、CI 或 UI。

基线 `30045207d9036ccbcda9b262a8eae9c528c62e80`。根后续源依赖按序 `8d656d63`、`1b3a5e17`、`d56e2a98`（本树等价 cherry 为 `aa9ec228`、`9a0449f7`、`6b8307d8`，无需在根重复集成）。测试冻结提交 `886820a676ba3fecc7cbc222d5065477b63bf661`。

## 实际链路与证据

使用真实 PostgreSQL 18.4、实际 publisher role、PublicationRepository 的 create/check/publish、compilePublicationGenesis、PublicationWorldRepository.startPublished、不可变 publication binding、新档 V0 的 epoch2 admission。review/compiler 夹具明确标为本地合成验证，不调用真实审核或模型，不读取主原稿。DirectorSnapshotRepository、WorldDirectorAgentModel、runDirectorAgent 和真实 Director store 提交对应 authoredEventKey 后，由实际 0081 request/project/receipt 路径消费。另有 actual npcAgentAdvanceServices.advanceIfEnabled 连续两次真实 dispatch，两角色各消费一次，只有原来一次 Director 评估。

实际 NpcAgentModel、runNpcAgent、PostgresAgentRuntimeRepository 的原子发送门槛和 PostgresNpcAgentKernel 全程保留。测试替身只在 TextModel.complete 返回明确合成角色提案。成功的个人策略和群回复有实际事件/状态/回执；没有预置模型成功或内存仓储替代。

- A 的 offer_message 只给 A；同事件 B 有真实 request，但无 A 的 intent source/text。script、editorialIntent、sceneText、机会 description、Director audit 的五个秘密哨兵均不进入 NPC snapshot/payload。
- 单人 offer_invitation 得到真实可用地点、原始 earliestAt，只是 plan suggestion；不产生 expiresAt/deadline。真实隐藏地点原稿可绑定和选为机会，但无角色 directive/隐藏地点正文。多人邀请由实际 compiler 拒绝开档，不能当作已实现单人邀请转换。
- 实际参与选择保存本人独立 goal，以 intent handle 为来源；后续私聊与实际群输入读取 private_strategy 通用来源说明，保留自己的策略摘要，不回放作者原意图台词。群用例还经过真实模型发送、kernel 和群回复提交。
- contentHash、他人 request handle、recordId、观察正文、plan 改 fact、private_strategy 伪装、伪造 actual state，各自在 request_sent 前拒绝，模型 0 次、sent_at/response_hash 均 NULL。剥离全部 intent source/observation、仅剥离 observation，以及同时把 snapshot input 改成其他 type，均有独立反例。
- 直接调用普通 mark(request_sent) 也不能绕过不可变 canonical episode receipt：INPUT_SCOPE_FORBIDDEN、0 发送。无 source-aware store 时 runner 同样拒绝。保护来源使超预算 snapshot 在 claim 前 NPC_AGENT_SNAPSHOT_LIMIT，不会静默删掉原稿来源付费。
- 真实 owner RLS 和 worker 边界均 NOT_FOUND；不能向别人的 actor intent 发送。另一角色实际提交使旧 worldV 的准备输入在 claim 前 VERSION_CONFLICT，0 模型/0 attempt。
- 模型返回期间通过 MemoryRepository.create 建立 active belief，再通过真实 forgetMemoryInStore 遗忘；最终 AGENT_REVISION_CONFLICT，paid raw 保留为 stale，重复同 command 为 ATTEMPT_STALE、不会重买。没有直接插入 forgotten 伪造成功。
- unknown transport 保留 unknown_after_send，同 command 为 ATTEMPT_UNKNOWN，模型总计 1 次，未推进角色或请求。
- scoped 实际 BEFORE INSERT receipt 触发器制造晚期 SQL 故障：response_received 保留 raw，world/state/commands/request/episode/receipts/results 全部回滚；清除触发器后同 command 原 raw 零新增模型恢复 committed，重复 committed replay 也无新增模型。触发器/函数通过 finally 删除。

原子性负例比较九类实际对象：world state/version、world_events、world_messages、actor_agent_states、commands、agent_episode_requests、agent_episode_receipts、agent_action_results、shared_episodes；attempt status/raw 单独断言，遗忘用例的真实记忆变化不混入“未变化”比较。

## 实际发现与根修复

剥离 source+observation 并替换 prepared snapshot.input.type 的真实反例，在根 `1b3a5e17` 上仍先付费、再因 EPISODE_DECISION_SCOPE 拒绝；已及时报告根，不修改公共源码。根 `d56e2a98` 使实际发送门槛由不可变 accepted receipt 决定，本文件保持该反例并断言精确 INPUT_SCOPE_FORBIDDEN、模型 0、NULL sent/raw。其余 hash/body/state 篡改保留精确 AGENT_REVISION_CONFLICT，不放宽为任意失败。

`deriveAndStoreMemories` 的 source-ref SQL 当前不接受 episode-intent handle（MEMORY_SOURCE_NOT_FOUND），已向根说明为 67/53 后续边界；本专项使用真实 MemoryRepository active+forget 路径，不声称自动记忆推导已接通该来源。

## 验收结果与范围

最终专属 PG55505：`node --experimental-strip-types --test tests/integration/actor-episode-intent.test.ts` **26/26 通过，0 fail/skip**（含父测试）；`ACTOR_EPISODE_INTENT_TEST_PORT` 默认 55505。`tsc --noEmit` exit0；模块边界 566 文件通过；仅新文件 Prettier check 与 git diff --check 通过。证据保存在本树 ignored `.local/actor74-{test,type,boundary}.log`。未运行 fullcheck/build，按根分工由根统一执行。

开服前确认 55505 空闲，正常关闭专属 local-db 父进程后会话 exit0，55505 无监听。未触及根 PG55564、生产、真实模型、发布或 UI。

**场景频道未覆盖**：当前真实 publication compiler 不生成角色 actual position，new-genesis admission 仍在 V0；联系名单、作者人物地点、同事件 participant 都不能当 actual presence。本测试没有手补 scene.opened/presence 或假 incident 通过。根确认该场景旅程随后沿显式 genesis setup/原生入场验收；此处仅对私聊和群的真实来源连续性负责。

普通 editorial_only/即兴机会只证明不交全局 prose，不宣称这些机会已有 typed intent 演绎，也不宣称 67 全部完成、69 普通 NPC/player/wake 活跃边界完成或已上线。本任务冻结待根验收，停止 PG；后续根统一 check/build/迁移确认/部署和公网验证。

## C 追加审计：新命令不得重买同一请求

根新增 `e28498ae`（本树等价 `5295e9ab`）仅加强实际发送事务的请求消费/既往付费保护，不阻止历史或 private_strategy 只读解析，也不干扰 response_received 原 raw 恢复。本人仅追加两个真实 DB 用例，测试增量冻结 **`2dd1fea2b9a246323190962cd02c031772b81d20`**，原 26 项保持通过。

在 `d56e2a98` 基线上真实复现：已有 invalid_output 付费 raw 的 pending request，用新 accepted receipt、新 command/new attempt、实际新 snapshot 再执行会成功 committed，确实发生第二次模型购买；已 consumed request 当时由原稿 exact observation 门槛提前 AGENT_REVISION_CONFLICT 拒绝，未声称该分支也已实际重买。修复后两条路径都精确 INPUT_SCOPE_FORBIDDEN：模型总计仍仅原来 1 次，新的 attempt sent_at/response_hash 均 NULL，九类实际业务对象完全不变，原 paid response_hash 不变。没有用伪造 attempt/status/request 输入来制造这两种状态。

最终追加验收 **PG28/28、0 fail/skip**；type exit0、边界 566、focused Prettier/diff 通过。前后证据为 ignored `.local/actor74-rebuy-{before,after,type,boundary}.log`。为增量重新启动前先核实 55505 空闲；结束后正常关闭专属 local-db 父进程，原执行会话 exit0，55505 再次无监听。没有 fullcheck/build/生产/真实模型/UI 写入。任务再次冻结待根统一集成、发布与公网验证。
