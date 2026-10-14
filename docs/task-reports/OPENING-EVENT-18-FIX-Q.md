# OPENING-EVENT-18-FIX-Q · 首演终态与因果可达性复核

2026-10-14，author_people14，root指派。只读8165828e9cb10df20013c731fe2b18c1860082a3；仅本人报告与主登记，不改业务。0模型/数据库/浏览器/生产/推送。

## 结论

原两项P1首演死锁已经针对性修复：真实未呈现的skip/expiry等终态，以及同轮expiry/exclusion可以释放首演gate；未完成或错误终态不能充当真实呈现。普通因果硬依赖、ALL与无可达分支的ANY、依赖前阶段与入站alternatives均新增校验，不削作者条件。但是新增可达性检查仍有两个已复现P2边界，已第一时间发root；请修后统一部署。它们不是SQL/权限问题。

## P2：可由全部成员过期解决的前阶段被误拒

位置：`publication-content.ts:626-638`，opening所在stage的afterStageKeys只允许prior本身有window且其expiresAt早于opening截止。

纯合成反例：before阶段无stage.window，唯一普通事件earlier有起点至一分钟后的有效窗口；later阶段afterStageKeys=[before]，指定开场opening属于later且无截止。公开schema仅返回opening_event_requires_prior_stage；同份有效运行plan在起点两分钟时实际结果expired=[earlier]、resolvedStages=[before]、eligible=[opening]。阶段通过全部可执行成员真实过期本来能解决，不需要阶段自身window。

建议最小修复：对阶段按真实运行语义判断可达：阶段自身先到期，或至少一个非editorial成员且全部成员能由clock expiry/exclusion解决（沿已有terminalByClock）；无成员/未证据的普通完成依赖仍拒绝。不能为通过检查改写作者窗口或自动把事件算完成。

## P2：ANY把窗口之外的时间当成可达分支

位置：`publication-content.ts:607-624`，reachable(not_before)无条件为true；既有requiredTerms在ANY多分支时不把这些时间视为硬条件，所以后面的not_before_at_or_after_deadline也不会拦该组合。

纯合成反例：opening有效窗口为起点至一分钟后；命名条件组match=any，分支为after_presented_node(earlier) 或 not_before(起点两分钟后)。earlier被首演gate压制。schema成功；起点与截止前eligible均=[]；两分钟时expired=[opening]且只eligible=[earlier]。任何时刻都不可能演出指定开场，虽然本次expiry释放修复保证世界不再永久锁死。

建议最小修复：not_before分支必须早于opening实际deadline才算可达；ANY至少保留一个可真正满足的分支。正常窗口内的日期、地点或其他可达分支保留，不改日期原文。

## 已验证正确范围

- openingEventPending接受无呈现源的skipped/expired/declined仅当status===outcome；claimed/unknown/failed无实际来源继续pending。
- 两个真实sourceId足以标识已经呈现，后续skip/expired不会重开；claimed/unknown即使混入旧来源也不释放。
- evaluateStory使用当轮expired/excluded额外取消openingPending；首次筛选仍逐项执行阶段、日期、地点、前提/命名条件组/入站alternative限制，不伪造用户完成。
- reachable拒after_presented/after_committed普通因果；after_resolved只允许无需先演出即可产生的更早clock期限/真实排除链。ALL全部需可达，ANY保一个可达分支；两个P2即其边缘判定不足。
- stage/node window运行按交集算有效期，新增deadline也取两者最早expiry，未改变普通日期地点数据。
- 51/51纯专项通过（publication-story、publisher-opening-event、publisher-plot-model）；两项额外纯合成反例用实际PublishedWorldContentSchema与evaluateStory得到上述结果。未运行完整check/build/PG，纯审查不把其他Agent的34项真实PG记成本人证据。

root接续：修上述两边界并加正反例，重新check/build/真实PG、双端与READY；本报告仍待验收，未称真实导演演绎成功。
