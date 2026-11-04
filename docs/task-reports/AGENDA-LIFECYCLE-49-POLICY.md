# AGENDA-LIFECYCLE-49 政策子任务

负责人 proactive43；基线32419a4e；独占application/own-agenda-review-policy.ts及其单测。root负责仓储/authority/预算接线/PG/原档验收。

## 完成

- ownAgendaReviewFamilyId增加可选reviewAt，未传时v1原始hash逐字保持；传入时按UTC固定60秒窗口计算v2 hash与`:w{minuteBase36}`后缀。窗口粒度不受配置gap或policyVersion变化影响。
- OwnAgendaReviewInput增加仅内存计算参数reviewAt；v2身份使用reviewAt ?? realAt，时间门槛与预算仍使用真实realAt，不用历史时间伪造当前准入。
- ownAgendaReviewGrantTime解析并验证原receivedAt所在分钟或紧邻前一分钟，用于collect尾秒跨accept分钟；返回窗口开始ISO。原hash仍须由authority按身份、anchor重新认证，后缀本身不授权。
- 同窗口unknown/raw/paid继续拒绝重新购买；后续窗口可以独立审视，但只返回consideration，绝不生成消息、事实、玩家承诺或预算预留。
- 保持anchor、优先工作、故事/真实时间、quiet退避及owner/world/actor预算检查。

## 验证

46/46政策单测通过；typecheck通过。覆盖v1完全兼容、同分钟稳定、跨分钟不同、配置gap变化不制造同分钟新grant、各类paid状态保护原窗口、原receivedAt用于后续恢复、无效/未来/过旧窗口拒绝，以及reviewAt不替代live realAt预算/时间检查。

0数据库变更、0真实模型、0原档写、0运行进程改动。不是完整生命周期或原档主动推进验收。

## 集成边界

root须在所有阶段使用原receipt冻结的reviewAt；collect用当前服务器时间。近期全窗口lastReviewRealAt与连续失败退避必须在authority实现，不能将60秒身份粒度当成每分钟付费计划。旧v1原调用仍保持旧策略恢复；新窗口不重试旧unknown。saved response优先恢复、晚到结果的revision/依赖保护仍归原内核。失败/unknown要继续计入已有预算。不得补跑离线历史窗口。
