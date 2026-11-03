# STATE-SIMPLIFY-35：代码、模型输入、持久状态与调度消费者联合审计

日期：2026-11-03。负责人 root-state35；基线 e8a60caa。原档 `2fb97a4a-7282-4d75-8a5c-67faf44a3188`，仅本地克隆库。没有新增业务表、列或 JSON 业务状态。未改记忆模块、人物原稿、用户历史和模型配置。

## 1. 真实链路与状态所有权

`proactive worker / advance HTTP → npcAgentAdvanceServices → 收集既有行动、条件、人物事项 → 优先 dispatchPendingAgentEpisode → 无优先工作的人物才取得 own agenda review 资格 → readPrivateAgentSnapshot → NpcAgentModel → decodeNpcWire / compileNpcPlanIntents → kernel → 事务保存事件、人物状态、回执、Outbox → 原消息投影`。

导演分支：事件资格/真实变化 → 导演评估 → director_decisions/shared_episodes → agent_episode_requests → 同一 dispatchPendingAgentEpisode。导演请求不是已执行计划；NPC 决定仍必须经原入口保存。不是自主议程抢先消耗了所有导演任务：当前代码在自主复盘前派发已有合格任务。

|内容|写入方 / 权威依据|实际消费者|结论与处理|
|---|---|---|---|
|`agendaReview`|模型的额外理由/来源报告；只保留在原 response|解码器要求其存在并认证；不产生任务或持久人物计划|**新协议删除**。已授权的输入回执解释触发原因，statements/executions/planIntents 表达实际决定。旧 response 按旧协议解释|
|`selfAgendaContext`|从 actor.persona 再摘角色经历、动机、背景，再统计目标/计划/责任数|仅模型请求组装|**删除字段、构造函数和独立文件**。使用原 persona 和 state，未删原稿或真实任务|
|`goals`|模型明确目标或 plan intent 编译器自动创建|kernel 的计划/行动关联、结果完成、上下文、事件进度|存在重复：未指定 goal 时把 plan.summary 再写为 goal.summary。**尚未合并**，不能只删除后让 plan.goalId 和行动结果悬空；需要统一计划/目标关联迁移|
|`plans`|NPC planIntents 编译，经 kernel 保存|调度 action/trigger、nextAction、事件 followUp|保留实际安排。不是导演任务的同一对象；导演提出机会，人物可调整/拒绝其做法|
|`responsibilities`|明确待回答/待执行责任及玩家决定|问题承接、赴约、履约、条件唤醒|保留真实义务；不能用泛化任务取代接受/拒绝/暂缓范围。当前原档仅 1 条，不能声称大量重复责任已落库|
|`questions / decisions`|实际问题与本轮玩家语义判断，经内核应用|防重问、范围准确的选择承接|保留；普通聊天不能消费旧责任|
|`continuation`|NPC 另写下一步判断；服务端绑定 basisHash|`continuationConditions` 负责未被计划/责任覆盖的条件；`localContinuationSettled` 防同上下文重买|确有交叉但仍有独立消费者。**本批修正消费者**：`no_current_intent`/单独 `await_response` 不再被 `hasLiveNpcState` 当成活跃任务扩张普通聊天协议。未删旧条件等待或防重复证据|
|`episodeParticipations`|kernel 将人物选择投影进 actor JSON|来源可见性、并发依赖、初始化资格、事件生命周期、导演观察|和 episode receipts 的选择/理由/来源重复。**未删**：目前是授权快照的一部分，不能直接从 JSON 删除；迁移需统一 receipt 投影和所有这些消费者|
|`agent_episode_receipts`|同一事务的真实参与回执|请求消费、完整提交核验、生命周期|保留权威回执。不能只因与 state 相似就当冗余日志删除|
|`agent_attempts / input_receipts`|输入准入、付费领取、响应保存|幂等、恢复、unknown 防重买、复盘预算/窗口|保留；取消/失效记录需按引用和费用状态归档，不能按 status 批删|
|`world_events / world_messages`|事件权威 + 展示投影|历史回放 / 手机读取|用途不同；未当作可任意删除的重复数据|

## 2. 本批实际删除与修改

- 当前 wire v18 不再输出 `changes.agendaReview`，不再因它遗漏而产生 `NPC_AGENDA_REVIEW_SCOPE`。
- 调度触发本身不再强迫 `changes` 为对象；没有变更可为 null，有消息、即时行动、跨轮计划则沿用原字段。没有新增自动成功、兜底对白或额外模型调用。
- v17、v16、v15 以及更早已付费记录保留原解码语义；流式解析与普通解析一起接入 v18。历史 v17 缺少必要 review 仍按当时协议判定，不拿新规则改写旧结果。
- 删除 `actor-self-agenda-context.ts`，移除模型输入和重复说明；现有人格、目标、计划、责任和导演本人任务仍在。
- 修复 `hasLiveNpcState`：单独持有历史安静判断不再强制完整输出协议。活跃目标、计划、动作、问题、责任仍按各自状态判断；独立 `await_condition` 继续保留。
- 旧 self-context 单元测试替换为真实模型请求组装断言，检查人设、目标仍在且原快照不变；没有靠删除测试掩盖人格丢失。

## 3. 数据库实测（只读，不是磁盘账单）

v429 时：6 人 goals=0、plans=0；24 条 questions；1 条 responsibility；6 人 continuation 都为 no_current_intent。24 条事件请求中 20 consumed、4 pending。尝试状态有 3 unknown_after_send，必须保留原请求核对边界。

逐条比对 `actor_id/request_id/choice/reason/source_ids/world_version`：20 条 episodeParticipations 全部与回执相同。它们 JSON 序列化合计约 8.7KB；6 行 actor document 的 pg_column_size 合计 18,182 字节。这两个数计量方式不同，不能相除宣称数据库节省百分比。

此结果证明重复存储存在；不证明它导致当前没有消息，也不支持“清掉这些行就恢复主动性”。原档目前的直接现象是尚无实际个人计划、部分请求受旧付费结果保护。未把 pending/unknown 删除、重开或伪装成未调用。

## 4. 同一原档输入的前后对照

用同一当前世界、同一个人物状态和同一条原 wake receipt，分别经过 e8a60caa 的模型适配器和修改后适配器；拦截发送，不调用供应商。计量是 JSON 序列化字符数，**不是 token 或耗时**。

|人物|原 messages+schema|修改后|减少|
|---|---:|---:|---:|
|欣欣|47,126|45,411|1,715|
|舒雅婷|57,011|54,983|2,028|
|青青|45,300|43,408|1,892|
|刘胜男|51,480|49,347|2,133|
|林白语|43,294|41,043|2,251|
|李之之|48,433|46,152|2,281|

各人的 `actor.persona` 字符数前后相同。输入减少约 3.5%–5.2%，不能称为已大幅提速。原始计量 `.local/state35/measure.json`，数据库摘要 `.local/state35/audit.json`，不含密钥。

## 5. 验证与运行

- 真实本地 PostgreSQL `own-agenda-window05`：7/7，通过 v18 无重复报告的事务保存、一次接续、同命令不重买；旧 quiet/await_response、unknown/invalid/partial 边界不变。
- check/build 和本地运行结果在收口追加。
- 这次精简不能证明原档已持续主动演绎；必须分别记录真实结果，不能用受控 PG 的 quiet 成功冒充来信。

## 6. 未完成及后续顺序

1. 旧 4 条 pending 请求与已付费 attempt 的逐条恢复/终止归属；unknown 仅查询原结果，不自动重买。
2. 导演仍可能把邀请入口判成“等待玩家先提出”；人物承接后长期无下一步仍未解决。此处要依据作者机会、已下达本人任务和实际结果处理，不能用更多复盘或固定消息替代。
3. goals 自动复制 plan.summary 的存储合并：需同步 plan.goalId、actions、结果证据、事件退出与旧快照恢复。当前未实施，不能宣称目标/计划已合并。
4. episodeParticipations 转成从权威回执统一读取：需先替换来源认证、CAS 依赖和生命周期消费者，再迁移当前 JSON；不能仅删字段。原始事件与历史付费快照保留。
5. continuation 全面退出：先将独立条件等待迁入唯一的现有计划/责任，再以现有 receipt 接管旧 quiet 消费证明。本批只修误把静止状态当活跃任务的问题，未完成整个退出迁移。

本轮没有生产部署或数据清理。没有把原档无计划的问题算作已解决。


收口验证：`npm run check` 4176/4176、boundaries/typecheck 通过；隔离生产 build 通过；最后提示字段名称校正后 model 测试60/60。原档正常 advance 实测 `played=0, actors=[], no_candidates`，商业模型调用0，未强开重试。因此**持续主动演绎仍未通过**。

另一次只读大小检查：428 条 agent attempts 的 response 合计 6,037,826 字节；59 条 director attempts 的 snapshot 合计 11,485,335 字节、response 78,815 字节（均 pg_column_size，不是磁盘账单）。较大的保留项是运行快照/模型结果，不是原档不存在的 goals/plans。它们被恢复、来源核验和复盘预算读取，归档前必须替换对应消费者；本轮没有擅自删除。

本地更新：3218 PID85384（build-state35）、queue85385、proactive85386；health200，两个worker ready。本次未更新3219，未推送生产。运行就绪不代表主动演绎已通过。
