# 44-154-N5 · 持续议程三层预算仓储

负责人 codex-agenda154-n5；root独占公共SQL、服务、准入、source、协议、完整holder、模型额度、集成与部署。2026-10-19 主登记短锁登记后从root **dfcc614dbd44c159263d2e69a519cf30c762eff5** 创建 codex/own-agenda-budget154-n5（author-eligibility63/人生剧本）。N2/N3/N4冻结分支未修改。

## 冻结源码与交付范围

**7ec695a669ff18fb78a8ca1b942b09d70c6aae59**，仅两个NEW文件：

- `src/modules/world/infrastructure/own-agenda-budget-repository.ts`
- `tests/integration/own-agenda-budget.test.ts`

本报告另行冻结。无共享consumeLimit、公共SQL/原runtime/server/协议/前端修改；原rate_limits现有schema/RLS足够，未扩权。0模型/生产/部署/全量测试，本包待root集成验收，不主张持续议程公共接线或整体44-154已完成。

## 强类型API与原事务接点

```ts
type OwnAgendaBudgetDimension = 'owner' | 'world' | 'actor';
type OwnAgendaBudgetPolicy = Readonly<Record<OwnAgendaBudgetDimension, {
  limit: number; windowSeconds: number;
}>>;
type OwnAgendaBudgetSnapshot = Record<OwnAgendaBudgetDimension, {
  remaining: number; nextWindowRealAt: string;
}>;
readOwnAgendaBudgetInTransaction(sql, owner, worldId, actorId, policy, realNow)
  : Promise<OwnAgendaBudgetSnapshot>;
reserveOwnAgendaBudgetInTransaction(sql, owner, worldId, actorId, policy, realNow, attemptId)
  : Promise<OwnAgendaBudgetReservation>;
```

reserve结果：

- `{ status:'reserved', attemptId, budgets }`：本次三桶成功写入当前**调用方传入事务**，尚未授权独立commit或发模型。
- `{ status:'budget_wait', code:'OWN_AGENDA_BUDGET_WAIT', exhausted, nextCheckRealAt, budgets }`：本调用所有bucket写已SAVEPOINT回滚，外层事务仍可用。root可在**同原事务**将本attempt cancelled_before_send落库后再返回runner等待，不需catch SQL异常收尾。不把等待当人物quiet或unknown。

无新事务/BEGIN/COMMIT、独立连接、模型、任务或attempt写。三个remaining/nextWindowRealAt与N2输入结构兼容，无N2/N3源码依赖。

`OwnAgendaBudgetError.code`：INVALID_OWN_AGENDA_BUDGET_POLICY / INVALID_OWN_AGENDA_BUDGET_SCOPE / INVALID_OWN_AGENDA_BUDGET_TIME / OWN_AGENDA_BUDGET_ATTEMPT_NOT_RESERVED。不存在/跨owner world走原NOT_FOUND。真实数据库异常不转换为budget_wait；清理成功后原样抛原错误对象；清理也失败则AggregateError保留primary作为cause及errors[0]、cleanup作为errors[1]，不静默成功。

## 认证、稳定桶与单调窗口

- 复用app.user_id及原RLS；要求pl_app、非worker、owner/world实际相符，当前epoch≥2，实际世界actors唯一匹配本人、同owner/world actor state存在且文档身份匹配。
- read无锁无写，真实READ ONLY事务可运行，不初始化空桶。reserve重复取得原world锁及本人attempt锁；只保守接受实际reserved/live、当前epoch/worldV/actorRev一致、sent/raw/hash/event全空的真实attempt。只查询raw存在标志，不读取正文。已sent/未知/有raw或其他world/actor attempt在任何计数写前拒绝。
- **root仍负责原token/lease/receipt/hash、review grant/source/anchor、priority/暂停和完整holder认证**。本helper不冒充授权器、不允许重复发模型。
- primary key仍原(owner_id,bucket)，owner始终实际账号owner。固定命名空间 `npc-own-agenda:owner:v1`，world/actor分别使用 `npc-own-agenda:world:v1:<sha256([worldId])>` 与 `npc-own-agenda:actor:v1:<sha256([worldId,actorId])>`。v1是固定存储名，不是可配置policy版本；不含family/CAS/tick，所以换故事策略/人物议程不清空预算。
- policy无默认值/无version字段，精确owner/world/actor和limit/windowSeconds键；二者均正整数且≤PostgreSQL int最大值。各维度独立窗口与上限。realNow必须由可信服务端采样，不接受玩家时钟作为预算来源。
- 原窗口取显式realNow按各windowSeconds对齐；只有incoming窗口更晚才count重置为1；否则count+1，window_start用GREATEST保持单调。延迟的老时间只能保守计入现有更晚窗口，不能回拨或获得额外额度。read对更晚stored窗口也按其真实count保守投影。
- bucket配置应作为server运营合同；rate_limits没有历史windowSeconds列，更改窗口长度会按新配置解释存量窗口，不声称保存了历史配置。policyVersion不能用来切桶，root如需更换窗口合同应另行验证转换规则。

## 原子预留与调用方责任

在原reserved→request_sent事务里，完成root完整授权后调用本helper**一次**；world→attempt→owner桶→world桶→actor桶固定顺序。三个计数以原SQL UPSERT串行争用；任一不足ROLLBACK TO SAVEPOINT，释放savepoint后返回typed budget_wait。成功返回后root在同事务完成第一次request_sent及其他最终校验，全部成功commit后才调用模型；外事务失败会将三桶和send标记一起撤销。

helper不修改attempt，也不新增预算reservation ledger。已经request_sent再调用会被实际状态挡住，不会重扣；**若调用方对同一个仍reserved身份在一次事务里连续调用两次且不作send跃迁，helper不是通用幂等预留凭证**。root应将唯一首次跃迁与一次helper调用绑定，不把返回reserved当可重复使用的send许可。原protected response/committed replay不可再次调用reserve。

预算是保守的发送次数预留，不等同provider账单/tokens。预算与request_sent提交后即使进程在网络前退出，也不自动退款/新建family重试；按原sent/unknown保护。savepoint名固定npc_own_agenda_budget_v1，调用方不要复用此内部名字或在同SqlClient并发执行多个事务工作。

## 实际验收证据

启动前确认独占端口 **55634** 无监听，使用本工作树忽略的.local数据库配置；PostgreSQL18.4、原migrate和原app身份，未碰其它端口/进程。真实DB **14/14，0skip**（父测试+13子项）：

1. read-only/RLS owner-world-actor认证，read不建桶；三层独立额度/下一窗口，非法配置/日期拒绝且零写。
2. 原表三桶与send标记同事务提交；真实已sent/其他world attempt拒绝重复扣。
3. 同一attempt两个并发调用，仅第一位完成send及三桶各1；第二位实际状态拒绝。
4. 外层send事务主动失败，三桶和send一起回滚，原attempt仍reserved。
5. owner/world/actor分别耗尽，每级不足均不保留此前预留；外层仍可同TX取消零发送身份，sent/raw/event空。下一窗口通过原0082 exact-CAS claim恢复同attempt并再次预留。
6. 独立窗口长度与limit调整仍读相同namespace，不以策略对象改变新建桶。
7. 不同world并发共享owner cap=1，只有一边成功，失败边不留下world/actor桶。
8. actor及world独立预算，owner聚合共享；同名actor跨world不混桶。
9. 老事务先开始并等候，新窗口预留成功后才执行旧时间预留；三桶window均不回拨，count在cap以内，第三次旧时间预留仍等待，下一窗口仍指向真实较新窗口结束。
10. 在第二桶注入真实PostgreSQL除零22012，第一桶写撤销、原错误对象不变、外事务可继续SELECT并提交。
11. 注入rollback失败，AggregateError保留primary/cleanup，不返回budget_wait；外事务回滚无残留计数。

发送标记测试使用原表SQL跃迁作为预算同事务证据；原accept/claim/saveResponse/mark及0082恢复实际执行，合成结果显式标记无provider，**不把这套fixture称为完整review/runtime接线或真实模型验收**。

命令证据：`node --experimental-strip-types --test tests/integration/own-agenda-budget.test.ts` 14/14；`npm run typecheck` 0错误；`node scripts/check-boundaries.mjs` 647 files通过；两个NEW文件prettier/diff check通过。只做必要目标验证，未运行全量check/build或已有N2/N3套件。

## Root接续

先集成源码commit，再将reserve接入原mark首次发送同事务，budget_wait同事务结束reserved；N2继续只读预算，实际send仍重验。跨CAS零发送family恢复、N3真实turn锚和quiet/progress、O paid frame保护、消息/事件的自然演绎及拒绝记忆仍root负责。集成后按项目check/build、真实PG及已批准模型额度验收，公网部署验证由root完成；本包不自行部署。
