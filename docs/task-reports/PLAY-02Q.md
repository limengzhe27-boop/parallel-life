# PLAY-02Q · 创建防剧透、导演入口与事项术语只读审查

日期：2026-10-08。审查主目录基线50fcaca。Agent：codex-play02q-20261008（/root/play_contracts）；主Agent指定只读复核。状态：待验收。

唯一写入范围为本报告及DEVELOPMENT.md本人登记。未改业务、共享契约、UI、SQL或部署；保留LIB-04B在途修改。NAR-02RI、SCENE-01和GROUP-01仍按各自登记推进，本审查不接管其代码。

## 结论

当前创建前确认页展示公开起点与用户选中的现实人物资料；生成后的手机投影却把内部NPC人设作为人物简介直接传给客户端，防剧透尚未形成服务端边界。旧“与导演讨论”实际打开设定表单，而不是独立聊天Agent，但表单与HTTP接口仍真实改写后续导演要求，违反最新入口要求。时间控制与内部导演必须保留，不能整块删除混合面板。

CurrentMatter仅提供绑定现场的当前事项及状态证据，主基线尚无业务消费；它能承接短期任务的一段真实进展，不能充当长期目标、任务图或当前情况描述的完整引擎。数量上限、奖励体系和新的时间制度均未定，本审查不制定。

## 1. 创建与人物信息：目前究竟展示什么

|阶段|实际内容|代码证据与界限|
|---|---|---|
|方向卡与草案|title/premise/opening/tradeoff、推荐理由；身份/地点/氛围；用户自己确认的资料和人物角色|discovery-app.tsx:510、draft-editor.tsx:153、161、265。方向opening在discovery-planner.ts:28被提示为具体但尚未发生的生活场景；只有文案提示，没有防剧透语义校验|
|设定保存确认|上述story/setup、选中事实/经历、人物姓名与现实关系、本分支角色、用户描述前600字、照片带入说明|seed-consent.tsx:17、24、54。没有在此组件展示生成后的NPC persona；用户本来提供的资料不应误判为隐藏NPC设定|
|创建进度/创建结果|queued/running/failed/unknown与ready、打开手机|build-control.tsx:72。WorldBuildSchema（world-build.ts:54）及TaskSchema（api.ts:169）不返回opening或整个人物设定|
|世界生成后的手机接口|identity/setting、所有state.actors的姓名、relationship、summary及头像；消息、便签、邀请、选择|build-repository.ts:243-260、worlds/[id]/route.ts:9。summary直接使用metadata.opening.actors[index].persona，甚至fallback到a.persona|
|手机身份页与人物资料|完整summary进入contact，并在人物页展示|world-app-data.ts:16-21；world-phone-app.tsx:1047；apps/messages.tsx:1216。隐藏UI不能阻止已到达浏览器的数据被读取|

因此，不能声称“创建前确认页正在展示完整NPC幕后动机”；明确的泄露发生在生成后的WorldPhone响应，创建完成者即使尚未打开UI，也可调用该接口。也不能声称目前确认页完全不会透露未来：story.opening、tradeoff是自由文本，可承载过度预告，尚无独立可见起点与后台发展字段。

### P1：人物动机与玩家简介共用同一段文字

world-planner.ts:31和38要求persona包含人物想要什么、不能让步什么、动机及态度；私有试演路径在:86直接把characters.desire写入persona。world-build.ts:123的公开summary允许任意字符串。build-repository.ts:260未经裁剪直接投影，组成完整确定链路。

隐藏动机一旦存在于persona，就会跟着summary送达玩家。这不是跨账号越权，而是同一owner内部导演/NPC知识与玩家视角没有分离。RLS不能解决这个产品知情边界。

### P1：不知道的人、未知关系没有独立可见来源

WorldPhone返回所有state.actors。没有knownToPlayer、公开人物来源、首次接触事件或未知关系标记。私有设定路径把与protagonist有关的relationships.context全部拼进relationship（world-planner.ts:76-85），没有单独的“玩家是否知道”字段。disclosure表示转述允许程度，不能当成玩家已知标记。与主角相关也不自动意味着主角知道。

正面边界也存在：WorldPhone没有返回actorTies、state.facts或完整state；actorContext.ts:46-51只拿当前NPC自己的persona，:88-94过滤事实可见范围，:145-155排除真实profile记忆。应保留这些边界，不为防剧透删除NPC自己的目标与知情范围。

### P1：公开记忆读取是第二条内部知识出口

memory/records/route.ts:6-18允许调用者选择character，缺省甚至没有scope过滤；memory-store.ts:218-255按owner返回所有匹配text，没有玩家观察过滤。postgres-world-repository.ts:52-70确实保存角色belief，sourceType为agent_inference；有回复来源不代表该belief本身已经向玩家说出口。

因此，仅移除summary仍不足以形成完整服务端边界。此处静态链路和合成SQL适配器已复核；未读取生产真实用户记录，不声称生产已有某条具体秘密被泄露。memory POST同样接受character范围（memory.ts:156），至少应把玩家记忆管理与内部角色记录操作分开审查；不能让公开GET或响应再次暴露NPC未公开内心。

profile/export/route.ts:16-28目前导出profile/interview和build元数据，没有导出world state/persona，不应误报为同类世界剧透。

### 最小完整修正范围（建议另立实现任务，由唯一集成人分配）

1. 在world-build.ts及world-planner.ts分开“仅服务端的角色人设/动机”和“玩家已知人物资料”。公开姓名/关系/简介要有公开起点或实际接触来源；未识别的内部人物不能自动列成手机联系人。后台发展可能性和未来结局不得进入公共描述。
2. build-handler.ts保留内部persona和关系供NPC/导演使用；build-repository.ts只能构造玩家projection，删掉persona-to-summary以及任何private fallback。旧世界没有可信公开简介时省略简介或只展示已知称呼，不能从旧persona重新摘要来宣称安全；不要求旧世界重建、不改已发生历史。
3. 裁剪应在服务端projection完成。world-app-data、身份页、联系人页处理省略字段即可，不能靠details折叠、CSS、客户端删除或“不要剧透”提示词当唯一边界。公开人物资料关联要按实际actor ID，不扩散现有按数组index取人设的模式。
4. 公开memory/records读取只交付玩家可读记忆；内部角色belief继续供内部上下文调用。个人档案及依法保存/删除本人资料的能力不取消。对同owner的角色记忆读取/编辑仍需产品范围校验，不能只靠owner鉴权。
5. 同查identity/setting、便签、开场消息、方向opening/tradeoff：公开文本只表达起点、已知线索和可参与机会，不输出后台未来结局。结构分离能防止内部字段直接外传；自由文本的语义仍需真实模型样本审查，不能宣称schema可证明每句话都不剧透。

初始文件候选：contracts/world-build.ts、world/infrastructure/{world-planner,build-handler,build-repository}.ts、可新增纯公开投影规则及专属测试；features/phone/{world-app-data,world-phone-app,apps/messages}；memory/records路线、memory-store的公开读取边界及服务端调用。若需持久可见性字段/动态认识事件，再由集成人分配唯一契约与迁移，不占SCENE-01/0037、GROUP-01/0038。本审查未授权自己写这些文件。

## 2. 用户导演入口：移除与保留的精确界限

|位置|当前行为|建议|
|---|---|---|
|world-phone-app:663、1270|桌面导演图标打开DirectorPanel|移除玩家导演入口；迁出其中时间控制，不能简单删掉全部面板|
|phone-shell:372|真正的management页有“与导演讨论”|移除。该页在:369直接处理management，不走world-phone-app自定义management，后者:1450也有同类旧链接，两处均须处理|
|navigation.ts:5、readRoute|仍认可panel=director深链|兼容旧链接时转到时间/管理页或首页，不重新开放修改；只删按钮不够|
|director-panel:182-277|guidance、themes、故事pacing、focusActorIds、先看影响/应用|删除玩家编辑与影响预演。它是表单，不是已实现聊天Agent，但它真实修改当前分支未来|
|director-panel:114-179|故事时间、暂停/继续、既有1×/2×、有界advance/恢复|迁为清楚的时间管理，保留已有行为；不引入新的时间算法/次数规则。故事pacing与clock.speed是两种不同能力，不能混同保留|
|LifeClient:210、215；direction GET/POST|浏览器读取与写入导演要求|关闭玩家公开修改入口，包括preview:true；关闭会泄露内部要求的公开GET或改为安全状态读取。不要只让客户端停止调用|
|services.ts:134-153；direction-repository:28|POST实际upsert world_direction，后续改变主题、出场、节拍|删除或拒绝公众服务路径，内部调度读取可继续。内部与公众端口应明确分开|
|services.ts:163-178；scheduler.ts:13；world-phone-app:234-268|后台/回归/可见手机有界advance|保留内部导演与自动回访；不能因移除用户导演入口一并停掉。也不能把内部命名含director的变量当成用户UI入口删除|
|分支列表、持久世界、换人生|读回保存世界、进入/恢复/切换|保留。不能借入口修正取消时间、保存恢复或多人生；完整手动存档槽并未因已有数据库持久化就自动实现|

方向POST没有“进入世界后禁止”的runtime条件（direction/route.ts:37-45）。services.ts:152直接写入；directionLines（domain/direction.ts:74）将guidance/themes交给NPC，advance-world.ts:46-48使用pacing，说明不是空壳设置。

另外，时间与当前情况UI有真实性缺口：world-phone-app.tsx:1172固定显示“现实同步流转中”，并不反映clock.paused/speed；:1259-1263固定“第一幕/第一个清晨/已收到邀约”，并非读当前故事阶段。移走混合导演面板后，时间管理仍应读真实clock，不保留这些硬编码状态。现有data.setting取不可变opening.setting，宜诚实标为起点，不能当成更新后的当前情况。

最小入口修正范围：world-phone-app、phone-shell、navigation、director-panel（可替换为时间面板）、LifeClient对应方法、direction路由及其public service边界、导航/客户端/API测试。client.ts有LIB-04B在途修改，services.ts正在交执行集成人使用，必须在该集成人协调下串行改，不能覆盖别人文件。

旧world_direction记录不能静默删除或当作新世界创建依据。移除公众入口后，历史玩家要求是否继续影响未来必须显式确定兼容策略，并区分获授权的创建主题与玩家后期guidance；不应无说明地继续把旧任意guidance当系统指令，也不重写已提交历史。这是上线修正的待定边界，不由审查擅自重置全世界。

## 3. CurrentMatter与用户三种术语如何衔接

|用户术语|含义和可信来源|现有承接能力/限制|
|---|---|---|
|长期目标|玩家想体验的方向或主动认领的愿望，可跨多个现场|story/setup、私有创作protagonist.desire、已保存choice可提供有来源的意向文本；均不代表已实现目标引擎。不要把配角desire、threads.possibleOutcomes当玩家目标或必达终点|
|短期任务|玩家能参与、尺度可结束的当前挑战|CurrentMatter的title/status/evidence可承接当前现场任务及真实进展；必须有sceneId，不能直接承载世界级跨场景长期目标。任务来自玩家认领或事件实际形成，不由UI按次数自动制造|
|当前情况|玩家现在可以观察/已获知的处境和限制|用公开起点与后续玩家可观察事件派生只读描述；不是可勾选任务，不套CurrentMatter五态。不能使用完整导演状态或隐藏动机生成前台摘要|

代码依据：experience-rules.ts:106-114定义CurrentMatter；:438-505定义状态转换及证据。当前仅有scope、sceneId、title、五态和evidence，没有长期目标ID、父子/依赖、期限、完成条件表达式、奖励或跨现场生命周期。主基线搜索到CurrentMatter消费仅在contracts和领域规则；不把已上线契约宣称为可玩的任务系统。现场分支正在开发的仓储/流程不在本次只读审查范围，后续需独立验收。

可直接复用的规则：计划/假设不是尝试；未知状态不是成功；短期完成需相关行动裁定或明确玩家报告；玩家报告保留user_report，不变成独立验证；放弃由玩家明确报告；一个行动不影响无关事项；完成短期事项不自动完成长期愿望；返回手机不等于离场或完成。

最小可行承接是先把当前现场事项用“短期任务”呈现，把来源可追溯的处境用“当前情况”呈现；长期目标先诚实呈现为用户选择的体验方向文本。需要长期目标修改/跨现场关联时，再单独收敛世界级可选目标契约与认领/修改事件，不把sceneId强行伪造或复制为多个CurrentMatter。未决定任务数量；contract数组的技术容量上限也不是玩法限制。“主要一个加零到两个”仍是规划体验假设，不能硬编码为用户已确认规则。

## 4. 验收反例（供后续实现任务使用）

1. 同一NPC的公开称呼正常可见，内部persona含合成秘密标记：创建响应、world GET、联系页、消息页、首屏序列化和memory GET都不得包含标记；NPC自己的服务端上下文仍保留合法目标。检查原始HTTP正文，不只看截图。
2. 人物尚未与玩家相识、秘密关系只在后台存在：联系人/关系简介不提前公开。真正见面/有来源的介绍后才展示；群成员、日程参与人、现场在场不互相推断知情。
3. 旧世界仅有persona且无可信公开简介：能正常打开和聊，简介可缺省；无persona fallback，无强制重建、无历史篡改。
4. 明确用户选择的原本人物和分支角色仍正常显示；创作作者编辑自己设定与玩家获取新世界幕后动机分开，不误删已授权照片/人物资料。
5. 删除所有导演按钮后，旧panel=director深链、旧客户端POST、preview:true和直接GET同样不能恢复玩家修改/读取内部要求；不发起付费模型调用，不改变world_direction。
6. 暂停/继续、已有倍速、手动有界恢复、内部scheduler和回归来信继续按当前合法语义工作；暂停时UI不得写现实同步流转中。保存世界/换人生和已有私聊不回归。
7. “如果我试拍成功”“我想获奖”“让他同意”只能作假设/愿望或NPC待回应输入，不能产生已完成短任务、长期成就或替NPC同意。某任务未知裁定保持未解决。
8. 玩家说“我拍完了”保留自述来源；现场已保存裁定可完成相关试拍事项，但不得完成“成为知名导演”的长期愿望，也不连带更新其他任务。
9. 当前情况根据玩家实际看见的行动后果更新；隐藏NPC想法不进入摘要；创建opening不永久充当第N天当前情况。阶段完成允许休息，不按消息数不断加任务。

## 5. 本轮实际验证与限制

- 已读最新规划第十一节、handoff第二次协调、主表、项目与架构约定，并逐文件核对上述路径。
- 合成内存样本验证：WorldPhoneSchema接受hidden summary，worldAppData把该summary送入contact，legacy director深链可达，三个结果均true。未访问真实用户数据。
- 合成SQL适配器复核listMemories：character belief被返回，查询没有player visibility过滤；公开MemoryEditRequestSchema接受character范围。没有连接数据库，没有实际写记忆。
- 执行现有world-direction、world-app-data、phone-navigation、world-experience-contracts测试，共32项通过。这些测试验证当前行为，并不证明最新产品规则已满足；其中保留旧director深链恰是待更新的旧约定。
- 没有业务改动，本批未运行共享构建/数据库/真实模型/浏览器，也未部署；不借前一任务PLAY-01的测试/上线证明本次缺口已修复。
- 仅报告，提交与上线由当前唯一执行集成人协调。当前线上世界能力未因报告改变。
