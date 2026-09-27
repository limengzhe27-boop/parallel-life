# 体验重构最小契约提案

2026-09-28 · EXP-03A · 待集成人审阅。依据 [体验重构基线](EXPERIENCE_REBUILD.md)。本文是设计，不表示接口、迁移、Repository 或调度已实现；EXP-03A 完成也不等于 EXP-03 完成。公共 Zod/数据库契约仍由集成人冻结。本轮不新增业务代码。

## 1. 复用边界和事实源

|对象|当前事实源|本提案增加的能力（未实现）|
|---|---|---|
|现实资料|Profile 的 facts/events/people、照片引用；MemoryCandidate 与来源消息|统一只读投影、精度与冲突标记、版本化摘要|
|推荐|Discovery 的方向与来源、profileVersion|方向转成持久草案，不把推荐等同用户选择|
|创建起点|ApprovedSeed、SeedRepository.approve、WorldBuild|草案修订/确认绑定、细粒度资料与素材选择、统一创建用例|
|世界|WorldState、WorldEvent、command receipt、Outbox|显式附件、可见性投影、增量读取游标|
|图片|MediaGeneration/任务、PrivateAsset、相册投影|真实状态映射、素材/人物/消息的 ID 关联与投递幂等|
|认知|Memory 的 profile/branch/character scope 和 SourceRef|沿用；不得作为第二份现实档案或剧情事件表|

不另建“体验数据库”。资料更正走 Profile 用例，世界后果走现有 reducer/command，媒体完成走独立修订与 Outbox。模型只能提案。身份由会话取得，客户端不指定 ownerId；所有引用在服务端检查归属、世界、角色可见性。

当前代码核对：`src/contracts/api.ts`、`seeds.ts`、`discovery.ts`、`world-build.ts`、`album.ts`、`memory.ts`；`world/domain/types.ts`、`media/domain/types.ts`；SeedRepository、ProposalThread、ProfilePane、world-app-data、layout 的样式导入。EXP-02 正并行修改真实性路径，实施时以其合入结果为基线，不复活被删除路径。

## 2. 资料读模型：一份事实，多种视图

建议 `ProfileView` 作为组合查询结果，不作为可独立编辑的新文档：

```ts
type ProfileView = {
  profileId: string;
  profileVersion: number;
  viewRevision: string; // 包含候选/来源变更的组合修订，不冒用 profileVersion
  current: ProfileItem[];
  interestsAndWishes: ProfileItem[];
  experiences: ProfileItem[];
  people: ProfileItem[];
  photos: AssetRef[];
  unresolved: ProfileItem[];
  pending: CandidateRef[];
  summary: { text: string; itemRefs: ItemRef[]; basedOnRevision: string } | null;
};
```

ProfileItem 最小字段：稳定的 `itemRef={kind,id}`（fact/event/person/basicField）、text、category、sourceRefs、origin（user_statement/user_edit/agent_inference/legacy_unverified）、certainty（recorded/needs_review）、可选 time（value、precision=year/month/day/unknown）、可选 conflictGroup。ItemRef 保留原 ID，不能以数组序号或文本哈希代替编辑目标。当前已确认自述可投影为 recorded；confirmed 只是旧存储状态，不足以证明历史模型推断正确，来源无法辨别则 legacy_unverified。agent_inference 只列待核对或认知视图，不能用于现实事实带入。

|现有记录|目标视图与兼容规则|
|---|---|
|identity 的“个人资料\n”文本块|只解析已知标签到 current；保留原 fact ID 与字段路径。未识别行进入 unresolved，不丢弃|
|独立 identity fact|进入 current；不再因类别整体隐藏，不自动猜是哪一个字段|
|interest / wish|进入 interestsAndWishes，保留二者语义；愿望不变为已发生经历|
|personality|用户明确自述可展示“你说自己…”；推断标 needs_review，不由生日补性格|
|experience fact 与 events|共同展示经历；用各自 ItemRef 编辑。相似项标可能重复，未经核对不删除或合并来源|
|relationship fact 与 people|同页展示关系文字和人物卡；未解析成 person 的记录仍可见；同名不自动合并|
|rejected / forgotten / superseded|不进入正常视图、摘要或新草案依据；授权的审计视图保留最小必要记录|
|旧候选和正式条目重叠|保留来源，展示重复提示；不得以展示去重替代迁移回执|
|旧错误生日/假设经历|显示可更正的待核对项；不根据正则批量改写历史|

未知日期保持精度，年份不能塞进 HTML date 后伪装为空或补 01-01。摘要没有自己的编辑入口：编辑其引用条目后摘要失效并重建；旧摘要不能继续作为新模型上下文。访谈成功响应或后续刷新要更新 ProfileView 与问题状态，不能只更新 messages；不同修订异步返回时不覆盖较新数据。

**基础资料可信边界适用于全部字段，不只生日。** name/birthdate/birthTime/location/occupation/hometown 均需有对应原文、本人归属和陈述语气证据；否定、假设、引述、他人资料和角色设定不得直写本人。正则可识别有限明确表达，不能作为完整的可信校验器；模型提供值不代表其可信。来源引用真实存在且属于该用户，只能证明出处可访问，不能证明抽取值受该原文支持。建议按字段保留 sourceMessageId 与证据片段，校验主体、否定/假设和冲突；无法明确时保持待核对或不写入。候选 suggested/confirmed/rejected 是工作流状态，证据可信度是另一维，confirmed 不会自动使错误引述成为本人事实。含糊时间、跨分句主体和用户更正需专项语料；不能把被拒绝值静默用兜底补回来。

**EXP-02 实施快照（只读复核，未作为上线证据）**：当前差异已阻止创建意图自动建第一方向、复用 SeedConsent，照片默认不选且展示该组实际带入的图片；这仍是整组选择，尚未逐张授权，也未落地 LifeDraft。不能据此将本节持久草案/细粒度选择/统一确认用例标为完成。

资料写入沿用 Profile command。手动修正优先，明确自述按最新产品约定整理，有歧义/冲突才待确认；用户不需要逐条完成问卷。建议统一 `editProfileItem(commandId, expectedProfileVersion, itemRef, operation)` 到现有 ProfileRepository，旧客户端的 PATCH 只作同用例适配。confirmed、candidate、memory 的服务端状态不得由前端自行互相改名。跨分支写回仍保留已有两次同意路径，不因自动整理现实聊天而取消。

## 3. 人生草案：修订的是意图，Seed 固化的是授权起点

新增最小持久 `LifeDraft`（设计，尚无对应 Repository）。作为 Discovery 模块内的工作稿，避免引入第二个世界模块：

- id、revision、status=draft/confirmed/archived、createdAt/updatedAt。
- story 沿用 SeedStory 的 title/premise/opening/tradeoff；补 protagonist（主角身份）、tone、startTime（明确值或待提议）、setting。未知项由模型提出时标 fictional_proposal；不能混入 Profile。
- basis：选中的 Profile ItemRef 与版本、用户明确指定的消息 ID、对应采访版本；不截取最近四句作为全部授权证据。
- selection：明确的 factIds/eventIds/personIds/assetRefs，portraitAssetId 单列；全部默认为空，不因已有肖像自动选参考照片。
- readiness：blockingIssues 与可补充的 suggestions；能创建依赖分岔、起点与选择范围清楚，不依赖生日或 fact 数量。
- confirmedSeedId（仅确认成功后）、confirmedRevision。生成任务引用 Task ID，状态从 Task 读取，不再复制另一套任务状态。

首次可由方向或用户明确设定形成草案；全部入口使用一个 `prepareDraft`，区别仅是输入来源。模型提案提交前校验其基于的 interview/profile/draft revision；过期输出保留为冲突，不覆盖用户的新编辑。任何关键字段或素材选择变化都增加 revision。confirmed 草案不可原地修改；“改一下”复制为新的 draft，保留原 Seed/World。

唯一确认用例建议命名 `confirmDraft`：入参 commandId、draftId、expectedDraftRevision、expectedProfileVersion、明确 selection；服务端在同一事务中重新校验来源/素材权限、固定该版本、保存 ApprovedSeed 并返回 seedId。确认请求必须来自具体展示版本，聊天中笼统的“建一个”只能打开草案，不能自动选择新生成的第一条方向。重复 commandId 同内容返回原 Seed，异内容冲突；同一草案修订重复确认不产生第二个 Seed。

随后 `ensureWorldBuild(seedId, commandId)` 复用现有 build 用例/队列；需保证同 Seed 的创建恢复返回同世界（实现时核对现有唯一约束，缺失由集成人补迁移）。确认后断线，GET 草案仍可找回 Seed；点击继续恢复同创建，不重新推荐。unknown 明确重试采用新 attempt/command，保留原请求关联，不自动外部消费。409 返回最新版本与冲突字段供重新审阅，不静默替换方向重试授权。

ApprovedSeed 是不可变授权快照。现有 includePortrait 会把 profile.referenceAssetIds 一并加入 assets；新确认入口必须明确列出实际带入的每一张图。不能在新设计中继续把该布尔值直接等同逐项授权。建议向后兼容扩展 seed 的 selectedItems/selectedAssetRefs/fictionalSetup/draftRef，保留原 facts/people/story 供旧世界读取；不得为了复用 factIds 把事件改造成假 fact。快照保存授权版本，实际生成/交付还要复查当前素材可用性与撤回规则。

|入口|唯一目标用例|不得再做|
|---|---|---|
|聊聊里谈一个如果 / 想看看|prepareDraft 或读取现有草案|自动建第一条推荐、把讨论当授权|
|分支页新建 / 改方向|prepareDraft / reviseDraft|另存组件私有的 story 与选择|
|草案确认卡 / 详情确认|confirmDraft → ensureWorldBuild|自行 approveSeed、默认素材、双重创建|
|恢复创建 / 刷新 / 返回|readDraft/build + 原任务恢复|重新生成方向或新建 Seed|
|进入既有世界|按用户选择的 worldId 读取|默认进入列表首个 ready world|

自由输入继续可用；阶段是系统对信息的判断，不强制用户按序答题。“不要创建”“朋友说创建”“如果我创建会怎样”均不产生确认命令。先完成用户消息提交，再基于其 ID 更新草案。

## 4. 事件、附件和媒体：共享引用而非共享文案

复用 WorldEvent 的 id/worldId/version/commandId、效果及 sourceEventId；不另建事实事件总线。建议新增只读 `PhoneSnapshot` 在现有 WorldPhone DTO 上渐进扩展：worldId、worldVersion、storyTime、mediaRevision、syncCursor、messages/invitations/notes/media、capabilities。syncCursor 为服务端不透明复合游标，涵盖媒体独立修订，不能只用 world.version 导致漏图。无增量服务时 capabilities 指示 bounded_refresh，以完整投影刷新作为诚实首版，不伪装订阅已实现。

最小引用提案：

```ts
type SourceRef =
  | { kind: 'world_event'; worldId: string; eventId: string }
  | { kind: 'opening'; worldId: string; seedId: string };
type AttachmentRef =
  | { kind: 'media'; requestId?: string; assetId?: string; revision?: number }
  | { kind: 'invitation'; invitationId: string }
  | { kind: 'note'; noteId: string };
```

以上为世界展示引用，不替换 MemorySourceRef，也不把用户上传硬编成 world_event；上传素材沿用其真实上传/相册命令来源，附件必须至少有 requestId 或有效 assetId。消息增加 attachments 和 source，后端保证引用目标在当前 owner/world 和会话可见。旧消息缺引用时仍显示文字，禁止按标题自动挂图；旧开场标 opening，不能冒造事件 ID。

媒体读模型以现有 MediaGeneration.id 为 requestId：状态 queued/running/submitted/succeeded/failed/unknown，UI 分别显示等待/生成中/处理中/可查看/失败/待确认；取消使用现有任务 cancelled，不把媒体 domain 悄悄扩成另一套状态。成功必须同时有受权可读的 assetId、revision，未接适配为 unavailable capability/明确错误，不填 ready。上传照片可直接展示真实素材；来源标 upload，不冒充生成。占位插画独立 presentation 装饰，不进入相册资产、角色记忆或已完成任务。

记录 source、storyAt、requestId、approvedAssetRefs、subjectActorIds、visibility、assetId/revision、deliveryReceipt。Visibility 复用 owner/actors/world 的语义，world 仅限此世界，绝非公网。持有者、出镜者、接收者不是同一概念；照片中有某角色不意味着该角色看过照片。角色获取上下文前仍需裁剪，客户端 URL 可见不授予 NPC 知识。用户上传到现实档案不等于授权任何分支或角色。

媒体成功投递以 `(worldId, requestId, recipient/conversation)` 为幂等键；回执、附件引用和 Outbox 状态原子落库，图片字节无法同事务时使用暂存/完成记录，防止崩溃后重新生成或重复发消息。图片失败不撤销已提交对话。更换授权或素材删除后，投递重新检查权限；旧消息显示不可用附件而不泄露旧 URL。未知结果先查询既有 providerTaskId，不能直接再次消费。

日历确认仍是 invitation command；确认不等于已赴约。便签标用户编辑/开场资料/事件引用，不能将旁白标为用户日记。所有时间使用 storyTime，createdAt 是实际存储时间，二者不互换。未实现的关系事件、自动调度、图库生成以及群聊接口保持 capability 未开启；EXP-05 不能以夹具声称 NAR-02/03 完成。

## 5. EXP-04/05 最小服务接口（提案，不是现有 URL）

|消费方|操作及输入|返回与边界|
|---|---|---|
|外层|readProfileView()|ProfileView；分页来源引用，不下发完整私人访谈给世界|
|外层|editProfileItem(commandId, expectedVersion, itemRef, patch)|committed + 新资料修订；冲突保留用户输入|
|外层|prepareDraft(commandId, committedMessageIds 或 directionRef)|持久 draftId + task；不授权建世界|
|外层|readDraft(id)、reviseDraft(commandId,id,expectedRevision,patch)|LifeDraft 与 readiness；服务端版本校验|
|外层|confirmDraft(commandId,id,expectedRevision,expectedProfileVersion,selection)|committed + seedId；不可变授权快照|
|外层|ensureWorldBuild(seedId,commandId)、readBuild(seedId)|worldId/task/canEnter/media状态；不伪造百分比|
|手机|readPhone(worldId,cursor?)|授权 Snapshot 或 delta + nextCursor；游标过期返回完整重同步标记|
|手机|sendMessage / invitationAction / saveNote|沿用现有命令与期望版本；accepted 与 committed 分开|
|手机|readMedia(requestId)、retryMedia(requestId,commandId)|真实状态/任务；unknown 显式决定；未实现则禁用动作|

读 API 不触发付费模型或推进；主动触发由 NAR-02 的持久调度实现。HTTP 路由最终命名由 I 冻结，以上命名是用例接口，不允许前端自行杜撰上线 URL。既有 LifeClient 方法通过适配层迁移，先冻结响应和错误，再并行改页。

公共错误沿用现有体系：NOT_FOUND（包含无权引用，避免探测）、INVALID_INPUT、VERSION_CONFLICT、IDEMPOTENCY_CONFLICT、UNAVAILABLE；不要将所有失败统一“没了解够你”。任务 unknown/cancelled/failed 保留真实原因类别。重试复用原 commandId 仅限同一请求重放，改变 body/版本必须新命令并经冲突恢复流程。

## 6. 替换顺序与删除清单

|旧路径/文件|过渡方式|切换后必须删除/收敛|
|---|---|---|
|ProposalThread 的 discover→approveSeed→createWorld 编排|先适配到统一草案用例|自动首选方向、默认照片、独立创建事务编排|
|DiscoveryApp + SeedConsent + BuildControl|复用同一草案/授权组件及服务；已有 Seed 继续读|第二套 consent 状态与不同的创建选择语义；不能只隐藏按钮保留可写 API|
|branch-intent 的正则命令触发|降为 UI 意图建议，消息提交后才处理|正则直接建世界的副作用；不能以更长正则替代授权|
|ProfilePane/BasicInfo 字符串过滤|服务端只读 legacy adapter 输出 ProfileView|UI 多处拆“个人资料”、排除身份、按关键词藏记录|
|world-app-data 标题匹配图片|旧记录无附件正常显示文本|标题/姓名猜测关联、统一 ready 映射|
|world-phone-app 的并行本地数据回退|草稿可本地，已保存条目以服务端投影为准|以 localStorage 便签/伪消息替代提交成功的路径；迁移个人草稿需明确导入，不静默上传|
|globals.css / phone-first.css / outer-ui.css 三层覆盖|先分清 reset/token、外层组件、手机专属职责|被新组件替换的重复选择器和 inline 覆盖；不可直接删共享 reset 造成旧世界回退|
|phone.module.css / apps.module.css / preview.module.css|保留模块隔离，统一 token；预览仅开发|同一控件多套样式归属；不为了换视觉重写路由恢复逻辑|

先加可读兼容字段/投影→旧数据差异预览→统一写用例→切换一条完整体验→禁用或转发旧写 API→移除旧组件与覆盖。旧 API 转发时仍严格要求相同草案/授权语义，无法证明具体确认的请求必须拒绝并提示升级，不得补一个隐式同意。

迁移不改写历史 Seed 和 WorldEvent；旧世界照常读其基线。旧资料映射仅读，不双写第二份档案；不确定记录留 unresolved。不可变快照和当前撤回权限分别处理，不能为撤回而重写历史。回滚代码保留新增用户数据，未识别的新写语义停止写入而非丢字段保存。可删除旧路径的证据：代码搜索调用点清零、所有入口通过同一用例、旧 URL 无独立写入、迁移样例无信息丢失、旧世界读回归通过。开关只切整条体验，不让草案来自新页而确认落旧页。

## 7. 最小验收语料与证据

|合成输入/场景|应有结果|禁止结果|
|---|---|---|
|“不要创建分支，先聊聊” / “朋友说帮我创建分支”|继续讨论，零建世界命令|正则匹配就创建|
|“我想开咖啡馆，不想填生日”|可形成标记虚构起点的草案|生日/资料数量门槛|
|“2020年毕业；我朋友1998年出生”|本人生日不变|年份兜底写本人生日|
|“不是上海，是苏州；照片别带进去”|草案升版本、地点及素材清单可见|旧版本自动重试授权/默认带参考照|
|“先看看第二条，暂时不进去”|选中第二草案，无 build|自动创建首个新方向|
|“今天不赴约，但我愿意周末再聊”|语义提案、必要时确认改期；聊天继续|自动记为已参加或停止自由输入|
|资料更正后慢摘要返回|忽略旧摘要，来源版本一致|旧结论覆盖新资料|
|两入口同时确认同 draft revision|一个 Seed/同创建恢复；差异内容冲突|两个世界或授权串版本|
|两张同名照片/角色重名|仅 ID 引用精确关联|文字匹配误挂图/泄露给其他角色|
|图片生成中刷新、失败、unknown|真实状态保留；unknown不自动再次生成|ready占位/重复收费和重复投递|
|暂停与主动触发竞争、提交后崩溃|NAR-02真实库证明恢复/幂等，主角选择仍待用户|丢事件、重复后果、自动代答|
|旧 identity/relationship/experience/年份资料|所有条目可定位可更正，精度保留|隐藏、自动猜测迁移或填假日期|

单元层验证映射、状态转换和否定语义；真实 PostgreSQL 验证跨 owner/world/actor、版本竞争、回执和恢复；真实模型用三种经历验证自由表达与剧情后果；媒体必须有真实适配证据；浏览器覆盖手机/短屏/PC、刷新和失败回访。纯设计没有这些运行证据。本契约冻结后，EXP-04/05 可用明确标注的开发夹具并行，但真实体验待服务接线和 NAR-02/03 后验收。
