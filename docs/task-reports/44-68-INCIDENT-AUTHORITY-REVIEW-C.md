# 44-68-INCIDENT-AUTHORITY-REVIEW-C

## 身份、范围与结论

- Agent：`codex-ma44-incident-authority68-review-c`，会话 `/root/episode_context_61`；root 独占产品源码、公共契约、SQL、集成和发布。
- 本人工作树：`/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本`。只新增本报告、主目录同名镜像及本人主表行；开工前已短锁登记。
- 只读来源：root `/Users/limengzhe/.codex/worktrees/history-chat-media/人生剧本`，审查起始 HEAD `f73858b00e7fdcc247031e7d4802ed4110a2c4bf`。0 产品/SQL/测试/配置修改，0 DB、模型、生产、端口或 full check/build。
- 结论：可沿同一 Director → NPC runner/kernel → 世界事件/回执链实现有界闭环，但必须分开作者方向、个人态度、实际发生和真实结果。旧自然语言事件没有可验证执行/观察规则时，不能确定性认证；呈现承诺也不产生替 NPC 决定或替玩家同意的权限。

## 当前真实边界

|代码|当前事实与实施含义|
|---|---|
|`domain/director-runtime.ts`；`director-runtime-repository.ts:1037`|Director 只提交 proposed opportunity，共享 episode 初始 sourceEventIds/resultIds/unresolvedResponsibilityIds 均空。声明的 resolved/withdrawn TS 枚举不代表 SQL 已实现。|
|`agent-narrative-repository.ts:581`；SQL81 `guard_agent_episode_progress`|仅 engage 且该 NPC 真实提交消息才把 episode 改 active，附本轮事件。它证明 delivery presentation，不证明作者事故/会面/结果。SQL81 只准 proposed/active，强制 results/responsibilities 空，不能直接填结果或关闭。|
|`domain/agent-narrative.ts`；SQL81 request/receipt|本人 choice 和 reason/sourceIds 有真实独立回执；它不是 player decision。request 一次 consumed，唯一约束 `(world,episode,actor)`，输入 revision 固定 0，不能靠重跑该 paid request 做再评估。|
|`npc-agent-kernel.ts:240-377`；`domain/agent-runtime.ts:96`|可信能力结果有 actor/action/event/version/证据/输出引用；当前只有 plan.record、appointment.propose、travel.begin。completedGoalIds 当前均空，成功写计划/邀约/开始出发不能认证外部目标完成。|
|`authored-event-eligibility-repository.ts`|目前 nodeProgress/stageProgress 故意为空。occupied authored keys 只防重复机会；不得把 occupied/active 直接投影为 after_committed_node。|
|`domain/authored-event-eligibility.ts`|after_presented 需真实 presented 证据；after_committed 需 resolved+committed；after_resolved 匹配指定 terminal outcome。资格 window 过期本身不生成 expired 结果；冲突证据阻断而非挑一个方便的结果。|
|`settings/domain/story-event-progress.ts`|已有成功 receipt、criterion basis/purpose、all/any、每人可见性和普通换题不完成条件的可复用纯规则。productiveBeats/pace 只是调度建议，不能成为发生或完成凭据。旧持久 adapter 绑定 legacy publication_story_nodes/plans，不能直接接 epoch2 或触发旧 planner。|

## 四种不同的声明

1. **作者方向/呈现承诺**：不可变 source origin + nodeHash 上的戏剧目标、required/optional、未来邀请/消息建议。表示系统应努力寻找合法呈现路径；没有成功就记录未实现/被边界阻断，不能写“已经发生”。
2. **个人参与态度**：NPC 仅通过自己实际 runner 的 episodeDecision 决定；玩家通过真实玩家命令决定。decline/quiet/defer/engage 都只改变相应主体的 stance。单个人的退出不关闭其他人的目标。
3. **事件实际发生**：特定执行/观察规则在可信世界事件上成立，能指出具体什么发生、谁执行/观察、何时、依据。邀请已发、出发已开始、到达、会面和合作达成是不同谓词。
4. **结果/结束**：显式 completion/withdrawal/expiry policy 在真实证据上成立。成功、失败、拒绝、暂缓、退出不混为一个 completed；未选择、换题、离线和超出聊天轮数都不能伪造结局。

若作者写“预制事件一定发生/目标结果”，最新自主决策权仍优先：只能由作者授权且运行时已支持的外部事件能力保证呈现，不可保证 NPC 接受、玩家同意、赴约、付款或成功。无合法路径时保持明确 blocked/uncertified，不默认调用其他人物兜底，也不把未授权脚本转成他们的知识。

## 最小通用数据协议（设计建议，尚未修改契约）

**Episode policy binding**：绑定原 episode、world/epoch、完整 `AuthoredMaterialRef`、policyVersion/hash，以及若干有名称的 occurrence/result/withdrawal/expiry criteria。每个 criterion 必须声明 `purpose`（communication/decision/physical/world_result）、可接受的 evidence kind、精确主体/目标、all/any 组合及适用范围。policy 来自显式作者字段或有版本的注册能力规则；不能来自 Director 随意改写的 prose。

**Episode progress receipt**：append-only，包含 episode、expectedEpisodeRevision、world/epoch、绑定 ref/policyHash、kind（occurrence/criterion/resolution/defer/withdraw/reconsider）、明确 outcome/criterion keys、真实 sourceEventId/version/storyAt、逐条 evidence refs 和其 verifier kind。proposal 只允许引用句柄；这些可认证字段由服务器 resolver 填充，模型不能自称 `verified:true`。同一 source record + episode + rule 只能投影一次，重复调用只返回同回执。

**Shared episode 投影**：保留现有 presentation 历史；新增明确 nullable occurrence/resolution 引用和控制状态（如 deferred 及 nextCheck），不能将现有 active 改称 incident occurred。resolved 必须引用足够结果证据；withdrawn 必须有明确退出政策及受影响主体范围。revision 做 CAS；个人责任列表来自实际本人状态，不能由导演擅自改完。

**Reconsideration cause**：原 request 不变，真实新证据/明确重新开放/一次跨越的作者时间阈值生成稳定 causeKey。需再次向同 NPC 发起 consideration 时，追加同 episode/actor 的新 request revision，记录 previousRequestId/cause，而不重开旧 consumed/paid/unknown 请求。普通后续计划优先沿本人已有 responsibility/plan/nextCheck 和普通 wake；不为每次 poll 新建 consideration。

## 谁可以提出，谁可以认证

|提出者|允许提出|最终权威及不得代替的内容|
|---|---|---|
|Director 原模型/决定|选择机会、引用真实进展提出“复核 criterion/外部 typed intent”的建议；协调新 cause|不直接产生 occurrence/result、NPC stance、player consent、位置或能力成功。运行时逐项重新解析来源并核 bound policy；不能凭 audit/description 作证。|
|某 NPC 原 AgentProposal|本人意愿、退出或暂缓；本人 action；引用自己已知的证据建议进展|只可替自己行动。自身 receipt 可证明本人 choice；能力 executor 认证实际副作用。不得替另一 NPC 或玩家同意，不得把“我认为成了”认证为外部结果。|
|玩家现有命令|邀请回应、旅行/现场输入等实际操作|由原命令权限、expected version、exact target/revision 和事件回执认证。普通一句“到了”只形成 reported knowledge，不是 actual position；含“同意”文本也不自动成为某次具体邀请的同意。|
|已注册能力/确定性 continuation|真实执行结果、到达、受支持外部事件的观察|只有对应 kernel/continuation 的成功世界事件和具体验证器可认证。Director 或 NPC 的 output 文本不能自行生成该权限。|

所有模型仍只调用现有 Director/NPC 单次接口，不增加独立“裁判模型”或第二套付费队列。最小 progress projector 只处理真实已提交事件/能力结果；需要外部自然事件时，先登记受约束的 typed capability 与来源/前提，沿既有 UoW/任务执行，不开自由文本写事实旁路。

事件真的存在也不代表所有 NPC 知道。progress receipt 默认是服务端审计，不直接作为全体角色事实；角色知情继续通过现有 fact visibility、实际 scene observableTo、membership、本人 perception/消息/strategy resolver 授权。Director 的 participantActorIds 不授予知情，不能由它自由填 knownByActorIds 自证权限。

## 可直接复用的证据与不能升级的证据

- `agent_episode_receipts`：本人考虑和真实已呈现记录；可绑定 source request、本人、attempt、实际 message ids。不能凭 choice 或条数认证 author incident。旧 active 回执不自动补成新 occurrence。
- `agent_action_results`：核实同 owner/world/epoch、actual committed attempt、actionId、outputRefs 和真正能力 effect。plan.record 只证计划；appointment.propose 只证具体邀请已建立；travel.begin 只证实际开始在途。
- `AgentJourney` + `agent-arrival-continuation` + authoritative position：证明准确角色实际到达。必须连接本 episode 的授权 action/request/criterion，不能拿同地点的无关到达或同时在线推断会面。deterministic scene.opened 只是呈现已有 presence，不是移动或会面凭据。
- `invitation.responded`：精确 appointment ID、操作和当前邀请版本/主体的真实玩家命令，可证明 accepted/declined/rescheduled；接受不能证明到场，改期不能沿旧邀约同意执行新方案。
- 真实 scene action result/worldResults：仅在现有 scene kernel/receipt/presence/可见性验证通过、且结果类型与 policy 一致时使用。输入 action、台词、图片、场景标题本身不证外部动作成功。
- 作者既有 `direction.progress.completion` 的 `npc_exact_message`/`invitation_response` 可用于明示的 conversation/decision 规则；literal phrase 匹配最多证明文字出现，不能认证其语义、承诺或物理结果。不要把旧 adapter 的 `.includes(phrase)` 复制为世界发生认证。
- 可复用 legacy progress 的纯 receipt/criterion/visibility 约束与真实事件 resolver 结构；不可借 legacy goal-context 把全局 title/editorial/script 下传本人，也不回填旧 publication_story_plans 或采用旧 planner 兜底。

## 最小可运行闭环及明确缺口

先交付一个通用但有界的 **真实邀请流程**，适用于任意人物、地点和题材：

1. 合法作者单人物 offer_invitation，通过 67 只给 A 本人未来建议；Director 只给考虑机会。
2. A 可拒绝/暂缓/安静。若 A 自主选择并实际执行 appointment.propose，kernel 保存真实 action result、appointment、事件和 episode evidence binding；此时最多认证 `invitation_offered`。
3. 玩家针对准确 invitation 的真实回应生成新证据。只有显式作者/注册 policy 规定本 node 的范围就是“提出邀请并得到回应”，才按 accepted/declined 认证该范围结果。若标题/全文目标是“会面/合作”，该邀请结果只是子条件，整事件仍未完成。
4. 暂缓保留旧事和所有人的独立立场，nextCheck 等待真实回应、明确开放条件或有依据的时间。新 cause 到达才再次考虑；同一 cause 已 paid/unknown 不重买。普通换题既不关闭，也不重置旧事为“从未提出”。
5. 当前 appointment.propose 只落 title/at/participantIds，没有 placeId 的执行绑定。作者 placeKey 及模型建议可供考虑，但不能补称邀请场地已落库或赴约已安排。地点若是该 policy 的必要条件，需要扩受校验的能力参数/effect，或保持 unavailable；不能猜。

真实会面/事故/产出需另外显式提供 occurrence 和 result 条件，例如“准确主体经真实位置/到达凭据进入同一地点，产生与该 episode 绑定的实际现场动作”，再由已支持的 scene/world-result 能力验证结果。单纯同时在场也只证 co-presence，不证交谈或项目完成。若缺少此类作者条件或能力，返回 `unverifiable_policy`/`unsupported_effect`，可以继续合法沟通，不认证事件全文发生。

这使闭环能真实运行，又不会将“邀请流程成功”半真替换为“作者会面/事故/目标成功”。自然语言目标的语义认证必须另有明确 authority 设计，不能用自动摘要补上。

## 事务、持久化和新迁移

- 在现有 NPC kernel、玩家命令 UoW、arrival/scene continuation 的真实 source event 成功事务末尾调用同一 progress projector；验证 event/command/attempt/result/visibility/bound policy，append evidence receipt，再 CAS shared episode。只做投影，不再调用模型或创作事实。
- 若后续需 catch-up，只从成功事件重放确定性投影，使用游标/幂等记录；不在普通读取时创建 occurrence、采用旧 epoch 或补假历史。源 UoW 的同步 hook 故障须使原事件/状态/进展/receipt/Outbox 一起回滚；catch-up 面对已经提交的源事件只能回滚本次投影并安全重放，不能宣称撤回历史源事件。
- shared document 需要新版本/兼容读取和新 SQL CHECK/guard：81 当前不准 resultIds、terminal state、新字段，也只准单 presentation append。保留原 origin/participant 私密边界；新 occurrence/resolution 更新必须由实际 progress receipt 和源 UoW 授权，不能只检查某个可伪造 GUC 字符串。
- 新 append-only progress receipts/criterion evidence：owner/world/episode/epoch/ref/policyHash、真实事件和 attempt/result 的 FKs/逻辑关联、唯一 evidence key、RLS、只读重放、不可篡改。可使用一张 receipt 表加 JSON evidenceRefs；不要为每种自然语言剧情建表或新 runtime。
- 支持再次 consideration 时，新迁移需扩 81 request revision/cause，调整 `(world,episode,actor)` 唯一约束为 revision/cause 幂等，并限定同 actor/episode 只有一个当前 pending；严格 body revision 与实际 request 对应。旧 rows 仍 revision 0、旧 input/receipt 不改写，不能重算旧 definition/source hash。SQL81 literal revision=0 guard 和应用 strict parser 必须一同升级。
- 自然语言原稿只有 editorial/script 时没有可执行 policy；新政策字段应通过显式新作者版本/sidecar binding，保持旧 publication revision/hash 不动。runtime 不能自动补写“全员都愿意”的 policy。
- stageProgress 仅由明确 stage completion 规则和 node receipts 推导；stage 列顺序不代表节点已发生。未定义 stage completion 时 afterStage 保持 blocked，不取 max order 猜结清。

## after_* 与再评估映射

- `after_presented_node`：只接受新严格 presentation policy 的认证 receipt；generic active/engage/普通消息不够。认证“已展示”仍不等于 occurrence。
- `after_committed_node`：只有该 node 的显式目标范围已真实 fulfilled/committed 的 resolution receipt。邀请子流程不能满足父会面节点；未知/不支持语义继续 blocked。
- `after_resolved_node`：仅映射明确 terminal outcome；decline/withdraw/skip/expiry 必须有相应主体及政策依据。defer、quiet、一次失败、普通换题都不是 terminal。
- 当前 `AuthoredNodeOutcome` 仅 committed/declined/skipped/expired，没有通用 failed。能力 failed 首先是操作结果，不自动映射 declined/skipped；作者若要“失败后分支”，需显式新增 terminal outcome/criterion 契约及作者版本兼容，不能悄悄借用旧枚举。
- author window 资格过期只说明当前不可考虑；若要产生 expired resolution，需显式 expiry policy、真实 clock 边界和未履行条件证据，不能在资格 reader 悄悄建结果。
- 向现有 eligibility loader 加 authenticated nodeProgress/stageProgress；仍核 sourceHash/nodeHash/world/epoch/version/at。向现有 semantic wake 增加新证据 revision/cause，保留逐资格历史抑制、occupied 与 paid/unknown fences；不能按 elapsed seconds 反复买 Director/NPC。
- 主体个人退出、共享 episode 控制暂停、作者节点 terminal outcome 分开保存。只有 policy 明定 essential executor/各自范围时才能聚合退出；不能以 participant 列表或一个人的放弃替代全体结果。

## 必须通过的否定验收

1. 全部 NPC engage、多个消息、聊满目标轮数、Director 写“发生了”、作者 required、所有人出现在 participantRefs：均不创建 occurrence/result，不解锁 after_committed。
2. 无 policy 的 editorial_only、自然语言“见面成功/事故发生/达成合作”：可提出机会，不得 canonical 认证；不把 generic presentation 当替代。
3. A decline/quiet/defer 不修改 B stance，不生成玩家同意，不关闭 B 未完成责任；玩家换题/离线不完成、不重置旧事。只有真实新 cause 才允许同 episode 新 revision；旧 paid/unknown 不重发。
4. plan.record succeeded、appointment.propose succeeded、travel.begin succeeded、到时间、accepted 邀请、普通“我到了”分别不能被升级为赴约/到达/外部目标完成；current completedGoalIds 仍不由模型填。
5. 引用别 world/owner/epoch、别 actor/action/episode/邀请版本、未成功命令、raw/unknown、重放旧 source、伪造 resultId/criterion、未见过的位置/他人私聊必须拒绝；证据必须与本 node policy 和实际 source 绑定。
6. clause scope 为沟通的文字出现不得认证 physical/world_result；否定/引用/假设里的词不能通过关键词猜“同意/已发生”。模型 claim 不等于 server observation。
7. 真实 effect 或 projection 中任一步故障都回滚相关事件/状态/回执/进展；同 source 重放不加 revision、不重复解锁、不再买模型。并发不同 proposal 同 episode revision 只有一个 CAS 成功。
8. 当前及后继人物 snapshot 只收到本人可见 receipt/fact/own strategy；导演 audit、全局脚本、另一人的 decline reason/私聊、尚未公开的地点和未观察结果不泄露。遗忘只裁剪后续授权视图，不删除真实历史或重置 paid cause。
9. full invitation 流程真实存库可跑，且接受只完成被明确界定的 invitation-response 目标；同 fixture 的 meeting/world-result 目标仍不完成，直到真正注册结果证据存在。

## 当前接续点

- 状态：待验收，设计定位完成。没有更改公共协议或创建新 SQL，以上均为待 root 实施的建议。
- root 可先冻结四轴及 bounded policy/receipt 契约，再按一个现有能力闭环实施；开放自然语言全事件之前仍需明确作者/能力证据和真实 PG 否定验收。不得以本报告或局部邀请闭环宣称 68 全部完成。
