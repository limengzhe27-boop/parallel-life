# WORLD-PUBLISH-MD-FLOW-REVIEW-Q · 导入到玩家存档的限定链路审查

2026-10-13，负责人 `codex-publisher-md-flow-review-q-01a0c7c8-20261013`。待验收；只有报告与本人主行变更，根独占源码、部署与本轮12次文字/2测试存档。Q 不调用模型、数据库、HTTP、浏览器或端口。

## 基线与范围

准确根树 `.local/worktrees/world-publish-intake-01` HEAD `9f4d20010beaa483c3804640d7ca70511c482871`，本轮审查前后工作树干净。自有 photo-compose-02/人生剧本、codex/publisher-md-zip-q 只提交本报告，保留已有 ZIP 与审查提交。

读实际 importer、plot/editor 与 controller/client、publisher HTTP/services/repository、publication-runtime/genesis/world repository、0043/45/46 SQL、story domain/repo/service/progress 与 phone/player projection，以及 WORLD_PUBLISH_MD_GUIDE 与 MD-INTEGRATE 报告。SQL 仅读定义，没有执行数据库。部署报告/任务历史中的“新授权待答复”是上一轮状态；本轮根明确转达用户已授权12文字/2存档与协作，仍仅由根消费，旧20/24闭账不能借用。

## 最关键结论：备注存入草稿不等于导演使用

importer :776 将已识别候选原段落写为 `intent:{kind:'editorial_only'}`，明确 actorKeys/prerequisites 为空。domain/publication-story :135、:160、:265 跳过这种 intent；repo.prepare :673 无 eligible 时返回 `none,managed:true`，server/publication-story-service :67 对已管理世界返回 handled/played0，不回退通用导演来猜剧情。

因此纯模板两个幕后备注**不会自行被导演演绎**。它们可以保存、合法编译，仍不产生 claim/message/邀请，也不代表玩家完成事件。剧情编辑器允许作者明确改成实际来信 offer_message 或单角色 offer_invitation 并补参数。真正被用时，repo.claim 取当前已满足条件的一个节点，service :81 将该节点 editorialIntent/intent 放入角色有限 cue，再走原 resolveTurn/校验/事务。不能将候选数量、played 数字、口头“已推进”当这一来源链的证据。

`world.hiddenContext` 保留在作品正文中、不进入公开预览；目前 persona() 只取本人 privatePersona、publicSetting、公开主角身份与本人可见关系，StoryPlan/source SQL 也不含 world.hiddenContext 字段。它是当前的安全保存边界，**不是已接入每轮导演指导**。节点被手工转成可执行后，其当前 editorialIntent 可以实际被用；整份世界梗概/所有备注自动供导演演绎仍未做，不在本轮扩大为自动 extract。

首轮结论已提前回根；根随后确认：新临时作品与一个 trial 已建立，第一导入候选明确设为 supplier offer_message，第二保留 editorial_only，两条历史消息时间已明确，最终稿 schema 通过且 check 仅 trial_unverified 后才建 trial。Q 未访问这些存档；后续是否真成功必须由根提交实际来源证据。

## 已核对的完整接线

|阶段|实际代码与边界|最低证据/不能冒充的内容|
|---|---|---|
|导入|确定性 parser/ZIP，proposal 与原文诊断；UI 指纹/代次/权限再验；应用只 setDraftContent 与前端 review|确认内容由源文件提取/人工补齐，不称模型生成；没有自动保存发布|
|草稿保存|PublisherClient.save 带 expectedDraftVersion，PublicationRepository.save 原子新 revision/hash 与回执，版本冲突保护|读取回来的 workId/revision/hash 与保存内容对应；incomplete 草稿允许保存，不等于 runtime 合格|
|完整检查|PublishedWorldContentSchema→reference/time/knowledge→compiler capability/media manifest→精确 trial evidence|缺日期/地点/非法引用阻断；此前仅trial_unverified正确，不能用初始历史消息解门槛|
|试演创建|startTrial staff授权，SQL43精确 principal/work/draft/hash admission/binding 与独立owner/world；runtime compiler确定性v0|一个已固定最终稿的 trial；不是 WorldPlanner 重新抽取或自动补全剧本|
|试演证据|SQL43 trial_evidence 将绑定world上v>0 assistant消息的sourceEvent关联world event，再关联succeeded command/result_event_id|真实持久事件/消息/原回执，不是初始消息、UIflag、悬空文本或模型只返回但未提交|
|发布|checkId/work/version精确匹配，publish 再assess/media/trial/basis/hash，再锁版本与permission，保存不可变publication snapshot|试演后不要再save改版；过期check/别draft/别staff trial不能给此稿背书|
|玩家创建|startPublished authenticated owner，publicationVersion+commandId，SQL43精确listed当前版；validated compiler+原子binding/world/build/genesis|trial与player不同owner/world，origin精确同发布版/最终draft/hash；不复制trial个人进展|
|创建重放与继续|SQL43原command原request回执早返回，同owner/work/version独立唯一binding；catalog已有worldId则直接继续|同命令同参数同world/seed/origin；新命令同版也是resume同存档，不另造第三个world|
|下架|unpublish只listed=false+metadataVersion；SQL45 owner的旧binding连原版card，controller直接worldId继续；新访客无目录/新admission|已有player消息/进度/旧card保留，新访客不能新建；旧原命令重放恢复已有存档与新入场区别清楚|

“恢复”在本轮指同一玩家继续已存世界，不是后置的历史版本对比/回滚管理。不要为检验恢复再创建新player或新版world。

## 公开/幕后与 NPC 隔离

- catalog/发布 card 仅 title/hook/identityLabel/experienceNote/description；preview 白名单只 publicSetting、公开card、作者确认的已知facts/地点。源码不会把 world.hiddenContext、privatePersona 或候选完整计划作为 player preview 返回。
- world GET 走 builds.phone，publication seed/opening/origin 与不可变binding逐项核对；actors 用 projectPlayerActors，仅作者公开身份/traits/appearance/已授权关系，不以内部 persona 作为名片fallback。phone 返回实际消息/笔记投影，非裸 WorldState。
- 编译每个 actor.persona 只本人 privatePersona 与合法可见关系；已发生 facts 需visibility与initialKnowledge匹配才入该角色可见范围。没有接用户真实 Profile、私人访谈或照片；不要将本轮合成作者身份当真人资料。
- story.progress 仅 currentStageKeys、总节点元数据、已经有sourceEvent的presented引用与pending opaque command/claim；不返回完整节点原文或未来intent。总数也不是已演数量。
- 回应某个角色只接当前自己有限context；只有真实已发邀请和真实场景可拿当前 sceneBrief。未呈现备注、后续节点和他人私聊不是正常NPC资料。本文不扩大重新审所有长线/scene/多人代码，根应对最终合成样例看真实ctx/来源与外部输出。

## 本轮有限真实 QA：根独占，Q仅提出条件

先固定最终稿的 workId/draftVersion/contentHash、两个 actorKey→actorId、可执行与仅备注两个 nodeKey、历史消息及时间；固定后不再 save，因为新修订会使已有trial证据不匹配，重新建trial将破坏两存档上限。所有请求按实际 provider model调用计数，页面自动导演/纠错/重试也计，不能按按钮点击数算12。无需跑新场景、图片、多人物行动或另造世界来证明本轮后台链路。

|验收反例/步骤|通过条件|不通过/不应宣称|
|---|---|---|
|历史来信“就已经是AI回复”|创建trial后check仍trial_unverified；v0历史保原作者日期且不被算入证据|初始非空assistant或打开手机就ready，是假背书|
|只看可执行supplier来信|该node唯一真实claimed→turn/resolved event与succeeded command→对应actor的sourceMessageId；story状态presented/committed，phone有该实际message|played1/AI说“已安排”但node没source；另一个NPC、旧genesis消息、不同world/command冒充|
|仅备注自动演绎|第二editorial_only无claim/source/outcome，重复推进不额外付费生成它；总节点数可以包含备注|因为总数2就称两个节点都可玩；备注被当未来事实/自动泛导演执行|
|承诺或假设被当完成|在本轮必要的真实user回合中表达“我先核对，再决定是否付款”，只保存实际陈述/当前反应，不编已支付/对方同意/事项完成|现实Profile事实、金钱奖励或世界verified成功由这句承诺凭空生成|
|试演证据和发布版本|真实assistant提交后重check ready，trial receipt对应这个principal/最终revision/hash；发布snapshot对应samehash|换稿后仍用旧trial/check发新稿；仅对话质量截图代替回执|
|trial污染player|临时上架后只创建一个player；其origin绑定发布版且初始无trial新对话/choices/scene，而作者历史按原稿独立存在|复制trial手机、复用trialworldId、把私有trial在玩家目录公开|
|玩家真实承接|在player独立实际角色回合看公开设定/本文有效约定承接，source绑定player而非trial；假设/行动边界仍成立|只靠初始预置字符串“回复正确”；仅模板build成功冒充真实模型运行|
|创建重复/刷新恢复|同原命令重放、再进入或刷新仍同world/seed/origin；历史和新消息存留，不新增第三存档|入口点击或unknown自动重付/重建world，原来源和进度消失|
|下架和权限|本人目录保原card+world继续；新/无binding guest看不到临时作品且start被拒；跨owner trial/player读取被拒，0新world|下架清除本人存档或让新guest建world；误用管理员DB读到数据就称玩家授权成功|
|公开与幕后标记|使用合成公开字段与幕后/另NPC私有标记；公开catalog/phone含允许公开字段、不含幕后原文/别NPCprivatePersona；NPC A请求context不含B独占资料|不出现某词便称所有语义保密；把本人NPC可主动说的背景与公开DTO直接泄露混为一谈|

核心付费检查可围绕 trial导演来信、trial一个真实user回合、player受控导演/一个真实user回合；这不是承诺每步固定调用数。每次前由根预留并检查预算，进入player可能触发自动导演也需算入。剩余额度仅给明确必要、允许的恢复；unknown先核原command/lease/source，不能用新command自动重付。不要求把12次全部用满。

版本冲突、权限拒绝、同命令重放、下架与本人继续、公开DTO过滤属于0模型检查，可沿既有两个合成存档验证。不为了新稿反例修订再建trial或对无关用户存档取样。世界级model/source证据必要，但不要求额外模型频繁反问“讲秘密”来消耗额度。

## 完成记录应包含的证据

根交付用可追溯且不含凭据的 work/publication/revision/hash、两binding/world/owner种类、真实actor command/event/message、node state/source、trial evidence/check id、player origin/重放/下架继续结果、最终两个world paused与账本closed、实际调用/纠错/unknown计数及剩余上限。包含实际公网版本READY/别名SHA及关键流程，不把旧版本检查数和之前20/24样例移作新稿成功。

可执行节点实际提交成功只代表这个人工配置的事件接通；仅备注仍不能自动演绎。一个真实assistant足以满足现发布门槛，但**不是逐node剧情覆盖或自然语言质量的自动审核**：SQL43没有统计全部候选/现场/结局是否演过，也不直接核供应商账单。真人体验、所有原稿关系/结局与长期导演质量保持后续任务。

## 本轮审查结果与接续

在准确9f4d200读到的限定链路没有发现新的来源/权限/版本接线P1。最重要的是验收范围与用词：editorial_only/hiddenContext不会自动成为当前导演事件，trialVerified不等于全剧情完成，unknown/played或数字不能替代实际提交来源。

Q本轮只读源码/历史报告，**0新测试、check/build、实际PostgreSQL、HTTP/browser、模型、生产写、端口、新世界/图片/部署**；根1827check/404边界/type/build与之前HTTP/390/ZIP证据只是根报告，Q没有重新验证。真实模型QA新结果仍由根回传，不提前标成功。本报告待根集成后归档，原报告独立提交，Q不接管公共源/运行额度，也不继续自动extract或扩任务。
