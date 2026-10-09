# NOTES-WORLD-01Q · 玩家可见系统记录的最小数据链

## 结论、状态与接续点

**待验收：只读方案已交，NOTES-WORLD-01功能尚未实现。** 首版可在备忘录中提供“眼下要做的事”“关于这段人生”只读区，复用已有已提交选择/邀约和公开开场身份/处境；私人便签沿用现有编辑/保存链。不能直接公开导演议程、角色承诺记忆或无来源的开场notes，也不能把当前最多5条choice当完整长期/并行任务引擎。

下一条操作：I审本文，先冻结独立只读接口、记录/来源/状态语义与私人便签ID边界，再登记真实后端实施范围；验证后冻结响应，才分配辅助notes界面。BOOT的完整前史另行推进，不要求用户补表单，不用静态任务填空。用户视觉验收项目集中记录在末节，后续统一验收；不等待用户逐项批准普通实现选择。

## 身份与范围

- Agent `codex-f-01a0c7c8-notesworld01q-20261010`；会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b；2026-10-10根明确分配分析子包，按主目录短锁新增本行/领取成功，NOTES-WORLD-01父任务定义/状态未变。
- 独立工作树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，codex/notes-world-01q，冻结8e485f4df9962c34654cce8e8e9e39ff3496a71e。实际只新增本报告；主目录本人主表行及专属报告镜像。
- 业务、公共类型/配置/迁移/phone文件只读。没有运行模型、数据库、端口、构建、浏览器；不重复头像QA、不夹LIB04B WIP、不发消息到其他线程、不接管I或上线。
- 已读AGENTS、PROJECT_BRIEF、主DEVELOPMENT/ARCHITECTURE_REVIEW，PRODUCT/ARCHITECTURE相关边界、冻结源码；主目录PHONE_PREHISTORY_IMPLEMENTATION_PLAN、INITIAL_PHONE_LIFE_SPEC、BOOT-01A作为方案依据。前史方案两文件未在冻结Git对象内，不将其WIP文档当已实现代码。历史架构“尚未接线”等段落不代替当前源码。

## 现有链路与玩家可见来源

下列文件和行号均来自冻结8e485f4；这里的“可用”指实现具备来源接点，不是本轮亲跑验证。

| 来源               | 现有真实接点                                                                                                                 | 能展示什么                                                                                 | 不能说什么                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 用户选择           | domain/reducer.ts:125实际用户原话校验，choice.recorded；BuildRepository.phone:215返回choices及事件时间                       | “你的计划/你当时说”，展示原话、经过校验的概要和对话来源                                    | 决定不是执行结果，pending/followed_up不是待领奖任务/已完成                                          |
| 人物下一步建议     | reducer.ts:148、178；必须截自同事件角色回复，next_step/recovery_step带sourceMessageId                                        | “某人提出/遇到阻碍后有新建议”，可以回到对应已见对话                                        | 不把建议当用户接受；不能把导演[choice:ID]舞台指示显示为主角发言                                     |
| 用户自述结果       | reducer.ts:212及types.ts StoryChoice.result                                                                                  | “你说已完成/你说遇到阻碍/你说已放下”，保留来源原话                                         | 不是世界核实成功、奖励、照片、NPC已执行的证明；不能统一转completed真值                              |
| 邀约/日程          | domain/invitations.ts:26、appointments投影、POST worlds/:id/invitations                                                      | proposed待回应、confirmed已有明确接受、cancelled/attended/missed原状态；跳回日历           | NPC一句邀约不自动确认；过期不自动attended，用户attend只是有效命令下的记录，非独立到场证明           |
| 现实时间与故事时间 | world_events的occurred_at和payload.storyAt、邀约.at、World时钟                                                               | 分清“记录于”与“故事中的日期”，有有效storyAt用故事时间                                      | Build.phone的choice.at当前取occurred_at；不能改标签冒称故事发生时刻，旧缺失storyAt保持记录时间      |
| 公开开场信息       | build-repository.ts:294的identity/setting，build-handler把开场保存到world_builds.opening                                     | “这段人生的起点/身份/处境”，只复制这两个既有公开字段及世界title                            | 不能把当时开场处境称永远当前事实；不读取完整opening、actor.persona/actorTies/结局/内部事实          |
| 私人便签           | POST worlds/:id/notes→PostgresWorldRepository.saveNote:294→note.saved reducer/事件/回执/world_notes→hydrate→WorldPhone.notes | 用户可编辑、每便签版本和保存状态；原文字不自动解释成剧情状态                               | 笔记中写“已完成”不改变系统事项，不派生canonical fact/任务完成；分享仅预填消息，不自动发送/让NPC知道 |
| 承诺记忆           | memory-store.loadWorldMemories；domain/agenda.ts:155接收character commitment供导演                                           | 首版不直接用。未来只有与玩家实际看见的逐字消息/可见现场条目核实对应的“某人说过…”才可作提示 | owner RLS允许读取不等于玩家可见；NPC内心承诺、summary/episode、角色belief不得泄露或升级成事实       |
| BOOT前史已知记录   | 当前仅方案，待公开来源/受众/条目ID契约                                                                                       | 以后只公开明确playerVisible且来源合法的genesis条目                                         | 不放开旧opening.notes，不伪造过去玩家输入/真实完成，不据前史改现实Profile                           |

路径前缀：domain为src/modules/world/domain；仓储为src/modules/world/infrastructure；memory-store为src/modules/memory/infrastructure。以下补充说明是实施门槛。

### 开场便签为什么为空

不是单纯页面忘了渲染。WorldOpeningSchema要求1—5条notes，WorldPlanner确会请求这些文本；build-handler.ts:227/230保存version0 state和完整opening，但state未放notes，appointments也显式为空（99行）。PostgresWorldRepository.hydrate:139/172只从有已提交world_events来源的world_notes读取notes，没有读取initial.notes。BuildRepository.phone:309明确注明“Generated opening notes have no player-knowledge provenance. Keep them internal”，只返回state.notes。最后world-app-data.ts:78和apps/notes.tsx消费这些公开notes。因此新世界无手写记录时会空；不能把内部开场notes直接并入公开数组当快捷修复。

BOOT-01应在既有world-build租约/commit事务保存带playerVisible、受众、故事时刻、条目级引用的一份不可变前史；公开已知记录作为系统只读记录，不直接借note.saved成玩家手写事实。genesis:worldId不是UUID普通world_event行：要有专门来源分支，不伪造event/message绕过FK、内连接或记忆来源检查。以后若明确提供“起点内原有可编辑私人便签”，必须另标editable类别及初始版本，由I定义hydrate/replay同ID覆盖；不能默认所有前史文字都可改。

### 当前choice的容量与状态限制

reducer.ts:131同actor新选择会将旧选择superseded；146行slice(-5)。故现choice最多5条全世界近期记录，不能保障同人多件未了结事项并存；superseded表示记录被新选择替代，不是用户取消/放弃旧行动。首版标“近期计划/建议记录”，旧项进历史，不凭空声称长期目标仍完整保存。欲实现多条独立任务、长期追求/客观完成，要另走NAR契约和持久来源，不只改列表文案或把slice放宽。完整历史可将来由真实事件分页重建，首版不静默声称完整。

### 承诺与玩家知情

PLAYER_MEMORY_PREDICATE已比owner RLS严格：排除character记录和内部branch summary，仅对特定已存玩家可见消息/可观察现场的逐字片段开放部分branch记录，并容许用户correction。loadWorldMemories则会取character和branch供导演；buildAgenda.detail还含内在转述与调度提示，不能复用为公开事项列表。就算调用公开listMemories，也不能把profile记忆、user_correction或角色说法当世界canonical任务依据；首版从已核实公开消息/选择/邀约直接读取，不需要额外memory/LLM摘要。以后承诺提示须核实owner/world、实际可见sourceMessageId/scene条目、逐字对应/归属说话者、类型为说法而非事实、当前源版本/撤回与遗忘规则，不使用“sourceType=world_event所以公开”的快捷判断。

## 建议最小契约（待I冻结，未新增实现）

**A包：无新迁移/无AI，新增独立只读查询。** 建议 `GET /api/v1/worlds/:id/records`，独立 `src/contracts/world-records.ts`。不直接给既有WorldPhone响应加字段：WorldPhoneSchema是strict，新增optional字段只让新reader兼容旧server，旧reader仍会拒收带新字段的server响应，不能称双向兼容。

响应语义建议：schemaVersion=1、worldId、worldVersion、coverage='recent'，三个分区 `current / about / history`。每条为稳定服务器ID、kind、标题/原文、明确stateLabel、assertionKind、来源与可导航目标；所有字段由服务器从已裁剪来源派生，前端只排版/导航，不决定完成、角色知情或事实。

- kind首版限定player_choice、actor_suggestion、invitation、opening_context；公共genesis等BOOT契约到位后再加，commitment不提前开放。原quote和来源标签保留，choice.intent仅为概要，不覆盖用户原文。
- provenance必须判别来源：world_event（eventId/version，可选真实已见messageId）、opening_field（seedId及仅identity/setting字段）、未来genesis_entry（合法条目ID/来源格式版本/playerVisible）。公共响应不含原event.payload、隐藏persona、private memory、完整approved_seed或私人访谈。
- ID独立命名空间，如 `sys/choice/<sourceId>`、`sys/invitation/<id>`、`sys/opening/identity`；不是私人NoteId。当前notes接受的ID字符集不含斜杠，已有严格入口会拒收该格式，但I仍须在应用/领域及未来扩展处保护系统类型，不能仅靠UI disabled或暂时的字符规则。
- current纳入未撤下的近期计划/具体建议/待回应及已确认未结束邀约；用户自述blocked标“遇到阻碍”，recovery仍是人物建议；reported_done/abandoned入历史并保留“你说”限定，superseded入“此前计划记录”。具体状态是只读投影，不新增任意setStatus/complete接口。
- about首版仅世界title、公开身份/处境并标“人生起点”。这不能替代未来“当前处境”引擎；后续更新只采纳已发生且主角可知的事件，不能用模型未来预测/导演summary填。
- 未读数、普通问候或没有明确来源的来信不自动变任务；不对全部聊天跑摘要生成“要做的事”。只有已提交choice/建议/邀约等白名单条目进入首版。
- 选择与同事件邀约保持现规则：仅一个明确同actor邀约时关联，否则不猜/不按title匹配。suggestion必须核实真实可见sourceMessageId，链接的是对话/日历来源，不是假执行按钮。
- 统一在owner-scoped读事务/一致版本获取状态、来源及裁剪字段，引用事件必须已提交且version≤worldVersion。前端同时展示的数据若版本不同，先保持旧已确认版本并再读，不拼“新日程+旧计划”推断状态。projection ID不能随刷新变随机，不写DB/新task/Outbox。
- 来源缺失的条目不公开、不猜完成，UI可以显示无依据空态；元数据coverage说明近期截断，不能“共5件任务”暗示系统完整追踪。

**写入口保持明确：** 私人笔记仍POST notes且走note.saved/回执；邀约回应仍POST invitations；选择/结果仍由实际用户输入→现有Task Queue/运行时/reducer事务产生。系统记录GET无修改接口，UI不设完成复选框。私人笔记分享只沿现有预填聊天行为，由用户真正发送才被角色知晓。

**B包：与BOOT共用合法来源，迁移仅在必要时由I分配。** 若初始公开记录仍从新的不可变initial来源索引投影读取，可复用同PostgreSQL的snapshot JSONB格式升级，不必为了列表建一个第二任务库。若要索引/外键约束、分页长历史、独立事项生命周期或可信结果，需要I新增owner/world/source/version表或历史投影，并补RLS/回执/队列/replay；不可复用pl_app可随意写的world_notes当系统状态真源。GENESIS来源、同ID合并、T0与故事时间必须与BOOT统一，不能本Q预占迁移号/新状态字段或擅接模型。

## 精确实施接点与分工建议

以下只是建议范围，未领取源码；I确认后才可登记实施。候选新增路径不存在属于正常待实现，不声称已有。

| 负责范围           | 现有/建议文件                                                                                                                                                 | 应做的最小事                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| I公共契约与组装    | 新src/contracts/world-records.ts、新src/app/api/v1/worlds/[id]/records/route.ts；src/server/services.ts、src/features/api/client.ts                           | 冻结来源/状态/版本/错误与GET，无新的completion写入口，保持旧WorldPhone/Note契约可读                                                |
| 服务端应用/纯投影  | 新src/modules/world/domain/player-records.ts、相应application端口；现infrastructure/build-repository.ts、postgres-world-repository.ts                         | 纯函数只接经裁剪/验证的来源；仓储owner事务读取真实投影与事件；不让domain依赖SQL/框架或直接loadWorldMemories                        |
| 写边界必要保护     | src/contracts/notes.ts、domain/notes.ts、API notes/route.ts、PostgresWorldRepository.saveNote                                                                 | 系统ID不能保存；提供id须属本world可编辑私人note或合法可编辑genesis；无id由服务器分配；不覆盖另世界note或只改UI                     |
| BOOT后续           | contracts/world-build.ts、world-planner.ts、build-handler.ts、hydrate/replay、memory来源边界                                                                  | 统一初始公开来源/不可变snapshot/条目型genesis，不开放旧无来源opening.notes；有真实新模型/PG证据才说前史已完成                      |
| 后续辅助UI（未领） | features/phone/apps/notes.tsx、新system-records.tsx、apps/types.ts、phone-shell.tsx中的PhoneAppContext与world-app-data.ts接线；world-phone-app.tsx由I划分协调 | 三分区：系统只读有来源/状态/回对话或日历，私人便签编辑/保存保持；新读取错误不擦私人成稿，不造示例任务                              |
| Q验收（未领）      | 新tests/integration/notes-world-01.test.ts、纯player-records测试及双端真实UI证据                                                                              | 下表12组真实验证；原tests/integration/notes.test.ts、invitations.test.ts、player-projection.test.ts、world-notes.test.ts等保留回归 |

静态风险需I顺带核实，未亲跑复现：① world_notes按id全局PK，saveNote允许输入任意合法id且ON CONFLICT(id) UPDATE未重新限定world_id，若同owner拿另world私人ID来本world保存，可能覆盖/破坏另world投影。② 旧note command回放从compact result_state经hydrate读取可变最新world_notes，后续编辑覆盖该行的sourceEventId后，旧版本过滤可能找不到原note，返回NOT_FOUND。请用下表08/09真实库反例核实；本Q不修改它们、不把推断写成已证实缺陷。新系统类型不能再复用这种可编辑投影。

## 旧世界、空态及用户体验边界

1. 没有公开genesis schema的旧世界不补写前史、不调AI，不解除旧opening.notes隐藏；继续读既有手写便签、可验证近期choices/明确状态的邀约以及原有公开identity/setting。旧缺失choice/invitation字段按空处理，旧status缺失邀约不能擅自confirmed。
2. 新接口上线不改变旧phone响应；旧客户端继续正常，新客户端单独请求records。接口暂不存在404/服务故障503显示真实“这部分暂时无法读取”，私人笔记仍可用，不能把错误当0条/重新创建世界。
3. current无依据：显示“暂时没有已记录的待办事项，可以先看看来信和日历。”只提供现有导航，不要求用户填问卷、不放固定预算/欠款/奖励；about无可验证字段显示“这段人生的信息还未记录”。开场public身份可存在，不能为迎合“空态”把有效信息也隐藏。
4. 三分区以来源/编辑权限区分，不依赖文案或颜色来保护：系统内容详情只读，无编辑/完成/删除；私人便签可新建/编辑，明确记录不会自动成世界事实。系统记录本身不产生未读来信/新事件，刷新不变状态。
5. 时间由服务端真实story来源解释，手机/PC用同一时区显示；没有有效故事时间的旧记录标记录时间，不套手机今天或随机昨天。记录详情有“你说/某人建议/人生起点”限定，不用术语、引擎编号或debug字段污染UI。

## 12项待实施真实PG / API / UI验收矩阵

**下表是验收要求，全部本轮未运行，不是12项通过。** 后端用独占真实PG、pl_app/pl_worker受限角色与实际事务/Queue；可以用明确模型替身检查运行时，但真实AI质量/BOOT另计。UI必须真实API，手机/PC；用户体验最后统一验收。

| ID     | 真实PG/API应验证                                                                                                                 | 手机/PC应观察                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| NWQ-01 | 创建合法world/opening含secret marker notes，记录接口只取公开identity/setting；无笔记写入                                         | about显示人生起点；开场secret不出现在DOM/响应/系统区，私人笔记空态真实              |
| NWQ-02 | 实际用户选择经Queue/reducer提交，假设/转述/问题/导演cue不能choice.recorded；source owner/world/event/version成立                 | 只出现用户明确近期计划，显示原话来源，未执行不勾完成                                |
| NWQ-03 | 植入character commitment、private belief、branch summary、profile/suggested来源、不可观察scene与有可见字面message对照            | 全部私密marker排除；如未来开放承诺，只显示获准说话者逐字说法，不泄导演议程/推断     |
| NWQ-04 | next/recovery引用真实角色消息与同choice；伪造message、另一actor、同回合两个邀约均不能误关联                                      | 建议/阻碍有来源；多邀约不猜链接，不能把建议当已接受或恢复成功                       |
| NWQ-05 | 用户reported_done/blocked/abandoned保存有来源；superseded不等同abandoned；不产生奖项/asset                                       | 对应显示“你说…”或“此前计划”；人物一句说已完成不改用户/系统状态                      |
| NWQ-06 | proposed→accept→confirmed，reschedule需重新proposed，cancel/attend/miss严格时间/版本/receipt；legacy未知status不强转             | 只读事项与日历同源同步，点来源到真实日历；过期不是已参加，不能在系统卡随意切完成    |
| NWQ-07 | 向notes/伪造system PATCH/complete传sysID、type/status或来源注入；数据库无系统状态/事件/回执变化                                  | 系统详情无可写/完成控件，绕过UI仍被API/领域拒绝；正当私人保存不受影响               |
| NWQ-08 | 真实私人note创建/编辑、同command幂等、双设备期望版本冲突；编辑后回放旧command仍返原receipt或明确契约错误                         | 草稿/错误保留，保存刷新一致；手写“已完成”不改变系统事项，分享只预填消息             |
| NWQ-09 | 同owner两world不可互用note/sourceID，跨owner世界/记录/来源404且RLS看不到；恶意note冲突不覆另world                                | 切人生各自记录和私人笔记分开，旧note/world版本无损                                  |
| NWQ-10 | 来源≤指定worldVersion，pending/failed/unknown模型未提交不出记录；刷新重复读取无新task/Outbox，choice截断与同actor替代语义明确    | 刷新状态/ID/原文一致，错误不清成空；不会把有限5条称完整长期任务或自动重复推进       |
| NWQ-11 | 旧世界无genesis/choice/status，旧strict phone schema可读；新records404/503与正常空数组区分                                       | 旧便签可编辑，系统真实空/错态，手机和PC不生成占位任务，不逼用户填表                 |
| NWQ-12 | BOOT合法playerVisible genesis来源与隐藏条目混合、跨条目引用验证、创建失败回滚、重复命令单份initial；后续同ID版本覆盖与replay一致 | 前史已知事项可见、秘密不可见、稳定T0；刷新不重新生成，无替玩家过去/现在发言或假完成 |

需留给用户统一验收：三分区容易辨认、人物建议与我的计划不混淆、来源能返回微信/日历、换世界/刷新内容延续、私人编辑失败保留、空态自然且不靠假任务填满、开场像已有生活但不会提前泄结局。内部PG/RLS/失败回滚由I先验，不拿用户体验确认替代安全测试。

## 过程与本轮验证

- 领取后按冻结源码追踪生成→opening/initial→hydrate→phone→notes UI、saveNote事件/回执、choice/reducer、邀约与player memory过滤；关键进展已更新本人报告并镜像主目录。
- 若干初次读取猜错单复数文件名/不存在glob而退出，均只读且无执行资源；改用rg文件清单确认真实路径。BOOT未提交方案只从主目录读取，未复制WIP源码到冻结树。
- 核对过程保留失败：初次矩阵检查因匹配规则未容许表格空格而AssertionError；同批后续提交未被失败中断，产生cdec2d7。复查改用容许空格的规则，12项ID计数通过，但发现猜测的apps/context.tsx并不存在，已更正为phone-shell.tsx中的PhoneAppContext。后续复核与更正独立提交，不改写原提交历史。
- 最终核对29个现有引用路径、12项矩阵ID、与冻结基线的文件范围、Markdown格式和diff；详细结论以主表交付登记为准。“路径存在”不是业务验收。
- 本轮新增业务能力0，领域原型0；交付为可实施契约建议/边界分析。测试、npm check/build、真实PG、模型、浏览器、公网、部署均0；未启动资源或复制凭证。报告不含密钥/真人照片/完整访谈。
- 最终独立提交ID登记主表；I受控合并/发布文档及冻结下一阶段契约，本Q先待验收，不自行标已完成或自动领取实际NOTES/SPACE。

## 2026-10-10接续：从Q方案到最小UI分包（候选，未领取业务）

根已读原Q及NOTES-SAFETY-01稳定66d5506，安全包交I联合集成/部署，本接续不扩写安全源码、不重启资源。只读复核notes、provider、world-app-data、phone-shell、navigation、messages/calendar及原导航测试；读取DESIGN的世界手机独立样式边界。这里只追加方案，不改变原12项PG/API/UI矩阵，不把用户不回应记为验收通过。

### 开UI前依赖与文件归属

1. I冻结公开records来源/种类/稳定ID命名空间/状态/时间/版本/覆盖范围、允许导航目标，并先实现server投影，给出真实PG/API来源过滤与写拒绝证据。文档认可、接口草案或choice现状不满足“已接真实数据”。候选GET路径/字段仍以I冻结结果为准，本报告不形成第二份公共契约。
2. I接好LifeClient、独立记录读取状态及PhoneAppsProvider显示数据；notes专用记录加载/错误不得混入现有全局loadError而遮掉私人编辑器。旧世界/404/503、无来源空态、跨world晚响应/版本协调由I组装层解决，UI不拉私密原事件/导演memory、不自行对choice猜人物ID或造任务。
3. NOTES-SAFETY-01先由I合入、验真实保存/旧回执及公网；不会让UI重新实现一套便签存储，也不以本地fallback证明真实同步。头像0039/其他在途需先完成范围协调，界面业务领取从I指定联合稳定基线开始，不复制当前0039 WIP。

| 后续候选执行范围                                                                               | 最小职责                                                                                                                                   | 前提/范围外                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| src/features/phone/apps/notes.tsx                                                              | 将系统详情分流到只读组件，列表明确三分区；私人new-note/id编辑/操作回执/草稿/分享预填沿用                                                   | 仅I冻结的公开显示模型；不替换保存协议、不改其他应用                                         |
| 新增src/features/phone/apps/notes-records.tsx                                                  | 只读事项/起点信息/历史详情、原文和来源按钮、独立加载/错误/空态；组件只接授权数据                                                           | 无fetch/模型/事实推断/任务状态写动作；名字为候选，不提前建文件                              |
| 新增src/features/phone/apps/notes-records.module.css                                           | 仅备忘录分区样式、短屏流布局、长文换行/可访问来源按钮                                                                                      | 复用手机现有外壳；不修改apps.module.css/phone.module.css/公共外层CSS                        |
| 导航测试与证据（按实际新增行为再登记）                                                         | 若新保留目标需要验证，可新增tests/notes-records-navigation.test.ts；真实API浏览器验证只读/私人编辑隔离、来源导航、滚动和双端，保存日志截图 | 现routeHash/parentRoute已支持的普通路径不写重复实现测试；不把源码字符串检查当UI不可编辑测试 |
| I持有：contracts/API/client、apps/types.ts/provider.tsx、world-app-data.ts/world-phone-app.tsx | 冻结并接入新的读取状态/版本/导航目标；提供给上述纯UI组件                                                                                   | 辅助不顺手改这批共享文件；如确需provider/导航扩展先登记/I协调                               |

候选业务范围尚未领取，无端口/DB/浏览器资源。本轮仅Q报告提交；父NOTES-WORLD-01保持待开发，后续需根/I明确分配。

### 分区与操作

- “眼下要做的事”：只显示server确认可公开的近期计划/建议/邀约，保留“你当时说”“某人提出”“待你确认”等归属；可有“此前记录”折叠区显示自述结果/被替代计划。“这里只记录近期计划”说明有限覆盖，不把最多5条choice或同人替代规则包装成长期任务引擎。
- “关于这段人生”：首版公开身份/处境明确标“人生起点”；未有新来源不能自行改成“眼下事实”。信息无有效来源保持空态，不公开opening.notes、persona、角色私密commitment、Profile/suggested或未来剧情。
- “我的便签”：新建/编辑/保存与未保存草稿仍独立，数量只算私人便签；自述“做完了”不改系统记录。系统详情没有form、input、contentEditable、删除/保存/完成复选框，私人编辑不因系统GET失败清稿。
- 统一搜索只能过滤已经授权/已加载的三分区文字；有查询无匹配显示“没有匹配的记录”，不说世界没有事项。无公开事项时简短提示去看微信/日历，不填固定账单/欠款/奖励；404/503显示读取错误并允许真实GET重试，不能用空数组掩盖失败。

### 来源、返回与滚动的实际接点

- MessagesApp当前用target查联系人id，而非sourceMessageId；world-app-data的PhoneStoryChoice只留下actorName，不能按同名人物配链接。I需提供已经核实可见的actorId或冻结navigation目标。首版open('messages',actorId)，文案“查看对话”；不称“定位到这条消息”。若要精确消息锚点，另由I分配messages及路由扩展，不把messageId硬塞为联系人target。
- CalendarApp当前以邀约id打开详情；只用server唯一明确关联的目标，多个邀约/未知目标不猜。来源缺失或联系人不再可打开时保留获准原文/来源说明，提示暂时无法打开，不转进私人编辑页、不偷偷改日程状态。
- 系统ID在I冻结命名空间内先识别，再查私人NoteId；未加载的系统深链展示加载/错误/失效只读态，不走原“找不到便签”编辑路径。原new-note与真实私人id行为保留，旧management深链仍进notes。
- PhoneShell现navigate已pushState并保存world/app/target的scrollKey，back可返回来源页；优先复用open/返回历史，不另搭外壳。notes当前noteList另有overflowY:auto，而shell保存的是外层scrollTop，两者不保证天然恢复；实施应选单一滚动容器，或在I允许范围登记显式的world/列表/查询滚动键，再用真实浏览器验证，不能仅拿现导航纯测试说恢复成功。

### 留存后续验收（本轮全部未跑）

1. 真实server数据：系统公开条目原文/状态/来源一致；带秘密marker的内部notes/memory不在响应或DOM，旧无来源世界真实空态，不依赖预览假任务。后台来源/RLS/伪造写拒绝由I先做PG/API验收。
2. 系统只读：鼠标/触控/键盘进入详情，找不到可改标题/正文/完成控件；仅展开/返回/重试不发notes保存、邀请状态或系统完成命令。导航微信可正常沿既有markRead逻辑，不误把“有任何写请求”当失败；无系统状态改变才是边界。
3. 私人便签：新建/编辑/版本冲突/原command重试后最新内容不回退；系统读取404/503/刷新失败仍保留草稿；分享只预填，未确认发送角色不知道。
4. 来源与导航：两位同名联系人点各自正确对话、有效日历id进入真详情，缺来源不猜；深链/返回/刷新及换世界不串记录，详情返回保持原搜索与阅读位置；未实现精确消息定位不宣称通过。
5. 手机390×500及390×844、PC1440宽内既有约420窄容器：真实长标题/原话不横溢，三分区与来源按钮可读、末项可达、按钮至少44px可点，键盘打开私人编辑仍能保存/返回；不加手机外辅助面板，不改PC外壳。截图记录实际API世界和状态，不用静态预览充当产品验收。
6. 用户待统一确认：是否容易分清系统事项、起点信息与私人记录，来源回看是否顺畅，空态/错态是否自然、长文/短屏是否舒服。该清单只是留存待验收，不把连续开发授权或用户不回应记为用户已通过。

本接续新增业务/测试/PG/模型/构建/浏览器/公网均0，仅做报告格式、引用接点与变更白名单核对；安全66d5506及其已完成本地验证不重复计入本Q。等待I公开契约/server/API证据及明确UI分配后才开发。
