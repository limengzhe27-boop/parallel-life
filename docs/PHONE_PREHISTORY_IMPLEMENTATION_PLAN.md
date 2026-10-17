# BOOT-01A：分支手机前史实施方案

2026-10-09；状态为方案待验收，**BOOT-01未实施、未上线**。依据 INITIAL_PHONE_LIFE_SPEC.md；由当前唯一业务集成人冻结公共契约、迁移及实际实施登记。此方案不阻塞正在发布的照片/聊天联合修复，也不决定预设剧本结构、任务数量或时间改制。

## 当前可复用的能力与准确缺口

源码依据为集成候选48942cd，287个冻结源码/测试哈希已核对一致；最新联合发布981c3ad的源码一致性及READY由协调者提供，未据此宣称前史已具备。

|接点|当前实现|BOOT需要补充|
|---|---|---|
|contracts/world-build.ts|WorldOpening为人物、1—4条开场消息、1—5条notes|带来源/时刻/知情/公开边界的有限前史提案；不能只放宽数组数量|
|world/infrastructure/world-planner.ts、build-handler.ts|真实任务生成；服务端绑定人物ID；消息按现实生成时刻倒推分钟；appointments为空|确定故事接管时刻，校验跨材料因果和引用，生成一份基线；不让模型指定真实资产/用户权限|
|world_initial_snapshots、PostgresWorldRepository.hydrate|不可变version=0基线；initial messages/appointments/facts参与读取，后续投影按已提交事件版本读取|安全承接初始notes及明确来源元信息；同ID日程/便签后续修改覆盖，不简单拼接重复记录|
|domain/player-projection.ts、build-repository.ts|选入人物、有来源消息/邀约、可观察现场/群成员可成为联系人；内部persona不可公开；无来源opening notes隐藏|额外有依据的既有联系人与公开关系；有明确主角知情来源的前史便签；继续隐藏幕后动机|
|application/actor-context.ts、memory-store.ts|角色自己的消息、参与日程、可见事实、定域记忆与总预算|带有受众的前史知识/未了结约定；genesis来源合法性，不能冒充真实用户发言或普通world_event|
|phone/world-app-data.ts、notification-projection.ts|真实消息投影；私聊已读主要为浏览器pl_read集合；群聊有真实DB已读版本|服务端初始已读/未读基线；若承诺跨设备，补私聊已读持久接口，不用LocalStorage充当存档|
|media/album-projection.ts、asset-repository.ts|真实ready素材；人物原图按owner/revision绑定，上传日期明确不等于拍摄日期|获准实际素材的故事引用元信息；空图可诚实缺失，pending/failed不能渲染成功|
|domain/world-history.ts|从给定initial按版本重放邀请/便签/私聊/群/现场，重放不执行Outbox|前史仍在initial，后续事件不回填过去；测试重放一致，不把此函数当完整分支继承产品已完成|

上述路径均相对src/modules或src/features，完整文件见实施范围表。历史ARCHITECTURE.md仅供边界参考，其“世界尚未接线”等旧状态不取代当前源码。

## 一份持久基线，若干受权限约束的视图

推荐将经过校验的有限前史与现有version=0快照一同提交；前史本体仍在当前PostgreSQL，不新增第二剧情库。基线对世界唯一，不每次开手机重新生成。

以下是待I冻结的语义字段，并非已添加的API/类型：

|对象|必须承载的内容|运行时约束|
|---|---|---|
|前史头|格式版本、world/seed关联、接管故事时刻T0、时区、提案/素材来源版本、前史条目索引|owner/world由服务器赋值；T0已确定后不可随刷新改变；创建实际时间另存|
|前史来源条目|稳定条目ID、类别、故事时刻或范围、引用的同基线条目、可见受众、来源种类fictional_genesis|ID由服务器在一次提交中分配；局部key解析成服务器ID；拒绝重复/悬空引用，不伪装用户输入|
|已知联系人|actor ID、主角已知的名字/称呼、相识依据、主角可见关系说明|独立于隐藏persona和actorTies；初始“主角认识”不等于全NPC知道彼此|
|过去来信|发件角色、文字、故事时刻、关联约定/素材、初始已读标记|首版只生成NPC→主角来信；不得包含player历史气泡、当前行动或假称已发送的新消息|
|世界背景事实|已发生事实与角色说法区分、发生时间、知情actor集合及主角是否知道、来源条目|预算/地点等公共情境才可能公开；角色私有动机不给主角便签/公开memory；说法仅为belief|
|过去日程|发生时刻、参与者、地点或说明、状态、聊天/事实来源|attended/missed/cancelled只作已成立虚构前史；不填写接管后玩家真实responseAt/Version|
|未来日程|约定时间、参与者、地点、来源、proposed或已有起点内confirmed|新邀请默认proposed；首版可保守只给未来proposed。已有confirmed必须有明确“起点内旧约定”证据与公开说明，不能由一条新邀请自动确认|
|主角已知便签|标题/正文、记录故事时刻、可见依据、相关事实/来信/日程|不能由无来源opening.notes直接公开；预算只来自已确定事实，不把NPC内心或未来结局写入|
|实际素材引用|资产ID/修订、授权来源、用途、故事关联条目；若有故事日期须注明为虚构设定关联日期|只来自批准seed中的实际授权资产或成功项目素材；拍摄时间未知保持未知，不将上传时间改造成经历证据|
|当前未了结线索|引用既有来信/日程/事实、相关角色、已知状态、可回应入口|为既有议程提供来源，不新增固定任务数量；不写未来完成结果，不让NPC自动替玩家答应|

来源条目不是新的世界回合，也不是倒放的玩家命令。沿用genesis:worldId作为组来源，新增必要的条目级来源索引/解析，不能直接把任意genesis字符串塞进要求真实world_events行的外键或内连接。模型只返回局部引用与提案；运行时校验后才能持久化。

## 创建、读取与修改

1. 用户明确确认的approved seed是唯一现实资料入口。向开场模型提供已选虚构设定、人物角色、获准素材元信息；不提供完整访谈、suggested候选或未选现实资料。先确定T0及当前时间政策，模型只在范围内给出相对时间/明确日期，服务器解析。
2. 复用现有world-build Task Queue及有效租约。生成时不持数据库锁。模型提案先做结构、容量、日期、角色映射、重复引用、受众、素材与因果检查，再构造version=0状态和来源索引。服务端再次核对已选素材ready/owner/revision。
3. 在现有queue.commit短事务内一并保存worlds、immutable initial snapshot、人物绑定、前史来源/初始已读、开场元信息、必要记忆记录，以及已有媒体Outbox和任务成功回执。失败全部回滚，ready不能在前史完成前返回。已失效租约不能提交；结果unknown不自动调用模型重付。
4. 重复同commandId同内容返回原任务/世界，异内容冲突；重复seed创建复用原世界。首次重读/开锁/离开再回不生成新前史。条目ID和前史正文在成功后固定。
5. 仓储从immutable initial +已提交事件投影读取。修改日程/便签时按条目ID和提交版本覆盖该项；不能initial appointments +后续整份投影简单相加出现两个旧约定，不能在同一页同时显示proposed/confirmed两个版本。hydration、历史回执读取和replay必须同规则。
6. 初始便签纳入公开投影前先检查playerVisible和来源；现有“无知情来源的opening notes隐藏”保留。新便签仍走已有note.saved事件与回执，首次编辑初始便签需服务器认定版本0，不直接修改初始快照。
7. 所有读写沿用owner/world身份和FORCE RLS。UI拿到裁剪后的联系人、聊天、日程、便签与实际素材，不拿完整前史内部事实/角色persona。不靠浏览器传来的knownActorIds、readIds或assetId声明授予权限。

**持久投影选择建议**：initial存完整小规模权威前史；常用读取尽量复用现有投影。若需新来源/读状态表，限同PostgreSQL中的owner/world附属表，由I分配迁移序号，保持来源只读与RLS。不得提前预留迁移号或把同一条旧消息同时写initial和world_messages造成重复。memory_source_refs等现存来源约束需要显式适配genesis条目，不能伪造用户/回合来源通过校验。

## NPC知情、记忆与回访

角色只能接收其参与来信、参与日程和明确获知的事实。来信发件者可以记得自己的旧约定；另一角色仅同一世界或认识对方，不代表知道这段私聊。玩家知道某事实也不自动广播给所有角色。事实可见范围先过滤，再检索/排序；预算满时保留核心身份、当前相关约定及其来源，不能截掉限定词后改变含义。

首版可直接依托初始消息/日程/Fact输入actor-context，不必为“记住”额外调用模型生成摘要。若持久memory需要前史摘要，其scope限定character/branch，sourceKind必须明确虚构基线，角色私有摘要不能落共享branch并向其他角色检索。仍走现有来源校验、忘记/纠正和blockedSources，不通过直接INSERT绕过deriveMemory把模型句子升级为事实；也不把全部助手来信当canonical。公开memory/candidate边界继续限制内部导演内容，任何前史都不回写profile。

接管后的真输入沿用现有事件、回执、World reducer。首版不创建StoryChoice来冒充玩家已经选择，也不将前史旧约定写成responseVersion=1。回访复用clock/agenda/advance-world/return-followups，初始未了结事项带稳定来源进入议程；冷却、预算、暂停、已有待回应事项及过期邀请规则保持现有政策。不为每个历史条目立即调一次角色，不能每次回来重演同一句开场。

若玩家不回应，允许有来源的NPC询问或环境发展，不自动接受试拍/参加活动/发送主角回复。失败/unknown仍保留原任务和玩家输入。对于超过T0后的旧约定，导演只能基于已提交后续事件更新状态，不因刷新而自动写成attended。

## 未读与故事日期

过去已读为初始固有状态；少量当前未读由明确条目标记，依据当前可回应事情决定，不规定固定条数。服务器返回初始读态与接管后的用户已读。首版若没有跨设备私聊回执，至少初始历史在新浏览器仍默认已读；产品不能承诺后续跨设备已读同步。若纳入本次BOOT完整要求，I须实现世界/会话内单调持久已读与相同命令回执，复用群聊语义但不直接复制其source_version>0约束到version=0私聊。

桌面角标、微信未读与锁屏来自同一投影。展开通知不标读；打开会话按已获授权的消息标读；清除提示不代表玩家完成事项。新消息到达同联系人仍再次通知。按消息故事时刻显示过去/现在，不按服务器入库created_at伪造“刚刚”。T0前的历史与T0后的真实输入可区分；古早年代示例使用对应故事日期与时区，不能取系统Date.now批量替换。此方案复用现时钟政策，不引入新的加速/跨日制度。

## 素材、继承与兼容

有图才展示实际图。选中人物原图保留sourcePersonId和资产修订；历史关联不证明这张图真在虚构事件拍摄。上传日期与故事引用日期分别标注。项目通用素材必须有权限及来源；生成任务只有真实ready资产可入相册。pending/failed/unknown显示真实状态，缺图允许没有相册项；正文不得承诺“已经拍好照片”作为生成成功证明。刷新/replay不执行媒体任务；删除/修订失效按现生命周期拒绝或显示缺失，不复活原图。

旧世界缺少新genesisVersion时走legacy读取，保留原不可变快照和有限开场；不补写几天历史、不批量公开旧opening.notes、不臆测既有关系/已读、不清旧portrait。若将来允许用户补前史，必须单独明确命令与新版本/新分支，不更新immutable initial。现有openingMessagesForDisplay仅保留旧同刻小批次兼容，不能重新排列有明确时刻的新前史。

来自作者预设的演绎只携带授权虚构内容及可用项目素材，建立新owner/new world的独立初始基线；不复制作者访谈、私人角色记忆、其他玩家操作或其个人照片。跨世界续接/分支若尚未有完整产品接口，就只提供接入要求，不声称已支持：目标world的actor/message/source ID重新映射，父世界来源仅作内部继承证据，重检资产权限，events从该世界起点续写；读态按新世界单独初始化。多人共享也不能从前史默认授予新成员观看历史私聊。

## 可以据此拆分的实施范围

下表为待I冻结的工作包，**不是已领取任务或允许任何Agent直接开工的登记**。公共契约与迁移先串行，其余只有准确范围不重叠才可并行。

|工作包|候选文件与交付|前置/负责人边界|
|---|---|---|
|基线契约与来源|src/contracts/world-build.ts；src/modules/world/domain/types.ts及新增纯前史校验/规范化；若需来源/已读表的新增迁移|I负责冻结数据格式、条目ID、受众、故事时间、legacy策略及迁移；先处理PHOTO-QA资料隔离P1|
|生成与事务|src/modules/world/infrastructure/{world-planner,build-handler}.ts；现有build任务组装；独立纯/真实PG专项|契约冻结后一个负责人；不能与PHOTO/PLAYER仍在写的文件重叠；复用现队列，模型额度由I协调|
|读取与编辑|src/modules/world/infrastructure/{postgres-world-repository,build-repository}.ts、domain/{player-projection,world-history,notes,invitations}.ts；必要来源解析服务|同ID覆盖及replay/回执统一由一个接线负责人；不要各仓储各自决定前史真实性|
|角色记忆与议程|src/modules/world/application/actor-context.ts、domain/agenda.ts；src/modules/memory的来源校验/仓储，必要turn-planner接线|依赖合法genesis来源、受众和事务；涉及memory契约/RLS交I串行。初期不新增独立长期任务引擎|
|只读手机与已读|src/contracts/world-build.ts的裁剪查询由I；src/features/phone/{world-app-data,notification-projection,world-phone-app}.ts(x)及具体聊天/日历/便签显示；私聊已读API若纳入|共享caller/client由I统一；展示执行者不写源数据，不重复搭外壳；导航/滚动恢复保持|
|素材关联与验收|src/modules/media/infrastructure/{album-projection,asset-repository}.ts必要扩展；专项tests及各任务报告|依赖PHOTO用途验收和真实资产；无图不阻塞合法文字前史；模型/PG/公网资源各自登记|

不需要改探索原型服务、不加SQLite、不引入内存生产Repository、不换Task Queue。具体迁移编号、任务ID、测试库/端口和执行者由I在唯一主表登记；此文不占其资源。

## 可执行验收场景

所有内容都是合成设计样例，**未运行真实模型/数据库测试**。身份A为导演，身份B为异地返乡者；两者不共享故事模板或私人资料。

|场景|预期与必查证据|
|---|---|
|导演正例|T0前制片人说场地保留到周五，摄影师曾确认器材；过去勘景有来源；明天试拍邀请proposed；预算便签来自公开起点事实；当前催场地来信未读。首次手机查询能将聊天/日历/便签对应到同基线|
|返乡者正例|旧同学上周来信、过去一场已取消约定、未来家人邀约待回应、已知交通资源便签；不复制导演的预算/人物/台词。历史事实与T0一致，照片只用此用户获准实际素材|
|NPC承接|向A制片人问“周五之前能保留吗”时知道其自己旧约定；询问未被告知的摄影师场地私聊时，不表现全知。测模型输出与实际actor-context过滤后输入|
|接管边界|玩家未回应邀请，刷新/推进/离开再回均不生成玩家答复或accept/attend；输入“先取消试拍”后真实command/event改变后续，旧前史正文不被改写|
|原子失败|未知actorKey、重复条目、悬空引用、T0后伪旧消息、跨账号素材、过期修订或提交前租约失效：整体拒绝，无半套world/基线/绑定/日程/成功回执；失败诊断脱敏|
|幂等与并发|同命令重送/查询/重启worker只一份基线；异内容同ID冲突；两任务提交竞争、unknown、cancel按现有队列规则，无额外模型收费自动重试|
|日程/便签更新|初始proposed→用户真实accept后仅同ID confirmed一次；再取消仅cancelled一次；初始note编辑并重放只有最新正文，同时initial仍原文；历史回执版本读不混入未来事件|
|前史假知识|角色私有欠款/幕后动机不能出现在玩家便签、联系人summary、公开memory或另一NPCcontext；助手说法不变canonical；所有profile和suggested资料在前史前后完全不变|
|未读一致|历史已读在新浏览器仍已读；当前未读桌面/微信/锁屏一致；展开不清、打开定位才读；新同联系人来信再次通知；若做跨设备持久已读，刷新/多端与回执单调通过|
|故事日期|T0设为1998年的合成样例：消息过去、邀约未来、页头故事日期一致；UTC存储和当地显示一致，跨午夜/时区排序正确，不出现现实2026“今天”混入；不改变时钟推进政策|
|真实素材|actual ready图可HTTP授权查看；pending/failed无成功项；上传日期不当拍摄证据；删除/修订后不复活；跨账号/world读取拒绝，不向作者/另一玩家开放照片|
|旧世界/重放|旧baseline读结果保持；新baseline＋后续事件重放等于当前权威状态；只读replay不调模型/媒体；source映射/遗忘屏蔽维持，刷新/reentry正文哈希不变|
|预设继承|两个玩家从同一获准虚构预设创建独立world：基线因果可一致，命令/读态/后续/私有素材不互见；作者私人访谈和其他玩家记录为负样本|
|上线旅程|至少两独立合成身份实际模型生成、真实PG事务/RLS/队列/回执、390px短屏和PC打开四应用/通知定位/滚动/返回；生产迁移一致、READY和正式公网刷新/角色承接通过后才完成|

应保留初次失败及显式跳过，禁止用内存计算/fixture模型/本地build充当以上真实证据。长历史测试验证过滤优先、输入预算、同ID合并与当前相关约定召回，不只统计条目数量。

## 集成人接续

先解决PHOTO-QA-02三项现实资料污染反例并完成当前联合发布验收；随后冻结前史格式/来源、T0解析、公开知情与私聊已读承诺范围。按上表精确分配BOOT实施，公共文件先串行，再独立工作树执行。实现交待验收；迁移、真实模型/PG、双端、READY/公网都闭合后才能把BOOT-01标完成。BOOT-01A仅交规划，不改变当前产品能力。
