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
