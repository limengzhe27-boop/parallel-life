# CHAT-SESS-01 · 多聊天影响与无损迁移审查

状态：待验收，仅审查交付，不是功能完成或上线。2026-10-09；Agent codex-f-01a0c7c8-chatsess01-20261009，会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。已读MULTI_CHAT_PLAN与CHAT-SESS-00—06，按主目录.local/agent-board.lock先登记进行中，再审查。只写本报告与本人主表行，不改方案、业务、契约、迁移、配置或他人报告。

## 冻结与证据

基线eabd0255cab9d9cb554f0825d1acecd76f68f61c。独立只读快照/private/tmp/parallel-life-chatsess01-eabd025，从git对象提取src/tests/db/scripts/package.json，450个文件逐个SHA256核对，收尾复核无差异；没有环境文件、密钥或用户照片。主目录client/interview-app在途WIP未采用。证据主目录.local/chatsess01/snapshot-manifest.json。

62个准确既有影响路径均存在、无重复，file-inventory.json保存分组，完整清单见文末。本轮5项实际context/schema纯观察、0模型调用，context-observations.json保存结果：旧发送schema仍可读；带interviewId的新发送/构思字段被现有strict schema拒绝；当前B消息的上下文会读入共享people中A的中性故事照片标签；confirmed档案事实仍进入上下文，context没有接收遗忘状态的输入。这些是既有函数的合成输入观察，不是数据库、API或多聊天已经实现的验证。

未启动数据库、HTTP、浏览器、构建或模型，没有修改生产Repository。未运行npm check/build：本轮仅只读审查，不抢I资源；格式检查与报告路径验证已做，不能引用先前构建冒充本轮。只为纯观察在独立临时快照建立依赖软链接，不共享构建缓存。

照片顺序优先：PHOTO-QA-03原28观察/6失败及原基线证据保持不改；收到明确修复冻结提交后优先复验，再继续后续审查。目前本报告不采用I在途照片代码，不把新增聊天规划代替照片验收。CHAT-SESS-05未领取。

## 主要结论与方案需要补充的点

### S1：不能先解除唯一约束，再继续运行旧代码

0001_foundation.sql:13创建interviews.owner_id UNIQUE；IdentityRepository.ensureGuest:38使用ON CONFLICT(owner_id)，不是只在首访才运行的安全假设。删掉独立owner唯一约束后，旧语句没有冲突目标，会报错；留下约束又不能创建第二聊天。readWorkspace:38及send/sendStreaming仍SELECT owner后取rows[0]，不能新增第二条记录后靠“第一行/最近一条”充当默认。

建议02拆为扩展与收缩两步，开放多聊天创建的门槛必须包含03/04，而非02单独上线：先保留owner唯一约束新增元数据/稳定默认映射；部署兼容初始化及所有显式定位入口，创建多聊天仍关闭；再解除独立owner唯一约束、验证新写入、开放功能。生产不得同时服务依赖旧ON CONFLICT(owner_id)的后端。旧部署回退也不能简单回到旧二进制；收缩后的回退应是兼容多聊天数据但关闭新建的版本，不能删除新聊天来恢复唯一约束。

### S2：后台任务的作用域存在，但读取上下文会取错

interview-handler.ts:60检查input.interviewId等于lease.scopeId，:61却readWorkspace(sql,lease.ownerId)。单访谈时恰好一致；多访谈会读默认或任意行，轻则VERSION_CONFLICT，重则在数值版本相同的情况下混用上下文。只修HTTP接口不够。

显式读取必须验证owner+interviewId、任务scope、inputMessageId确属该聊天，并对最终助手写入/问题回答/来源一并校验。现有interview请求hash已经含interview.id，保留该保护；task-repository.retry继承old.scope_kind/scope_id/input，应继续指向原聊天，不使用当前选择。旧入队任务缺新字段时按原input.interviewId或稳定默认映射解析，不批改task ID、command、hash或已接受调用。

RLS目前约束owner与有效租约，worker_owns并不区分同一owner的聊天。共享profile是合理的，但owner权限不代替聊天的最终业务校验；不能用宽读加模型听话维持隔离。

### S3：当前乐观锁并不覆盖全部共享资料写入

applyPeopleInTransaction:523读取profile并比对expectedProfileVersion，慢回合会跳过人物更新；applyBasicInfoInTransaction:177没有expectedProfileVersion参数，锁当前行后直接替换姓名、城市、职业等。生日有单独的冲突/精度保护，不能据此宣称其他字段也不会被慢回合覆盖。流式与后台均调用该入口；多个聊天的访谈版本独立后，共享profile并发会更频繁。

冻结统一资料写入策略：基于提炼开始时的profile版本验证、保留手工修改及较新确认，允许安全合并来源，冲突更新保留待审/明确未写入结果，不自动再次调用模型。不能只有人物静默跳过而任务仍succeeded、回复却称资料都已记好；需定义任务成功与资料未采纳的可见状态。用真实PG控制A/B模型完成顺序和手工编辑穿插，不以行锁证明语义不覆盖。

### S4：主题拒绝与遗忘需要补持久且统一的入口

interview_question_blocks由(owner,interview,target)索引。skip/dismiss不会插入block；只有block操作代表主题拒绝。升级应把既有显式blocks按owner取并集，保存原聊天/问题作为证据，供所有新旧聊天的上下文与最终createQuestion共同过滤。不能仅在新建时复制一次：A后来拒绝时已存在的B也必须生效。用户恢复讨论需明确、幂等的解除动作与权限，不能推断“新建=解除”。单open索引实际是(owner,interview)，无需误改成全owner只允许一个问题；问题source/answer触发器已检查同访谈，保留。

公共forget路径最终只更新memory_records状态；访谈planner.context直接读取confirmed profile事实、全部events/people及当前消息，没有使用forgotten/superseded来源过滤。只把记忆状态改掉，不会自动让profile中对应内容退出prompt。deriveAndStoreMemories只查active记录，旧来源未屏蔽时再次提炼也可能重新建active记忆。流式路径的confirmed候选写入与后台deriveAndStoreMemories接线不同，不能假设二者都有等价记忆记录可遗忘。

03需冻结“遗忘的是记忆、档案条目还是来源”并协调同源屏蔽：prompt构建、原始历史、共享profile检索、候选与最终写入均执行；拒绝候选、删除事实/人物及更正不得从另一聊天的旧source重新恢复。保留真实原文可导出和证据ID，不需硬删除旧聊天。现有世界不可变快照与现实资料遗忘是不同边界，不能顺手改写旧世界。

### S5：共享现实人物与聊天里的故事标签尚有歧义

当前story photoLabel也写全局profile.people，relationship=照片人物；planner把所有people送进profileNotes，虽标user_photo_label，仍会在B读到A的标签。纯观察已证实。MULTI_CHAT_PLAN的“现实资料共享”和“暂定人物身份隔离”不能仅靠history过滤实现。

I须明确中性标签可跨聊天展示/引用的条件，以及现实已入档人物、某聊故事角色身份的区分。可利用现存sourceQuotes中的interviewId和新的来源分类/映射过滤，未知历史标签不自动提升为现实关系。跨聊可显式选择已授权人物或素材，仍不据名称猜图；新上下文只带必要有效内容。不能把所有people都当成共享现实身份，也不能删除旧已授权世界所需人物和照片。

### S6：构思版本、任务、草案与不可变来源必须一起隔离

0004_discovery.sql以profile_id为PK且owner UNIQUE。readDiscovery owner-only；handler按profile_id覆盖document，任务kind=profile/scope=profileId。PrepareDraft按owner+directionId+discoveryVersion定位，0028唯一键同样缺聊天；SeedRepository.approve再次读取全局discovery并以当前版本验证。只给GET添加interviewId或只保存UI选项均不足以防覆盖。

建议每聊有稳定构思聚合ID与版本，并有不可变修订/依据来源；聊天消息归属、共享profileVersion和构思版本是不同维度。basedOn必须是该聊所选修订中的方向，不能读另一聊最新方向。新草案用源聊天/构思聚合或修订定位，仍可全局分支列表；审批时固定草案版本、资料授权、照片revision及源聊信息。

任务语义需冻结：不把interviewId塞入TaskScope.profile.profileId字段。若新增discovery任务kind/聚合scope，要一起改SQL CHECK、publicTask/TaskScope、worker-composition路由、claim kinds、租约策略及兼容旧profile discovery任务；若仍采用profile任务互斥，需明确跨聊天构思串行限制且结果/任务读取按聊天，不误称已支持各聊独立并发。新建/改名不调用模型，采用事务元数据回执，不伪装访谈模型任务。

旧全局discovery仅保留当前document，之前被覆盖的完整方向无法无损重建。可保留当前legacy版本、已存草案/seed故事和task输入依据，不把这些片段拼成一套伪造的历史提案。规划中的“稳定历史记录”应明确能保存什么、哪些旧历史本就不存在。

### S7：不可变表不能直接UPDATE补源聊天

approved_seeds有BEFORE UPDATE immutable触发器；confirmed life_drafts也拒绝UPDATE；world_initial_snapshots不可变。迁移新增source字段后对全部旧行UPDATE会触发保护，不应禁用触发器冒称无损。

建议旧记录通过独立、受owner复合FK/RLS保护的来源映射附加legacy默认聊天，保留原document/hash/版本/ID。新记录写入新的来源字段/映射，旧strict schema保持可读；源聊天、方向/修订、真实sourceMessageIds和当时授权快照都要关联。来源映射不能只由模型或客户端填写，要从所属owner、旧默认、已有draftRef/seed/build关系核对。试演setting_draft源及公共设定实例有自己的来源，不能全部强挂为个人聊天。旧世界genesis、NPC消息、重放、fork和素材授权不变，只读审计其新旧seed解析兼容。

### S8：切换聊天不仅是保存两个草稿

interview-app里的draft与pending-photo storage key当前只有profileId；pending.current command、selectedPhoto、photoCaption、outgoing、token、task轮询是组件级。apply按interview.version比较而不比较interview.id；A高版本结果晚到可覆盖B低版本。ProposalThread的workspace/discovery重读与异步回调同样没有目标聊天参数。

公共client方法应每次显式接收冻结的interviewId，不以可变client.currentChat/cookie决定在途请求目标。每个聊独立保留draft、原组合、File/object URL（仅页面存活）、asset、command、task及版本；响应、token、错误和poll写回前校验目标ID与本次请求。换聊不自动重付或把A失败照片与B草稿组合；已有照片回执先读A，刷新未知命令的恢复策略须在03冻结。仅给React加key不能解决公共client取错作用域；流式切换和响应取消也须与后端任务状态一致。

### S9：元数据、分页、配额与导出不能省略

新增title/updatedAt和元数据版本。建议改名使用metadataVersion，避免改名递增访谈消息version让正在生成的回应冲突；首条已存用户消息才生成有界原文标题，不额外付费，不把临时token当更新时间。列表用稳定(updatedAt,id)游标，账号级创建限流/数量门槛与命名长度由I冻结，不能靠新建绕过档案/照片/草案容量。

profile/export现在get唯一workspace最多200消息，builds也有列表上限，并catch后给null/空数组，不能称全量。新导出遍历本人所有聊天与按ordinal分页的全部消息，记录来源/元数据和真实失败，不静默截断；升级导出格式，同时说明旧格式兼容。模型预算继续只包含当前聊天有界历史与有效共享资料，不把导出的全历史送给模型。

## 旧ID无损与旧入口稳定策略

1. 以现存interviews.id直接作为聊天ID，不另建重复conversation实体再搬消息。保留所有消息ID/ordinal、人物sourceMessageIds/sourceQuotes、question/answer、candidate.source_scope_id、memory_source_refs、task.command/hash/scope/input，以及seed/draft/world IDs。增量迁移不重写已执行历史SQL。
2. 建稳定owner→default_interview_id映射，或等价的显式默认机制；使用(owner,interview)复合归属FK、owner RLS和事务初始化。旧账号默认指向其唯一原行，新账号默认创建一次；ensureGuest并发由账号锁/映射唯一回执协调，不再依赖被移除的owner唯一。映射不得因新建、最近更新时间、某标签页选择而变更。
3. 无interviewId的旧GET/send/question/discovery/draft/seed入口只解析稳定默认；显式其他聊请求必须验证owner，不默默回退。旧请求原回执重放仍返原结果。Interview hash已有目标ID；discovery新hash需目标聚合/聊天，旧hash兼容仅允许原默认/旧input版本，跨聊天同command冲突，不能改旧hash后否认其回执。
4. 所有legacy discovery/current version关联默认，保留旧profile-task适配；不可变draft/seed/world用来源sidecar。准备迁移时核对行数、源ID集合、外键、原document hash和当前迁移checksum，采样不是无损证明。旧正在执行任务需有兼容提交路径或可核验的受控排空；不能迁移快照后让旧worker继续把结果写到被遗弃的legacy表，也不把unknown自动排空为重付。
5. 02扩展→03定位/记忆/照片→04构思/来源完成并真实库验证后，才收缩单访谈唯一、开放新建。可在同一发布批串行实现，不允许生产出现“可创建第二聊但旧读路径仍owner-only”的窗口。照片与首页先按现有顺序完成；05等03/04稳定契约且I释放interview-app后独立树开发；06真实PG/模型/双端/READY公网后才完成。
6. 默认映射或同owner合法显式聊天不存在时明确失败/修复初始化，不使用最新一行修补；无硬删除首版保留默认不漂移。来源丢失/未知legacy修订诚实保留，不猜。

## 推荐冻结的接口与任务交接

接口名称由I统一定稿；建议新集合/详情、新建、改名、按ID消息/问题/构思入口，并保留旧稳定默认接口。显式请求路径与body若都带ID必须一致；返回workspace/task/proposal带可核对目标。历史列表元数据不带全消息或私密访谈内容，详情可沿用有界窗口；导出另走真实分页。

02给05的交接不能只有schema：需给新建回执与重放规则、列表游标、标题metadataVersion、默认解析、每页当前选择恢复、API中目标ID传法、stream事件归属、pending照片/命令恢复、profile冲突与主题拒绝/遗忘可见状态、构思/草案目标来源及legacy兼容样例。新API及专属仓储、增量SQL、UI列表模块为待I冻结的新文件，不当作已存在或已实现；文末既有清单是影响面，不是本轮扩大写授权。

## 实施负例验收矩阵（尚未运行）

|编号|真实验收安排|应观察到的结果|
|---|---|---|
|M01|旧有任务/消息/人物/问题/记忆/草案/seed/world升级前后全ID及document hash对比|原ID、来源与不可变内容不变，完整源数量一致|
|M02|解除owner唯一前后ensureGuest并发/重试，新建双击及响应丢失|唯一稳定默认；新建同command一个新聊；无ON CONFLICT错误|
|M03|A新增/改名/发言，B选中；两个标签页刷新及旧无ID请求|旧入口始终原默认，每页选择独立，显式B不变A|
|M04|伪造另一owner chat/question/source/asset/proposal及worker错误scope|读写拒绝；最终事务与RLS验证，不只HTTP参数检查|
|M05|A后台排队或stream途中切B，A/B版本刻意相同/不同|A上下文、token、消息、task和错误只属于A，B不被高版本覆盖|
|M06|旧入队interview/profile discovery/memory任务及unknown显式重试|原target/hash/input兼容，不改目标或自动重付|
|M07|A两图+B单图，分别补第一/第二/这是，另传跨聊source ID|各聊只取自身照片来源；跨聊拒绝，明确共享素材另校验授权|
|M08|照片QA03原问句/否定/转述五例＋肯定对照，各聊均运行|拒绝含糊断言，肯定关联真实唯一持久人物|
|M09|A上传延迟/503时B写新草稿，回A重试；asset已存但SSE丢结果|只重试A原图文，B草稿保留，先读A旧回执，不重复上传/消息/模型|
|M10|A/B各open问题，B回应携A question ID/version；新聊并发open|答案不串；每聊单open，两个聊可各有open|
|M11|A block主题，已有B/新C继续；skip/dismiss对照及明确解除|拒绝全owner生效，临时skip不全局封锁，解除有真实回执|
|M12|A已忘记/拒绝的来源在B历史/profile/events/people及再提炼入口|prompt和最终写入都不能恢复；用户明确新陈述采用有来源的新规则|
|M13|A慢回应、B或手工修改城市/职业/生日后A提交|较新编辑保留；冲突未写部分可见，不称全部记住，不重付模型|
|M14|A故事导演身份/教导主任照片标签，B现实职业；随后新C|故事身份不污染现实，非相关故事标签不默认进入新聊天|
|M15|A/B同时构思、basedOn另聊方向或旧修订；返看各自历史|独立版本/任务/结果，错源拒绝，不用B最新结果覆盖A|
|M16|A/B prepare/save/confirm，交换direction/version/draft/seed IDs|草案唯一键和审批来源匹配，已确认快照不重写|
|M17|旧全局提案被覆盖已有草案/世界，default源映射回读|保存确实存在的当前记录和片段，不虚构全部旧提案历史|
|M18|同command跨聊复用；命令重放含当前profile已变化|跨聊冲突，原target返原回执，不能返回另聊结果|
|M19|改名时模型运行、首条失败/未提交消息、排序分页同时间多行|不干扰消息version，未保存不自动命名，游标无漏重|
|M20|>200消息、多聊天、大量build及读取故障导出|全量分页且明确失败，无catch空数组假成功；不会全量送模型|
|M21|已有世界replay/fork/人物照片授权/公共设定试演|旧手机内容及授权不变，个人聊天来源不覆盖setting_draft源|
|M22|账号配额、空聊创建、不完整源映射迁移后重启及回滚|不绕过限流/容量，不调用模型，兼容版本回滚不删新聊天|
|M23|390/560短屏/PC，多聊切换、软键盘、失败和历史空/加载|输入/照片/导航可用且独立；真实操作后刷新恢复|
|M24|完整check/build、真实PG并发/RLS、合成真实AI及生产READY公网|旧默认及新建→A/B图文→构思→world全链闭环后才标完成|

## 本轮交付与接续

完成只读影响面、迁移与发布门槛、旧入口默认和24组负例设计；未实现多聊天、未跑矩阵、未做真实PostgreSQL/模型/线上验证。不把纯context观察或hash核对计入生产功能测试。下一位I先完成照片修复/复验与上线、首页接线上线，再采纳本审查冻结02—04。辅助等待照片冻结复验通知，以及后续05的契约/文件释放，不先写UI。

尝试向I对话直接同步具体风险被系统自动审批拒绝，理由是缺少本轮用户对该具体线程消息的直接明确授权；消息未发送，不绕过拒绝。报告与主表按已授权范围照常完成。根协调随后明确由其读取本报告并经其已授权的协调渠道转达I；本人不再重试直接发送，也不为这条中间消息另行打断用户，拒绝记录保留。

## 准确既有文件影响清单（62项，均已核对存在）

以下分组是建议I冻结范围的审查依据，包含必改与需回归核对项，不代表每个文件都必须修改；世界/NPC编译尤其以保留隔离为主。历史迁移0001/0002/0004/0005/0009/0010/0011/0013/0015/0028/0031/0036已审查，不在此授权修改；新增迁移编号由I串行分配。

### 02/03 contracts

- src/contracts/api.ts
- src/contracts/memory.ts
- src/contracts/discovery.ts
- src/contracts/life-drafts.ts
- src/contracts/seeds.ts

### 02 identity/init

- src/modules/identity/infrastructure/identity-repository.ts
- src/app/api/v1/session/route.ts

### 03 interview/profile

- src/modules/profile/infrastructure/interview-repository.ts
- src/modules/profile/infrastructure/interview-handler.ts
- src/modules/profile/infrastructure/interview-planner.ts
- src/modules/profile/infrastructure/profile-repository.ts
- src/modules/profile/application/person-extraction.ts
- src/modules/profile/application/basic-info-context.ts
- src/modules/profile/application/fact-quality.ts
- src/modules/profile/domain/profile-view.ts

### 03 memory

- src/modules/memory/infrastructure/question-repository.ts
- src/modules/memory/infrastructure/candidate-repository.ts
- src/modules/memory/infrastructure/memory-store.ts
- src/modules/memory/infrastructure/memory-repository.ts
- src/modules/memory/infrastructure/memory-handler.ts
- src/modules/memory/infrastructure/command-receipt.ts
- src/modules/memory/application/edit-memory.ts

### 03 routes

- src/app/api/v1/interview/route.ts
- src/app/api/v1/interview/messages/route.ts
- src/app/api/v1/interview/questions/route.ts
- src/app/api/v1/profile/export/route.ts
- src/app/api/v1/memory/records/route.ts
- src/app/api/v1/memory/candidates/route.ts

### 03/04 queue/composition

- src/modules/tasks/infrastructure/task-repository.ts
- src/modules/tasks/infrastructure/postgres-task-queue.ts
- src/server/services.ts
- src/server/worker-composition.ts
- src/server/run-task.ts
- src/server/http.ts
- src/server/limits.ts

### 04 discovery/seeds

- src/modules/discovery/infrastructure/discovery-repository.ts
- src/modules/discovery/infrastructure/discovery-handler.ts
- src/modules/discovery/infrastructure/discovery-planner.ts
- src/modules/discovery/infrastructure/draft-repository.ts
- src/modules/discovery/infrastructure/seed-repository.ts
- src/modules/discovery/infrastructure/profile-photo-roles.ts
- src/app/api/v1/life-proposals/route.ts
- src/app/api/v1/life-drafts/route.ts
- src/app/api/v1/life-drafts/[id]/route.ts
- src/app/api/v1/life-drafts/[id]/confirm/route.ts
- src/app/api/v1/life-seeds/route.ts
- src/app/api/v1/life-seeds/[id]/route.ts

### 05/06 UI/client

- src/features/api/client.ts
- src/features/interview/interview-app.tsx
- src/features/interview/photo-share.ts
- src/features/interview/photo-send-state.ts
- src/features/interview/proposal-thread.tsx
- src/features/interview/branch-entry.ts
- src/features/discovery/discovery-app.tsx
- src/features/discovery/branch-list.tsx
- src/features/discovery/draft-editor.tsx
- src/features/discovery/seed-consent.tsx
- src/features/discovery/build-control.tsx

### 04/06 immutable world audit

- src/modules/world/infrastructure/build-repository.ts
- src/modules/world/infrastructure/build-handler.ts
- src/contracts/world-build.ts
- src/modules/memory/application/compile-context.ts
