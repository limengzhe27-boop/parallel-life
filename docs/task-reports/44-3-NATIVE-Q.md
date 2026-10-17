# 44-3-NATIVE-Q：原生群聊／现场投影与人物快照

- Agent：codex-ma-arch44-3-native-q-20261015；唯一集成人为根对话。
- 独立目录：`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`。
- 第一冻结分支codex/ma-arch44-3-native-q基于a8e19311，业务提交 **b831752**；只新增5个已登记文件。根fba94a54中的3个domain文件单独同步为a456701，不属于本人业务修改。
- 后续strategy接线分支codex/ma-arch44-3-native-strategy基于根9b8db14b，重新挑入等价b831752为85c84a6f，避免复制根在途改动。
- 任务状态：待验收；源码已冻结，未由本人部署或切换真实入口。

## 已冻结能力和文件

1. **agent-channel-projector.ts**：按根确认签名导出projectNativeAgentChannelInTransaction(sql,ownerId,{attempt,snapshot,transition,eventId,occurredAt,storyAt,effects,statements})。不自行BEGIN/COMMIT、不代root begin/finish人物attempt；所有写入留在原SqlClient UoW。
   - 写入前核实际世界CAS、同UoW attempt/world/epoch标记、真实receipt正文/原接收时刻/版本与transition一致、人物归属与revision。
   - 群事件为group.turn_resolved，同人物多条statement按原顺序换行合一条原生群消息。总长最多500；超限拒绝，不截掉台词。消息ID为服务器按event/channel/index生成的稳定UUIDv8，符合既有原生读取契约。
   - 现场为scene.reaction_recorded，每条statement对应独立原生SceneEntry；4000字符单条上限，实际presence和observableTo校验。只保存本人对白，不改现场出入、玩家动作status、既有动作结果或地点，不伪scene.opened重演。
   - native event.data包含actorId/agentRuntime/effects，可供通用finish/replay使用；不写world_messages伪装私聊。
   - appointment.proposed通过根native replay hook进入日历待确认投影；不造邀请台词，不在reply.invitation重复写一份。其它当前未注册效果（含media）明确拒绝；本批没有媒体能力或新图片Outbox，不能称为媒体接通。
   - 同事务保存真实commands成功回执、world_events、群消息或现场entries、日历与世界version/time；历史genesis预约不会丢失。未改变现场presence/action的语义。
2. **agent-channel-snapshot.ts**：按根确认签名readNativeAgentSnapshot(db,ownerId,world,actorId,input,storyAt,state)导出，初版是严格渠道快照。
   - 验原生成功group.message_sent或scene.input_recorded、真实正文/原输入版本/故事时间、当前和原消息版本成员/在场、scene observableTo、private thought排除；不是仅信任accepted text。
   - fullstate仅服务端CAS使用，view通过来源授权裁剪；只加载本群或本人实际目击现场及真正公共事实，不将DM原话/私人记忆作为渠道speech。玩家位置报告保持speech，不写成世界位置事实，不把world.space.currentPlaceId放进NPC提示。
   - native来源核成功command、原文及版本；保留被持久state引用的旧渠道来源而非只看最近80条。忘却独立于召回窗口，receipt/消息/条目/event别名迭代闭合；被忘却输入不能复活为旧receipt或旁人回声。
   - 第一冻结版本尚隐藏仅由private source支撑的目标/计划/decision；canonical不丢，但**跨渠道策略连续性未完成**。不能以“不泄露私聊”冒称同一人物已经完整连续。后续按根新usage协议接线，见下。
3. **0074_agent_native_projection.sql**：根授权新增的精确权限迁移，0072未改、0073归B。
   - 不授pl_worker新表权限，也不放宽pl_app通用NPC写入。旧player policy保持不变。
   - 新pl_app NPC群INSERT policy要求真实response_received/live attempt、当前world epoch/CAS、actor revision、原receipt、实际native event/command、sender/messageId/text、原输入与当前player/actor membership一致；GUC仅作为定位标记，不单独授权。
   - DEFERRABLE INITIALLY DEFERRED约束触发器在COMMIT核真实command succeeded、attempt committed/eventId、actor状态/version与事件stateAfter、世界版本；缺finish不能提交半成品。
   - scene_items现有owner策略无同类只限player的阻断，本批不扩大其权限。
4. **tests/agent-channel-projector.test.ts**：稳定原生UUID契约测试。
5. **tests/integration/agent-native-channel.test.ts**：真实PostgreSQL正负向专项。

## 第一冻结版本验证

在本人独立本地PostgreSQL **127.0.0.1:55565 / parallel_life_test**，真实pl_app owner连接，实际迁移及RLS执行。未借用集成人数据库、未运行真实模型。

执行`node --experimental-strip-types --test tests/agent-channel-projector.test.ts tests/integration/agent-native-channel.test.ts`正常结束exit 0；6个测试节点通过，其中1个pure UUID测试、1个PG父suite及4个PG场景，不把父节点当额外独立数据库案例。

真实PG场景：

- group原生消息、待确认预约、回放一致、主动抛错完整回滚、人物状态/command/attempt同事务完成，无DM投影。
- scene原生多条对白、待确认预约、回放一致、事务回滚；presence和既有actions完整不变。
- 伪造输入正文、错误人物/完整状态不匹配时拒绝读取快照。
- 缺UoW、伪actor/body/thread/attempt marker拒绝；故意不调用finish而强COMMIT，被数据库AGENT_NATIVE_COMMIT_INCOMPLETE拒绝并整笔回滚。篡改测试仅在传给真实PG的SQL参数上作负向变异，没有伪数据库响应。

fixture为合成人生/人物/输入。scene初始预约以真实owner SQL写合成genesis，然后使用现有真实scene进入/输入/投影；任务取消仅避免旧worker消费合成fixture。attempt的request_sent/saveResponse使用明确fixtureOnly数据，验证持久化流程，不冒充真实模型调用或人物演绎成功。

第一冻结版本typecheck exit 0；按根要求未跑fullcheck/build，未做浏览器或公网验收。0074只在本人本地验证，**尚未生产应用**。旧线上READY信息由根提供，不能算本任务新增源码已上线。

## strategy与worldContext后续接线（根公共9b8db14b）

根新增Source.usage=private_strategy/channel_context、readActorStrategyBasis和attachAgentWorldContext后，允许本人只改reader及专项测试，不改model/公共types/0074/projector。

- 本人的策略来源与本渠道观察分开：策略helper只返回本人有证明的结构化状态来源，无DM原文；已有渠道来源优先保留channel_context，补缺策略来源为private_strategy，view授权使用两者union。
- 调用根attachAgentWorldContext统一本人位置/知识与当地时钟，不自行从地图真位置推玩家所在；其它人物不接收本人的策略。
- 新PG案例将验证持久本人private输入basis支撑的goal/plan/declined在group view仍存在，捕获根NpcAgentModel实际payload确认decision.quote为空且不含原DM引文；这只是mock传输，不是真实模型效果。
- 接线曾遇到根helper真实PG阻断：memory_records.id(text)与$4::uuid[]比较。已回报，由根20ab06e2修正；本树仅挑该提交为b01838b8，不越权修改helper。根9b8db14b及0073公共源码是后续接线前置。
- **后续冻结提交04cfbce**，仅reader与对应PG测试：先渠道sources，再补缺的本人策略basis；channel_context不被策略来源覆盖。末尾await统一attachAgentWorldContext，再按最终sources union重算view，避免已验证knowledge来源后附而旧目标提前被隐藏。
- 最终7测试节点全部通过、正常结束exit 0：1个pure UUID测试、1个PG父suite和5个真实PG场景；新增策略场景使用真实持久accepted private receipt作为basis与合成结构化目标/计划/declined，实际根NpcAgentModel模拟complete捕获payload，确认decision.quote为空、目标/计划/declined保留、另一人物没有这些来源或状态。没有调用真实模型，也不是完整私聊服务→群聊产品旅程验收。
- 最终typecheck exit 0。未跑fullcheck/build、浏览器/公网或部署，按本轮根明确验证节奏交由集成人统一完成。
- 仅停止本人工作树PostgreSQL进程，已确认55565无监听，未动集成人数据库。0074保持原本地已验证内容不改；生产应用仍待根审查确认。

## 交接与未完成项

- 根已将b831752集成为305ea114，后续仅挑04cfbce；不重复挑本分支的等价85c84a6f或根公共同步提交。0074必须根审查并确认实际生产迁移后再上线，不由本人部署。
- projector不是整个kernel或实际入口：root负责调用begin→project→finish，及对应同SQL awareness投影。P负责旧repo入口门禁；worker桥不在本批，不能伪lease或给worker全表state权限。
- 原生群超长多条对白不能静默截断；后续真实入口应在模型/内核层与既有500字符原生契约一致，避免已收到raw却始终无法投影。
- 现场出入/物理执行、环境拆分、媒体能力、完整自主调度与旧新引擎切换仍由后续任务完成。当前只反应，不将场景地点当作NPC已知全地图。
- 不发布或修改“渣男体验”原草稿，不动真实玩家存档；未用测试数量或API状态冒称整个三渠道Agent已完成。
- 来源resolver目前按root冻结的有证据basis支持本人结构化策略连续，不导入整段DM。其它跨渠道source种类/复杂条件、真实模型是否自然承接、多人群聊调度和现场实际动作均未因这5个PG场景而自动取得验收。
