# 44-69-ORDINARY-DELIVERY-REVIEW-C

## 身份与范围

- Agent：`codex-ma44-ordinary-delivery69-review-c`，会话 `/root/episode_context_61`；root 独占所有产品源码、公共契约、SQL、集成和发布。
- 工作树：`/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本`。仅新增本报告、主目录同名镜像和本人主表行。
- 2026-10-16 开工前已按主表短锁登记；只读审查 root `/Users/limengzhe/.codex/worktrees/history-chat-media/人生剧本`，起始 HEAD `485e41f5018704374724142690f6cf0fe1440f58`，含 `e28498ae` 新 episode 发送门槛。
- 0 产品/SQL/测试/配置修改，0 DB、模型、端口、浏览器、full check/build 或部署。本报告是静态调用链分析，不是真实故障复现或实施结果。

## 结论与最小方案

现有普通 player/wake/native NPC 路径缺少中央发送前活跃检查。不能只补暂停 guard：必须同时完成已确认零发送取消在原 attempt/command 上的受控恢复，否则普通私聊会变为错误、wake 会永久被 blocker 排除、native task 无法使用现有恢复接口。

最小建议是：统一 NPC 活跃 guard + 一种受审计的原 attempt 续接能力。保持 accepted input、外部 command、native task 和 child command 不变，只旋转执行 token/lease；不使用 Director/bootstrap 的“新 command 后继”模式。先限定同 epoch/worldVersion/actorRevision 的零发送恢复，实际变更后保持明确冲突，不偷偷改写不可变帧。

## 已核对的真实入口与缺口

|入口|实际链路与身份|当前暂停/恢复行为|
|---|---|---|
|私聊 player|`src/app/api/v1/worlds/[id]/messages/route.ts:27` → `npcAgentServices.sendMessageIfEnabled` → 原 `command.id` 的 accepted receipt/attempt → `runNpcAgent` → `NpcAgentModel` → kernel|服务先 accept 后于 `npc-agent-services.ts:184` 检查已读取的 clock；暂停能发生在此后至发送之前。lookup 将 reserved/request_sent 判 BUSY；取消态判 INVALID_AI_OUTPUT，不能恢复。receipt 只读查询仍可保留原 command。|
|主动 wake|`npcAgentAdvanceServices.advance` → 原候选 → `execute` → `agentWakeCommandId(world,candidate.id)` → accepted wake receipt → 同 runner/kernel|`npc-agent-advance-services.ts:172,271` 的 clock 检查早于执行。wrapper 在 `:318` 把所有 cancelled_before_send/stale_discarded 当 stale_projection 永久 blocker；执行时仍使用原稳定 command。|
|群聊/现场 player|既有原生输入事件/receipt + 原 task → `nativeNpcTaskHandler` → `nativeAgentCommandId(task.id,actorId)` → `withLeasedAgentDatabase` → 同 runner/kernel → `finishNativeAgentTask`|`npc-agent-channel-services.ts:155` 仅前读 clock。取消态由 runner 拒绝；`recoverAgentTaskInTransaction:74-78` 只允许一个 response_received completion，0 attempt 或零发送取消都不能续接。普通 task retry 不应落入通用 enqueue 换 task。|

共同缺口在 `agent-runtime-repository.ts` 的 `mark(request_sent)`：当前只为 episode coordination 调 `requireEpisodeDeliveryInTransaction`；普通 player/wake 虽检查 world/epoch/actor revision/receipt scope，却没有同事务暂停与 managed active_until 检查。`readableActivityClock` 会把已过期 managed lease 投影为 paused，但只是入口读取时的结果，不能覆盖后续竞态。

普通内核当前在 `npc-agent-kernel.ts:125-135` 检查 world_clock：已有 postpaid 暂停保护，但既不锁 clock，也不在所有 SQL/afterCommit 后重新采样。应复用 71 的最终 SQL 后活跃复核思路，并用 `new Date(pgDate).getTime()` 保留 PostgreSQL Date 的毫秒精度。

## 统一 guard 的准确位置

1. 将现有 `agent-delivery-activity.ts` 的纯活跃规则抽为共用 helper/返回值，或增加明确 NPC 调用参数。规则仍只有 owned world + clock：paused、managed 且无 active_until、或 lease 已过期。为普通 NPC 使用清晰的内部暂缓错误，不借用“导演失败”或“episode 授权”。无 clock 的旧存档沿当前 fallback，不能暗中采用新权限。
2. 所有 NPC 的 `mark(request_sent)`，包括 `markRequestSentWithSources`，在原短事务中执行 world → clock 锁及锁后 realNow 采样；完成原 receipt/source/state/epoch/token/lease 验证，再更新 sent_at。SQL 更新之后、事务返回网络调用之前再次采样活跃状态，过期就整段回滚。不能持事务跨模型调用。
3. claim 前可做廉价活跃检查以少建 reserved；它不替代 mark 的最终 guard。真正 pre-send DEFERRED 时将原预约明确变为 cancelled_before_send，保持 sent_at/response/response_hash 全 NULL，并写可区分暂停取消的持久证据。未确认的 reserved 或 request_sent 不能仅因超时被认作可重发。
4. 内核在已有 world lock 下取 clock lock；提交开始检查一次，`finishAgentCommit`、awareness、episode projection 及 native afterCommit 全部完成后再检查一次。失败回滚 event/state/receipt/task success；先前独立保存的 raw 保持不动。readonly committed replay 不新增业务写入/网络。
5. 不将 episode 深聊 attention 政策套给普通 player/wake/group/scene：普通责任只受活跃检查及各自已有 audience/source/capability 约束。episode 继续叠加原注意力门槛。
6. native facade 已先锁 task 再锁 world，保留 task → world → clock 的锁前缀；普通私聊/wake 为 world → clock。不能在持 world 后另取可能已被 native worker 持有的 task 锁，制造新的相反锁序。

## 原 ID 续接协议

建议新增一个小的基础设施恢复操作，或在 claim 的 old-row 分支实现相同协议。root 已选定后者：经 current authority/activity/frame 重验的真实零发送取消，在原 attempt 旋转 token/lease，返回 `replay:false`，明确该次取得发送资格；不能仍返回普通 replay 然后被 runner 判 PENDING。root 计划由新 SQL82 独立 ledger 提供凭据，不修改旧 76。

- 事务内锁原 world、原 attempt；native 先锁原 task。只接受新 guard 的明确取消证据、`cancelled_before_send`、sent_at/response/response_hash 全 NULL、无 event，且无其他 active attempt 占同 actor。
- 验证原 accepted receipt 的全文/hash/channel/recipient、原 epoch、实际 worldVersion/actorRevision、当前输入权限、来源遗忘及新 author source gate；wake 还要确认原 semantic candidate 目前仍成立，不能把另一个新理由塞进旧 command。原 task/inputEventId、task input/hash、原 group/scene audience 也不变化。
- 追加不可变恢复证据，记录原 attempt、prior token/lease、next token/lease、用途和取消依据；CAS 将原 row 改回 reserved，旋转 token，给予有界新 lease。一次只有一个调用取得资格；其他调用看到 reserved/request_sent 就安静等待，不接管、不重发。
- 重新构建授权 snapshot 后走正常 request_sent guard，不能跳过 67 的 mandatory directive/source/state/private_strategy 校验。仍在暂停则再次确定性取消，而不是调用模型。
- 保持 attempt.id、commandId、inputReceiptId、inputHash、epoch、expectedWorldVersion、expectedActorRevision 不变。accepted input 的 storyAt/receivedAt/text 不重写；当前 snapshot.storyAt 可重新投影，但不能据新时间擅自升级原输入来源或旧条件资格。
- 若 world/actor/epoch 已改变，原 frame 不可续接；输出明确 VERSION_CONFLICT 并保留原消息/历史，不能为了“原 ID 成功”改写原 immutable frame。新世界版本如何显式重新准备是后续产品协议，不在本次最小自动恢复范围。
- 不自动重开 `stale_discarded`：其中可能有付费/失权/定义变化。即使当前 sent_at 为 NULL，也须有具体可恢复零发送原因和完整重新授权。`unknown_after_send`、request_sent、任何 raw/hash、paid invalid/stale 一律不能进入“新发送”续接。

## 三个调用边界需要一起适配

### 私聊与回执

`npc-agent-services.ts:164-182` 应将已确认的零发送取消路由到同 attempt 恢复，不再归 INVALID_AI_OUTPUT；临时暂停使用现有 INVALID_STATE 中文提示。继续用原 external command 重发原 POST，`store.accept` 按 command 返回原 receipt，`lookupMessage` 与 receipt endpoint 仍查询原 command，committed 后返回原 command 对应的唯一结果。不得 mint 新 external command 或把旧 receipt 404 当重买许可。

### 普通 wake

`read.prior` 当前只有 status，须加真实 sent_at/response_hash 或由 repository 给出受审计的可恢复证据。collector 仅对明确、同帧零发送取消解除 stale_projection；其他 invalid/stale/paid/unknown blocker 原样保留。仍使用 `agentWakeCommandId(world,candidate.id)`，不加时间、取消次数或随机后缀。runner 复用原 attempt 恢复，不买新的模型请求来决定“是否恢复”。

### native task

原 task 不能因暂停变成假 succeeded，也不能掉进 TaskRepository 通用 retry 的新 enqueue。先用当前既有失败/取消状态表达可恢复业务暂缓，配合实际零发送证据，避免报 AI_FAILED；无需为最小方案新加 task status。worker 的 aborted/timeout 默认 unknown 不能仅靠异常文本降为零发送，恢复必须以 DB 证明区分。

扩展 `recoverAgentTaskInTransaction`：

- 原 task 有零发送取消 attempt：恢复原 task.id（queued、清旧 queue lease），保存原 child command 和 actor 选择。task retry 时 attempt 先保持 cancelled；下一次 worker 真正执行 claim，才按 82 续接原 attempt/new execution token，避免 queued 等待期间持续占用 actor。queue 新 lease 不改 task id/input/hash。
- 早期暂停发生在 actor claim 前、确有 0 attempts：现有恢复会拒绝。允许一条单独的确定性 re-prepare 分支，仅在原 native source/receipt/task scope/epoch 验证通过且不存在该 task 的任何已发送/unknown child 时原 task 重排；首次 actor 尚未选定时不伪造旧 actor。环境任务与非 NPC task 不能由此直接获 NPC 授权。
- 已有 protected response_received：保留现有 76 known-raw 恢复路径及其原 task/attempt、旧 token 失效、原 raw/hash，不走零发送重开。
- request_sent/unknown_after_send 或未证明终止的 reserved：保持阻断，不因 task failed/unknown/cancelled 就产生新 task 或 paid child。
- 继续验证 `finishNativeAgentTask` 的原 task lease + child command + input event + 实际 kernel event；任务 success 与内核提交必须仍原子。

具体最小改位与 queued 继续方式：

- `agent-task-recovery.ts:74-78` 在现有 response_received 分支之前接入明确零发送取消；不要 return null，否则 `TaskRepository.retry:151` 会新 enqueue。unknown/paid 仍沿旧分支拒绝新发送。
- 新 task retry command 的幂等 receipt 也须落新 82 ledger 或该迁移的独立 task requeue receipt，绑定 owner/recovery command/original task/immutable input/zero evidence；重放返回同 task。不能伪造旧 76 的 `protected_completion`、`outcome='requeued'` 记录。
- `withLeasedAgentDatabase` 的 after check（`:93`）只接受 running/succeeded，所以不能在它的回调里直接把 task 设 queued 后返回成功。先按既有 worker finish 语义结束已暂停执行，再在普通 `TaskRepository.retry` 事务重排。
- `POST /api/v1/tasks/[id]/retry` 当前只返回 202 queued，不执行模型；之后现有 `/api/v1/tasks/[id]/run` → `runOwnedTask` → `claimForOwner` 即可继续原 task。群聊原 messages PUT 的 `runGroupOwnedTask` 也可执行同 task；它只运行 queued/running。无须为暂停再发送一条群输入、建新场景 action 或新任务。
- `nativeNpcTaskHandler:308` 已从同 task 的 prior attempt 固定已选 actor；`:323` 的 child command 保持 `nativeAgentCommandId(lease.id,actorId)`。cancelled 时重建 native snapshot，paid response_received/committed 仍传 null 走原 raw。
- wake 的精确位置为 `npc-agent-advance-services.ts:191-208` 的 prior 元数据、`:318-328` 的 blanket cancellation blocker，以及 `:539` 原 command/claim 调用。`agent-schedule-collectors.ts:596` 的通用 active blocker 原本仅阻挡 reserved/request_sent/response_received/unknown，无需全局放开所有取消或 stale。

## 数据库约束：哪些需要新迁移

|现有约束|结论|
|---|---|
|72 `agent_input_receipts` immutable trigger、`UNIQUE(world_id,command_id)`；attempt 同 command 唯一|保留。解释了为什么不能复制新 attempt 并沿用旧 command；accepted 输入也不能换正文/时钟。|
|72 `agent_attempt_one_active_actor` partial unique index|保留。原 terminal→reserved 时须先检查其他 active actor 预约，并由该索引兜底，不能释放他人 attempt。|
|76 `agent_attempt_identity_fence` 固定 id/world/actor/command/input/hash/epoch/expected versions|保留。原 ID 续接不应放开这些字段；同帧方案无需改 identity 字段。|
|76 token/lease 分支仅允许 `response_received`、已有 hash、匹配 `agent_task_recoveries` 记录|**必须以新迁移扩展**才可安全旋转 cancelled-before-send 的 token/lease；纯 TS 改 status 不足。不能直接关闭该 trigger 或假造已有 paid recovery。|
|76 `agent_task_recoveries.task_id NOT NULL`、task FK、outcome 条件与 immutable ledger|不能直接用于无 task 的私聊/wake。最小建议另加 append-only attempt resumption ledger，owner RLS/FK/唯一 next token/prior token CAS，trigger 在严格零发送分支核对它；保留 76 paid ledger 原规则。若扩既有 ledger，则需显式迁移其 task-null/purpose/FK/check 语义，范围反而更大。|
|72/76 当前没有 NPC `sent_at` 已非空后不可清空的 SQL trigger；75 Director 有独立保护|新“只信 sentNULL 的恢复”需补 NPC send 不可逆保护：一旦 sent_at 非空禁止清空/改写；已有 raw/hash 继续 immutable；零发送重开必须检查 old/new 全部无 send/raw/event。不能仅靠 status 或错误字符串证明从未付费。|
|domain `transitionAgentAttempt` 的 cancelled_before_send 为终态|是 TS 规则，不是 SQL status-transition trigger。应增加专用恢复协议/转换，不能把通用 mark 对任意 terminal 的恢复全面开放。|
|tasks status/check、same owner command unique、one_active_task、queue claim/renew/finish|原 task requeue 可沿用现有 queued/failed 等状态，**不必**为该最小方案修改 task status CHECK 或复制 task。需延续双 lease/token 和原结果校验。|

不修改旧迁移文件 72/76/81；下一份迁移编号、公共契约及 SQL 实施由 root 独占安排。本报告没有创建迁移或数据库对象。

## 已知 raw 的边界与验收点

- runner replay 的 response_received/committed 分支在 model 之前直接使用原 envelope；新零发送恢复应只放在新发送分支，不能影响它。新 guard 的 postpaid 暂缓错误不要列入 known stale/invalid，raw 保持 response_received。
- 私聊/wake 的原执行 lease 仍为约 240s，当前原生任务有 76 显式延租；普通私聊/wake 没有通用 known-raw 延租接口。暂停跨过原 lease 后可能被判 stale，不能声称原 raw 任意久均可恢复。若 69 验收要求长暂停原 raw 续接，须另外复用严格 same-frame/owner/source 检查并增加通用 known-completion 恢复授权，仍不重新调用模型；不能借零发送规则重开 paid stale/unknown。此限制不能由“raw 尚在表里”掩盖。
- 必做真实测试：私聊 player、普通 wake、native group/scene 各验证 pre-read active→真实 mark SQL 内暂停/managed expiry→0 calls/sentNULL→同原 IDs 恢复且并发仅一个调用；每次暂停后若未恢复不得继续调用。
- 必做 paid 测试：模型实际返回时暂停/managed expiry，以及内核末尾 SQL 才过期，均 full rollback+原 raw 保留；同 raw 恢复 0 extra calls，原 receipt/task 唯一；明确覆盖租约内与超租约不同政策。
- 必做隔离/篡改：unknown、已 sent、raw/hash 非空、paid stale/invalid、另 actor busy、换 body/epoch/V/revision、已失 audience、source forgotten 均不得进入 zero-send resume；旧 token 的 send/save/commit 均被拒绝。当前 67 canonical author-source 必填与 no-repurchase 测试应保留。
- 必做 native：原 task 重排与新 queue lease、原 child command 保持；retry recovery command 重放幂等；no-attempt preclaim 暂缓与 1 cancelled attempt 分开；0 新 task、0 假 succeeded、原 input event 未重复。
- 不可能撤回已经发出的网络请求；最终 `request_sent` 提交与真正网络发送之间仍有不可消除边界，不承诺暂停能退款或取消在途请求。

## 当前接续点与交付

- 状态：待验收；只读定位完成，未实施任何 guard、恢复方法或 SQL。
- root 正在独立冻结 67 的 check/build/PG/deploy；本任务不触碰其在途文件。后续 69 由 root 决定最小源范围、迁移和真实测试分工后实施。
- 本人仅报告文字与源码核对，未运行测试来冒充竞态已修复；主表本人行及主目录报告镜像同步后回传精确提交。
