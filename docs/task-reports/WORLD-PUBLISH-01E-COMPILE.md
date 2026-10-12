# WORLD-PUBLISH-01E-COMPILE — 最小发布起点编译器

2026-10-12；Agent codex-worldpublish01e-compile-01a0c7c8-20261012；主表短锁已领取进行中（只读准备）。独立`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，新`codex/world-publish-compile`自准确已发布88094a5c5da9eed0d84806e8c8070f0836cbcf24（含74身份/359安全内容），旧分支保留。根唯一公共协议/43/HTTP集成；Q不写人物UI，不读取私人档案，0模型PG浏览器图片生产部署。

预留确切范围：新`src/modules/settings/application/publication-runtime.ts`（仅编译端口和输入输出types，不依infra），新`src/modules/settings/infrastructure/publication-genesis.ts`（确定性适配器），新`tests/publication-genesis.test.ts`、本报告/主镜像/本人行。先回根接口与公共缺项，获明确冻结后才写三个源/test；所有旧officialGenesis/world/types/contracts/seed/SQL/API/原tests只读。

已只读核对official-genesis、WorldState/actorContext/player-projection、space及world-space contract、ApprovedSeed/WorldOpening/WorldPhone、build/official repository：officialGenesis硬要求6人和3不同人当前来信，不适合动态内容；WorldState本身演员数组不限8，旧模型WorldOpening为2–8且persona1200/setting500，不能把发布编译结果冒充该模型输出；WorldPhone是公开投影，与完整内部WorldState分开。space现仅official_genesis/seed_genesis来源、最多16地点/route120分钟，内容允许24地点/1440分钟，需明确支持预算。phone读ApprovedSeed并只从已观察联系人/旧official联系人读取公开关系；旧seed四固定ID，不能把新作品包装为旧preset。

## 回根的最小接口提案（待I冻结，不是已实现）

- 输入`{content: unknown, origin, worldId, ownerId, seedId, newId}`；origin全部由可信发布实例化调用者传`workId/publicationId/version/revision/contentHash`，IDs/newId也由调用者提供，不从payload取owner/发布权限。内容经准确安全schema解析；contentHash算法须与STORE冻结一致，不自行创造另一套摘要协议。
- 输出判别`compiled`或`invalid/unsupported`，含明确issues/missing列表；只有成功编译返回`WorldState(version0)`、安全opening metadata（主角身份/公开setting、初始公开人物、便签和来源）、稳定actorKey→actorId及消息/事实/邀约映射（仅服务器内部），并证明该输入实际支持`publication.opening.v1`。结果不发HTTP、不保存Repository、不授发布权；unsupported不调用模型/补人/伪装成功。
- 从2–12可变角色生成稳定ID映射（不按名字），每人只使用自己的Persona。保完整私人字段且遵守actorContext/状态预算，不截断。history只按原明确知情与visibility映射：主角已知→owner事实；NPC仅initialKnowledge且获授权→相应actors事实，避免直接world可见让未初知NPC获得历史。参与者actorKeys不是知情凭据。
- 按原message.at排序并保UTC实际历史时间、history/当前来信阅读语义，拒不可能/重叠不一致来源，不强求旧3条通知/每人都有历史。邀约只proposed并绑定实际messageId；不从编辑意图或台词推断用户动作/完成。关系可见性分别处理，不默认给mayShare授权；NPC上下文不含别人的Persona/整个hiddenContext剧本。
- 媒体任一引用/记录、timeline、任意候选节点（包括editorial_only未执行节点）、runtime_required扩展暂不接运行，明确unsupported，不能用当前保存协议允许来声称可玩。editorial扩展可保版本资料但不变事实；hiddenContext/编辑说明不注入事实/全NPC。空间只编译玩家已知地点/合法路线，超现有16/120分钟或文本/状态预算显式拒绝，除非根批准公共扩容。

## 需根冻结的公共衔接（Q不修改）

1. 稳定发布origin/space来源：建议新`publication_genesis`，带确切作品/发布版/源修订/摘要以及初始snapshotVersion0；root统一WorldState/SpaceSource及Zod/来源消费者。或root明确允许通过真实seed_genesis追溯发布版本，但绝不假official preset。初始snapshot和phone meta的发布来源需能关联同版；Q可先返回origin独立metadata，待公共slot准确后组装。
2. ApprovedSeed新的publication来源：root43新增合法稳定源并保持旧四模板/私人seed；保存公开起点和发布指针，**不把PublishedWorldContent全稿/Persona/candidates塞给玩家seed**。pub内容没有完整旧story.tradeoff，不能把体验说明伪造为取舍或截断长描述满足旧model结构；root决定新seed安全summary字段与兼容读取。
3. 公开人物/便签/空间投影：root将编译的安全公开contact/notes metadata与trusted actorId映射接入Build.phone/projectPlayerActors；认识但暂无来信的人可按approved公开名单显示，未知人物仍隐藏，关系/简介不从private Persona或内部relationship兜底。现WorldPhone可以容纳2–12；Q不改公共投影/模型WorldOpening/人物UI，不把knownAtStart当发布审批或profile授权。
4. 确定角色私有关系/历史原始来源及runtime预算：Q返回服务器内部source key/原occurredAt映射，让root43事务真实保存版本/初始快照/投影/回执；不创建Memory数组或假成功task。world事实权限与initialKnowledge双重过滤，运行state超预算及未接玩法字段拒绝。hash计算、公共slot及notes持久来源需根明确后消费。

最小验证拟直接调用编译器+真实actorContext/公共安全投影：2及12同名稳定角色、重复/坏newId、两个owner/world隔离、per-NPC Persona/事实隔离、原历史时间/当前未读、proposed来源回指、未支持媒体/timeline/节点无假支持、超预算无截断、非法原型/getter内容拒绝、旧4模板函数/文件不变。没有PG/HTTP/模型验收证据。

当前只读准备到此：本轮尚未实现compiler、不声明opening capability，等待根准确冻结接口与公共origin/seed衔接后在四预留文件内立即实施。不会再写泛化后台规划或占人物UI任务。

## 已实施（根冻结后，不再是上述初始提案）

根批准四文件实现并更正来源协议：不使用最初提案publicationId UUID；正式实例origin为`{workId,publicationVersion,draftVersion,contentHash}`，workId+publicationVersion是正式复合身份。root随后补private trial：明确input.originKind='trial'且publicationVersion=0，published必须>=1。源标识严格`publication-genesis:<worldId>`，避免既有genesis补时器修改作者at；space保真实seed_genesis/可信seedId，实际来源绑定由root43事务完成。

修改四新文件：

- `src/modules/settings/application/publication-runtime.ts`：仅端口/types，import type WorldState，不依infra。导出PublicationRuntimeOrigin、PublicationOpeningMetadata、PublicationGenesisKeys、PublicationCompileInput/Result/Issue、PublicationRuntimeCompiler。
- `src/modules/settings/infrastructure/publication-genesis.ts`：导出同步`compilePublicationGenesis(input)`及`publicationRuntimeCompiler.compile`。真实解析现PublishedWorldContentSchema和ID/metadata，2–12演员按stable key分配caller UUID；拒绝重复/坏ID，未知人物不适配则明确unsupported；每人仅自己的全Persona及获授权关系。历史仅owner-known或initialKnowledge且visibility授权的actors，world权限不自动当知情，参与actorKeys不推断记忆；调用真实actorContext确认初始授权事实可完整表示。完整世界/metadata/keys65KB、Persona4000字符、space16地点/120分钟限度不截断，输出用已有纯JSON guard核对。
- `tests/publication-genesis.test.ts`：31项实际编译/actorContext/空间/既有phone shape/legacy补时器测试；两人及12人、同名/constructor跨namespace、两owner/world独立、完整Persona、时间/未读/提议来源、预算、callback ID和getter、所有unsupported、私有trial0/pub1。
- 本报告；旧officialGenesis、world/types/contracts/seed/API/SQL/原tests、人物UI未改。

## 准确可用端口

```ts
compilePublicationGenesis({
  originKind: 'published' | 'trial',
  content: unknown,
  origin: { workId, publicationVersion, draftVersion, contentHash },
  worldId, ownerId, seedId,
  newId: () => string,
}): PublicationCompileResult
```

输入trusted metadata先检查纯data descriptors、UUID、有限整数/来源mode、64位小写hex摘要及caller allocator，拒绝getter和第二publicationId。`contentHash`只检查格式；它的真实内容/版本绑定和统一算法由可信STORE调用者核验，不私造另一个canonical hash协议，也不以随机UUID冒称DB来源存在。

`compiled`返回：`world` WorldState v0、`origin`、`seedMetadata:{source:'published_work'|'publication_trial',origin}`、`keys`、`capabilities:['publication.opening.v1']`和`opening`。opening精确形状：

```ts
{
  kind: 'publication_opening', schemaVersion: 1,
  origin, originKind,
  identity, situation, setting, experienceNote,
  contacts: [{ actorKey, actorId, name, relationship, identity?, traits, appearance? }],
  notes: [{ key, id, title, text, sourceEventId, factKeys }],
}
```

`keys`是服务器内部按namespace的数组：actors/messages/invitations/notes各`{key,id}`；history为`{key,occurredAt,ownerFactId?,actorFactId?}`；routes为`{fromPlaceKey,toPlaceKey,id}`。保原历史occurredAt用于来源绑定；不对客户端序列化完整world/keys或PrivatePersona。公开contacts关系仅player/world可见，不用private Persona/内部relationship兜底。

初始messages按原at排序，history已读、incoming未读，角色全assistant为作者NPC开场，不制造玩家回复/选择。appointments仅proposed且sourceMessageId回指真实新ID。开场notes仅metadata且必须有非空、player初知/可见factKeys，不塞world.notes冒充用户save。空/私有/未初知依据分别unsupported/invalid；root读取时区分作者开场便签和后续用户便签。

已知space地点/路线可初始化玩家明确startPlace，所有NPC当前位置未知，历史参与者和invite不标在场。路线modeLabel只通用“移动”，不发明开车/走路经历；本地route key稳定按边排序，不按角色姓名或Node先后猜地理。

invalid/unsupported返回`{status,issues:[{code,path}],capabilities:[]}`，不返回partial world。实际支持/缺项：

|可编译|明确拒绝或尚未接线|
|---|---|
|经过校验、无媒体/候选/时间线的2–12已知角色开场|任何media记录/封面头像场景相册引用；任何candidate，包括editorial_only；timeline；runtime_required扩展|
|own Persona与授权关系，owner/各actor精确初始历史|unknown actor公开隔离、Persona/关系超预算、真实actorContext不能保留全部初始授权历史|
|原历史消息时间/阅读状态、proposed邀约与来源、安全known notes|无factKeys的开场便签、超space16地点/route120分钟/name80、超65KB输出JSON预算|
|可信trial0或published>=1、稳定key/UUID映射|实际发布审批/当前permission/摘要绑定真实性、43事务持久化/RLS/回执、DB存在性，root另接|

hiddenContext、编辑说明及editorial扩展只在原不可变内容版本保留，不变世界事实或NPC全剧本。compiled只证明这份开场实际可编译；不意味着媒体、导演timeline、任意任务或发布权已经支持。

## 实际验证与接续

31新增专项和内容原102/独立内容QA92、actorContext、旧official-lives、player-projection共**243/243通过，零skip**。type `tsc --noEmit --incremental false`退出0；341模块边界通过；三个新TS文件Prettier与diff check通过，所有旧world/contracts/features/原tests相对准确880基线未改。首次28项全过，类型检查发现测试辅助函数status经assert.equal已收窄，删冗余永真比较后type过；随后新增总输出预算和trial/pub两项验证（现31），未宽业务断言。两人有效fixture和真实actorContext隔离反例位于新test的content()/input()及前几项，不导入测试执行来当生产素材。

这些是领域/适配器真实函数的合成验证，不是实际PostgreSQL/员工API/线上手机或真实模型。Q没有Repository/新SQL/HTTP、任务执行、数据库、浏览器/模型/图片调用或部署；不会把编译成功当真实发布/已完成。状态先待验收，根全check/build及43/HTTP/源绑定/真实DB/公网证据后才能整体完成。

root/B43接续：消费上述精确端口的world/opening/keys/origin/seedMetadata，在prepare→trusted compiler→commit中核实际pub或trial版本/摘要/许可，真实保存origin与seed绑定、初始snapshot/clock/phone元数据/回执；published_work和publication_trial新seed只安全summary+指针，不造旧tradeoff、不放全私人稿。root接公开contacts/notes读投影（带初知引用和作者来源），不JSON输出完整world，不混用旧Model WorldOpening。人物5区UI交小安，Q不改；未来规则与媒体接线仍必须明确unsupported，用户实际Model流程预算另批。
