# 44-58-NARRATIVE-STORE-P

状态：待验收；唯一负责人 `codex-ma44-narrative-store-p`。root 是公共接口、SQL81、kernel/server/CI 与最终集成、部署负责人。

## 范围与依赖

- 工作树：`/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本`；分支 `codex/narrative-store44`。
- 起点：root `47339d87`；明确接收 root `c9f54c84` → 本树 `f0dd30cc`，`95c37905` → `6f917871`，`86130cc9` → `5e3995ca`，`492eec05` → `7d8ee79a`。
- 本人只新增 infrastructure/agent-narrative-repository.ts、tests/integration/agent-narrative.test.ts、本报告。已有公共代码、SQL、配置、测试保持只读；依赖修改均为 root 冻结提交的 cherry-pick。
- 本轮 0 真实模型、0 生产写入、0 浏览器、0 check/build/发布；root 统一做最终检查、迁移、READY 和公网验收。没有发布原稿世界、没有改玩家存档。

## 最终接口与行为

所有 helper 只使用 caller SqlClient，不开连接/事务，不设置 commit GUC，不执行模型/调度，不初始化 actor，不切 epoch。

1. `admitNewAgentNarrativeInTransaction(sql, owner, {worldId, engineEpoch})` → NarrativeAdmission。
   - app 非 worker、正确 owner、当前 epoch≥2、world version=0、实际 SQL `md5(initial.state::text)`；SQL 再验证所有 cast 初始化 revision/projected=0 且无尝试。
   - 同一 admission 重放只读；世界已前进仍返回原准入，不重置剧情或观察游标。无 admission 的旧世界只读 cause 返回 null，实际玩家回合后不能补准入。
   - 新准入建立 version=0 的空 director_observed_states；不制造 opening event。
2. `readDirectorBootstrapCauseInTransaction(sql, owner, {worldId,engineEpoch,worldVersion})` → DirectorEvaluationCause|null。
   - 一个只读 SQL statement 同时读取当前 world/control/admission/initial hash 与相同 genesis 的 bootstrap 尝试元数据；不读取其他尝试全文/私聊。
   - ID=`bootstrap:`+SHA256(JSON.stringify([worldId,String(engineEpoch),genesisHash]))；不含当前世界版本或墙钟。
   - reserved/request_sent/response_received/unknown_after_send 保留原 cause 供恢复；committed/invalid_output/stale_discarded/cancelled_before_send 任一终态关闭该 cause。不根据时间买新调用。
   - 已准入新世界先有三轮真实玩家交流，cause 仍相同，不重开历史。
3. `createEpisodeRequestsInTransaction(sql, owner, {worldId,engineEpoch,decision})` → AgentEpisodeRequest[]。
   - 实际75 committed attempt+decision+shared episode；传入完整 decision 必须与真实 JSONB document 深比较一致。
   - 每 opportunity 的实际 participant 一个稳定 pending 请求，锁 world/control，顺序处理 episode/actor；消费后重放返回 consumed，不覆盖旧记录。
   - 只含有限枚举/引用/版本；没有标题、描述、全局 audit、作者全文、全局地点资料进入 NPC 请求。
4. `readPendingEpisodeRequestsInTransaction(sql,owner,{worldId,engineEpoch})` → AgentEpisodeRequest[]。
   - 当前 owner/current epoch、pending、createdVersion/id 排序。模型前一直 pending 且 input/receipt 双 null。
5. `projectEpisodeRequestInTransaction(sql,owner,{attempt,eventId})` → AgentEpisodeReceipt|null。
   - actual accepted origin=coordination/channel=private、真实 request/actor、strict 六键 typed body、revision0、placeOptionIds=[]、basisSourceIds 仅 `definition:<该角色 definitionRef>`。
   - 核对 DB committed attempt 的 token/command/input/hash/epoch/expected versions，实际 succeeded command、event/world/version/actor/runtime、输入来源、受保护 completion snapshot 和参与决策的合法 source 集。
   - 实际 event.proposal.episodeDecision 与 event.episodeDecision 精确一致。遗漏均记 unassessed/reason=null/sources=[]；不从回复文本或数量猜意愿。
   - assistant message IDs 来自本次实际 event/actor 的投影，按 ID 排序。普通玩家输入或其他 coordination 返回 null；同形玩家文本没有消费权限。
   - 在原 kernel finish 后的同 SqlClient、同实际 GUC，先 INSERT receipt，再内部 `consumeEpisodeRequestInTransaction` 一次 UPDATE inputReceiptId+receiptId+consumed。没有导出/保留 premodel bind 路径；SQL deferred FK 禁止提交半回执。
   - 只有 choice=engage 且本次确有 assistant 消息，才锁共享 episode，revision+1/status=active/追加真实 sourceEventId，保留其他全部字段。不会 resolved/推断结果或目标完成。
   - 已有相同 receipt 的回放只读，不要求当前 epoch/version/definition 仍与旧回合相同，也不二次推进 episode；缺 receipt 不借 replay 补权。

## 关键设计修订和缺陷证据

- root 在真实入口并发审查后将原“模型前绑定 input”收敛为上述同 kernel 原子消费。原因是 actor A/玩家先推进世界时，旧预绑定 input 可永久卡住 pending 请求。本人删除了初版绑定实现及其测试，不保留两套流程。
- 初版真实 engage + assistant 消息触发 SQL81 `guard_agent_episode_progress` 的 42883 `boolean -> unknown`。本人先上报实际错误栈/internalQuery，未修改 SQL；root `492eec05` 为 status 与 @> 两侧 JSON 操作加括号。只重建本人全合成 testDB 后最终链路通过。
- 旧草稿首轮的通过/失败不冒充最终验收；最终证据均基于原子消费版81及 root 运算符修复。
- 负向 SQL 测试只构造实际 kernel event 对应的待插入 unassessed receipt；没有伪造 epoch2 历史、参与判断、结果或事件。直接 SQL 的无效提交在整事务里被拒绝。

## 验证

最终本机真实 PostgreSQL 18.4，127.0.0.1:55566，独立 `parallel_life_test`，app/worker 角色、owner RLS，全合成数据。

- 新 integration 文件：15/15 nodes（14 子项+父项），0 skip；每项真实 repository/kernel/SQL，模型全部显式 mock。
- 新准入 md5/无假 event/幂等；未准入旧世界不补开场；world v3 前序玩家回合保留原 cause。
- cause 正常 reserved→request_sent→received→committed 及全部终态/unknown 恢复抑制。
- 实际 director bounded opportunity→独立请求；完整 decision 篡改拒绝，request 无 SENTINEL 私密 audit/description。
- A decline 不开始；B 用当前 v1 实际 engage+消息→active/revision1，正常及后续世界/epoch推进后旧 receipt 回放只读，无重复消息/事件/回执。
- 无参与 annotation、有文字仍 unassessed；quiet/defer/need_information、有 engage 无文字都不 active。
- 六种 malformed body（额外字段、全局地点、作者 source、null basis、字符串 revision、null 地点数组）分别在 repository 与真实 kernel 内 direct SQL 两层拒绝，world/event/消息/command/receipt 全回滚。
- 未知 request、玩家同形文本和普通 coordination 不获得参与权限；worker/foreign owner/epoch 各自拒绝。
- 实际 receipt 插入后人为抛错：原 actor revision/world/event/command/消息/receipt/consumed/active 全回滚；response_received 保留，恢复只用已保护结果，0 第二次 mock 模型调用。
- deferred FK 拒绝半 receipt，current commit GUC 缺失拒绝首次投影，错误 token/command/hash/revision 拒绝；unused old accepted input 不提前锁住请求，新 frame 输入可正常消费。
- `npm run typecheck`、定向 Prettier、`npm run check:boundaries`（558 files）和 diff 检查通过。完整 check/build 由 root 集成后执行，不在本任务抢公共构建。

## 集成接续点

- root 将 admit 接显式新世界 setup；snapshot reader/claim CAS/actual advance 调用同一个 bootstrap helper，禁止外部拼 cause 当权限。
- root 将 create/readPending 接真实 director advance；模型前不绑定。实际 attempt 的 paid/unknown/invalid/stale 恢复、同 frame 稳定命令与禁止重购策略由原 attempts/root 调度控制，本 helper 不另建任务队列。
- root 在 NPC kernel 正常与重放 afterCommit 同时接 project，保留既有 native task/awareness 回调；缺 receipt 的历史 replay 不补权。
- CI/根联合 PG 使用 `AGENT_NARRATIVE_TEST_PORT=55476`；本测试默认55566，有端口/专用数据库/本机角色边界。
- 本报告为存储层与 actual kernel composition 的待验收交付，不宣称完整 NPC/导演调度已上线或真实人格表现已验收。用户给出的真实模型额度只由 root 核实并统一记账；本人没有消耗。
