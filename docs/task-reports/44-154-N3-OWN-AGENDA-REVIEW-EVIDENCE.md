# 44-154-N3 · own_agenda 原始提交证据只读认证

负责人 codex-agenda154-n3；root 为唯一公共准入、预算、SQL、接线、集成与部署负责人。author-eligibility63/人生剧本，分支 codex/own-agenda-review-evidence154-n3，从 N2 报告 77dce708 开始，运行源基线117b9c48；未包含 root 新 M/O 在制公共修改。主登记目录唯一任务行已先短锁登记范围。本包待 root 集成验收，不是整个44-154完成。

## 冻结提交及范围

1. **edd3a4a5b809653ba34136dfe1445f73079c053a**：root明确授权的最小 N2 后续补丁，导出原 `ownAgendaReviewFamilyId(identity,anchor,digest)`，原 evaluate 复用同一实现，无行为放宽；原38测试内补共享身份一致性断言。未改写旧 N2 冻结提交。
2. **08fc3c1464d531920a95d6dec30eb4bd35c77c8d**：仅 NEW `src/modules/world/infrastructure/own-agenda-review-repository.ts`、NEW `tests/integration/own-agenda-review-evidence.test.ts`。
3. 本报告另行冻结；主表/报告镜像只更新本人范围。

无公共 SQL、server、phone、NPC协议、原执行器或内核改动，无真实模型、生产读写或部署。未运行全check/build，按 root 本包限定只跑针对性检查；全量集成/生产验收保留 root。

## 读取与认证契约

`readOwnAgendaReviewEvidenceInTransaction(sql, ownerId, identity)` 返回 `worldVersion`、`actorRevision`、`anchor|null`、`familyId|null`、`attempts[]`、`actorBlockers[]`。调用方使用原 owner transaction；单次 SELECT 一致快照，0锁、配置更改、数据库写、source登记、预算预留或模型调用。

- 原 world/epoch/actor state 文档和列、角色、owner上下文与当前 actor definition 一致；复用原 `agentDefinitionRef`，不另造定义hash。
- 对该 actor 原 attempts 跨 epoch 读取；receipt关系、ID/hash/origin/channel/时间/目标人物逐项验证。范围错误 fail closed。
- 当前 epoch committed attempt 必须有同 owner/world/actor 的真实 world event 和 succeeded command；精确关联 command/event/expected version，真实版本必须 expected+1 且不超过当前世界。
- **只以 `agent.state_committed` 原私人状态提交路径作为本包 anchor**。验证真实 command payload/hash、runtime input receipt/story/version/epoch、actor revision、actual stateAfter 的schema/world/actor/revision/projected version/definition以及story时间边界。该类型可能有合法计划或行动，不能从类型自行推断连续quiet次数。
- anchor 时间来自真实 `world_events.occurred_at` 和事件storyAt，不取易变attempt.updated_at。选当前定义下最新真实提交版本；消息事件不冒充此包anchor。
- 复用 N2 单一 family helper，身份含 world/epoch/actor/definition/anchor attempt/event，不含policy/tick/currentWorldVersion。
- wake review envelope严格JSON对象逐字段校验，不用 LIKE；检查精确键集/type/family/grantId/anchorAttemptId/policyVersion/basisSourceIds，以及本人私人通道、真实前驱锚、时间与版本。旧epoch不能冒充当前family。
- 当前family的**所有policy和transport**原status/sent/raw-presence摘要均返回，不能通过policy升级漏掉历史paid/raw/unknown。不会输出raw或私人全文。
- 同 actor 任何family/epoch下的 reserved/request_sent/response_received/unknown_after_send 作为单独 `actorBlockers` 返回；上层必须先处理，再计算 N2。旧终态普通raw不自动冻结全部未来family；保护结果和原身份恢复仍由原运行机制处理。
- 防资源滥用上限4096条历史，查询4097条探测；超限抛history_limit，不静默截取“最新一部分”后错误授权。

错误 `OwnAgendaReviewEvidenceError` code=INVALID_OWN_AGENDA_REVIEW_EVIDENCE，reason 为scope/receipt/committed_source/envelope/history_limit；不存在/跨owner world走原NOT_FOUND。

## 验收证据

独占本工作树 PostgreSQL18.4 **55634**；启动前确认端口空闲，不借 root DB/进程。真实PG测试 **8/8、0skip**，最后重跑成功（父测试+7子项）：

- 真实 F grant→原accept→readPrivateAgentSnapshot→原runNpcAgent→原PostgresNpcAgentKernel，显式合成模型一次quiet，0商用provider；真实 `agent.state_committed` 与成功command/stateAfter形成最小锚。
- 无锚无新授权；跨owner、错误epoch/actor/definition拒绝。
- 同family跨3个policy的invalid_output/raw、stale/raw、zero-send都保留，给N2使用新policy仍paid_fence。
- reserved/request_sent/response_received/unknown分别保留；其他family和旧epoch活跃项进入独立actorBlockers。
- 额外字段、假锚、伪family/definition、错误basis类型、旧epoch洗白拒绝。普通player发送类似JSON不是review授权。
- 借B的receipt认证A拒绝；伪committed借用已有真实事件拒绝；缺真实事件由原数据库FK拒绝23503，无关闭约束或触发器。
- 每次reader运行于真实 `READ ONLY` transaction，并断言恰好一个SELECT。正例原锚均真实runner/kernel；后续反例和跨policy账本用显式本地admin fixtures，不冒充review已获runtime注册或已真实发送。

命令：

- `node --experimental-strip-types --test tests/integration/own-agenda-review-evidence.test.ts`：8/8。
- `node --experimental-strip-types --test tests/own-agenda-review-policy.test.ts`：38/38。
- `npm run typecheck`：0错误。
- `node scripts/check-boundaries.mjs`：645 files通过。
- 两个NEW文件 `prettier --check`、`git diff --check`：通过。

运行过程首次误用不存在的tsx loader，启动即失败、未进测试；改为项目原node strip-types命令后真实PG两次通过。首次tsc发现测试query代理重载和可空索引问题，改为保留原SqlClient签名的Proxy及已验证索引后重跑0错误。未把这些失败计为通过或真实模型调用。

## Root接续与未完成事项

本包只提供证据。仍须 root N4 把accept前、发送前 source/permission/版本/预算原子预留、原receipt恢复、current-holder核验和全actor protected/unknown处理接入原运行链路；不得拿本reader或N2 ready直接发模型。预算只读也按root约定留待公共接线，本包没有以空预算模拟可用额度。

本包不推断联系理由、不创造用户责任、不把沉默变同意、不写NPC台词。普通提问去重和人物选择仍沿原questions/focus/replyAssessments/withdrawals/responsibilities/decisions。无真实model/手机流程/公网演绎验收，不主张首次主动联系、多NPC持续调度或整体154已完成。生产版本与上线验收以 root 主登记/DEPLOYMENT 为准，本工作树禁止部署。
