# NOTES-WORLD-03C-B · 长期追求阶段成果与有限机会

负责人 codex-notes03cb-01a11a84-20261011；工作树 .local/worktrees/nar-03；唯一集成人主对话。状态进行中，未交付。已安全 fast-forward 51f753f，旧 NAR-03/checkpoint 与 clean 分支均保留，未重置 WIP。

## 待 root 冻结的最小协议

WorldMatter 可选字段：
- pursuitProgress={milestones:[{matterId,title,eventId,eventVersion,at}],nextOpportunityIds:string[]}，只用于 pursuit，最多四条；本批每个追求一个起始里程碑、最多一次后续里程碑，一个机会。milestone.matterId 指真实世界 near_term ID（不是 scene item ID）。pursuit 原 status 保持 in_progress/blocked，不 completed；新增阶段时自身 version+1，updatedAt=结果事件时间。题目标题是来自可信原始事项的快照。
- opportunity={pursuitId,triggerMatterId,key}，仅用于运行时生成的 near_term；key 为可信精确 preset/version3 路由中的有限 follow-up key，无客户端或模型自定义。
- 新机会 source={kind:director_proposal,eventId,eventVersion,at} 指触发它的实际 scene.action_resolved，evidence world_event 指同源，status=not_started；prerequisites=[triggerMatterId]、visibility=player_visible、relatedPlaceId=可信规则地点、relatedActorIds=实际见证者与该规则角色的交集。assertion=world_verified 只表示机会确已开放，不代表事项已完成；rewardClaimed 保持 false，无金钱/好感赠送。

scene.worldResults 公共形状不扩展。纯 reducer 在现有 validated matter updates 后，根据精确官方 v3 规则生成 progress/opportunity（稳定 UUID derived from world/pursuit/follow-up key），重放以同一 event 重新推导同一结果，不储存模型声称的 reward。事务层写 event/state/command receipt；没有第二个奖励任务、没有读取回填。机会完成仍要求真实 saved action、指定目标、地点、可信行动和裁决观察、真实 source；不能用机会标题或自称达成通过。

## 四官方 v3 有限规则候选

|preset|实际已验证触发|追求|一次具体可选后续事项|地点与知情角色|
|---|---|---|---|---|
|county-yellow-hair|deliver_r17|own_workshop|r17_review：整理并复核 R17 交接记录，记录接头检查与验收信息|repair_shop；只有实际在场老周知情|
|only-child|meet_guyao|independent_project|book_project_brief：写出以封底讨论为依据的文化项目初稿，列出内容方向与预算边界|lake；只有实际在场顾遥知情|
|returned-daughter|visit_chenyu|handcraft_binding|binding_memory_note：整理一份装帧手艺记录，写下工序与旧店记忆|chen_home；只有实际在场陈玉知情|
|retired-star|meet_lusheng|quiet_music_life|quiet_song_brief：写出新歌创作小稿，明确署名与不公开演出的边界|old_venue；只有实际在场陆声知情|

完成起始事项只增加一项有来源成果和一个未开始机会，不完成长期目标、不自动宣称已付预算/已营业/已发行。不生成新 NPC 邀约或强行出现人物；后续对象事项允许玩家独立完成，若无人见证则无 NPC 反馈。后续成功增加第二个阶段成果，nextOpportunityIds 不再生成下一任务，保留可追溯历史。agenda 只沿用 actual witness matter_result 的有来源策略，自然回复仍交已有真实模型，不预写台词。

## 边界与验收计划

root独占 src/contracts/world-matters.ts、player-records/其仓储、UI，后端独占主表已列范围；root先确认协议并提供contract提交，再接类型。可先写独立纯规则与测试，不编辑root公共文件。根报告目前尚未出现在主目录/集成树，出现后补读，不能另立任务总表。

负例：self report/failed/partial/blocked/外世界或账号/旧版本/变更原始定义/伪造机会元数据不得奖励；重复任务与回放只得一次，长期目标不完成；事实与事件被屏蔽时上下文不泄露。真实 PG 验证同源事务、回执重放、原子回滚、源事件历史和 RLS；先迁移独占55471 dev/test再 check/build。0供应商/图片/生产写，上线与UI最终验收归集成人。

## root 冻结后实现接口

已读主目录03C根报告，采用root 10/10上限（替代上方候选4上限）。不改preset初始内容。B已实现独立纯规则初稿，导出：pursuitRules、opportunityId(worldId,pursuitId,key)、trustedOpportunity(world,initial,matter)、progressSceneMatters(previous,initial,validatedMatters,event:{id,version,at},witnessIds) -> {matters,observerFacts}。同一scene世界reducer校验原updates后调用；来源事实新增pursuit_result:<eventId>:<pursuitId>，actor visibility仅实际现场witness。供root/Q验证既有worldResults，不扩event负载API。后续机会第一次真实attempt可启动并达成；解锁时只not_started，不自动接受。预计机会成功写入第二里程碑，保留nextOpportunityIds用于可追溯历史，不继续解锁。
