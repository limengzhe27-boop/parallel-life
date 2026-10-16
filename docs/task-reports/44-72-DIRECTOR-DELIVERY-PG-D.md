# 44-72-DIRECTOR-DELIVERY-PG-D · 导演交付活跃边界真实数据库验收

## 身份与范围

- Agent：`codex-ma44-director-delivery72-d`；会话 authored_eligibility_63；root 唯一公共源码/SQL/集成/发布负责人。
- 独立工作树：`/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`，分支 `codex/director-delivery72`，从 root `dd22fdc05b4ddf7986631bda27ebf25bde8bd1e7` 新建。
- root 后继依赖 `66244c70`（旧70诊断期望更新）本地 `27db6c02`；`fbe83a26`（发送与提交末尾活跃复核）本地 `af7ce930`。均只作为root依赖，本人未改旧测试/产品源/SQL/配置。
- 本人独占 NEW `tests/integration/director-delivery-activity.test.ts` + 本报告；主目录仅本人登记行/报告镜像。
- PG55505 启动前空闲，独立ignored runtime/数据目录；root55564等其他资源未碰。
- 更新时间：2026-10-15T18:27:23.964990+00:00。

## 当前接续点

- 状态：待验收；精确测试提交 `5b8534044d785f991791f3cdaf9d08da9049111e`，仅一个新测试文件。
- 新测试默认55505，CI显式配置 `DIRECTOR_DELIVERY_TEST_PORT`。
- 下一步：root集成测试/报告，统一check/build、READY及公网验收。本人没有推送/部署或激活生产能力。
- 阻塞：无；未发现新产品问题。普通NPC/player/wake不在本次修复验收范围，不据本报告声称它们已修复。

## 真实链路

复用70的合成内容/稳定reviewer/真实compiler夹具方式，仅落新文件。真实 PublicationRepository create/check/publish → PublicationWorldRepository.startPublished → compilePublicationGenesis → epoch2初始actor state → 显式new_genesis admission；实际 PostgresDirectorSnapshotRepository + npcAgentAdvanceServices + SQL75 Director runner/store/recovery。全部模型输出明确mock，不调用真实服务，不写假成功event/history/绑定/GUC。

## 实际专项证据

1. 初始四种状态（paused、managed away/inactive、managed active_until已过、实际private深聊focus）分别通过实际advance核实bootstrap **0模型/0attempt**，资格wake.deferred=true；完整相关行不变。恢复后同V0只购买/提交一次bootstrap quiet，重复tick不增购。
2. 真实scoped BEFORE INSERT trigger在claim事务内暂停clock：实际claim已产生reserved，但request_sent guard精确 DIRECTOR_DELIVERY_DEFERRED，runner保存cancelled_before_send。sent_at/response_hash均NULL、0模型/decision/episode/request。恢复仍V0，bootstrap得到新稳定cause，跨秒ID相同，恰1新paid，原取消记录保留。
3. 四种模型返回时状态变化（pause、away inactive、实际managed lease过期、切private深聊）分别精确DIRECTOR_DELIVERY_DEFERRED。原attempt是response_received且sent_at/raw/hash已保存；无decision/episode/request/世界事件。重复advance完整相关行相等，0新模型；恢复后由实际advance的75recovery提交原raw、原attempt/command/token/inputhash/snapshot不变，累计仍只有最初1次模型调用。
4. Timecause A在明确not_before满足后，深聊仍延期、不消费；browsing恢复后同cause，只新增一次考虑，旧bootstrap不重买。
5. Paid invalid bootstrap有sent_at/raw/hash，恢复/跨秒仍无后继command、无第二购买。Paid stale用模型期间实际saveNote使worldV+1，原始作者always资格仍eligible；stale仍消费bootstrap/已捕获资格，不靠窗口失效掩盖重买。Unknown保留同attempt/command/pending fence，暂停→恢复和新A时间到来均不产生新购买，活跃时精确UNKNOWN。
6. 真实travel产生new_condition后，在深聊中仍允许normal global协调；snapshot没有evaluationCause，模型看到真实focus，决策committed。这证明只限制新机会，未把普通实际全局变化全部关闭。
7. Actual owner/worker/V/epoch检查分别精确NOT_FOUND/NOT_FOUND/VERSION_CONFLICT/ENGINE_EPOCH_CONFLICT，相关完整行不变；更换已保护raw精确DIRECTOR_RESPONSE_CONFLICT，直接改raw被真实SQL23514禁止。response_received随后实际advance0模型恢复。
8. 晚期shared_episodes INSERT scoped故障发生在decision已尝试写入之后；整个Director事务回滚，decision/episode/request/进度提交都不留下半份，原raw response_received保留。清除故障后实际recoverDirectorAgent提交同raw/同attempt，0额外模型。已committed回执在paused时重放仍只读原receipt、0模型。

## SQL执行期间自然到期的最终边界

root补fbe83a26后新增2个真实反例，不把activity lease与attempt执行lease混为一谈：

- **发送末尾**：实际browsing租约，claim事务scope触发器把本world active_until设为2秒后的真实instant；request_sent UPDATE触发器先检查activity尚活跃、用nextval非事务探针证明已到达该SQL，再pg_sleep跨实际deadline。最终guard回滚request_sent事务，外层取消为zero-send，sent_at/raw/hash仍NULL、0模型；actual clock原始paused=false/managed=true/expired=true；attempt lease实际仍大于当前时间60秒。resume后恰1paid后继。
- **提交末尾**：明确mock返回拟议opportunity前，设置实际browsing activity及2秒active_until；最终agent_episode_requests INSERT触发器先断言仍live、探针确认到达，再sleep到过期。此时decision、episode、attempt committed UPDATE均已在同事务走过，最后活跃复核仍把整笔回滚为原response_received，decision/episode/request各0；原sent_at/raw/hash完整，attempt执行lease仍>60秒。恢复后实际75recover同raw、0额外模型，产生恰1decision/episode/request。

这些2秒deadline只属于专属合成测试的真实managed lease控制，不改产品clock策略、作者story window或新增产品硬期限。临时触发器/函数/序列均有finally清理；probe只验证SQL确实执行到目标位置，未伪造业务事实。

## 最终检查

- `DIRECTOR_DELIVERY_TEST_PORT=55505 node --experimental-strip-types --test tests/integration/director-delivery-activity.test.ts` → **20/20 pass，0fail/skip**（父+19专项），最终约15.8秒。`.local/delivery72-pg.log`。
- `tsc --noEmit`：退出0，无诊断，`.local/delivery72-type.log`。
- `npm run check:boundaries`：**564 files passed**，`.local/delivery72-boundaries.log`。
- 新测试Prettier check、git diff --check通过。
- 所有测试世界6个旧publication剧情计划/节点/进度/回执/开场批次/投递表各0。结束实际catalog查询所有 `delivery72_%`函数=0、序列=0。
- PG55505正常SIGTERM，工具session退出0，随后无监听。本人工作树干净。
- 0真实模型、生产、浏览器/UI；按root分工0fullcheck/build；不承诺普通NPC/player/wake已修、完整叙事完成或已部署。

## 过程及集成

dd22+662依赖首轮18/18实际通过；接fbe最终边界依赖后新增2项，最终20/20。没有弱化失败产品断言或自主修改公共代码。root负责最终合并/全检/发布状态，主表保持待验收。

## 实际advance安静延期契约修正复验

root联合64原验收发现，实际advance在导演期间发生暂停时应返回安静结果；底层repository仍用DIRECTOR_DELIVERY_DEFERRED保护发送/提交。root修复 `93e8ce1c` 已作为依赖接入，本地 `c51179b4`；本人未改公共源或旧测试。

本次精确测试增量 `f5812ff65750192f6bff7af666f97a8120bdc591` 只改新72文件四处actual h.advance预期：由DEFERRED rejects改为played0/folded0/summarynull/actors[]，每处仍只有一次advance调用。其余zero-send/raw/status/完整rows/模型次数、发送和提交末尾实际SQL自然到期探针断言全部逐字保留；invalid/stale/unknown/晚故障等错误断言不变。底层错误没有被当作成功决策，实际wrapper不伪造DirectorDecision。

依赖后focused真实PG再次 **20/20 pass，0fail/skip**，type退出0、focused format/diff通过，日志 `.local/delivery72-quiet-{pg,type}.log`；此前边界564结果仍有效（本次imports/文件范围不变）。最终catalog临时delivery72函数0/序列0，专属PG55505正常停止/session0/无监听。测试源和报告冻结，状态待root统一集成/全检/READY/公网验收。

## 普通无cause Director零发送后继增量

发布前root/C发现普通global frame没有evaluationCause，零发送取消后原frame command固定，恢复会卡INVALID_STATE。root修复 `9c51f896` 已作为依赖接入（本地 `6592a723`），并接入ID字节排序后继 `3367a574`（本地 `29cae64d`）。本人不修改这两个公共源。

本次测试增量 `8525303d2e7c23a6daf943fdecb7db3d7ac13587` 仅在本人NEW72文件新增1项真实测试，原20项逐字不变：

- actual bootstrap quiet使原always资格已被考虑；实际travel/new_condition产生worldV1普通global snapshot，evaluationCause明确不存在，初始readUnsentFrameAttempts为空。
- 仅匹配本world且snapshot无cause的claim-local trigger暂停clock。实际advance返回quiet/played0，Director模型累计仍只有bootstrap的1次；新ordinary attempt保存cancelled_before_send，sent_at/response_hash均NULL，只有原bootstrap decision，0伪造新决策。
- 暂停重试完整相关行相等。resume仍worldV1/no cause，实际readUnsentFrameAttempts精确返回原零发送attempt ID；跨故事秒数仍相同数组。实际advance产生恰1个新普通global committed，物理command与取消记录不同，原记录完整保留；重复tick不新增调用/attempt，worldV仍1。
- 同项另建真实publication世界的普通global frame，模型transport明确throw后得到paid unknown；readUnsentFrameAttempts实际返回空，重复advance精确UNKNOWN，原attempt/command与调用数保持，不把paid/unknown伪装为零发送前驱。

最终root两依赖上实际PG **21/21 pass，0fail/skip**，type0/边界564/focused format/diff通过；日志 `.local/delivery72-frame-final-pg.log`、`.local/delivery72-frame-type.log`、`.local/delivery72-frame-boundaries.log`。原invalid/stale/unknown、quiet deferral、raw recovery、两最终SQL到期边界断言全部保持通过。

专属PG55505再次正常SIGTERM，session0/无监听；最终catalog临时delivery72函数0/序列0。主表和报告镜像同步，仍待root联合check/build、最新部署READY及公网验收。0本人公共source/SQLmigration/旧测试/CI/真实模型/生产操作。
