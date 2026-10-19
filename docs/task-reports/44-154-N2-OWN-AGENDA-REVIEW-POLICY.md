# 44-154-N2 · own_agenda 纯复盘资格策略

负责人codex-agenda154-n2；root唯一公共准入、原子预算、原receipt恢复、问题业务去重、集成及部署负责人。独立author-eligibility63/人生剧本，codex/own-agenda-review154-n2，自N报告a267b3e6（运行源码基线117b9c48）；不含root在制M调度或SQL依赖。先在唯一主表短锁登记本包。

## 冻结源码及范围

**a65eace5007ed8bbbc5751780ae71704be54f6b0**，仅NEW src/modules/world/application/own-agenda-review-policy.ts 和NEW tests/own-agenda-review-policy.test.ts；本报告另行冻结。其他源/SQL/phone/server/原测试均只读。0PG/模型/生产/部署/全check/build。**本包没有runtime接线，ready不是模型调用/发送/预算预留许可。**

## API与前置认证责任

```ts
evaluateOwnAgendaReview(input: OwnAgendaReviewInput,
  digest: (canonical: string) => string): OwnAgendaReviewResult
```

导出相关输入/anchor/identity/attempt evidence/budget/policy/grant/result类型。依赖仅原domain AgentAttemptStatus类型和纯显式ISO日历验证；没有Node/网络/环境变量/墙钟调用/数据库写入。摘要、anchor及预算由root加载器事先认证，本函数不是数据库来源认证器。

- identity：worldId、engineEpoch≥2、actorId、definitionRef。
- anchor：同identity、实际committed attemptId/eventId、committedStoryAt和committedRealAt。必须是原attempt→成功command→真实state event的认证元数据；纯函数只能检查一致性，不能证明一串ID真已提交。缺anchor返回not_due/missing_anchor，由上层保留原F入口，不伪造anchor。
- purpose：own_agenda或episode_participation；后者只返回needs_episode_review_contract，不转换成普通review。
- storyAt/realAt、显式paused、hasPriorityWork、非负整数quietStreak。
- attempts：当前family完整、跨所有policy和transport的认证摘要；familyId/attemptId/policyVersion、原status、sent、hasRaw。不得只过滤到当前policy版本，也不能漏掉旧paid/unknown。其他family记录不会改变此family判断；别的family若存在同actor活跃/unknown，原全actor守卫仍须执行，不能仅凭本函数ready跳过。
- budgets：owner/world/actor各remaining（已计入预留）、nextWindowRealAt或null；仅当前读快照。
- policy全显式：version、storyGapMs、realGapMs、quietBackoffMultiplier、maxRealGapMs。无默认分钟数。gap为正安全整数，multiplier有限≥1，cap≥base；损坏值不回退宽松默认。

结构/范围/日历或digest错误抛OwnAgendaReviewPolicyError，code=INVALID_OWN_AGENDA_REVIEW_INPUT。没有宽松许可分支。

## 稳定身份及结果语义

familyId为agenda-review:<injected64hex>，hash固定顺序身份为own_agenda_review/world/epoch/actor/definition/anchorAttempt/event。**不含tick、worldVersion、policyVersion、预算窗口、quiet streak或前端entry。**政策升级本身不刷新已paid身份；真实后继committed anchor才产生后继family。输入time只影响资格，不影响family。

ready返回原N规范envelope：type=npc_agenda_review、family=own_agenda、grantId=familyId、anchorAttemptId、policyVersion、basisSourceIds=[definition:<definitionRef>]，以及明确命名nextReviewStoryAt/nextReviewRealAt的计算窗口。它不是联系人台词、用户承诺、世界fact、observation、responsibility.deadline或原episode再参与权限；没有代码替人物决定联系内容。

其它结果：

| status/reason | 意义/接续 |
|---|---|
| not_due/paused、missing_anchor | 显式暂停不运行；无真实anchor保持原F与准入策略，不自行建历史。 |
| priority_work | 本人已有更高优先合法工作，先交原candidate/结果/计划执行。 |
| unknown | 原unknown_after_send身份保留，列原attempt IDs，不因预算补充或policy升级重买。 |
| paid_fence/protected_raw | 已收raw或response_received必须走原保护结果核对/重验；本函数不自动恢复或丢弃它。 |
| paid_fence/committed、paid_or_failed | 原committed或已sent/invalid_output保留原族围栏；取消标签不能隐藏已发送或raw。 |
| not_due/attempt_in_flight | request_sent仍在途，不混成quiet或自动判unknown。 |
| not_due/unsent_attempt_pending、unsent_recovery_required | 已reserved/零发送cancel或stale只交原receipt/CAS恢复，不再颁一个新grant。 |
| not_due/time_window | story与real两门槛尚未同时满足。 |
| budget_wait | 任一层余额耗尽，列exhausted与已知最晚nextCheckRealAt；任一耗尽窗口不明则null，不编造下一补额时刻。 |

quiet现实间隔计算为min(cap,ceil(base*multiplier^quietStreak))，指数溢出饱和到有限cap，不回绕；story间隔独立于quiet退避。两个门槛严格按各自时钟比较，边界相等可考虑，现实钟回拨或故事未走够均不提前。计算时间超可表示日期则明确拒绝，不绕回过去。

原goals/plans历史数组长度不是输入资格门槛：结束旧目标后若已有合法新anchor且无优先工作，可正常review。是否有真实高优先任务/完整安静连续次数由root从真实提交重建，不能从played=0或数组为空猜。

## 必须由后续运行时完成

1. 数据库owner/world/epoch/definition及真实anchor认证、完整family历史，原clock投影与显式暂停；不得接客户端自报grant/policy预算。
2. 原accept/claim/send前精确权限核验；原同actor/资源active/unknown保护，不能将本模块的同family预判误当所有family均安全。
3. ready是可重复的纯计算：同一余额快照连续调用两次均返回同一ready，不扣款。本测试明确证明这一点。**发送前必须在原request_sent短事务原子预留owner/world/actor额度**，并按N报告处理跨world并发/窗口不倒退；预算等待不留永久reserved，也不标quiet。
4. 本函数不接受allowAttemptId绕过参数。已有attempt时不发新grant；精确current holder、原不可变receipt、零发送CAS恢复和旧raw重验另由root公共契约认证。不能删除attempt摘要伪装空history来让原发送通过。若后续需要单独send-validation接口，先冻结该契约，本包没有暗加它。
5. 问题/责任业务身份、防新ID/换NPC重问、原episode quiet请求复盘family与投递权限，仍是root公共合同。envelope不给consumed episode再参与、用户期限、同意或完成权限。

## 必要验证

38/38新聚焦纯测试，0skip；npm run typecheck exit0；focused Prettier与diff检查通过。初次tsc只发现测试夹具对Readonly预算Record的赋值，改为整体替换测试快照后再跑最终38/类型，未改运行边界来适配测试。未执行任何PG、商业模型、部署或全量check/build。

覆盖稳定family（时间/版本/policy/预算/quiet变化不改）；真正anchor和身份变化；缺anchor不hash/不造grant；旧目标完成不阻新anchor；episode family隔离；暂停/优先工作；story/real双门槛及回拨；指数退避0/1/2/3/4/巨大streak封顶；跨policy付费/unknown/raw围栏；在途与零发送恢复区别；取消标签带paid/raw不洗白；已committed故障摘要遗漏paid仍阻挡；三层预算及未知窗口；作用域/时间/策略/status/digest错误；日期溢出；无副作用及等价时区。纯测试是合成认证摘要，不是源证明或NPC自然性验收。

当前主表待验收。root审核并统一归档本包后再接N3/runtime；本策略没有注册candidate、派发模型或发消息，不能据此标持续自主调度上线或整个154完成。
