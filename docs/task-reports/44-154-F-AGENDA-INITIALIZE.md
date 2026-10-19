# 44-154-F — 初始自主议程接入原人物运行链

负责人 codex-opening-fix-agenda154f；唯一集成人 root。独立 agenda-init154-f / codex/agenda-init154-f；基线4602daf8，前置154-B72a5df0f已先cherry-pick为16de0092。root按B→F集成；本次只交F提交，不重复交B。

状态：待集成验收。0 SQL迁移、0真实模型、0生产写、0部署。独占本地PG55629已用于必要验证，完成后停止。

## 实际运行接线

原bootstrap继续仅初始化空人物state并原子准入epoch2，不在创建事务调用模型、不生成预置目标。新增source-backed grant读接入原 npc-agent-advance-services 版本一致读取 → 原SchedulingView/collector → 原scheduleAgents → 原execute/accept → 原runNpcAgent → 原kernel事务。每advance仍最多原定一人物；低优先级10，已有计划/责任/观察工作优先，不全员发开场。

source='agenda_initialize'是原候选union的一员；应用层与原DirectorSnapshot严格枚举同步扩展，不绕过快照认证。遇到原导演全局语义变化仍按原协调规则处理；B保证全局quiet不能消掉独立人物机会。未增加另一调度器或人物存储。

## 来源、身份和资格

新增只读actor-agenda-initialization-repository：核对owner/world/epoch、原agent_narrative_admissions及不可变world_initial_snapshots的MD5准入hash、本人当前和genesis定义及state.definitionRef；本人定义hash与原agentDefinitionRef相同算法。仅使用已认证definition:<ref>来源，不新增AgentSource授权或向人物广播全局信息。

原state中存在goal/plan/action/responsibility/decision、已参与事件或未结束提问均不初始化，包括被裁剪隐藏的旧条目。缺准入、定义不一致、遗忘来源或本人正在付费/unknown工作时无grant。既有目标即使结束也不会重置，这不替代后续“无任务复盘”。

稳定candidate身份包含policy/world/actor/epoch/admission genesisHash/definitionRef，不含轮询时间、worldVersion或消息数；command复用原agentWakeCommandId算法。读取不保存目标、进度或事实。

同一个读取器也给原phone entry probe提供ready信号与稳定key。消费/unknown判断不在UI复制一份；probe无写入/调用模型。人物focus下仍遵守原注意力限制，不抢走聊天。

## 预发送和消费保护

accept及原markRequestSentWithSources事务再次认证精确服务器生成的初始化输入、同一command、真实空议程与原准入。runNpcAgent强制此输入走原来源fence，不允许只mark(request_sent)绕过。前置状态变化在请求前以VERSION_CONFLICT结束为stale，0模型调用，不留下reserved假忙。

成功quiet允许零对白零目标；原kernel仍真实提交state/event/attempt回执。下一读取按原committed attempt消费，即使state仍空也不重买。不以消息数或“是否写了计划”判成功。

known invalid/stale及unknown原槽保留，不轮询重买；A未知不阻断B独立机会。response_received继续原受保护恢复链。仅确证cancelled_before_send、sent_at/response_hash皆空且原world/actor CAS完全相同的槽可沿已有zero-send recovery恢复原attempt；不换command/input或创建第二次付费身份。

旧档通过原legacy migration admission获得同一lazy资格，不重播bootstrap，不覆盖历史/时间/既有责任。显式paused在原advance入口返回，测试证实0模型。

## 文件范围

- NEW domain/actor-agenda-initialization.ts：grant类型和显式输入类型识别。
- NEW infrastructure/actor-agenda-initialization-repository.ts：只读授权资格、稳定身份、精确服务器输入与事务重验。
- domain/agent-runtime.ts、application/schedule-agents.ts、infrastructure/director-runtime-repository.ts：同一候选类型扩展。
- application/agent-schedule-collectors.ts：SchedulingView grant及原候选来源。
- application/run-agent.ts、infrastructure/agent-runtime-repository.ts：原accept和请求发送前fence。
- server/npc-agent-advance-services.ts：真实读取与原执行入口接线。
- infrastructure/agent-phone-entry-probe.ts：同源只读ready。
- NEW tests/integration/actor-agenda-initialization.test.ts、本文。

原模型/158协议编译器、NPC kernel、bootstrap、SQL和生产配置均未改动。

## 必要验证与限制

本地真实PG55629：新增原服务连续旅程10子场景+父测试，11/11通过，耗时约3.7秒。全部是明确合成模型，不冒充商业模型演绎质量。

1. 两个无议程人物各一次quiet，零假消息，原committed回执消费。
2. unknown不重买，另一人物可继续。
3. 并发同人物最多一次模型请求。
4. 暂停/无准入/定义变化无机会。
5. 伪造输入/跨owner拒绝，有旧目标不覆盖。
6. 原legacy migration→lazy grant→本人明确waiting计划真实持久；无deadline编造，不重播开场或改时间历史。
7. 原phone probe依次呈现未消费人物grant，提交后不重复。
8. accept后新增真实议程，预发送重验0模型且stale终态。
9. known invalid付费输出不重买。
10. 确证zero-send取消沿原attempt恢复，identity不变。

必要原服务回归：NPC_ADVANCE_TEST_PORT=55629 tests/integration/npc-agent-advance-service.test.ts，17/17通过（含B三个原服务旅程）。npx tsc --noEmit、check:boundaries（639文件）、git diff --check通过。未重复跑全量check/build，交root统一集成部署门禁。

尚未做：商业模型自然规划质量、生产启用/部署、持久分钟due执行器、公平轮转和已完成议程的无任务复盘。初始化机会不保证每个人立刻安排活动，更不等于人物已发送消息或世界事件已发生。root应先完成集成/public验证后再标最终完成。
