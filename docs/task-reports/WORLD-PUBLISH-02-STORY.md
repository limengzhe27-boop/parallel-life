# WORLD-PUBLISH-02-STORY · 真实来源驱动的剧情侧car

2026-10-12；Agent codex-publisher-story-02-01a11a84-20261012。主表已短锁接续准备，独立 /Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本，codex/world-publish02-story，准确b47f9a3635cc406bd11c09ef4c65c4711e2d197d。不夹根WIP。仅新0046_publication_story.sql、新settings/domain/publication-story.ts、新application/publication-story-ports.ts、新infrastructure/publication-story-repository.ts、新pure/真实PG专项及本报告/本人行；公共contracts/compiler/server/47媒体、旧world/runtime只读。55478确认无监听，尚未启动；不复用旧43 cluster，0生产/模型/图。

## 给根冻结的具体端口/SQL方案

PublicationStoryRepository(appDb)：prepare(ownerId,worldId)→内部单一eligible node claim{claimId,nodeKey,commandId,actorId,intent,editorialIntent,origin}或none/busy/unknown；stablecommandId先落库，模型调用不在事务内。finish(owner,world,claimId)不收raw model output/approved/status，只核实际同world/owner/actor/stable command的succeeded command+world_event version>0+assistant message来源；邀约另核实际source invitation，单NPC参与者，不替其它角色承诺。reconcile按真实invitation.responded与故事时钟读取回应/过期，skip需明确owner命令并存侧car回执，unknown不自动重付；迟到成功能用同source回执finish恢复。

新46侧car拟plan（精确43 binding的immutable draft/formal/origin，裁剪timeline/candidates/stable key映射/可核history基线，不存完整hiddenContent/Persona）、node states+stable claim、source audit/outcome receipts。初始化窄definer核owner/world，直接从同binding version/hash裁剪，app不能SELECT全稿。actorKey→initial actorId必须稳定key映射且验证初始snapshot/contacts，不按重名合并；历史参与者不能代表知情。根新compiler若需要未来unknown actors，应保存/提供可信namespace映射；旧已支持稿可直接通过opening.contacts key与snapshot actorId核对。普通玩家与独立staff试演owner各自侧car；pub不获得任意player表权限，staff可由合法trialSession通过正常app池初始化。

纯领域按storyNow、stage afterStageKeys、有效窗口半开区间[notBefore,expiresAt)、实际history fact来源/可见性、前序真实outcomes、currentPlaceKey、互斥与exclude/alternative计算资格。editorial_only永不执行，不靠初始化/director选中标完成；阶段只有实际节点来源/明确跳过/故事window过期才推进。没有timeline沿非staged候选规则；无节点无伪故事成功。

待根确认：after_committed_node/outcomes committed的message含义。建议实际message呈现保存后node outcome committed表示“呈现事件落库”，presentation='presented'且playerCompleted=false；邀请则只有明确玩家accept/attend才committed，不能offer后即完成。若message presented不允许满足committed，需要新增公共presented前置，否则首消息→后续常见稿会永久堵住。公开progress仅当前已呈现source/status，不泄露未来plan；selected editorialIntent仅可信服务器单NPC提示，不整份剧本下发。

其它边界已发现、待冻结时明确：runtime appointment.proposed只有title/at/participantIds，无place字段；planned place不能当实际到场/行程事实，at_place依赖真实地图位置。pending/unknown若窗口关闭仍不能自动重付或把未知当失败，应保留未决attempt以便同command源恢复。actor map不假按姓名推断；空/editorial-only阶段无窗口时需明确owner skip或报告不支持，不自动清零“已完成”。

当前只读准备与接口提案，没有46源码/SQL/模型执行或通过验收证据，等根精确冻结语义后实施；不再写泛化后台规划。
