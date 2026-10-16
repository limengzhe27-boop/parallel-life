# MA-ARCH-44-Q：人物 Agent、渠道路由与现场规则复核

- 负责人：`codex-ma-arch44-q-20261015`；唯一集成人为根对话。
- 冻结基线：`1028b06b7cf29dcb46adfcc84a029b4f5a82bff5`，与指定 history-chat-media 集成提交一致。
- 独立工作树：`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`；分支 `codex/ma-arch44-q`。
- 范围：只读业务；仅本报告、主目录镜像和本人任务登记。状态：待集成人验收。
- 本报告是代码调用链审查及重构建议，不代表已实现独立 Agent 架构或已验证真实模型效果。

## 1. 未合并内容核实

原分支 `codex/npc42-q` 停在 `6bbb4c66`，工作区干净。对指定基线运行 `git cherry 1028b06b codex/npc42-q`：

- `09bddaec`、`a9ba7779`、`d8575f93`、`a6b67026` 全部为 `-`：等价业务补丁已经集成，不应重复合并。
- `35cb7aee`、`6bbb4c66` 为 `+`，只含历史 NPC42 审查/交付报告，无遗留未合业务。
- 本人长文修复 `a6b67026` 已由 `fb3c8d36` 集成。基线中 actor-context 已调用导出的 legacyPersonaExcerpt 做早期预算处理，不能沿用旧报告称这一接线仍未修。

## 2. 真实调用链与模型入口

|渠道|实际调用链|模型与提交边界|
|---|---|---|
|私聊|`POST /api/v1/worlds/[id]/messages` → authenticated / 世界活动锁 / 时钟投影 → `resolveTurn` → receipt 重放与版本核对 → `actorContext` / 本人记忆 → `publicationCharacterPlanner.prepareContext` → `publicationCharacterPlanner.propose` → `WorldTurnPlanner.propose`|`createTextModel()` → YibuTextModel；模型调用后 parseProposal / 效果权限 / 目标引文核对 → `PostgresWorldRepository.commit` 同事务保存事件、投影、回执、记忆、剧情协调与目标评估；成功后再尝试 story.progress 和 Outbox 派发。此入口是同步 HTTP 回合，不是群聊/现场的 leased task 模式。|
|群聊|`POST .../groups/[groupId]/messages` → `PostgresGroupRepository.send` → 先保存 `group.message_sent` 并入 world 任务 → 客户端显式 `PUT` 同路径执行任务，或 worker dispatcher → `groupTaskHandler` → `planGroupTurn` → `WorldGroupPlanner.propose`|`runGroupOwnedTask` 使用 queue claimForOwner/runOne；通用 worker 同样接 group handler。每个选中人物一次独立模型调用，默认一个，最多两个；模型不指定 actorId。`queue.commit` 重读版本/暂停状态后 `groupReplyEvent` / `persistGroupEvent` 保存 `group.turn_resolved`、群投影、预约与回执。|
|现场|场景创建/入场，或 `POST .../scenes/[sceneId]/actions` → `SceneRepository` 保存场景输入与 world task → `/api/v1/tasks/[id]/run` 或 worker → `worldTaskDispatcher` → `sceneTaskHandler` → `scenePlanning` → `ScenePlanner.propose`|`createSceneTextModel(sceneGatewayConfig())` 可选独立 scene 模型；scene 与 group 共用 world task 租约体系。`ScenePlanner` 内先裁定环境/玩家当前动作，再逐个调用现场人物；`queue.commit` / `commitSceneProposal` 重验版本、在场、动作证据并保存现场投影、世界变化、目击者记忆和回执。|

代码锚点：messages route:25；resolve-turn.ts:17/78/95/133；publication-character-planner.ts:26/56；turn-planner.ts:98/152/235；group-services.ts:17/53；group-turn.ts:7；group-task-handler.ts:25；group-repository.ts:176/431；worker-composition.ts:34；world-task-dispatcher.ts:5；scene-task-handler.ts:7；scene-repository.ts:629/790/838；scene-planner.ts:490。

现场模型调用并非恒定三次：普通简单当面问句满足 directQuestion 条件时，环境裁定直接由已保存输入构造，不额外调用模型；否则一次环境/裁定调用，再最多两个人物调用。开场人物调用还决定自己此刻是否到场，最终到场要经事务提交，预约或导演候选列表不是到场证明。人物候选排序按接收动作优先后截前两名，尚不是统一导演的回复责任决策。

## 3. 人物状态与知情协议的实际差异

|材料/能力|私聊|群聊|现场|
|---|---|---|---|
|基本身份与人设|本人 actor + 有界 legacy persona|选中 actor 的基本人设|每次人物调用自己的 actor/context|
|五维长文|publicationActorModules → selectActorPersona → ownCharacterSettings|无接线|无接线|
|开场本人私密方向|readActorSituation，绑定本人开场消息/事件/版本|无接线|有面向当前 offer 的场景摘要，不等于同一套 actorSituation|
|持续私密目标|readActorEventGoals → scoped eventGoals → 回合评估|无 eventGoals 或评估接线|无 eventGoals 或 applyActorEventAssessments 接线|
|本人私聊历史|按 actorId/忘却过滤后预算检索|明确不读 world_messages|actorContext 可读本人私聊，不读他人私聊|
|群消息|私聊 context 不加载 world_group_messages|只读该群且按成员加入/退出版本过滤|scene context 不加载 world_group_messages|
|现场经历|可检索本人的 character episode|不读私密记忆|目击可见 entries、本人记忆及当前可观察裁定候选|
|公共与私密事实|世界事实或指定本人可见事实，并过滤忘却来源|只有 world/canonical/非他人 belief 的公共事实|环境导演只读公共现场材料；人物调用读本人可见事实|
|持久化记忆|角色 belief 与来源、分支 episode|群投影及可选邀约；persistGroupEvent 未接角色记忆/目标更新|实际目击者 character episode + 分支 episode，保留真实 sourceIds|

因此当前存在“同一个 actorId，多个不同能力的提示上下文”。私聊里已建立的五维/目标不保证在群内或现场持续起作用；群内已知经历也不会自然带回私聊或现场。不能把现有三条独立人物调用描述成已经完成的跨渠道持久人物 Agent。

正向基础必须保留：

- 群成员在消息版本时是否在群，由 `experience-rules.ts:250` 的 canReadGroupMessage / groupMessagesForActor 校验；入群前和退群期间不能补看。
- 现场 entries 按 observableTo / presence 过滤；private thought 只给玩家，不入人物任务；邀请不是到场、对白不是动作完成。
- `scene-repository.ts:1300` 起按实际 observers 保存 character episode；`scene-conversation-memory.ts` 只保真实可听见输入/本人回复/观察，超长完整引文可能被省略，不保证全文长期记忆。
- `actor-context.ts` 拒绝真实 profile 进入 NPC，并过滤角色归属、branch、forgotten 来源与私密 progress 原始记录。不要靠统一提示词替代这些服务端裁剪。
- `character-policy.ts:36` 只允许可信 director origin 发 information.shared；人物不能替别人说话、把普通 belief 升成公共事实、替别人同意邀约。

当前信息共享机制也不等于跨渠道总线：私聊 director 的 information.shared 是受控披露；群内自然发言和现场被听见的消息需要按该渠道实际 audience 留证，不能自动公开作者私密方向或完整私聊。

导演当前观察并不完整覆盖三渠道：`director-observation-repository.ts:29` 的 actorExchanges 只读 receipt-backed turn.resolved / world_messages；recentWorldInputs 在 publication-event-progress-repository.ts:75 覆盖 travel、invitation、scene 结果，但未包含 group.message_sent / group.turn_resolved。不能声称总导演已经看见所有群内拒绝和承诺。

## 4. 群里短答的回复责任：已实证的问题

`selectGroupSpeakers(world, group, text, maxReplies)` 不接收群历史、上一问的发起人、reply-to 或未答事项。选择依据只有本条 @、本条关键词与人物人设/关系匹配，平分时用 world.actors 顺序；即便全部 score=0，仍保留第一名。默认 maxReplies=1，最多两个。

对冻结基线实际导出函数做纯规则探针，两名人物 a/b：

|本条输入|选中人物|
|---|---|
|`@b sound?`|b|
|`好`|a|
|`那就这样`|a|
|`不用回复`|无|
|调换 world.actors 顺序后输入 `好`|b|

这证明短答责任取决于数组顺序。此探针不是实际群聊模型对话，也没有证明 a 一定说错；问题在于正确责任人可能根本没有得到模型调用。测试 `tests/group-runtime.test.ts:134` 还把重复姓名 @ 未能定位时返回第一个人物固化为预期，不应原样保留这一行为验收。

此外，两人发言时 planGroupTurn 给每人的群历史是同一份已保存 read.messages，不含前一人的本次提案：第二人没有观察到第一人刚生成的回复。重构要明确同一批并发独立回应，或按实际提交版本串行续接；不可把未提交提案伪装成已经说过。

建议替换为有来源的回复责任输入：当前渠道/线程、玩家明确点名、所答消息的来源、尚待回答的问题/邀请与责任人、每人最后实际发言、当前成员/在场资格。短答优先承接可核对的未答对象；歧义时允许暂不答或由导演澄清，不能永远默认第一人，也不能让所有人代答。责任是路由候选，不是替玩家确认或自动完成事件。

## 5. R17 专属规则：该迁移什么，不能直接删什么

这不是只有一处提示词示例。scene-planner.ts 的 action schema / NpcActionSlot 固定 `receive_r17 | inspect_r17`；allowedActions、第一人称动作引文要求、缺少动作证据时拒绝声称已执行的正则也依赖 R17。普通现场提示还含“不照搬R17”等针对旧案例的约束。

关联领域规则：

- `scene-step-progress.ts:13/106`：规则版本 r17-delivery-v1、7种步骤、维修单/接头/钥匙的模式，且仅 official preset county-yellow-hair v3 的 deliver_r17 命中，**并非任何稿子写到维修就自动激活**。
- `scene-matter-policy.ts:17`：preset → matter → 固定地点及行动/观察条件；还有其它官方 preset 条件。
- `matter-progression.ts:16` 起：按官方 preset 的 trigger 生成固定后续机会，不是通用编剧事件演绎。
- matters.ts 的 SceneNpcActionProposal 类型仍枚举上述两种动作；测试与既有存档的 ruleVersion/step evidence 依赖它。

应替换的是“核心引擎只认识这些剧情动作”的假设；应保留的是原始玩家输入、本人实际动作引文、身份绑定、允许动作范围、在场/目击、否定/未来/引用排除、幂等与已保存步骤不倒退。

迁移方式：先由集成人定义通用的可信动作能力/证据协议，明确 actor、执行者/接收者、对象、地点、当前授权、可核对来源、观察及结果。旧 R17 迁为显式版本化能力适配器，读取旧 ruleVersion 不改写旧事件；新剧本默认不用维修规则。通用协议有同等反作弊证据和真实回归后，才移出核心中的专属 enum/正则/长提示。不能只删 R17 字符串，放开模型一句“我做了”直接完成事项；也不能把编剧正文自动转成正则条件表。

## 6. 保留 / 替换 / 迁移清单

|类别|对象|处理建议|
|---|---|---|
|保留|单一 PostgreSQL / owner RLS / 世界版本与 reducer / receipt / Outbox|继续作为真源和提交门槛，不新增每人物第二套数据库，不用内存 Agent 对象作生产状态。|
|保留|现有 queue lease、unknown 不自动再次计费、显式用户输入与事件来源|统一人物调度要复用；私聊同步与 task 两种生命周期须明确迁移，不可同时消费同一输入。|
|保留|群 membership/场景 presence/observableTo/忘却边界|变成统一上下文构建器的必选授权输入，不退化成 system 文案。|
|保留|已有微信、群聊、现场、邀约、地图和版本化发布快照|渠道渲染与投影可复用；架构重构不是重建手机外壳或丢旧存档。|
|替换|三个提示上下文各自决定人物“是谁、知道什么、在追求什么”|统一按 world+actor 的持久人物状态读取入口；渠道适配器只加入被授权的当下输入和输出形式。|
|替换|群聊关键词+数组第一人、现场接收人优先后前两名|统一导演候选/责任调度，并允许本人回应、拒绝、沉默；保持成本上限且不预先决定玩家选择。|
|迁移|角色 goal、opening situation、长期 episode / belief 的分散读取|先定义同一人物状态版本与来源协议，再三渠道接同一读取/提案/验证/提交流程。底层 publication 共享 ledger 与个人状态不可简单拼成对所有人可见的一份大 JSON。|
|迁移|导演观察只覆盖手机 exchange 与部分现场事件|增加 receipt-backed 群事件摘要及 audience，导演可统筹不代表 NPC 共知；不要把导演获得的全局内容反灌人物。|
|迁移|R17 专属步骤/动作/提示/存档规则|版本化兼容适配，通用能力协议验证后移出核心；旧事件、已完成步骤与成果保持原意。|
|替换|把可选进度评估失败当对话失败、把选择事件当发生|保留基线已经改善的可选评估降级与来源核验；跨渠道统一协议也必须区分提议、实际送达、观察、执行与完成。|

这里的独立人物 Agent 应表示“独立身份、持久目标/记忆、权限与自主提案”，不要求每个人单独进程、常驻付费循环或一种独立模型。仍可在模块化单体与现有 worker 中实现。

## 7. 推荐迁移顺序与验收门槛

1. 集成人先冻结统一输入/可见来源/回复责任/人物提案协议，界定导演权限与人物权限。保留现有存储真源，避免同时写两份相互冲突的权威状态。
2. 统一人物上下文与来源版本，再以明确版本/路由开关逐渠道接入；旧新路径同一 commandId 只能有一个执行者。先确保旧手机与场景入口可回退，不重写历史事件。
3. 群聊责任路由与群观察/记忆闭环：短答、点名、拒绝、离群/重入、多角色轮流提问，检查跨渠道只传本人真正获知的内容。
4. 分离现场环境裁定与人物提案，保留单事务校验、实际到场和执行证据；替换 R17 之前先完成通用能力及旧存档兼容验收。
5. 最终集成后按项目要求 check/build、真实 PostgreSQL 幂等/冲突/回滚/RLS/租约验证，以及有预算的真实模型与 PC/手机公网验收；部署 READY 后再称上线。具体任务定义和分派仍由唯一集成人主表登记。

关键真实验收应覆盖：群里 b 提问后玩家“好”不会被 a 代答；同一人物私聊→群→现场维持目标但不泄漏未分享隐私；群退出期间不知情；现场旁观者记住所听、未在场者不知情；玩家拒绝 a 不等于拒绝 b；事件被选中不等于已经发生；现场承诺不冒充执行；旧 R17 规则不会误触发普通作者剧本；租约丢失/版本冲突不重复付费或双发。真实验证须对照实际存储来源，不能只靠模型回答声称通过。

## 8. 本轮验证与限制

- 已读指定基线源码和项目入口文档，核实三条实际调用链、跨渠道上下文差异、群短答选人及 R17 规则版本守卫。
- 实际运行 selectGroupSpeakers 纯函数探针，结果见第4节；没有调用模型或写任何数据库。
- 未运行 check/build：本轮仅报告，集成人明确要求只读审查，业务源码零改动；不将本报告视为实现验收。
- 无真实 PostgreSQL、浏览器、公网、部署或付费模型验证。未操作“渣男体验”原草稿或其它生产数据。
- 本轮唯一交付是待验收报告。跨渠道统一 Agent、通用现场动作协议、实际迁移与上线均未由本任务实现，需由集成人排定实现及验证。

## 9. 根总体方案交叉复核

另已只读核对 history-chat-media 工作树中的 `docs/architecture/NPC_AGENT_RUNTIME_44.md`（2026-10-15 根方案，当时尚在编辑的文档，不冒称1028b06b已含此文件）。方案关于三入口、持久人物身份、短事务 attempt、范围阻断、单引擎写入和 R17 能力迁移的方向与本报告实证一致，可继续冻结公共契约。

公共 types/ports 实现前建议明确以下门槛：

1. **快照的授权维度**：人物 snapshot 必须绑定 world/actor revision、channel/thread、故事时刻与来源版本截止、当前实际 audience；来源先由服务端解析成员/在场/forget。owner 能读到，不代表 NPC 能知道。导演全局 snapshot 不能复用为人物 snapshot；他人人物私密计划摘要也不能成为普通群上下文。
2. **本人私密状态连续，不等于可公开原文**：本人在私聊形成的计划可影响之后群聊/现场行为，但 private SourceRef 的存在不授权转述原话或秘密。渠道输出的披露/动作需要自身许可，不能让 ChannelAdapter 把 actorState 全量 JSON 展开给群成员，也不能把群里某人的拒绝同步成所有人的个人目标状态。对模型可用服务器发放的有限句柄，不必暴露持久数据库指针或工程标识。
3. **R17 迁移不能只泛化名称**：旧能力实例应绑定 preset/version/matter、具体对象、place 与执行人物，保留旧步骤来源和完成结果。通用 handover/inspect 必须由内核按授权对象与前提实际执行，模型的 succeeded 或“我检查了”不是结果凭证。旧正则保护只能在通用能力具有等价证据门槛后退出运行路径；旧事件重放读取器保留，不启动第二套写引擎。
4. **既有数据迁移只认真实来源**：未接入统一状态的群聊天不能用新模型倒推历史答应或拒绝；现场实际目击 episode、群成员版本、既有有效结构化步骤均保留来源，映射不了就 unknown。迁移不能重置人物、覆盖稿件或补造玩家选择。

以上已回报集成人。本人下一阶段仅在集成人给出精确冻结接口与文件归属后，才领取渠道 adapter/group/scene 接线；当前不预建业务文件，也不修改公共协议。
