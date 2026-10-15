# 44-48-TRAVEL-KERNEL-Q：实际NPC出发内核与连续抵达回归

状态：待验收。负责人 `codex-ma-arch44-48-travel-kernel-q-20261015`；root唯一源码/SQL/公共契约/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-48-travel-kernel-q`，基线root `1349a423`。开工前短锁登记，先提交六组方案及历史夹具真实性说明。root随后明确授权同一正例接47实际arrival服务，本树仅cherry接 `46f845c5` 为父依赖 `0193b75c`，不修改其源码/测试。

本人只新增 `tests/integration/agent-travel-kernel.test.ts` 与本报告/主镜像/本人状态行；没有改其它源码、SQL、旧测试或CI。root通知冻结后没有继续修改测试文件。

## 夹具与证据边界

每组建立独立合成世界，显式给出room→park路线、15分钟路程和本人/另一NPC。通过既有epoch1 WorldRepository.commit保存一条尚未接受的历史邀约，再经实际SceneRepository.enterPlace、队列claim、commitSceneProposal、queue.finish保存A在room的历史现场。此为**明确合成的迁移前历史准备**，不是新NPC引擎行为，不用假回复冒充AI成功。

随后通过既有可信初始化/switchEpoch和projectAgentWorldChange从该真实已保存场景来源建立73实际位置；不手塞epoch2departure/result或位置。使用ClockStore.ensureAnchor保存既有世界时间锚，以满足实际route候选的clock_ready。角色名列入旧编剧地点候选仅用于允许历史场景writer，不把名册本身当作到场。

正向出发走实际npcAgentServices.private→readPrivateAgentSnapshot→NpcAgentModel（TextModel.complete明确合成JSON，计数1）→runNpcAgent→protected response→PostgresNpcAgentKernel→真实80 journey/73 projection/scene interval事务。模型只能选择实际snapshot提供的routeId，travel.begin参数只有routeId，sourceIds包含本人的self-position及当前真实accepted input，目标仍active。

afterCommit故障组采用同一个实际runNpcAgent/store/真实private snapshot/NpcAgentModel/实际kernel，只在该kernel允许注入的事务末端hook抛错。不是假的Repository、手造成功result或跳过事务验证。

## 最终真实验证

自有PostgreSQL18.4 / 55565，真实迁移80。命令：`node --experimental-strip-types --test tests/integration/agent-travel-kernel.test.ts`。最终 **7/7节点通过，0skip**（父测试和六组），日志 `/tmp/44-48-final.log`。

|组|实际结果|
|---|---|
|1 出发及连续抵达|实际private调用1次产生succeeded departure result、journey80 in_transit、本人73 in_transit且placeId=null、同事件runtime.departures/sceneDepartures、真实scene presence.leftVersion=出发版本。player实际位置/当前地点、另一NPC状态和全部位置知识不变；已有非空邀约仍proposed，目标不fulfilled。随后读真实clock锚，以速度和storyNow计算正常投影到ETA对应的测试server realNow，调用47实际commitDueAgentArrival，真实journey变arrived、独立arrival event、本人at park，**模型总数仍1**。不直接写world/位置或把ETA塞成事实；player、goals/responsibilities、邀约、知识和原scene关闭间隔均不变，时间未越过两小时后的既有邀约。|
|2 同command重放|实际私聊同命令重放，返回同回执，模型总数仍1，旅途/动作结果/世界事件/commands/Outbox计数及完整物理状态不重复。|
|3 afterCommit故障与恢复|实际kernel末端抛错，world/scene/73位置/actor状态/知识及journey/results/events/commands/Outbox全部回滚。attempt保留response_received和原protected raw。按同身份/同raw、snapshot=null恢复后成功出发，模型仍只有首次1次，raw不变且仅一个journey。|
|4 已知错误路线|实际输出missing_route，能力failed result正常保存，独立有效对白保留；依赖出发成功的“I am setting off.”不展示。0journey、实际位置/scene/知识不变。不是整轮UNKNOWN，也不把failed结果当作执行成功。|
|5 来源撤销|模型返回前使用既有forgotten来源metadata夹具撤销实际self-position来源；额外断言该撤销确已执行，避免模型前置断言失败被误算安全通过。最终真实服务VERSION_CONFLICT、attempt.stale_discarded，物理状态及事务计数不变。此为真实来源撤销重审，不称已测试产品forget API。|
|6 未知传输|受控TextModel.complete抛未知传输错误，实际attempt unknown_after_send，重试无第二调用，0journey/位置/scene/世界变化。已接受输入回执允许保留，不冒充玩家没发过消息。|

旧scene“不能拉回”验证范围：读取实际已关闭的持久presence interval，结合纯committedAwarenessDelta的scene.action_resolved案例，证明投影不把已离开A放回；**没有执行新的actual scene.action_resolved写入口**，未伪造存库scene事件，不宣称完整旧场景后续入口已验收。

`npm run typecheck`、修改测试Prettier、边界检查、git diff检查通过。0真实模型、0生产、0浏览器/公网、0fullcheck/build。所有TextModel输出明确合成，非线上模型质量证据；原“渣男体验”草稿不改不发布。

root接续：接本人两文件独立提交，保留1349出发源码及47 arrival父依赖。本人测试冻结，root继续实际advance、旧场景完整入口、最终集成check/build、生产80迁移及部署READY/公网验收。本地真实出发→抵达通过不等于已上线，也不替代P47更多时钟/权限/并发验收。

资源收尾：自有PostgreSQL正常停止，55565核无监听，没有停止其它Agent服务。
