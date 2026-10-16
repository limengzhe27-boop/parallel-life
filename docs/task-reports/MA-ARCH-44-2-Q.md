# MA-ARCH-44-2-Q：统一人物模型适配

- Agent：`codex-ma-arch44-2-q-20261015`；唯一集成人为根对话。
- 独立分支/目录：`codex/ma-arch44-q`，`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`。
- 已按短锁在主表登记，独占两个新代码/测试文件和本报告；未修改旧 planner/group/scene 或公共契约。
- 基线：`1028b06b`，仅接入集成人指定公共提交 `3e9bc64`、`a00b4900`、`4630c34`，本树分别为 `70d7e8d6`、`9264822c`、`f6d0a3c5`。公共文件不是本人另行修改。
- 业务冻结提交：`a37b1be`。状态：待验收；未部署、未切实际入口。

## 修改文件与能力

1. `src/modules/world/infrastructure/npc-agent-model.ts`（新增）
   - 导出 `NpcAgentModel implements NpcAgentModelPort`，构造参数为现有 TextModel；`validateInput(snapshot)` 与 `decide(snapshot, signal)` 共用纯确定性 prepare。
   - 私聊、群聊、现场共用一个人物决策协议，输入来自 authorized AgentSnapshot；保留同一个 state 的 worldId/actorId/revision、目标、计划、责任与当前焦点。不会自行读取导演或数据库。
   - 显式白名单构造 state、actor、channel、observations 和 sources，未知额外属性不透传；source 只提供 id/kind/version/at/显式 deadlineAt，不提供 recordId。accepted_input 维持输入回执类型，不伪装成已提交聊天消息。
   - 定义版本、世界版本/人物 revision、输入/观察来源是否在给定 sources 内、重复来源、来源种类/时间及观察形状做确定性预检查。输入合法性或预算失败在 complete 前拒绝，不产生模型请求。
   - 固定上限：用户 payload 24,000 UTF-16 字符、完整 serialized messages 32,000 字符；预算包含 system 与 JSON 转义，不宣称为 token 数。模型输出上限 4096 tokens。
   - 压力下只把 persona 选成有界原文节选，并逐条移除不受保护的旧 observations；节选/省略来源明确标注。legacy JSON persona 保持结构/身份/边界。state、actor.boundaries、完整当前 input、当前问题与 open/waiting 责任相关 observations 不截断。保护内容本身仍超预算则报 NPC_AGENT_SNAPSHOT_LIMIT，不谎称模型读完全文。
   - 一次 complete 请求对白及必要决定/goal/plan/action/责任增量；空的未变化数组允许保留。人物只能提议 allowedCapabilities，不能自称执行成功；动作依赖对白带 dependsOnActionIds；歧义保持 undecided；不以消息数完成事项，不重复催问；只有 wake 允许合法安静。deadline 必须对应来源明确提供的 deadlineAt。
   - **原始响应原样返回**，包括空字符串、坏 JSON 和带动作依赖的响应。适配器不解析、不修复、不补回复、不重试、不写 DB；由 root runner 先持久保存 raw，再由 root parser/kernel 校验和提交。transport 异常、取消按原异常传播，不包装为虚假成功。
2. `tests/npc-agent-model.test.ts`（新增）
   - 12 项实际模拟端口测试，见下。
3. 本报告及主目录镜像、本人 DEVELOPMENT 行。

## 验证结果

12/12 专项测试通过：

- 三渠道使用同一协议、身份/revision/state，传输参数与输出模式一致，输入对象不被改动。
- 额外导演/他人数据属性和 source.recordId 不进入 payload。
- 坏 JSON、空输出、依赖动作的 raw response 保持逐字一致，每次只有一次调用。
- allowedCapabilities、当前输入准确传递，执行/依赖/不确定/安静规则进入 system。
- wake 不造回复；显式 deadline 不自动创建责任截止；accepted_input 回执句柄保持类型。
- 超长 JSON persona 仍可解析且保护身份/边界；长 emoji 人设与旧观察按预算选择，完整 4,000 字符玩家输入保留。
- 强制状态/边界/当前输入本身超预算时 preflight 与 decide 都在零调用时拒绝。
- 定义/版本/来源不一致、来源重复在调用前拒绝；取消与 transport 失败不自动重试。

最终 `npm run check`：边界检查、typecheck 通过；2,501 项测试中 2,497 通过、4 失败，全部为 `ECONNREFUSED 127.0.0.1:55570`。两项 character-image-flow 和两项 RLS 测试依赖此前任务已停止的本地 PostgreSQL。本轮未擅自启动数据库或换成内存替代，因此**完整 check 不是全绿**。最初公共基线的 domain/Zod 边界阻断已随根提交 4630c34 解决，不是当前剩余阻断。

构建：接入最终公共 4630c34、业务冻结 a37b1be 后的 `npm run build` 已 exit 0。

未运行真实模型、未建立真实 PostgreSQL 验证、未操作生产数据、未改“渣男体验”草稿、未做浏览器/公网验收。本轮没有界面改动；mock 测试不能作为模型表现、数据库原子性或上线证据。

## 接续点与明确边界

- 集成人可独立 cherry-pick `a37b1be`，只含两个新文件。依赖最终公共协议 4630c34 及其前置；不是把本分支所有历史提交重新合并。
- Snapshot loader 必须在服务端按 owner/world/actor/channel/thread/时点/成员/在场/忘却核验来源；适配器只有 state 内一份 identity，没有第二份外部 expected identity，不能冒称自行证明了 RLS 或真实来源授权。
- 同一人物私密状态可影响立场，不代表群/现场可以公开私人原文。白名单和 system 规则是适配层措施；实际资料授权、输出/能力/依赖/决定引用校验仍由 root snapshot/kernel 负责。本轮没有真实模型证明其语义上永不泄密。
- `validateInput` 必须由 runner 在标 request_sent 之前调用；`decide` 返回值须先保存再 parse。输入回执来源与 claim.inputReceiptId 的绑定由 root runner 负责，适配器不新增另一个回执体系。
- 尚未把旧私聊、群聊、现场切到新入口；尚未接真实人物状态仓储、任务租约、群短答责任路由、实际能力执行或新导演。不能称为完整人物 Agent 已可用。
- 新动作的目标对象必须由后续渠道 snapshot/能力授权提供；allowedCapabilities 名称本身不证明对象存在或有执行许可。真实执行不得依靠模型自述。
- 由集成人完成实际入口切换、真实 PostgreSQL/并发/回执/unknown 验证、模型预算内验收、生产迁移和 READY/公网检查。本任务先保持待验收。

## 下一阶段精确实施设计：群／现场实际入口（只读，未实施）

### 所读接口与两个先决点

2026-10-15 根再次指派只写设计。已读根 history-chat-media 中 `run-agent.ts`、私聊 `agent-snapshot-repository.ts`、拆出的 `worldrepo.commitInTransaction(...,{legacyProgress:false})`，以及 P 工作树中尚未冻结的0072/agent-runtime-repository；P文件是工作中快照，不冒称已经集成。公共SQL/UoW冻结前不修改源码。

1. **输入接受也需要新版引擎门禁。** 当前 group.send / scene.input 先写原生事件并 UPDATE worlds；0072 engineEpoch>=2 的世界围栏要求事务中的正确 epoch/world 标记。这些真实玩家输入还没有 NPC attempt，不能伪造 attempt 调 begin 来解锁。根需要可信的 `runAgentWorldCommandInTransaction(sql, owner, expectedEpoch, command, work)` 或等价SQL门禁，核真实输入/命令/版本并仅在本事务开放该世界。场景进入、离开、视图与其它合法世界操作也不能误被一刀锁死。
2. **输入版本与执行版本必须分离。** P当前 claim 要求 inputReceipt.expectedWorldVersion===attempt.expectedWorldVersion；attempt 对(world,commandId)唯一，finish要求世界恰好+1且事件commandId属于该attempt。因此同一群输入让两人分别提交，不能共用commandId/同一版本，不能一次queue.commit重复finish两个attempt。建议保留一份不可变原始输入回执，允许每人按当前世界版本重新授权执行：receipt记录原输入版本，attempt记录执行快照版本；相同输入的 actor 子命令稳定唯一。需由根/P明确冻结这项条件变更及授权证据。若选择派生回执，必须增加可核对parent来源，不能把coordination改成player骗过决定校验。

### 最小运行签名（提议，不是已提交公共API）

统一调用仍为现有 `runNpcAgent(deps, ownerId, claim, snapshot, signal)`；不是只把旧planner换prompt。基础infra工厂拟为：

```ts
// 基础设施组装形状，由root冻结后再落实。公共AgentKernel端口无需暴露SqlClient。
createLeasedNpcRuntime({ queue, lease, model, channelWriter, workerPersistence }): {
  run({ actorId, inputReceiptId, sourceInputEventId, channel, threadId }, signal): Promise<void>
}

readGroupAgentSnapshot(sql, ownerId, {
  worldId, groupId, actorId, inputReceiptId, sourceInputEventId, expectedWorldVersion
}): Promise<{ snapshot: AgentSnapshot; seed: ActorAgentState | null }>

readSceneAgentSnapshot(sql, ownerId, {
  worldId, sceneId, actorId, inputReceiptId, sourceInputEventId, expectedWorldVersion
}): Promise<{ snapshot: AgentSnapshot; seed: ActorAgentState | null }>

// Kernel验证/执行后，渠道只投影已经授权的结果，不自行推断goal或完成。
channelWriter.commitInTransaction(sql, ownerId, {
  attempt, snapshot, eventId, nextWorldVersion, statements, results
}): Promise<{ eventId: string }>
```

每个执行子任务的可信输入至少固定 runtimeVersion、world、channel/thread、actor、inputReceiptId、sourceInputEventId、engineEpoch、稳定子command及调度授权引用。actor名单由服务器候选/责任调度持久化，不接受客户端任填，不从worker自报身份推导授权。

### 群聊最小切换流程

1. send同一短事务核成员/暂停/版本/幂等，保存真实group.message_sent与唯一输入回执；回执的执行锚点要明确采用输入事件提交后的版本，不能混同客户端提交前expectedVersion。原消息只存一次。
2. 统一scheduler按明确点名、reply-to、开放问题/责任选择人物；每个选中人物独立子command/attempt。最小首批每个lease只执行一个NPC，后续人物从前一实际提交结果接续生成子任务，避免同版多模型竞速和一次task重复finish。原始输入与本次执行版本按上述新规则区分。
3. handler在租约限定读取中拿本人ActorAgentState和已授权snapshot；初始化/迁移由显式事务完成，不在context read偷偷建状态。输入文本必须与原group.message_sent及immutable receipt逐字对上。
4. 释放读连接 → validateInput → 持久claim/request_sent → 一次NpcAgentModel → 持久raw → root parse/kernel。不能继续调用planGroupTurn/WorldGroupPlanner作为第二决策器。
5. kernel的事务执行器注入原queue.commit(lease, work)：同一个SqlClient上校验lease、beginAgentCommit、执行能力、写group.turn_resolved及投影/回执、finishAgentCommit，最后finish_task。不能先用pl_app另连接提交人物状态，再让worker发现租约已丢；也不能先finish任务再提交人物状态。
6. 原生group writer可复用persistGroupEvent的同SQL投影，但只写当前人物已通过kernel验证的statements/实际结果。不得落一份假的私聊turn.resolved以迎合私聊kernel，否则会串到微信私聊。群邀约仍为proposed，不能由群消息代玩家接受。
7. task或attempt重放先查持久状态/回执，response_received恢复只重做校验/提交，unknown_after_send不自动再次调用；paid后stale不能偷偷换snapshot重新推理。多个子任务的批次/后续状态必须可追踪，不能父task一成功就声称全部人物已答。

### 现场不能包裹旧ScenePlanner

旧ScenePlanner.propose内部既调用环境裁定，又自行选人和直接调用人物模型；把它的模型参数换成新prompt仍是双重人物引擎，必须拆掉人物分支。

- 保留独立环境/玩家动作裁定入口，输入只含公开现场与本次真实玩家动作；产物只含环境/玩家动作候选，不含NPC对白、NPC行动、人物目标评估或最终到场决定。普通直接问话仍可使用已有无模型的确定性记录。
- 先以合法世界命令保存环境/当前动作真实裁定，再派发人物输入任务。人物只能把已经提交的环境结果当result；旧的observedNow未提交候选不能直接变成既定事实。环境若仍调用收费模型，也需要根明确的director/task raw-response恢复协议，不能虚构NPC身份借用ActorAttempt。
- 开场人物从服务器核准的地点/预约/事件候选产生独立协调或wake输入，不伪造玩家说话。本人Agent提scene.enter等许可动作；内核实际保存presence后才展示依赖到场的对白。开场名单、邀请、“我会去”都不是已经到达。
- 已在场人物从真实scene.input_recorded/条目获取原玩家输入，按实际受众与回复责任选择。私密想法无NPC任务；尚未实现的耳语不扩大成全场听见。
- 人物kernel写原生scene.reaction_recorded或经根冻结的等价单人物事件，在同SQL中保存对白/实际能力结果/presence/人物状态/回执和task finish，不重放整段旧SceneProposal把先前玩家动作再执行一遍。
- R17实际执行只能经注册能力和版本化旧规则适配器，不把旧ScenePlanner收词正则再调用一遍形成第二进度真源。通用交接/检查协议未冻结前不能宣称已完成场景动作切换。

### 0073租约限定函数的最低权限边界

0072仅pl_app的表权限保持不变，禁止GRANT所有state/attempt给pl_worker。0073由根/SQL负责人实现一组狭窄SECURITY DEFINER操作：租约核验后的snapshot/source读取、input receipt读取或接受、人物状态显式初始化、attempt claim/mark/save/read-response，以及同UoW begin/finish。具体函数名由集成人冻结，渠道实现不自行创建迁移。

每次函数验证task_id/token、running且未过期、world/owner、runtimeVersion、channel/thread、确切actor和immutable输入绑定；不能只验证“某个world任务存在”。仅返回本次人物的状态、可见来源和自己的响应。函数使用固定search_path、撤销PUBLIC执行、输出数量/体积有界，响应不进日志。事务锁顺序固定task→world→actor→attempt，mark/save同样核租约。

原TaskLease与新AgentAttempt是两层不同围栏：任务租约不能替代actor revision/epoch/expected world CAS；attempt token也不能让已过期任务提交。queue.commit与kernel UoW共享SQL，不跨两条连接“各自成功”。任务过期、跨actor/thread伪造、旧token、离群/离场、忘却来源都必须在真实PG负向验收中被拒绝。

### 跨渠道来源resolver

需要一个统一、只读的按人物来源解析器；渠道reader不能直接复用readPrivateAgentSnapshot的完整observations进群。

- private_message只给本人，保留speech性质；本人状态可以跨渠道持续，私人原话不自动成为群或现场公开信息。群snapshot默认不载入private transcript；需要本人已知计划时用同state的引用/摘要，不复制原文。
- group_message须核真实world/group event+command成功回执、消息版本/正文、该人物在消息产生时的membership以及当前发言资格；退出期间、入群前不可读。来源到当前worldVersion/storyAt截止。
- scene_entry须核真实scene/event/command、observableTo、该人物在该版本的presence；private thought永不纳入。当前到场不授权读取加入前所有现场原文。
- action_result须核实际kernel结果和执行回执，不从对白/承诺建立；authored只读取当前发布定义中本人物被授权部分，不给未来事件库、导演全局摘要或他人私密方向。
- accepted_input核不可变receipt、原生sourceInputEvent及原输入文本/渠道/受众，不把receipt持有者owner权限当成NPC可见性。future/forgotten/来源缺失保持不可用，不让模型补猜。
- 保持opaque handle→真实record映射在服务器，模型只接有限句柄；审计/决定引用回来后按原受众/版本再次解析，不能只检查handle字符串存在。

### 建议文件归属与冻结门槛

|文件|最小改动／责任|
|---|---|
|新agent-channel-snapshot.ts|Q后续拟独占：群/现场只读reader与共同来源解析，使用根冻结的worker查询端口。|
|新agent-channel-task-handler.ts|Q后续拟独占：同一runNpcAgent的leased人物任务入口，不直接调旧planner。|
|group-task-handler.ts / group-repository.ts|Q后续拟独占：群接受回执、调度衔接、单人物原生投影。改前需根正式释放登记。|
|scene-task-handler.ts / scene-repository.ts / scene-planner.ts|Q后续拟独占：拆环境与人物、原生单人物结果；环境协议和通用能力由根先冻结，不能并行改同文件。|
|agent-runtime-ports.ts / agent-runtime.ts / run-agent.ts / npc-agent-kernel.ts|根独占：输入版本/执行版本关系、同SQL事务注入与native channel writer协议；Q只消费冻结接口。|
|0072 / agent-runtime-repository.ts|P独占；需根协调输入锚点与attempt多人物关系，不擅改。|
|0073及worker限定source/state函数|根指定唯一SQL负责人；Q不扩worker表权限。|
|worker-composition.ts / world-task-dispatcher.ts / group-services.ts|根集成：唯一新任务标签和runtime工厂接入，旧/新同world只允许一个写引擎。|
|新集成测试及渠道pure测试|范围与PG端口由根另行登记；不可拿本设计或mock当真实权限/原子验收。|

当前没有修改上述业务文件，也没有启动PG/模型/生产操作。先冻结两个先决点、同SQL事务注入、0073权限、环境/人物拆分和原生事件策略，才能实施。只切私聊不表示群/现场已经迁移；若0073或通用能力未完成，应在主表保留明确未完成项，不隐藏回退旧双引擎。

## 公共 Source resolver 细化（根确认原则后的设计，未写源码）

### 已确定的回执原则，覆盖上一节的待决建议

根已明确：immutable receipt.expectedWorldVersion 是实际接收锚点；claim 允许该锚点 **小于等于** 当前执行快照版本。不能重写回执、hash、text 或 origin。群里多人共用同一个parent receipt，各用稳定派生command和独立attempt；private的指定recipient不得由别的人物claim。P正在调整持久层与真实PGcase，本报告不冒称修改已落地。player/world command的有源epoch UoW仍由根另行冻结。

### 解析器职责和提议签名

建议一个infra实现 `resolveAgentSourcesInTransaction(sql, authorization, requests)`；普通app与0073租约函数使用同一授权语义，查询实现可不同。authorization必须由已验证的会话/任务生成：owner/world/actor、channel/thread、inputReceiptId、receipt接收锚点、执行worldVersion、actorRevision、storyAt；worker另绑定确切task/token。requests只接受服务器挑出的候选引用，模型传来的任意recordId不能触发检索。

返回 `{ sources, observations, deniedHandles, stateProjectionRequirements }`：sources只含已核验的有限句柄；observations区分fact/belief/speech/plan/result；denied原因只留服务器审计，不把缺失私密内容写给模型或玩家。stateProjectionRequirements指明哪些持久状态文本需要遮蔽/显式重投影；不能把拒绝的来源偷偷补成“听说”。这是假定接口，最终type/ports仍由根冻结。

解析分两层：一层取得带真实归属/事件/受众的record，另一层核“该人物何时知道、当前渠道能否使用/披露”。共享人物状态不等于所有渠道使用同一段私聊原文。裁剪预算在授权之后；被拒的内容不能进入关键词排序、提示长度预算或topic选段。

|Source类型|真实来源绑定|人物／渠道授权|
|---|---|---|
|accepted_input|agent_input_receipts.id/world/owner、不可变hash/text/origin/channel/thread、接收锚点；group/scene再绑定原native输入及其成功command。不是另造worldmessage。|claim引用同receipt id；接收锚点≤执行版本；private recipient精确相同；group/scene必须实际属于原输入受众且当前仍可发言。受众不因执行较晚而扩大。|
|private_message|world_messages的actor、sourceEventId/sourceVersion/正文，JOIN成功command和实际message effect；初始历史走不可变发布快照专门分支，不假造运行时回执。|只能给真实收发人物。群/现场默认不载private transcript；本人已授权的持续计划可作为state摘要影响行为，但不授权公开私聊原文。|
|group_message|world_group_messages/group/event/version/正文与group.message_sent或group.turn_resolved逐项对应，JOIN成功command。|原消息版本的membership允许读取，当前membership允许发言；入群前、退出期间不可知。不同group不因为同一actor就自动共享原文。|
|scene_entry|scene_items的entry/document、sceneId、source event/version及成功command；验证具体entry kind与原action文本。|按原版本presence与observableTo，私密想法排除；当前到场不回填之前未目击记录；耳语未授权不给全场。|
|world_event / fact|成功命令结果、精确投影/事实、世界与版本；canonical和believedByActorId分开。genesis引用只认可该世界不可变初始快照。|world事实或精确本人可见；他人belief不是公共事实，不能只因事件在同世界就放行。|
|action_result|agent_action_results与实际kernel事件/命令、执行者/对象/结果/版本互证。|只有该人物实际观察或获准披露的结果可见；本人“我会处理”和其他人的台词不构成result。|
|authored|绑定world的不可变publication/version/人物definition，必要时精确已激活且已送达事件。|本人设定/有限已授权方向，不是全部未来剧本或其他人物私密指示；作者资料不能伪装成玩家现实事实。|

group原输入可通过receipt.commandId定位成功group.message_sent，再核groupId和text；scene.input_recorded的event.data并不直接存完整text，必须继续核scene action/entry或已保存命令请求原文，不能拿事件标题充当玩家说话。server sidecar若缓存来源映射必须不可变并参与receipt/任务指纹，不由客户端补填。

### 同一来源两个版本、受众与忘却闭包

- 接收锚点是历史事实，执行截止是本次snapshot；source.version/at描述真实来源，不把旧记录改标为当前执行版本/当前时间来“通过”校验。当前worldVersion内新增的实际结果可用于更新观察，但不是重写原玩家输入。
- 截止到执行worldVersion/storyAt，并排除未来、未提交、错误command receipt、跨world/actor/thread和forgotten引用。原来无权听见的人，即使后来入群/到场也不能claim该输入。当前失去发言资格的人不能凭过去在场继续输出。
- **忘却必须覆盖衍生文本。** 只删除observations不足：持久state.goals/plans/responsibilities的summary、decisions.quote及action.parameters仍可能含被忘却原文。root需冻结“完整server state用于CAS/reduce，模型view只含可授权文本且保持同identity/revision”的语义，或在明确遗忘命令中先重投影这些内容。不能为了遮蔽而把持久目标删掉/标完成，也不能用模型view覆盖完整state。
- 对同一source的修正、撤销或忘却，sources和相关状态文本采用同一授权快照；旧plan仍可在服务器保留为审计对象，但依赖失效来源的动作不可执行。无法完成授权闭包就不得把原文送模型。
- 供动作/决定引用的opaque handle，只在本次已授权表内解析；返回kernel时再次核receipt/actor/audience/版本。字符串命中不是权限证明。private内部使用与群/现场对外披露要有不同许可，不能将source.kind当作充分授权。
- 来源故事时间与回执receivedAt的墙钟语义需要根统一：二者不可互换。私聊尚无native消息的accepted_input要从真实接受锚点/有源sidecar获得故事时刻，不凭执行时刻倒填历史。

### 实施前的最小负向验收

0073真实PG应覆盖：同parent receipt两人按不同执行版本成功，各自command/attempt/actor revision独立；private recipient他人claim拒绝；同群后入者/退群者拒绝；现场未目击、私密想法拒绝；伪造task token/actor/thread/原text/hash拒绝；未来/forgotten来源及其衍生state文本不入模型；raw响应恢复不重付；同SqlClient任一步失败时原生投影/状态/结果/task均回滚。适配mock还应捕获最终payload，确认隐藏state文本不通过其它summary/quote字段绕回。

本节是公共来源设计，不新增Source resolver源码、不改群/现场、不改P0072、不建0073、不运行PG或真实模型。等待根冻结server-state/model-view语义及授权接口后再登记实施范围。

## 已冻结可见状态接口后的窄修交付

根公共提交 `9317ecdb`（本树仅cherry为`d470ec85`）强制AgentSnapshot包含viewState及redactedStateIds。根负责loader按来源/forget闭包生成可见view，完整state保留在服务端做CAS/reduce。本人获独占授权修改原npc-agent-model.ts与对应测试，未改公共契约或loader。

- 冻结业务提交：`6e4f43e`，仅两个原文件。
- payload字段仍名为state，但**唯一取值为statePayload(snapshot.viewState)**，没有完整state fallback。schema、world、actor、revision、definitionRef、投影cursor必须与canonical state一致；缺view或redactedStateIds、任一绑定不一致时在模型调用前拒绝。
- 预算与受保护来源也只使用viewState中的focus/责任，不遍历完整state的隐藏summary/quote/参数。仅传stateDetailsWithheld布尔告知存在遮蔽，不传被隐藏对象ID；提示词明确“隐藏不代表已删除、结束或完成”。
- 完整state不被覆盖、不删除目标或历史；模型view不能作为持久化完整状态的替代。loader对actor材料/observations/source与viewState的共同授权仍由根负责，不能仅凭本适配修改声称所有输入资料已经验证不泄密。
- 14/14专项通过；新增测试把被忘却摘要放到canonical目标/计划/责任中、决定引文、动作参数和focus引用中，其中一个摘要远超模型预算，确认raw canonical数据既不进入prompt也不影响预算，view仍可调用且原state不变。
- 缺view、world/actor/revision/定义/cursor错配、缺redactedStateIds均零模型调用拒绝；原12项适配测试继续通过。
- `npm run typecheck` exit 0。按根本轮明确要求不重跑fullcheck/build；此前完整检查/构建证据不冒称覆盖本次冻结提交。
- 无真实模型、PG、生产、渠道实际入口变更。root可挑`6e4f43e`接续集成；任务仍待验收，非已上线声明。

## 根private WIP快审（只读，修复前观察）

根要求快审其未提交agent-snapshot-repository.ts、npc-agent-services.ts及authorizedAgentState/reduce；另只读核对npc-agent-kernel.ts和P已接入的scope helper，以免误报已有校验。下述是当时WIP，并非不可变提交结论；已立即回报根，不改源码。

### 必修1：可见状态依赖过滤未收敛

authorizedAgentState先按dependsOnActionIds剪枝，再因preconditions删除动作，第二步后没有重算actions集合或再次剪依赖；plans条件用的集合也可能包含已删动作。responsibilities只核sourceIds/deadline，nextCheck的来源条件没有核。

调用实际纯函数复现：a1以public来源建立但有hidden observation前提，a2依赖a1，plan p引用a2并等待a1结果；责任r的nextCheck引用hidden。只允许public时实际输出仍为actions=[a2]、plans=[p]、r.nextCheck=[hidden]，redacted只有a1。无PG/模型调用。

建议对source条件、动作依赖、计划条件与责任nextCheck联合迭代至不动点，核nextActionId及focus.subject引用；不能把已失效对象保留为仍能推理的状态。此结果证明投影闭包缺口，不等于已证明真实模型泄密。

### 必修2：旧accepted_input恢复缺少真实消息／事件别名忘却闭包

快审时agent-snapshot-repository.ts:193–214为持久state保留旧receipt句柄，过滤仅blockedSources.has(receipt.id)，source.recordId也只设receipt.id。现有loadActorMemories里的blockedSources来自forgotten.source_ids，常为消息/世界事件ID。若state summary/decision引用原receipt句柄，忘却该轮message/event不会命中receipt UUID，该句柄仍被恢复，authorizedAgentState仍保留相关文本。kernel提交前的sources检查同样只展开现有句柄/recordId/去前缀ID，没有receipt→原消息/事件映射，不能替代这个闭包。

应从实际已提交事件的agentRuntime.inputReceiptId与消息投影建立只读别名，再按忘却记录核验。模型view必须在调用前遮蔽，不能只在提交时拒绝已泄露到模型的内容。这是源码路径推导，尚未跑真实PG重现；根需补“先真实一轮、按消息/事件忘却、下一轮payload无旧summary/quote”的数据库测试。

### 输入接收时刻／版本需保留原语义

- 快审时当前input对应AgentSource.worldVersion使用world.version，而不是receipt.expectedWorldVersion；parent receipt晚执行时会把接收锚点改标为执行版本，与已冻结原则不同。
- source.at已使用input.storyAt，receipt保存receivedAt与storyAt是正向修复；但npc-agent-services仍把新计算storyAt传snapshot，恢复response_received时并未恢复原推理时刻。执行时刻可重新核验，但必须与原输入时刻及原模型响应依据显式区分，不宣称回放恢复了全部原快照。
- npc-agent-kernel.ts:219的turn.resolved.data.userAt使用回复提交at，而不是原receipt.storyAt；这会把玩家发送时刻改成稍后的回复时刻。应保留原输入故事时间，回复/执行at独立记录。

### 正向核实与验收边界

reduce基于context.state合并增量，没有用viewState覆盖canonical；validate对隐藏对象ID修改有REDACTED_STATE_MUTATION拒绝。private服务由真实command构造recipient/thread/inputHash，明确拒绝外部director origin；scope helper校验private thread==actor，未发现该HTTP入口自行伪造群/现场玩家输入。只读来源查询没有初始化状态或调用模型。上述正向观察不抵消三项修复需要。

未写业务源码、未跑PG或真实模型、未部署；不重跑fullcheck/build。根报告的联合真实PG5项使用mock模型，不能作为真实模型效果证据。phase1若只部署受epoch门禁的代码且不将生产世界切2，须明确完整群/现场运行仍未完成；本报告不批准未经修复的epoch2激活。

## 能力成功与目标完成的窄prompt补丁

根新增可信能力结果的completedGoalIds，并维护责任/决定版本元数据后，指派本人只改原适配器与mock测试。

- 冻结业务：`607f2f9`，仅npc-agent-model.ts及对应测试；提示版本为npc-agent-v2-goal-completion。
- 提示明确plan.record只记录计划、appointment.propose只建立邀请，两者成功都不授权完成外部目标；普通resultId或succeeded不足以将goal设fulfilled。没有可信的目标完成资格则保持active/deferred，或有真实原因withdrawn，不以消息数、记计划、发邀请结清外部目标。
- completedGoalIds只有可信能力执行器维护；responsibility.revision与decision.responsibilityRevision由服务器维护，model proposal不输出这些内部字段。现有显式白名单未扩大，不给模型透传两个对象的内部revision；根state.revision身份绑定照常保留。
- 15/15mock专项通过。新测试核system规则及最终payload省略内部revision，并不声称真实模型一定遵守；实际完成资格由根kernel强制验证。本适配仍raw透传不解析模型响应。
- 按根明确要求未跑fullcheck/build；本轮没有真实模型、PG、生产、公共类型或其它源码改动。
- 交由根集成与实际验收，保持待验收；先前private快审必修项待根修后另行只读复核，不因本prompt补丁而宣称已解决。
