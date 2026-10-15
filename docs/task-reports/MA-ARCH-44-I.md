# MA-ARCH-44-I：持续人物与导演总控重构

2026-10-15；集成人 codex-root-ma-arch44-i。主登记目录为 Desktop/projects/demo/人生剧本；源码复用 history-chat-media，分支 codex/ma-arch44-integration，起点1028b06b。本文是证据与接续记录，任务状态只以主登记 DEVELOPMENT.md 为准。

## 当前结论

整体仍在实施，**没有完成全能力迁移与真实模型连续旅程，生产世界尚未切换epoch2**。截至阶段三，实际入口已接统一人物私聊/群聊/现场、确定性环境和持久导演推进。作者开场/事件候选、通用行动、业务attention和旧档迁移等仍未完成，不能把入口存在称为完整产品可用。

## 审查与方案

实际基线1028b06b，核对远程main相同；主目录旧96e51d15不用作源码。P/B/Q各在独立工作树核对当前实际链、未合补丁及源数据边界；不是按旧e732/a8e09报告原样重复修复。

统一方案：[NPC_AGENT_RUNTIME_44.md](../architecture/NPC_AGENT_RUNTIME_44.md)。实际链、角色/导演/内核/渠道职责、状态所有权、保留/替换清单、迁移/回滚和逐阶段验收均已列出。三份只读报告已集成。43已修的来源绑定、EARLY、个人/共享阶段及开场计数修正不重复算新增成果。

## 本批实际实现

- `ActorAgentState`按worldId/actorId保存独立revision、定义引用、目标、计划、动作、责任、决定历史及焦点。普通执行状态不写成belief JSON。原始人物定义引用按未经裁剪的版本计算，不能因换话题/预算节选而换人物版本。
- 0072建立人物状态、已接收输入、调用attempt、实际行动结果与世界engineEpoch。模型前输入已持久接收；原storyAt和墙钟receivedAt分开。同一命令正文不同拒绝，群/现场共享输入接收锚点可早于不同NPC执行版，但必须实际参与授权。
- 领取、发出、收到结果、非法输出、已知过期、提交、发出前取消、结果未知分别持久化。保存受保护的原授权快照与模型原返回；恢复使用原快照，最终权限/忘却/时间/版本重验，不重新付费。
- 世界epoch围栏涵盖所有最终world写入；新内核begin → 世界事件/投影/回执/Outbox → 人物状态/实际结果/attempt finish使用同一SqlClient短事务。模型期间不占数据库连接。旧NPC入口不获新epoch写权限。
- 私聊POST及只读回执入口已接新运行时，按DB世界epoch确定唯一引擎。epoch1仍走现行入口；epoch2私聊直接走同一NpcModel/runNpcAgent/kernel，跳过旧goal-memory/发布进度解释。这是过渡切换边界，不能长期作为两套引擎维护。
- 无对白的计划记录/日历邀请使用真实`agent.state_committed`事件，可重放且零假消息。实际创建的邀请产生明确责任和结果对象引用；邀请不是答应、到场或任务完成。当前注册能力只有plan.record/appointment.propose，均无外部目标完成资格。
- 拒绝/答应/协商/暂缓/待定记录分开；行动前提看当前责任版本的最新有效决定，历史答应不能覆盖后来拒绝。换话题不会自动结束旧责任。fulfilled须可信能力结果明确认证，不能用记计划或发邀请完成外部目标。
- 服务器完整状态与获准模型view分开；可见性/忘却闭包覆盖目标、动作前提/依赖、计划、责任nextCheck、决定及焦点，迭代至不动点。隐藏内容不入模型，也不因裁剪view而从canonical状态删除。
- 忘却授权不受200条召回排名限制；原消息、事件、已接收输入别名及派生记忆按真实turn来源关联。本人长期记忆只以实际本人消息/成功事件来源证明进入私聊；信念/计划不提升为世界事实。模型返回后忘却/来源修订再次核对。
- 统一候选算法收集所有来源，支持world/actor/episode/channel/action/resource范围阻断；导演只选择获准候选并返回协调意图，不代写最终NPC对白。单人已协调工作可免导演调用；需跨人协调时一次决策。当前算法/协议已实现，实际开场/发布/通用推进collector接线尚未完成。
- 一个模型适配使用同一协议处理private/group/scene的授权view，保留当前输入和状态，原返回不假回复/不自动纠错重付；真实群/现场业务入口仍待接入，不把适配器测试当切换完成。

## 当前真实私聊调用图

`POST messages → npcAgents.sendMessageIfEnabled → epoch2 → accept input / lookup → 授权只读snapshot → claim短事务 → NpcAgentModel一次调用 → protected snapshot+raw response → kernel begin / 同SQL世界commit(legacyProgress:false) / finish → 原回执`

epoch1仍进入旧resolveTurn及其长锁；群/现场仍走原Worker；开场/发布/通用推进仍有旧串行调度。这些路径必须在后续切换并删除，不能将本批称为完整新架构。

## 验证证据和边界

代码检查2550/2550通过，真实PostgreSQL受影响两组41/41通过（含长篇人设跨话题），本地构建通过；4份基线格式漂移仅格式归一。生产迁移/READY/公网记录见部署接续段。此前P单独30项真实库、Q15项模型协议mock、B39项纯调度已通过；它们不是线上模型质量证据。

根真实库验证包含：实际私聊服务一轮模型mock/原回执重放、模型时连接全部空闲、无对白计划与邀请真实结果、非法动作全回滚、先答应后拒绝不执行、忘却真实用户消息后原话/回声/派生状态不复活、无效日历不滚日、别人推进后保留原输入时间、提交失败保存原结果后零新调用恢复、长篇人设跨话题版本保持。付费模型0、生产测试存档0；不使用原作者/真实玩家资料。

43已闭账8保守预约/1测试存档，下架/暂停并恢复Ego200会话。43参与unknown、重复回应和自主续演未通过项继续留在本次完整旅程，不能复用旧额度。

## 继续实施的具体范围

1. 可信玩家/world命令UoW与0073窄lease桥；切换后仍允许合法地图/日历/群/现场输入等用户能力，禁止拿伪NPC attempt开门。
2. 统一来源解析与显式已提交事件投影，包含群、现场、动作结果、日历决定；全私密state仅在服务器，跨渠道不灌私聊原文。
3. 群/现场实际人物决策走同一runNpcAgent与同一状态；native channel投影、群短答责任、现场存在性和环境裁定分开。当前kernel对未注册渠道明确拒绝。
4. 持久导演协调、共享事件与真实候选collector，删除services串行handled和仓储选人；计划触发、行动资格、责任生命周期使用同一确定性判定，实际事实/结果决定收尾。
5. 业务交谈session/presence、12/1倍与75秒便宜检查解耦；重要等待与沉默/拒绝不同路径，保留旧时钟锚点。
6. 通用场景能力/世界规则包，迁出R17专属动作/固定句式；媒体及其他原能力迁入新内核。多人/多人生继续保留原任务，不因本次单owner世界基础而取消。
7. 旧存档显式迁移、单引擎原子切换、清理旧状态解释与调度，再做新明确额度的模型连续旅程/公网验收。没有这些证据不标整体完成。

## 部署接续

本批部署只安装基础与受控入口，不自动更改任何生产world的engineEpoch，不修改作者稿、历史/头像/朋友圈/玩家存档。迁移72为新增结构及epoch1无行为改变的围栏；最终记录待追加。

阶段一上线证据：469ac8f938aef359d5ca7f5f1275067bf6a4a9f6 / dpl_41eLkzuFDaX5FQRciT9P3nsAoPCm READY，Vercel API精确SHA与Nu别名；生产72/72迁移checksum核验。公网health/workbench/published可用，发布目录390/1440宽均无溢出，不进入真实用户存档。首次匿名作品probe误用非API路径404，不将其写成权限验证。CI check/build成功，数据库523pass/29fail；与1028基线29个失败名称逐一相同（集合差为空），全库失败仍未关闭。

用户补充世界边界、NPC知情时空与导演持续观察已合入同方案§10。B新增0073/world-awareness，只一套kernel投影，root后续接实际提交；不能以纯类型声明这十条旅程完成。P合法player writer/Q native/B eligibility并行，root收公共契约及集成。


## 阶段二集成接续（2026-10-15）

同一人物真实私聊/群聊/已有现场入口已接统一状态与一次模型提案；任务租约、原输入、原生渠道投影、同事务父任务成功已做真实数据库验证。玩家日历接受/拒绝回写对应已有责任的明确决定；无关聊天不消费责任。私聊策略跨渠道保持，原话不进入群聊。

新增有来源位置告知协议：玩家说自己在哪只存player_report，保留原文证据，不移动玩家，不通知无来源人物。实际旅行只让合法观察者知道离开原地，不能知道目的地。读取不更新人物进度。scene观察移到presence保存之后；确定性现场展示不改写独立位置证明。交谈界面打开期间阅读/思考保持1倍，关闭回浏览12倍，75秒检查与DOM活动解耦。

0073观察/知情/世界边界、0074原生渠道权限、0075导演保护调用/不可变决策/proposed-only情节草案已集成；75不赋予NPC私人决定或实际移动权。导演模型与应用恢复协议已实现，实际advance接线仍未完成。并行44-13只读全局快照、44-14新现场环境、44-15导演恢复与边界回归继续进行。

验证：整合代码check2621/2621、build、format通过；实际受影响PG47/47与75导演PG18/18通过（模型均mock）。后加确定性环境认知回归专项通过。曾同时check/build造成.next类型文件生成竞争，已等待build后串行重跑check通过，不计代码失败、不掩盖记录。当前未做真实模型验收，44新付费调用0、生产测试存档0。

生产迁移75/75已应用并由migrate逐项校验checksum。部署本批只安装持久与受控入口，生产存档epoch仍不切换；当前线上SHA及READY证据由本节后续实际记录。整体重构仍未完成，不以测试数量或模型适配器存在宣称完整旅程可用。


阶段二正式上线：b8d892749ab079fbddbe69f999b1b9fc3dded7d0 / dpl_2GHurtMGBBWSpsWppn3KNyjJPnmM READY，Vercel API精确SHA、关联身份与Nu别名核验；75/75生产迁移checksum一致。health/workbench/published200、匿名/api/v1/publisher/works401。本次Ego201已结束不存在，未新建浏览器任务绕过，不将HTTP称为本批手机/PC视觉或完整旅程验收。

线上后CI发现旧worker被新增观察hook触及owner-only表而42501：阶段二数据库573pass/54fail，相较1028新增26失败、移除1，未将其冒称基线相同。已修36c6d96，纯worker在已通过epoch围栏的旧提交中不访问Agent表；epoch2旧worker仍被SQL围栏拒绝，未扩大权限。Q实际旧group/scenes及新增worker边界17节点16pass/1明确模型skip，app native5/5；源与权限未放宽。另旧generalGoals读取不存在world_matters表的42P01已改为实际worlds.state.matters来源，既有scene-natural-delivery6/6恢复。热修READY待记录，完整库复验仍在进行。

后续代码接续：导演应用/模型严格恢复与边界新72mock通过；新确定性环境actual entry→lease→scene.opened/receipt/observation/task13PG通过，但实际dispatcher、env在场人物后续input授权及仅导航版本跨越恢复尚未接，不将环境模块视为完整新现场。新advance组合26013774及blocked过滤beeb8906已有代码，尚未接services，P实际入口PG/B真实global snapshot在集成。导演新机会仍proposed；通用移动/撤回/主动观察、作者事件和开场候选、业务attention身份、关系实际结果、全存档迁移与旧路径删除仍待完成。44真实模型0，生产测试world0，epoch2生产启用0。

热修本地门槛：check2694/2694、build成功；root真实worker边界6/6、旧scene自然对话6/6、新环境13/13通过。完整PG634pass/19fail/5明确opt-in skip，含2处旧测试硬编码55476环境守卫；其余旧邀请时效/发布证据/旧时间调度和内部trigger权限清单失败继续待核，不报全库绿色。新worker42501回归已修，新增trigger仅由触发器调用、不应给app/worker直接EXECUTE；对应旧测试清单待补严格无权限断言。

## 阶段三真实入口接通

services.advance在旧流程之前按DB epoch路由；epoch2仅收集统一人物计划和责任，需要时使用真实全局快照及持久导演。不再回退旧Planner，但作者开场/事件库候选未完成，生产不启用新引擎。

实际worker先建立零模型现场环境；NPC后续输入须独立原位置、真实成功环境任务和当前同地证明，再走同一人物Agent及原生现场投影，父任务同SQL完成。已收到raw的private回合先零付费恢复，再收候选；unknown只阻本人，已知失败仅阻自身候选资源。blocked候选同时受调度、模型parser与SQL提交边界检查。

导演可读取已有地图配置和开场便签，明确不代表人物在场、行动完成或所有人知情。人物真实位置与认知保持分开。

阶段三check2695/2695、build和format通过；真实PG首组42通过/1端口guard（误用NPC_AGENT_ADVANCE，实际测试变量NPC_ADVANCE），改显式变量后advance13/13通过，综合55节点通过；不报首轮一次全绿。含真实snapshot→advance→导演SQL/游标→人物kernel、现场8和权限2；导演阻断SQL防线/模型协议37/37通过。0真实模型、0生产测试world、生产epoch2仍0。

热修0d6b4f36134aa5d21fdcd3c6b812b31e0d7c70b9 / dpl_eqFND27aWoRwxbE8T6sqLWZbk6Ro READY，Nu别名和精确SHA已核，公网health/workbench/published200、匿名works401。CI38722287488 check成功，DB641pass/18fail；相较1028失败名称无新增、移除11，不能称全绿。阶段三已补内部trigger权限清单，逐项断言无直接EXECUTE，不扩大权限。

阶段三READY证据待实际追加。通用移动/撤回/观察与初始位置授权、共享事件生命周期、作者内容候选、注意力业务身份、等待保护、旧档迁移与旧执行路径删除继续登记；未通过全部连续旅程不标整体完成。

阶段三已核实956a3a33 / dpl_2PSVNrvdf4ST8sEWJi8ybw3rAVwS READY、生产75/75、正式Nu别名，公网关键公开入口200/匿名作品401。阶段四接续见 [MA-ARCH-44-PHASE4-I](MA-ARCH-44-PHASE4-I.md)：真实手机入口围栏、只读查询、原任务保护结果恢复、导演slot恢复及最后人物认知来源过滤，仍属于同一统一架构，不标整体完成。


阶段七已上线，见[阶段七集成](MA-ARCH-44-PHASE7-I.md)：360fd198 / dpl_8HuieomDunPp2eDvLBEEyBFCTgCM READY，生产80及Nu别名/公网核验。实际人物出发/到达与无假目击、发布可选试演真实证据已交付；全套重构仍未完成，导演bootstrap/episode交接、完整感知/实际投喂manifest、旧存档迁移与执行入口退役继续进行。44-55正在修合法NPC回复引入新地点时同事务最终版本与原回执不一致，不以旧缺陷为由忽略。


阶段八接续见[阶段八集成](MA-ARCH-44-PHASE8-I.md)：实际advance的显式bootstrap→导演实际提交→逐NPC同一执行入口→原子回执与本人持续立场已接；新机会还未等价于原稿事件发生。人物裁剪后的具体情节语义、实际发生/结果、观察消费、旧档切换/旧入口退役与真实模型连续旅程未完成。当前生产仍ef083ca0/80，阶段八build/81迁移/READY待核；0新增真实模型，不启用epoch2。
