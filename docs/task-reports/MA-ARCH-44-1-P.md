# MA-ARCH-44-1-P：人物与调用持久层

负责人codex-ma-arch44-1-p（辅助2），root唯一公共接口/内核/集成/发布负责人。工作树publication-story-02，分支codex/agent-runtime44。公共基线3e9bc64，已接只读公共更新a00b4900、4630c34、a0cc5b6e（本树cherry-pick SHA不同）。只改本报告、0072_agent_runtime.sql、agent-runtime-repository.ts及integration/agent-runtime.test.ts。没有existing worldrepo/services/worker/作者数据修改，没有模型/生产操作。

## 实现

- 0072新增agent_runtime_worlds控制面、actor_agent_states独立world/actor状态与revision、不可变agent_input_receipts、agent_attempts和不可变agent_action_results。app按owner FORCE RLS，worker/publisher/public无表权限；后续lease适配由root协调，未将worker冒充app。
- 真实world UPDATE/DELETE触发epoch围栏。无控制行或epoch1维持旧写行为；epoch2及以上必须事务内app.agent_engine_epoch与app.agent_world_id精确匹配。控制epoch只允许+1，更新时锁同一world；不允许降级。
- 明确初始化人物状态；read无投影写入。切换epoch需world版本/epoch匹配、全部实际人物已有投影、无未决Agent/旧commands/tasks/director/opening/story调用。不修改历史、时间或world版本。尚未适配的group/scene/media旧写在epoch2会被围栏拒绝，因此本层不是允许立即批量切生产世界的声明。
- 玩家输入在模型前独立幂等保存。相同command不同hash或同hash不同业务正文冲突；重放返回原receipt，不替换输入。群/现场可有共享receipt和各人物派生命令。
- claim用world短锁序列化同世界竞争，核receipt来源/hash/接收人物、epoch>=2、world版本、actor revision和有效lease。同command重放不重新领取、不换token；其他活跃/unknown同人物调用阻断。claim/mark/save/read各自短事务，返回后连接释放，均不包含模型回调。
- request_sent/unknown_after_send不能变回reserved。已知无效输出与未知分离。已收到响应先受保护保存，原文不进日志；同响应幂等、异响应冲突。过期lease或epoch变化仍保留响应并stale_discarded，不能执行。超过有界JSON预算或不可序列化时存固定storageError/可得hash及长度，标invalid_output，不冒充未知重付。正常raw JSON体上限1MB，数据库保护2MB。
- readResponse沿root新envelope返回found/response，实际JSON null不等于缺失。

## root内核接线：同一个SqlClient

`PostgresAgentRuntimeRepository(db)`同时实现AgentAttemptStore、AgentInputStore、AgentStateReader。以下helper不BEGIN/COMMIT、不新连接、不调模型：

1. `initializeActorAgentStateInTransaction(sql, ownerId, state): Promise<ActorAgentState>`：仅明确revision0初始化，幂等返回已有状态，定义引用冲突拒绝。
2. `switchAgentEngineEpochInTransaction(sql, ownerId, {worldId,expectedEpoch,nextEpoch,expectedWorldVersion}): Promise<void>`：全部演员投影就绪、调用静止后单步切换。
3. `acceptAgentInputInTransaction(sql, ownerId, input): Promise<{receipt,replay}>`：与其他接受记录需要原子性时可直接使用。
4. `beginAgentCommitInTransaction(sql, ownerId, attempt): Promise<ActorAgentState>`：锁world/attempt/actor，核epoch/token/lease/状态/world及actor CAS，设置本地epoch/world/attempt事务标记。
5. root在同SqlClient执行实际world event/state/command receipt/projections/Outbox写入。
6. `finishAgentCommitInTransaction(sql, ownerId, {attempt,eventId,state,results}): Promise<void>`：必须有begin的同事务标记；核实际event+成功command+actor+world版本、actor revision+1及结果归属，保存状态/结果、mark committed。普通mark不得单独committed。

finish不限定event.type，允许turn.resolved和agent.state_committed；它不替root进行语义推断、能力授权、模型调用或fake world commit。root须在入口先核已有命令回执；本层只提供真实持久原语，不把未切换入口包装成完成。

## 验证

本树独立合成PostgreSQL18.4，127.0.0.1:55566。迁移72/72实际应用，未修改其他既有迁移。0072在冻结前修订DB NULL与控制锁边界，重置仅本地本迁移的临时对象后按最终草案重跑；无生产迁移/数据重置。

- 实际PG22/22：world/actor/owner隔离、只读不初始化、输入先存/不可变/正文绑定、并发唯一领取/重放、连接释放、unknown不重领、token与raw响应不可替换、epoch和lease过期留响应/拒执行、已知超大输出invalid、epoch1旧写/epoch2任意最终world写拒绝、切换前已开始的旧reader晚写拒绝、未决调用阻切换、全部actor投影就绪、worker零权限、跨owner直接RLS空集、actual state/result/event/command/outbox一并提交和全部写后故障回滚、actor CAS、JSON null响应envelope、无对白状态事件、错actor事件拒绝、SQL JSON null身份拒绝。
- `npm run check`在接a0cc envelope前通过：type/boundaries及2489/2489纯测试。
- 接envelope及最终窄补后：typecheck通过、公共kernel/runner专项20/20、PG22/22通过。没有无变更重复全套；root最终集成后运行联合check/build及实际入口PG。
- 没有UI变更、浏览器/模型/生产/部署操作；本地PG在冻结后停止。不能以本持久层测试宣称完整Agent架构/跨渠道/主动人生或公网体验已完成。

## 接续

root在同SQL world commit关闭legacyProgress，连接begin/finish；构建显式bootstrap/迁移并按epoch路由全部真实入口，补clock/授权新鲜度、共同episode和能力语义。epoch围栏会诚实拒绝尚未适配的旧写，不得用全局set_config掩盖双引擎。worker lease安全函数仍待专门接入和权限验证。新调用必须新预算，43闭账额度不复用。

## 接收锚点及多渠道权限窄续修

root合入初版后，明确receipt.expectedWorldVersion是不可变接收锚点，不要求与每个人物之后的执行版本相等。已接公共只读更新9317ecdb及28b1f05b。0072文件完全不变，校验和不变；仅repository、本PG及报告续修。

- claim允许receipt.expectedWorldVersion≤当前执行CAS版本；receipt原正文、hash、时点及接收版本均不变。private指定recipient和thread必须是本人；null不能当任意private角色授权。
- 增加AgentAttemptStore.lookup(ownerId,worldId,commandId)，仅查已持久attempt，owner边界不变，不初始化/推进任何状态。HTTP重放应先找实际旧attempt及committed事件，不能混用旧WorldRepository的另一种请求指纹。
- group依据真实创建事件、成功命令、接受时成员区间及执行时成员区间授权人物和player，检查来源被忘记的情况。成员需要在两个时点均有权，但不要求同一连续区间：确实见过输入、退群后再加入不丢失历史知情；真正之后才加入者不可消费旧输入。thread不存在或其他世界source均拒绝。
- scene依据真实entered source、成功opening/action receipt、实际presence原文与当前player experience授权；伪造session.presence但无对应已提交worldResults证据仍拒绝。离开当前现场后不能继续领取旧现场输入。本层未冒称支持尚无合法来源的新presence协议。
- paid send前及beginCommit再次核对不可变receipt的渠道权限/forget，避免claim后撤权继续发送或执行。saveResponse仍允许保存已付费返回结果，不因撤权毁掉证据。root协调层负责将已知pre-send失败收束reserved，以及将INPUT_SCOPE_FORBIDDEN按known stale处理。
- AgentInputReceipt新增storyAt后，accept校验真实ISO和日历合法性；receivedAt为墙钟、storyAt为接收世界时刻。两个初次时点均排除幂等body比较；重放返回原receipt，不倒填执行时刻。
- 公共claim没有另一个origin/channel参数，所以授权只读取已接受receipt自身；origin替换在相同command接受时冲突。root snapshot builder必须使用store实际返回receipt，不从调用者重造player origin/channel。

实际PG30/30、typecheck、boundaries515以及公共kernel/runner20/20通过；包括同群receipt A在v1提交到v2后B在v2独立领取、私聊跨actor拒绝、原输入/接收时间不改、fake group/private null、原成员退出重入与真正后加入者区别、scene无实证presence/当前现场拒绝、忘记来源、claim后和收到响应后撤权阻断，以及只读lookup。没有再次运行fullcheck/build，无新增SQL/模型/生产操作；root正在集成真实service/kernel入口并承担联合check/build和后续权限桥。
