# NPC-AUDIT-43 · NPC 回复与推进审查

日期：2026-10-15。负责人 codex-npc-audit43-01a13e13。用户要求找问题，本轮只读业务实现，不接管 NPC42 的集成/部署，不调用模型或操作生产存档。

## 基线与范围

主目录 main 96e51d15 明显落后；主要审查 /Users/limengzhe/.codex/worktrees/history-chat-media/人生剧本，读取期间 HEAD 从 c0711560 到 36f5ada6（另一个集成者仍在修改）。结论针对已读文件，未证明这些缺陷均已出现在生产。主表 NPC42 仍由其他负责人验收。未读取或输出密钥/玩家私聊。

## 1 · P1 多人开场计入同一个收尾计数，导致尚未互动就建议结束

publication-event-goal-context.ts:324 将其余 openingActors 的开场逐条计为 npc_progress。story-event-progress.ts:329 在 standard productiveBeats>=6 时立即返回 seek_closure，甚至先于参与状态/玩家输入判断。publication-progress-beat-store.ts:215-228 准备实际续演时使用全局 old.productiveBeats，只替换本人的 participation，覆盖候选阶段按本人可见证据得到的建议。

离线实际调用领域函数：6个角色各一条开场，0玩家输入，得到 productiveBeats=6 / participation=unknown / nextMove=seek_closure。此结论是错误的收尾建议，不是自动伪造已完成；运行时仍区分完成证据。

建议：同一批开场只计一个引入阶段；分别保存全局事件变化与角色有效交互计数；候选判断和最终claim使用同一节奏口径。补6人开场、其中1人回复、其他人尚未交互的组合测试。

## 2 · P1 是否恢复主动续演依赖可缺失的模型标注，真实回复可能没有解除静默限制

resolve-turn.ts 将缺失 eventGoalAssessments 作为[]提交。actor-goal-repository.ts:402 只对数组成员保存语义进度；没有可靠标注就没有该回合的事件进度证据。publication-progress-beat-store.ts:94-131 仅扫描 publication_story_progress_evidence，只有同角色的 engaged/reopened/declined 才重置无回应计数。两次主动续演后，即使玩家已就该事回复且NPC正常回应，只要该回合返回合法空数组，限制仍保留。

离线调用真实 mayFollowUp 方法，提供两条成功主动续演证据、模拟后续未标注回复不进入证据表，结果false。SQL输入使用stub，未做真实数据库重现；代码链路证据明确。不能将任何闲聊自动判为同意，更不能用无标注覆盖已保存拒绝。

建议：将“玩家实际回应过”和“玩家同意/拒绝/目标完成”分离。保存可审计的回复观察；明确相关输入缺标注时标为待判断，避免成功聊天静默留下过期调度状态。补空数组及标注缺失回归。

## 3 · P1 已发布世界的空剧情池会吞掉普通事项/约定的主动推进入口

services.ts:256-272 先调用 advancePublicationStory，handled=true 时直接返回。publication-story-service.ts:69-75 在directorPool存在但候选为空时返回handled=true/played=0；prepare返回managed none时也如此。普通 advanceWorld 只有该链路未handled才执行，其 agenda 才处理普通约定、选择和事项等。

因此已发布世界中，若没有可续演的编剧事件，普通聊天新提出的约定或事项即便已有general goal，也不会仅凭该目标加入publication opportunities；同时通用agenda被短路。已发布事件本身能续演，不代表所有NPC自行提出的事情能主动续演。这是静态调用链确认，未做线上复现。

建议：统一收集发布事件与普通事项的可执行候选；或明确安全的空池回退，保留开场未完、unknown、暂停等阻断条件，不能简单移除所有handled保护。

## 4 · P2 单一续演候选绕过导演全局观察，属于现有架构覆盖缺口

publication-story-service.ts:77-85 直接准备唯一eventProgress候选，不调用chooseStoryOpportunity；publication-character-planner.ts:40-54 只在choose时读取完整导演观察。此优化已有测试明确保证，所以不将其冒称意外回归。但它意味着其他人物最近互动/世界结果的语义协调没有在每次续演发生；当前只有结构化目标与时序规则提供判断。

建议：明确哪些已验证变化可以走零导演调用的快路径，涉及新世界变化或跨人物因果时重新协调。此项为设计风险，未证明某条真实对白因此错误。

## 验证与边界

- 现有 tests/story-event-progress.test.ts、tests/publication-story-progress-service.test.ts、tests/actor-situation.test.ts：24/24通过。
- 两个临时内联探针均执行完成，结果如上；没有新增业务文件或测试文件。
- 本轮未运行全量check/build：仅只读审查与报告，且共享集成树正在被其负责人构建/修改，避免争用构建输出。没有SQL、权限、队列或UI变更。
- 未调用真实模型、未做数据库集成、未改生产/作者稿/玩家世界、未部署。不能用本轮测试证明语言自然性或完整剧情体验。
- 本报告是本地待验收审查材料，不是已上线修复交付；当前公网版本未在本轮重新核验，不将本地36f5ada6宣称为线上版本。

## 接续

建议先解决1和2，再统一3的调度候选；4结合调用成本设计。修复归原集成负责人协调，届时需真实DB、受控多轮模型验收、check/build、生产迁移核对、READY及公网实测。当前状态待验收，未标已完成。

## Structural review continuation: 15c343bb

Read-only review of history-chat-media; inspected business files clean. Six structural findings:

1. services.ts:239-272 short-circuits opening, publication and generic advancement instead of collecting candidates together. world-phone-app.tsx:410-527 also owns opening phases and idle dispatch. Move orchestration into an application coordinator; preserve activity-based pause.
2. group-turn.ts:18-44 and group-ports.ts:17-25 lack the eventGoals/authoredLifeModules/actorSituation injected in publication-character-planner.ts:26-92. scene-planner.ts:1080-1120 assembles another input. Share actor-state and decision contracts, with distinct visibility/channel adapters. Never copy private transcripts into group context.
3. actor-goal-repository.ts:177-225 reconstructs ordinary goals and restores matching definitionHash from memory; :498-523 stores execution progress JSON as belief/agent_inference. Published goals use a dedicated progress table. Separate explicit runtime goal/plan state from recall and belief memory.
4. PublicationStoryRepository owns progressSpeaker/opportunities/prepareProgressBeat/reconcile business orchestration; postgres-world-repository.ts:583-610 calls it directly and reconstructs context/applies assessments. Move policies to application-level coordination with one transaction unit of work; retain atomicity.
5. scene-planner.ts:50,184 defines receive_r17/inspect_r17; :1111-1117 embeds first-person regex, keys, repair form and R17 connector. Generic engine protocol contains story-specific content. Introduce reusable authorized handover/inspection capabilities plus world-specific data; do not accept arbitrary model claims as actions.
6. Reply effects, optional semantic assessments, publication reconciliation and beat counts have separate progress interpretation paths. Unify observation/judgment/state-transition contracts; represent successful dialogue separately from pending semantic judgment and actual execution. Latest commit fixes source binding, so old annotation defects are not assumed unchanged.

No business edits, SQL, model calls, production writes or deployment. Static architecture review only; no shared build contention. Preserve 12x browsing, 1x interaction, leave pause and important-boundary protections. Pending architecture acceptance.

## Per-character agent verification: e732a662

User asks whether the current project has become one agent per role. Main remains96e51d15; latest inspected integration history-chat-media e732a662, source/db clean; implementation publication-story-02 1e2a771 checked as well.

Confirmed: publicationCharacterPlanner prepares actor-scoped persistent goals, authored modules, own opening/current situation, own posts and visibility-filtered context. loadActorMemories scopes recall by actor/world. Live opening calls resolveTurn separately for each delivery actor. These are real per-character logical-agent capabilities, not merely one fixed generic response. Shared planner/model implementation does not invalidate logical agent isolation.

Incomplete: group-turn uses GroupPlanner and its separate GroupActorInput without private-path eventGoals/authoredLifeModules/actorSituation; scene-planner independently assembles actors and invokes its own model path rather than the private-path enriched decision interface. Ordinary goals remain reconstructed from matters/appointments with progress stored in character memory, published goals use shared event progress; no unified role plan/trigger lifecycle across channels was found in inspected runtime wiring. services233-289 still orchestrates opening/publication/generic advancement.

Conclusion: per-character scoped model turns and partial persistent goals exist; the intended single continuous per-NPC Agent across channels and autonomous plan lifecycle is not fully implemented in this inspected integration. No claims about current public deployment. No model/DB/build/production operation; source review only.
