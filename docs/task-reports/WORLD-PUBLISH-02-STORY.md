# WORLD-PUBLISH-02-STORY · 真实来源驱动的剧情侧car

2026-10-12；Agent codex-publisher-story-02-01a11a84-20261012。主表已短锁接续准备，独立 /Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本，codex/world-publish02-story，准确b47f9a3635cc406bd11c09ef4c65c4711e2d197d。不夹根WIP。仅新0046_publication_story.sql、新settings/domain/publication-story.ts、新application/publication-story-ports.ts、新infrastructure/publication-story-repository.ts、新pure/真实PG专项及本报告/本人行；公共contracts/compiler/server/47媒体、旧world/runtime只读。55478确认无监听，尚未启动；不复用旧43 cluster，0生产/模型/图。

## 给根冻结的具体端口/SQL方案

PublicationStoryRepository(appDb)：prepare(ownerId,worldId)→内部单一eligible node claim{claimId,nodeKey,commandId,actorId,intent,editorialIntent,origin}或none/busy/unknown；stablecommandId先落库，模型调用不在事务内。finish(owner,world,claimId)不收raw model output/approved/status，只核实际同world/owner/actor/stable command的succeeded command+world_event version>0+assistant message来源；邀约另核实际source invitation，单NPC参与者，不替其它角色承诺。reconcile按真实invitation.responded与故事时钟读取回应/过期，skip需明确owner命令并存侧car回执，unknown不自动重付；迟到成功能用同source回执finish恢复。

新46侧car拟plan（精确43 binding的immutable draft/formal/origin，裁剪timeline/candidates/stable key映射/可核history基线，不存完整hiddenContent/Persona）、node states+stable claim、source audit/outcome receipts。初始化窄definer核owner/world，直接从同binding version/hash裁剪，app不能SELECT全稿。actorKey→initial actorId必须稳定key映射且验证初始snapshot/contacts，不按重名合并；历史参与者不能代表知情。根新compiler若需要未来unknown actors，应保存/提供可信namespace映射；旧已支持稿可直接通过opening.contacts key与snapshot actorId核对。普通玩家与独立staff试演owner各自侧car；pub不获得任意player表权限，staff可由合法trialSession通过正常app池初始化。

纯领域按storyNow、stage afterStageKeys、有效窗口半开区间[notBefore,expiresAt)、实际history fact来源/可见性、前序真实outcomes、currentPlaceKey、互斥与exclude/alternative计算资格。editorial_only永不执行，不靠初始化/director选中标完成；阶段只有实际节点来源/明确跳过/故事window过期才推进。没有timeline沿非staged候选规则；无节点无伪故事成功。

待根确认：after_committed_node/outcomes committed的message含义。建议实际message呈现保存后node outcome committed表示“呈现事件落库”，presentation='presented'且playerCompleted=false；邀请则只有明确玩家accept/attend才committed，不能offer后即完成。若message presented不允许满足committed，需要新增公共presented前置，否则首消息→后续常见稿会永久堵住。公开progress仅当前已呈现source/status，不泄露未来plan；selected editorialIntent仅可信服务器单NPC提示，不整份剧本下发。

其它边界已发现、待冻结时明确：runtime appointment.proposed只有title/at/participantIds，无place字段；planned place不能当实际到场/行程事实，at_place依赖真实地图位置。pending/unknown若窗口关闭仍不能自动重付或把未知当失败，应保留未决attempt以便同command源恢复。actor map不假按姓名推断；空/editorial-only阶段无窗口时需明确owner skip或报告不支持，不自动清零“已完成”。

当前只读准备与接口提案，没有46源码/SQL/模型执行或通过验收证据，等根精确冻结语义后实施；不再写泛化后台规划。

## 实际进展（已按根冻结实施，不再停在只读提案）

基础domain/ports/12 pure已冻a48fb3ccff3085f12d1075bca16b27c62e0707e1，场景brief端口小后继e7406ee734c630fa64c6f6f672e3b0858451694a，根已接。46三新表plans/nodes/immutable receipts及窄source/plan-store/clock函数、本Repository和真实PG专项已在本人树实现WIP；新表owner FORCE RLS，app仅新table范围select/节点写/审计insert，pub/worker全拒，无旧权限扩张。初始化仅裁剪版本绑定timeline/candidates/history/key maps，不返full hiddenContext/privatePersona，精确初始namespace映射逐项校验源/actor visible canonical ID，不按名字/关键词合并。实际planned place仅在source invitation已offered后读link，不预写world或arrival。

默认prepare一次保存stableclaim与command/expectedVersion，none含managed false/true供根防止计划等待回落generic auto；unknown只回查实际receipt，不重复模型。message真实同actor/source/command已呈现才outcome committed但playerCompleted=false；邀约真实participant/title/时刻匹配才offered，实际accept/attend才committed，cancel declined/miss expired，反应变更跟随真实来源不假玩家goal完成。public progress不露未来节点title/指示/分枝；sceneBrief只当前已实际offer并有效的单NPC片段。自动10故事分钟/每日3，manual可明确，retry不改变原cmd/expectedVersion。

本人55478独立新cluster已启动、dev/test46迁移本地应用。首次SQL source.guard text world command_id与uuid node command_id比较的42883已精确修本人46 cast，不放宽proof；初始skip测试误期待after_committed在skipped后满足，已改本fixture为明确after_resolved skipped条件，不改资格规则。随后真实PG20/20、12pure/type0；进一步增强plan-store真实actor/key/history IDs+visibility与claim/presentation窗口/排除实际source guard后正在最终复验。所有WIP migration重建只本人全新synthetic local dev/test，不改生产/shared世界。没有付费模型/图，剧情效果都是明确synthetic proposal，经真实WorldRepository/reducer/事务保存，opening由实际Q纯compiler初始化（local trusted adapter只裁剪尚未由根扩展的timeline/candidates给opening compiler，46自身则读完整精准被保存plan）。不能把本fixture编译/合成回合称真实原稿全玩法验收。

根服务/公共compiler/47图片、Q后续0048等待邀约均只读，本项只有46。全check/build/完整PG与最终冻结SHA、资源停止证据待收尾，当前保持进行中。实际日志ignored .local/story-pg-*.log/story-types-final.log，根将适配旧role-grants新6函数分类，不加执行权。

## 最终候选交接（待根集成/生产/供应商验收）

最终真实PG23/23（22子+parent），12pure、完整1655/1655 check/type0/build0，指定格式/diff0。明确包含：人在初始小店也能收到餐厅邀请（intent目的地），at_place只按实际当前位置阻止；邀约链接不改变位置/不假到场；same-sql两个export不初始化/不reconcile/不新开连接；worker无有效租约拒、同world/owner活租约只读已offer片段、错owner/world/过期拒；worker仍读不到3表/整plan/source函数；scene行存在时brief必须实际currentScene/active/同invite，关闭/不匹配无brief。scene门槛测试行是明确合成fixture，不声称实际场景完整演绎成功。

完整源码交接按a48fb3c→e7406ee→最终后继，不重入b47基线；domain/app port/repo/46及本人tests/报告限定范围。prepare.none含managed false/true：有计划的等待不应回落generic automatic director；unknown只核同stable receipt，绝不自动重付；retry明确且world版本变化VERSION_CONFLICT保原请求，不默改expectedVersion。Root公共compiler/server/scene/world/47与Q0048只读，未取消未来全复杂scene/多人/时间需求。

新增export readPublicationInvitationLinks(sql,ownerId,worldId)、readPublicationSceneBrief(sql,ownerId,worldId,invitationId)，repo方法复用。一个窄publication_story_offer_context(text,text) definer同SQL返回已真实offer源链接；app current app.user_id+owner/world，worker还需exact task_id/lease_token/running/nonexpired/scope_kind world/scope_id world/owner，pub/PUBLIC拒。只实际source event+command+invitation，origin同43绑定；最新cancel/miss过滤，即使缓存节点未reconcile也不吐失效brief。现场已有scene时当前active同invitation才允许舞台片段；不返回future plan/Persona，links仅实际邀约地点元数据，不写世界/到场。

根旧grant测试准确分类：appOnly=publication_story_source(text),publication_story_store_plan(text,jsonb),publication_story_clock(text)；app+worker lease只读桥=publication_story_offer_context(text,text)（publisher/PUBLIC拒，表/sourceplan仍worker全拒）；private triggerhelpers=publication_story_immutable(),publication_story_node_identity(),publication_story_node_source()（app/worker/pub全deny）。根独占旧role-grants分类与全源整合PG；本人不放宽旧权限、不改oldtest，不把根未运行的新整批写绿。

实际23PG日志.local/story-pg-final2.log，check/build .local/story-check-final.log/.local/story-build-final.log；本地dev/test46 checksum收口另存ignored proof。本项0真实模型/图片/生产写/部署，效果经真实WorldRepository/reducer保存的明确合成提案，开场是实际Q pure compiler；root新compiler支持timeline/candidates和9虚构图/正式稿发行另行集成。message=事件已呈现、invitation accepted=有用户回应，playerCompleted永远false，绝不称吃过饭/见过面或完整原稿全部玩法已经完成。

失败修正证据：首guard text command_id与UUID比较42883，精确cast修本46并重建本人合成cluster；skip测试原要求skipped满足after_committed是错误fixture，改实际authored after_resolved skipped，不降业务门槛；strict TS固定数量数组的索引需非空类型声明，运行数量断言保留；actor/history命名空间SQLstorePlan逐项加实际初始source与可见性验证；窄worker helper按根批准增加，不扩任何old表/source权限。源码从最终提交冻结释放I，资源停止状态存ignored handoff/主表本人行，不循环追加tracked回执。
