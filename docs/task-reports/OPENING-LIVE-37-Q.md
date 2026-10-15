# OPENING-LIVE-37-Q 只读快速审查

- Agent：codex-opening-live37-q-20261015；辅助会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b；root唯一集成与生产负责人。
- 范围：仅本报告及主目录镜像/本人登记。独立photo-compose-02/人生剧本，codex/opening-live37-q，准确基线1c795517（根codex/opening-live37）。没有业务/SQL/配置改动，没有进入37-B源码窗口。
- 状态：待验收；以下两处建议在上线前窄修，交root。正式仍按root所报2fcb4822/已授权副本v1，不把候选称线上。

## 必修1：另一标签页已落库的来信，本页只刷新计数

P1。`src/features/phone/world-phone-app.tsx:428–445`：GET得complete只设置openingFinished；得到ready只在自己POST的`played>0`时load。多tab中A完成消息，B收到delivered增长/complete，或B抢占失败POST返回played0，本页手机消息仍停在旧版本；complete后开场读取还停止。必须等另一次无关刷新/可见性变化才可靠出现，不能保证用户要求的实时到达。useWorldRecords无定时phone刷新，不能代偿。

离线执行本提交的实际checkForWorldNews函数体（非手写替代算法），输入GET complete/6/6，结果`finished=world-a, loads=0, paid=0`。建议记录world作用域的已见进度/版本，在观察到进度增长、其他执行者完成或最终complete时只读刷新真实phone；不要为同步消息新增模型请求或重发已投递内容。

## 必修2：新增GET之后没有重新检查后台/发送中状态

P1。同文件428–441：readWorldClock后有完整guard，但随后await readWorldOpening后只检查active。请求期间切后台或开始发消息，active仍true，仍会自动POST开场。实际函数离线探针：在readWorldOpening返回前把visibility设hidden，paid POST计数1；把phoneReady.sending设true同样POST1。

建议在新await后、任何自动付费POST前重验active、当前world/epoch、可见性、数据/刷新/发送状态；若时钟暂停有变化，后端claim前仍必须再验，不依靠旧clock快照。此修复不应以取消请求冒充已取消上游费用。

## 条件风险：显式恢复回调没有世界代次保护

同文件535–549：显式恢复await后的setOpening、旧load和finally没有world/epoch fence；组件若复用并更换worldId，旧响应可把旧状态送进新world的组件实例，旧load还会创建较新的request序号。若实际宿主保证所有world切换均卸载旧WorldPhoneApp，此风险不阻断上线；本轮没有真实浏览器证明宿主复用，因此不把它当已复现的线上串世界。建议同一窄修给status/retry回调加world/epoch隔离，或用实际宿主卸载证据排除。不要为了此项扩大重构。

## 未见阻断的部分与依赖

- OpeningStatus只返回phase/total/delivered/retryable；strict wire schema拒收额外source/brief。planner严格核对获准actor集合、缺漏/重复/外来/超限均拒绝，不自动编造补全。未发现该public projection直接输出私有简报。
- LifeClient本方法无网络自动重试；POST只发confirmRetry，未知/正在发送不会由phone自动调用确认重试。多tab是否真正不重付仍依赖37-B durable claim、原command/receipt对账与显式恢复，未审查其未交接源码、不替它宣称已验收。
- trial allowlist GET/POST只落绑定world的opening端点，拒绝多余路径/DELETE；现有owner认证与world读取先行。纯测试通过不等于真实跨owner PG验收。
- 新外层flex列、状态条flexShrink0、手机余量flex1/minHeight0配合phone height100%，静态没有看到固定整屏叠加造成的高度错误；本轮没有PC/mobile真实布局测量，不宣称已完成双端验收。

## 实际验证

- 只写报告。7/7现有纯测试通过：publication-opening-contract、publication-opening-planner、phone-auto-advance，模型是明确测试桩，0真实模型。
- 忽略目录`.local/opening37-q/probe.mjs`读取实际提交的checkForWorldNews函数体执行，复现上述complete不load/隐藏仍POST/发送中仍POST。模拟页面依赖仅用于离线反例，不是生产Repository或线上效果。
- 0数据库、HTTP产品端口、浏览器、生产写、部署。没有对未冻结B实现跑全量check/build；本轮不新增大测试矩阵，完整发布门禁由root合入后执行。
- 下一步：root窄修两个P1；37-B交接后验durable claim/unknown/暂停的真实事务证据；按用户节奏完成必要检查就部署READY，再做授权范围内聚焦公网。原稿及副本源不由本Agent修改。

## Follow-up: root uncommitted phone changes

Root HEAD08c64579. Read-only inspection of uncommitted phone diff and actual function-body execution, no source changes. GET delivered progress now reloads the phone; after-GET canAdvance rejects hidden/sending; world epoch guards old response writes/finally. Original probes now show GET complete loads1 and hidden/sending paid0.

Remaining P1: B GET ready/delivered0, A commits all arrivals, B POST returns played0/complete/delivered6. Both auto and explicit retry write observedOpening6/finished but only load for played>0. Actual current root function-body probe still shows loads0, observed6, finished world-a. This can hide committed messages and stop opening reads. Compare POST response delivered against previous observed progress before overwrite, and perform a read-only phone refresh for increased progress OR played>0. Fix both POST callbacks; add no paid call.

Probe: ignored .local/opening37-q/probe-root-followup.mjs in independent tree. Zero new source/SQL/DB/browser/model/production/deploy operations; no expanded test matrix. Root notified before release.

## Final narrow recheck: 78238762

Read current root committed source after its final response-progress fix. Both auto POST and explicit retry compare delivered growth before overwriting the observation and load on played>0 OR new delivered progress. Auto checks isCurrent again after await load before completion caching. Existing epoch response/finally guards remain.

Actual current auto function-body probes: GET complete loads1; hidden during GET paid0; sending during GET paid0; another tab commits between GET and POST, played0/complete6 now loads1 (previously0). The two mandatory findings and the requested scope fence are closed for this narrow offline review. No further mandatory blocker found in these changes. Root may proceed with migration68/deployment and its separately authorized12/2 real acceptance. This is not real PG, mobile layout, provider or production acceptance.

Root notified immediately. Source/SQL/production/model changes by this reviewer remain zero. Review report only; final integration and task completion belong to root.
