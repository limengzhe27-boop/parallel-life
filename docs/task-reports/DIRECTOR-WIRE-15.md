# DIRECTOR-WIRE-15

负责人director-wire15-20261027，独立grok-image树/codex/director-wire15-20261027，基线a0a9cfe3。root唯一main集成/真实验收/端口。0新表/业务字段/迁移、0真实模型/原档写/端口操作。

## 最小设计与修改

复用已有作者ActorInteraction/topic/personalObjective/proposedInteraction及actorTasks键控表达，不新增一套任务协议。当前新版本director-wire-v15的顶层emergent只写actorTasks，所有catalog人物键逐一为null或本人互动；代码按原catalog稳定顺序机械派生参与者及future_task，至少1人非null。不同对象键顺序不改变归属。来源/ref/known topics/执行权限及原canonical校验完整保留。

旧v14分出独立PreviousOwnerWire入口；v15仅把新emergent形状编译成旧内部表示后递归原v14链，作者机会仍走原作者链。v14违法额外任务仍拒绝，不过滤、不自动恢复旧失败。actor-opportunity-context仅白名单增加v15，结构化任务内容/hash/本人来源路径不降为legacy字符串。root已修directorDecisionSourceIds实现未改。

总机会上限仍2，provider schema与v15 decoder使用同一预算helper：max(0,2-本轮作者窗口条数)。两个作者槽时emergent maxItems0，一个作者槽时max1，零作者槽时max2；作者暂缓不挪用已预留槽。原bootstrap开场/nativeTurn更严限制继续为0。原Wire/canonical总2限制不放宽。协议版本及相应wire说明更新v30，仅描述上述格式/预算，不强制人物engage，不改变人格/知情/拒绝/安静语义。

## 验证

聚焦新unit5/5，导演/作者/机会相关回归280/280通过；必要typecheck、754文件边界、diff-check通过。4处既有测试只更新当前provider版本/name及已被actorTasks取代的字段期望，保留旧v14响应读/拒绝用例。未重复全量check/build，交root统一进行。

覆盖：不同actorTasks键顺序/单人/多人/只出本人结构化任务；0/1/2作者槽schema与decoder一致、合并超预算拒绝；混传actors/stagingIntents、少键/额外actor/source键、全null、空白/超长/多字段/JSON逃逸后task超600拒绝；伪造source、未选actorTopics/假topic hash、bootstrap/native保护；v14正常读不变且旧extra tasks、新字段硬塞v14、未知v16严格拒绝。

独立PG55651/parallel_life_test最终4/4（新v15旅程1+既有有限quiet接续3）通过。新旅程使用原publication/start/admission→原导演→两个NPC原内核事务，TextModel为显式内存stub，无真实网关：

- 无作者窗口可提出1个多人emergent；新schema没有actors/stagingIntents。
- 两个人按catalog actorRef→actorId映射各收到本人独立topic，internalContext没有另一人的私有测试topic，currentOpportunity及actor_interaction_opportunity结构正确。
- 原director response/hash持久化一致；两个请求真实consumed/两个engage receipt及各1条消息由原内核提交。
- 已提交导演同command读取不可变decision，拒绝任何再次model调用；跨owner看不到receipt。
- 所有合成世界cleanup暂停；没有读写真实clone记录。首轮测试曾错误从NPC payload不存在的actor.id取身份导致assert失败，已改按原private channel.threadId与director catalog精确映射；不按数组顺序或名字猜人物。失败为隔离stub测试，无真实调用。

最终日志：忽略目录.local/director-fourth-20261027/wire15-unit.log、wire15-regression.log、wire15-pg-final.log、wire15-type.log。新协议验证不代表真实模型一定遵循/不会再空白跑满输出；真实首次进入及主动来信仍由root专属存档完整验收，未称上线。
