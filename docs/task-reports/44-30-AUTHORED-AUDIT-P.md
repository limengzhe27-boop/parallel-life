# 44-30-AUTHORED-AUDIT-P｜作者开场与事件进入统一 Agent 的设计审查

状态：只读方案冻结，待 root 分工实现；没有新增业务代码。2026-10-15。

执行者 codex-ma44-authored-audit-p，线程01a11a84-9572-7ab0-92fb-967f963dfc20。工作树 publication-story-02/人生剧本，codex/authored-audit44，基线 **08f4254c**（已含root0076/ba5b7524与44-27）；之后root在途接线不在本次基线内。仅本专属报告/主镜像/本人登记，0源码/SQL/模型/生产/PG/check/build。以下新类型、表和能力均是提案，不表示已实现。

## 核心结论

沿用同一个导演、NPC kernel、时钟、事件/回执/恢复链。作者库是导演可选的虚构意图来源，不是NPC已知事实，也不是必须照发的对白。应先增加**世界范围的作者机会候选**，再把导演选中的机会变成**有权限来源的本人考虑请求**；NPC据人格、当前处境及玩家真实选择形成自己的目标、计划和表达。共享事件进度从实际消息/动作/玩家决定投影，不从导演提案或原稿将来时推断。

空goals/plans的新档需要合法的作者开场bootstrap。不能先由导演伪造每人goal、塞几个人工ready action，或改回旧publication_story_plans/batches以让调度“看起来能跑”。

## 真实现状与材料字段

|来源/实现|实际字段与约束|目前缺口|
|---|---|---|
|0058 `publication_story_source(world)`，为最终覆盖版本|绑定owner/world→work/draftVersion/contentHash；published另核publication_versions精确内容；初始snapshot/build/opening.origin必须一致。返回origin、timeline、nodes完整candidates、conditions、openingEventKey、actorKeys、history、knownFactKeys、initialKnowledge、contacts(actorKey→actorId)、initialActorIds/Facts/PlaceKeys、places含description及隐藏地点、routes、genesisSource|新DirectorSnapshot未读此库；不能只读当前draft替换既有世界已绑定版本|
|0055 `publication_director_setting(world)`|setting/tone/hiddenContext/identity/situation/overallSetting/characterSettings含actorKey/name/lifeModules。仅pl_app、owner绑定；原文来自该冻结修订|不包含openingEventKey、事件nodes、conditions或timeline；不是事件库接口|
|`published-world-content.ts:254–351`|openingEventKey可选；candidates **0至32**，不是固定几个事件；actorKeys/prerequisites可为空。含title、editorialIntent、script、sceneText、scenePlaceKeys、settingPlaceKey/placeKey、conditionKeys、互斥与timeline alternatives、intent及direction.progress|当前容量上限须诚实保留，不为本方案发明固定节点数；无每段事件内容的知情范围/事实性质标注|
|同契约 `:35–68`|prereq为history_fact/after_committed_node/after_presented_node/after_resolved_node/at_place/not_before；条件组all/any；intent为editorial_only/director_event/offer_message/offer_invitation|不能用自然语言“差不多满足”替代前提证明；offer_message.text也不能默认成为NPC最终台词|
|`director-snapshot-repository.ts:360–391,899–907`|只把director_setting放worldSetting字符串；setting/genesis source knownByActorIds=[]。完整cast/states/episodes/actual changes独立读取|未携带作者节点；worldSetting进模型又在director-agent-model:174附近节选4000字，直接拼全事件会静默丢掉材料|
|`agent-schedule-collectors.ts:529–566`|只注册actor_plan/responsibility，来自实际本人状态/来源|空新档无候选；worldV0没有needsEvaluation时不会自行进入有用的导演选择|
|`AgentCandidate` domain `:210`|必有worldId+actorId、channel/thread、本人sourceIds及CAS版本|不能把导演专属全局作者库硬塞成“某NPC已知的候选”|
|`npc-agent-advance-services.ts:374–440`|执行前candidate来源必须全在本人authorized snapshot；nudge只允许来源子集，当前自主执行private本人thread|先新增作者候选再无条件复用execute会被合法拒绝；不能为了通过而开放全局source|
|0075 shared_episodes / director repo:821–848|数据库CHECK revision=0、status=proposed；仅INSERT grant；当前origin固定director decision，sourceEventIds/resultIds空|没有active/resolved持久推进闭环，类型枚举存在不等于SQL支持|
|`AgentSource`已有authored；`agent-source-resolver.ts:70`等|目前主要授权本人definition/已知genesis；`definition:<ref>`是人格来源|authored类型不是任意node/script阅读许可；需真实per-actor grant|

此外publication genesis仍拒正常世界未知角色投影（publication-genesis.ts:205）；WorldBoundary的actorIds/placeIds/capabilityIds是**当前已登记边界**，extensionPermission=none。作者隐藏地点/未引入人物在source中存在，不等于已经加入地图、到场或可由模型自由扩展。

## 最小统一协议

### 1. 作者材料读取与可追溯身份

新增只读 authored-runtime reader，在真实snapshot的同一个owner+epoch+worldV一致性读取中调用**已有publication_story_source**，验证origin/namespace，不调用buildStoryPlan的存储路径，更不写旧plan。可复用buildStoryPlan中纯粹的key→id/history映射校验，但不要借其运行时states形成第二条进度权威。

完整引用至少含worldId、bindingId、kind(trial/published)、workId、publicationVersion、draftVersion、contentHash、nodeKey、fieldPath；片段另加start/end及片段hash。ID用整个结构的稳定hash生成短不透明句柄（小于现240字限制），服务端保留完整引用。原稿script与editorialIntent分别保存，不以`script ?? editorialIntent`永久替换或覆盖另一字段。作者后来修改工作台不回写既有世界引用。

DirectorSnapshot新增typed `authoredCatalog`，与fact/speech/belief/result观察区分：包含来源引用、开场标志、事件标题、候选角色范围、原文定位、窗口、条件组及满足/未满足的真实证据、是否有当前可执行能力。完整原文仍在受控source中；模型投喂明确预算索引/原文块，材料太大明确报限或分批读取，不能无声截尾。当前max32只是存储容量，候选数按实际内容变化。

所有文字保持资料身份，不能覆盖系统规则。导演可读全局虚构设定和必要隐藏原稿，绝不读取现实profile/interview；其catalog/hiddenContext/audit也绝不进入NPC payload。

### 2. 一个候选机制，区分世界机会与本人行动

建议root冻结判别联合而不是给AgentCandidate补假actorId：

- `actor_action`：包原AgentCandidate，继续现有计划/责任collector、本人source授权、NPC执行。
- `authored_opportunity`：世界scope，stableId绑定作者ref+真实前提证据/窗口语义，allowedActorIds来自contacts且必须在当前boundary；携带作者ref，**不声称这些actor已知整稿**。
- 后续自主新机会可用同一world-opportunity变体，origin=director、basis是已有虚构事实/关系/已发生选择，仍受boundary限制。

它们在同一snapshot/排队/导演partition/审计中被selected或deferred；只有actor变体允许直接typed nudge+execute。作者世界候选被选中，是一次propose机会操作，不能当actor action执行。`DirectorOpportunity.authoredEventKey`改为绑定精确ref；parser/store核它对应本轮获准的作者世界候选，替代当前把`candidate.episodeId===nodeKey`当授权的过渡判断。

若root为了最小改动选择分开typed数组，也必须由同一调度器/同一导演决策处理和去重，不另造旧导演/旧plan store；禁止把world候选cast成ActorCandidate或减弱本人source gate。

### 3. 没有goal/plan时的首次唤醒

1. 新世界状态可以仍是空goals/plans。读取冻结作者开场引用、当前actor定义、初始已授权事实与真实时钟，不先替NPC生成目标。
2. author collector产生合法world候选；openingEventKey只提供首轮优先意图。没有指定开场时，按实际eligible事件或现有关系生成有来源的可选机会；没有合法候选就诚实quiet。
3. root advance在`world-opportunity candidates非空`时允许一次导演协调，即便actor candidates为空、observed=evaluated=0。stable bootstrap key绑定world/epoch/作者源/条件真值与材料修订，不能按当前时钟每秒换key。
4. 导演明确选择后，原decision事务保存proposed shared episode、作者来源链接及**给获准NPC的考虑许可**。不改NPC goals，不生成对白，不把选择写成world fact或玩家同意。该许可是持久来源，不是已完成事务后的内存callback。
5. 许可形成普通同管线的NPC wake候选，sourceIds只含该人的确切已授权材料/当前事实；内核accepted_input记录原episode/ref/grant，stable child command绑定grantId+actorId+该许可修订。一次只执行有界角色步数，其余待后续事务读取同global进度。
6. 用`origin=wake`允许NPC自然安静、暂缓、拒绝或提出自己的计划；当前NPC prompt把coordination视作必须有回复，不能为促开场而强迫每个角色都发消息。系统wake不得投影成玩家发言，更不得作为玩家accepted/declined决定的证据。
7. 首次NPC输出只经原runNpcAgent/model/parser/kernel/SQL UoW；真的发出消息/执行动作后，才能产生对应episode evidence、awareness与后续候选。已完成同grant重复检查不再买模型；known raw/unknown继续44-27/0076恢复规则，不换ID规避。

### 4. 按角色授权，而不是让导演自由写一段简报就解密

原契约的actorKeys只表示允许参与；script可能混有多人私事、幕后目标、未来结果和“回应后才知道”的信息。仅source span对得上原文也**不证明该actor获准知道**。必须新增确定性的角色材料许可：who、sourceRef/span、nature（own_intent/authored_setup/report/belief）、可披露受众、前提、是否仅private_strategy。未标清的原文默认director-only；不能靠LLM声称“适合A知道”授予权限。

最小安全上线层可以先只用现有initialKnowledge/actual messages及persona形成联系意图，不给NPC整段脚本。若产品要求准确演绎“母亲车祸、青青正在医院照护”等原稿新增事实，则需明确的author material/setup结构与运行时激活规则，不能让一段导演文字直接变成世界事实或实际位置。

建议作者端可选typed `materialBindings`（最终契约由root定）：原文定位、actorKeys/audience、nature及前提；原文不修改。既有长稿可由导入助手提出定位/分类供作者核对，但模型分类本身不是运行时授权。没有范围标注的旧稿不得默认全员知情或静默批量迁移。

- own_intent：只让本人考虑/计划，不证明目标已发生或必须服从。
- report/belief：NPC知道一条说法，仍带来源与不确定性，不能更新实际位置。
- authored_setup：需要真实已授权的环境建立事件（如运行时支持的setup激活），一次性、原文来源、前提/时刻/受众明确；由运行时确定性提交，不由NPC对话确认外部事实。选择proposed机会本身不激活setup。
- private_strategy：可以影响本人立场，但不给群/现场输出原秘密或别人私聊；其source不自动变成channel_context。

runtime reader/model只拿本actor的persona+material view+已知观察；不拿catalog、全script、其它人的brief/goal、global audit，也不直接复制全局episode.description/全体未完责任；共享事件也必须给本人权限裁剪后的view。kernel在提交前再核grant、origin/contentHash/actor/audience/世界版本/遗忘来源，以免模型期间权限变化。director最终对白/玩家决定不进入许可schema。

### 5. 作者前提与完成语义

|原条件|统一引擎中的证明|
|---|---|
|prerequisites=[] / 无conditionKeys|没有额外前提，不凭空加人物数量、强制互动轮次或全员计划|
|history_fact|精确映射已提交的genesis/后续fact，并核候选所需角色知情范围；仅作者库里存在不算角色知道|
|not_before / stage/node window|真实story clock，窗口open/expired分开；越界改变语义frame、使旧raw stale|
|at_place|按契约明确定义的玩家实际位置证据；不从NPC听到的“我在那儿”、计划/邀约倒推出到场|
|after_presented_node|绑定该作者ref的实际已提交消息/展示回执；proposed episode、导演selected、NPC安静state commit都不算presented；presented也不等于用户已读|
|after_committed_node / after_resolved_node|核源episode的明确结果及其证据，严格保存原committed/declined/skipped/expired语义；不能把邀约accepted解释成物理任务完成|
|条件组all/any|逐项纯规则验证，空组/坏引用明确失败；多个conditionKeys按原契约组合，不用模型替代|
|互斥/alternatives/stage|只吃有来源的真实结果，不能依据尚未执行的导演预期排除别线|

opening的required提高优先级，不覆盖prerequisite、不迫使NPC接受/玩家回答。开场前提未满足时，应给明确blocker并保留其它独立可行事件；不能复刻旧openingPending“开场先被硬依赖堵住，同时封锁其它满足条件节点”的死锁。若作者显式定义依赖，才按该依赖阻止后继。

`direction.progress`仍保存pace/refusal/completion原意：refusal影响玩家参与或该人目标，不能关闭全体角色；npc_exact_message仅当自然产生的实际本人物消息确实匹配时可作证，不为过条件强迫照念。物理成果必须来自对应已注册capability result，不能一句“做完了”视为成功。当前缺少的物理capability应展示未支持/待办，不虚构结果。

### 6. shared episode 的实际进度与时间同步

同一个SharedEpisode由统一世界版本/clock驱动，NPC个人goal/plan/decision仍归其本人。建议在现shared_episodes上增加版本化投影与append-only evidence，而不是新旧两套story ledger：

- proposed：导演提出机会，只有origin author/director ref，不含实际发生断言。
- active：存在真实参与/消息/动作的来源证据；各角色可有自己的未处理责任或选择不参与。
- resolved/withdrawn：只能由明确规则+真实completion/expiry/withdrawal证据提交；某个A退出不自动关闭B未完成的责任，也不代替玩家决定。
- 原节点“presented”是独立有证据的里程碑，不机械等同episode active/resolved；保留offered invitation、accepted response、实际到场/结果的不同阶段。

证据记录至少含world/episode/ref/revision、sourceEventId+version+command、record/result ID、actor/audience、evidenceKind、可见性与原规则criterion key。实际NPC/kernel或确定性世界命令的同一SQL事务保存事件、状态、结果、receipt、episode evidence/revision、awareness/Outbox。Director只读已提交证据再协调；不直接把episode标active、不自行补NPC台词或到场。场景观察与玩家位置仍遵循73/76既有来源规则。

当A推进worldV，B下次读同一新的global episode版本；B只收到自己可知的变化，未知他人私聊不得通过“进度摘要”泄漏。B的未执行工作不会因A跑得快被自动视为完成/过期；只有真实时钟/前提/已发生结果改变资格。每轮CAS确保陈旧NPC raw不能把较慢角色写回旧全局进度。

作者机会默认对同一bound node一次性提出；用world+authorRef唯一约束去重。重开须有明确新授权/新revision和实际因果，不以时间tick重建相同机会。quiet与deferred也保留同语义frame的已评估记录，防止空新档不停付导演费。

### 7. 导演在边界内创作新机会

已有opportunity的conversation/meeting/follow_up继续作为有限创作空间：可围绕已知关系、实际选择和未完事项提出建议；必须引用现有合法证据、actor/place/capability。只能proposed，NPC独立决定和演绎。不新增未授权的重要角色/身份/城市，不把作者隐藏地点自动加入boundary，不把编导预期结果当已发生。

若作者节点要求隐藏地点揭示或未知人物引入，需单独已实现且有来源的reveal/introduce capability；当前boundary extensionPermission=none，应明确deferred/missing_capability并保持任务清单，不能擅自扩边界。普通媒体、travel/arrive等仍按根后续能力实现，不以本方案取消。

## 文件与迁移建议（全部由root冻结契约后分工）

|范围|精确建议路径|负责人/交叉约束|
|---|---|---|
|统一candidate/catalog/ref/material/episode contract|world/domain/{agent-runtime,director-runtime,world-awareness}.ts，settings/domain/publication-content.ts、contracts/published-world-content.ts|root唯一公共契约；先决定world/actor联合与privacy许可，不让执行者各自猜类型|
|纯作者资格与稳定identity|新world/application/authored-opportunity-candidates.ts、新world/domain/authored-event-eligibility.ts|可独立执行者；消费冻结source/evidence，不读取旧StoryState、不存旧plan|
|真实source/snapshot/evidence授权|新settings/infrastructure/authored-runtime-source.ts；world/infrastructure/{director-snapshot-repository,agent-source-resolver,agent-snapshot-repository}.ts|B或单一后端执行者；现44-26仍占knowledge source文件，先串行移交，不能并写|
|导演输出与事务|world/infrastructure/{director-agent-model,director-runtime-repository}.ts，application/{run-director-agent,director-runtime-ports}.ts|root整合44-27后独占；保持raw恢复比较新catalog/material/window字段与稳定frame identity|
|本人grant/bootstrap/NPC步进|新world/infrastructure/authored-opportunity-grants.ts，现agent-runtime-repository/npc-agent-kernel/agent-snapshot-repository及server/npc-agent-advance-services.ts|root统一接线；不绕runNpcAgent；0模型状态seed与真实model步骤分开|
|共享episode实际证据|新world/infrastructure/shared-episode-projector.ts及必要world-history事件/reducer/awareness/ports|单一执行者；所有writer同UoW，纯proposal不造world event；不把旧publication_story_progress继续写成权威|
|只读状态/作者体验|publication-opening-http/publication-story-http、对应contract/phone仅在后端冻结后|root/专属UI；展示来源、待条件/未知/失败，不把proposed渲染成完成；本轮不写UI|
|验收|新authored-opportunity纯测试、实际source/RLS/empty-start/kernel/episode/recovery PG、实际HTTP与模型质量验收|独立Q；原角色/导演/恢复专项持续回归|

**需要新增由root分配编号的SQL迁移，不能修改已应用0075/0076，P不占号。** 至少：

1. 按world+精确authorRef绑定episode的不可变来源/选择记录与去重；所有者RLS、published/trial源核验。若嵌入现director_decisions/source metadata，应有同等级SQL约束，不能只存可改自由文本。
2. per-actor material/wake授权receipt：origin decision+episode+actor+source span/性质/audience+前提frame+撤回/失效规则；不可篡改来源。没有许可不得凭author key读取原稿。不能给worker全库读作者原文。
3. 扩展shared_episodes合法revision/status转换及实际evidence append-only表，关联真实world event/command/result，并允许必要最小UPDATE。0075现有revision0/proposed-only CHECK、grant与origin trigger需在新迁移精确演进；保留原director-proposed数据，不把它自动改active。
4. 如果引入authored_setup环境建立事件，新增有限、source-bound的授权/幂等和事件投影约束。此能力不是当前已实现功能；若不做，就限定新开场只使用已合法的已知事实，不假称原稿所有情节已经支持。

无需另建publication_story_plans/batches/nodes或第二个旧story progress store。也不需要固定给每NPC填goal；个人目标仍来自其原Agent模型提案及内核校验。

## 先后顺序与验收门槛

1. root冻结源ref、world候选、材料许可与episode里程碑的公共形状；只读reader+纯资格先行。明确哪些旧稿只能director-only，不伪装支持完整情节。
2. P/其它独立实现者可接纯资格collector；B接source/scope reader；root接单一director/bootstrap/native kernel及迁移；Q独立真实验收。文件重叠先短锁登记串行。
3. 空goals/plans实际published/trial新档，1/多/0作者事件、optional前提为空、无指定开场都有诚实表现。指定开场只优先合法节点；前提不能绕过，无硬锁全池。
4. 真实source绑定/immutable revision/hash/crossowner；原文保存后可精确定位，编辑当前草稿不改变旧档。32是当前上限，无固定六人/固定几条模板。
5. 独立NPC payload快照证据：不含其它人的秘密/未来剧情/全script/audit，私密strategy不向群披露；未授权原稿不能引用为source。
6. Director selected/proposed后episode仍无actual result；NPC安静/拒绝不强迫发消息；自然对白、真实邀约、玩家拒绝、动作失败分别产生正确里程碑和个体责任；不自动到场。
7. A真实推进后B读当前world/time/episode但不泄漏未知事实；候选去重/quiet不重复调用，窗口越界、CAS/unknown/knownraw恢复继续同一有限状态机。
8. 真实PG（包含迁移/RLS/事务故障/回执恢复）与root全check/build/部署READY/公网后，再用明确独立模型额度评人物与开场质量；不以本报告或mock成功宣布能力上线。

本报告与设计均未部署、未启用生产epoch2、未发布用户世界。冻结后等待root实施分工，不自行接管公共源码或迁移。
