# 44-97 真实现场观察来源适配

负责人 codex-ma44-97-observation-q，辅助线程01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b；root确认任务号和新增文件范围。独立core-handoff88-q/codex/scene-observation97-q，基线6905d7fc8a625b8f357a710b2a2843d82a4503c5。主登记短锁先领取，专属PG55565启前确认无监听。状态：待验收，公共接线与部署未完成。

## 文件和能力

仅新增：

- src/modules/world/infrastructure/actor-scene-observation-sources.ts
- tests/integration/actor-scene-observation-sources.test.ts
- 本报告；主表仅本人行及报告镜像。

readActorSceneObservationSourcesInTransaction(sql, ownerId, frame)只读适配实际scene_sessions/scene_items、成功world_events+commands；frame包含worldId/actorId/sceneId/worldVersion/storyAt及可选maxBytes/maxEntries。返回稳定scene:<entryId>来源、有限观察文本、明确omittedSourceIds和complete/budget_limited。

先验证owner、真实人物、当前世界版本、现场归属；逐条要求原事件时点的presence与entry.observableTo同时成立，再核原成功command/event、版本、scene和生产者正文。不是同一粗地点就自动目击，也不以当前加入关系补发旧记录。遗忘检查复用原forgottenAgentSourceIds，过滤后才预算，不把被遗忘或无权记录的ID放入omitted。

支持原玩家scene.input_recorded、实际旧scene proposal叙述/对白/裁定、同一原NPC内核产生的native scene dialogue。玩家user_action始终speech/player_report，NPC对白是speech/actor_report；裁定还须原action处于resolved、resolution事件/版本/outcome/observation逐项匹配。narration的fact沿用原“已提交现场叙述”种类，evidenceKind=scene_record，不能据此创建新的全局事实或位置。没有将这份适配器包装成主动观察或物理视线引擎。

source.contentHash绑定原entry及原event身份/版本，不包含当前世界版本、轮询时刻或检索时刻。事件墙钟eventOccurredAt、原故事时间storyAt、当时明确受众的learnedAt与当前retrievedAt分列；读旧记录不重写获知时间，不从玩家台词推定物理事件发生时间。

文本不截断；容量以整个source+observation包UTF-8字节计，默认16000字节/80项。先授权、后按近期优先选择完整条目；单条太大不阻断更早可容纳条目，未容纳的合法来源明确列出。未按actor.projectedWorldVersion过滤或假ack，不因本次读取、source存在或knowledgeSourceIds就声称模型已评估。

## 实际验证

专属真实PostgreSQL18.4/55565，完整应用本基线84项迁移；原pl_app owner-RLS与pl_worker租约队列实际调用。运行新专项8个子测试+父节点=9/9，0skip：

1. 实际scene.input玩家“已到公园”只作为speech，玩家真实位置仍room；无权角色无正文/省略ID；重复读取不改world，未来检索时间不改来源hash/获知时间。
2. 真实旧scene writer后来明确加入乙，乙可读新叙述，但不补发加入前原文。
3. 原私密想法即使测试用管理员篡改派生entry受众，也因原producer私密标志拒绝；随后恢复合成记录。
4. 篡改合成entry正文与原producer不符则拒绝；恢复后通过原MemoryRepository和forgetMemoryInStore实际遗忘，正文与omitted均不再带此来源。
5. 原长文完整保留；最新超大条目被明确省略而较早短条目保留；21条真实私密输入超过旧20条窗口仍不挤掉有权历史；0字节预算列明全部合法省略，不泄隐藏文本。
6. 真scene attempt及commitSceneProposal生成裁定，适配为result；仅修改合成action.resolution为不匹配结果时拒绝，随后恢复。
7. 错owner/未知actor/旧version先拒绝。
8. 合法历史现场迁移epoch2→真实scene输入→原队列runOne/nativeNpcTaskHandler→同一NPC kernel实际提交→适配读取准确投影对白，乙无权。模型是明确本地替身1次，0供应商请求。

测试现场准备使用原epoch1 writer显式生成合成历史presence，随后原switchAgentEngineEpoch切2；不冒充新genesis已支持NPC初始位置，不手塞epoch2人物行为事件或执行结果。管理员修改仅用于合成数据反例，不是正常产品操作或安全权限证明。

检查：npm run typecheck退出0；模块边界585文件通过；两新源码/测试Prettier通过，git diff --check通过。首轮fixture因地点ID“room”与真实名称“Room”混用失败；第二轮私密示例不符合现分类格式、切epoch缺expectedWorldVersion失败，类型检查同时发现后者；修正测试使用真实协议后全部9/9。没有放宽公共产品校验来迁就测试。

日志位于本机/tmp/44-97-test.log和/tmp/44-97-type.log，不含密钥；不把重复运行次数累加覆盖。没有重复全量check/build；公共集成后统一执行。本人PG仅关闭自己的local-db父进程，原启动会话退出0，已核55565无监听，不操作他人数据库服务。合成世界收尾paused且active_until=NULL。

## 接续和限制

root在原snapshot/来源发送门/内核最终门接入；本组件本身未接线，不另写用户世界或生产认知。调用方须在原一致事务/版本及epoch边界内使用此SqlClient；读取不代替最终来源、forget和付费身份重验。

这是本人获准的原现场材料，不是对任何新channel的披露授权。private或原现场之外的群/现场必须重新授权受众；不能把这里返回的完整个人材料直接转发到新渠道。root若接scene:<id>新contentHash，发送前及最终门须用同一canonical适配验证，而非旧无hash来源形状直接比较。

当前observation额外evidenceKind/时间字段不是新增公共模型协议；root模型payload若只挑旧三字段，须诚实保留speech/result语义，必要时由root接元数据；不能宣称模型已收到所有新增信息。omitted清单只证明适配容量筛选，最终模型prepare仍可能再裁剪。真正模型消费ack仍需最终实际请求选择与成功commit证据，不以本模块结果代替。

暂未适配media_reference/time_place、派生肢体描述或累计步骤旁支叙述等未能准确匹配已注册producer的记录；不会凭相似文字猜来源。complete仅指本适配器注册并授权的候选包未因预算省略，不表示完整世界观察覆盖。当前loadScene仍读取该场景已有条目，并非无限历史的流式分页方案。

没有新增observe.place/room能力、视区或覆盖授权，没有生成“无人”“刚离开”“目的地”推断，没有修改真实位置、SharedEpisode整体结果或候选队列；普通对象收据和单次邀约拒绝均不判整段终局。B原actor-observation-cognition等文件保持只读，未另造同职责纯认知组件。

本人真实模型0、生产/公网写入0、浏览器0。真实数据库9节点是来源适配与实际调用链证据，不是自然演绎质量验收。生产公共部署由root串行处理；“渣男体验”不发布、新引擎不启用。97公共接线、最终模型投喂/消费、完整观察及总架构未完成继续保留主表，不能把这个可调用适配器称为产品已完成。
