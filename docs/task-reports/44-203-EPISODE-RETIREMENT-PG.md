# 44-203-EPISODE-RETIREMENT-PG

只读基线6d49b473，独立episode-retirement203。独占新tests/integration/episode-retirement203.test.ts和本报告，等root明确契约后实现必要PG。无生产/模型调用。

## 当前事实与覆盖

|场景|当前实现|已有覆盖/缺口|
|---|---|---|
|engage且实际保存消息|agent-narrative-repository 657段将proposed→active，追加实际sourceEventIds|agent-episode-advance.test覆盖quiet/decline一个人物之后另一人engage；旧串行批次数字可能需按最新调度调整|
|engage但无消息|只消费请求，不激活共享事件|不能把个人选择等于已呈现；终止策略未定|
|全部decline|请求全部consumed，共享仍proposed|episode-defer-reconsideration.test 749-752明确期待proposed，标题clean withdrawal误导，未验证共享终止|
|全部quiet|请求消耗；quiet不是拒绝，无共享终止|现有单人quiet稳定/不重买覆盖，不证明整事件有去向|
|defer/need_information|个人等待责任与条件，相关变化后重新考虑|episode-defer-reconsideration旧旅程覆盖；个人生命周期投影无权关闭共享事件|
|某人计划withdrawn|只个人计划终态，目标/责任可能仍open|episode-participation-lifecycle只算个人followUp；共享明确不由个人撤回直接关闭|
|作者完成结果|episode-outcome-repository仅明确invitation_response真实证据→resolved|必须保留，不与retirement混用|

## 最关键遗漏

没有全参与者已决定且无继续责任后的共享withdrawn判定/提交路径。不能将所有quiet当拒绝、一个计划withdrawn当整段结束，也不能把defer带合法等待误结束。

只把shared status改withdrawn还不够：authored-event-eligibility-repository occupied仅proposed/active，原作者事件可能重新成为候选。需保留作者键终态历史或既有消费证据，避免换episode ID重邀。

## 待root明确的最小契约

1. all decline是否仅对所有原participants都有本epoch成功receipt且无pending/unknown时withdrawn；证据sourceEventIds及endReason如何用现有字段记录。
2. quiet是否维持proposed，或仅在既有明确撤回判定后终止；不得当拒绝。
3. engage后撤回如何证明所有相关计划/目标/责任已终止，不能牵连同目标无关计划。
4. authored withdrawn是否阻止同作者节点重新开演；其他合格事件仍可选择。
5. 原终态结果不可被晚到engage或重复投递重开。

必要PG矩阵拟压为：全decline终止+幂等/不重开；decline+defer保留等待；quiet不能冒充拒绝；engage分支及部分计划withdraw不得误终止。根据root实际修复范围选最少连续旅程，不先编造新状态协议。

## 首批契约与必要真实 PostgreSQL 验收

本批仅落实 proposed 且全部原参与者 consumed/decline 的撤回，不实现 engage 后整体退休。借用 root core-stickers200 的 domain、consume 仓储、资格仓储和 0111 迁移进行测试；这些公共源码不包含在本测试交付提交中。

专属测试通过原发布、导演安排、人物考虑及 advance 入口执行两个连续场景，未手工写入参与结果：

- 第一人拒绝后仍 proposed；第二人明确拒绝后 withdrawn，endReason=all_participants_declined，revision 增加 1，resultIds 为空，sourceEventIds 包含最后拒绝的真实回执事件。
- 第二人 quiet 时仍 proposed，不把沉默视为拒绝。
- 仅第一人拒绝时，直接 SQL 伪造整体撤回，即使绑定第一人的真实 commit attempt，也被数据库以 23514 / EPISODE_WITHDRAWAL_REQUIRES_ALL_DECLINED 拒绝。
- 其他 owner 的应用角色查询结果为 0，保留 RLS 隔离。
- 原人物回执和历史保留；两次后续 advance 不增加考虑次数、不重开原事件。
- 原作者键 all_decline_event 仍 occupied；独立非开场节点 defer_service_event 仍 eligible，撤回不会堵塞整个事件库。

执行：node --experimental-strip-types --test tests/integration/episode-retirement203.test.ts。
结果：1/1 通过（含上述两个场景），约 14.7 秒。独立本地 PG 55672，受控模型，0 真实模型、0 生产写入、0 部署。

## 未覆盖与交接边界

- defer、need_information、unassessed、pending、engage 的组合未新增真实 PG 穷举；本批聚焦 all-decline 新事务和 quiet 负向，其他领域守卫由 root 聚焦单测验证。
- 已 active 事件中个人计划 withdrawn 后的共享终止不属于本批实现；不能以本测试宣称已补齐。
- 不证明真实模型人物表现或用户既有存档体验；由 root 统一集成、必要真实体验与部署。
