# 44-153 世界连续运行与玩家在线状态分离

用户最新要求取代离开冻结规则。唯一集成人root，小安只读审查已交接，公共源不并写。

## 真实调用图和替换边界

Phone useWorldTime → activity endpoint → PostgresClockActivityRepository → world_clock + world_clock_activity；现在away/lease过期同时截时间并paused。readWorldClock → storedActivityClock/readableActivityClock；原native advance → due arrival → pending episode → scheduleAgents → 原Director/NPC → kernel事务/Outbox。delivery、episode、narrative gate错误复用presence为运行门禁。SQL publication_story_clock另按active_until投影，须同JS一起改。phone-entry probe可以继续要求真实可见页面，不能替代后台调度。

后台 cron → claim_due_worlds → runDailyScheduler → services.advanceWorld → 同一native入口。现每天一次、全局最多2world，不冒称分钟级常驻执行。先保留预算上限与部署频率，补epoch2未知/试演隔离；返回以原调度立即检查已到期的责任和计划，不另建“离线剧情生成器”。

## 状态与接口

world_clock增加continuity_mode（presence/continuous）和pause_reason（legacy/manual），paused在continuous中仅表示明确停止。world_clock_activity租约仅表示可见关注与在线12倍浏览/1倍交谈；过期转离线1倍，不能冻结世界或给NPC全图知情。连续时间采取分段投影：锚点→presence截止按原在线速度，此后按离线1倍；away将当前投影结锚并切离线，返回从同一投影接续，时间SQL/JS一致。

离线行动继续原Agent候选/计划/责任/结果/知情链：允许原due arrival确定执行；Director协调有合法cause才调用；人设决策由对应NPC提出；只有内核成功结果成为事实。事件概述、缺席或过去时台词都不是执行证据。未处理邀请不是失约；unknown不自动重买，来源哈希与回执/CAS保留。

重要约定不再冻结整个持续世界；玩家的到场/接受仍需本人动作。在线快进保留原wait重要变化停点，真实时间经过后相关人物自己调整计划，不能替玩家补选。离线安静是合法结果，不补虚构朋友圈/消息。

## 迁移、失败和回滚

0092仅加字段、替换同名SQL投影与既有scheduler函数，不修改历史事件/消息/人物/日程。旧时钟默认presence，旧暂停来源不明不全局强开；正常玩家明确进入时原activity原子采用continuous，从当时原投影锚点开始，不回算采用前离线。publication trial仍presence，原lifecycle/setClock显式暂停保留，manual pause不能被普通activity误解锁。新正常世界首次进入同样采用，无题材特判。

回滚可将continuous按最后合法投影结锚再切presence并暂停，不能倒拨时间、删事件或让旧代码忽略已执行结果。部署先核迁移再READY；unknown不自动恢复付费，transaction失败全回滚，真实执行结果投影仍原Outbox。

## 实施与验收

1. 同一纯时钟策略/SQL分段投影与采用入口；2. 原kernel delivery/narrative/到达和群聊门禁改成run-state；3. 返回便宜检查与原cron未知保护；4. 聚焦真实PG：离线/lease过期仍走时、到达一次、SQL JS一致、私聊focus过期、trial/manual pause不解锁、未知0重试、旧档历史保留；5. check/build、生产迁移核验、READY、公网关键读。商业自然演绎质量仍归148/150，不借此宣称已通过。

## 本批实际实现和必要验证

连续时钟从同一clock定义贯穿read/project、activity、native delivery/episode/narrative/group gate，原due arrival与actor plan调度不建旁路。原前台probe仍要求真实presence，连续世界返回只授予一次cheap原调度检查，不能作为语义cause或强制模型调用。采用资格由0092 own-world SECURITY DEFINER函数核对runtime epoch与不可变publication binding，trial真实绑定及opening双重排除；foreign own-scope=false。manual pause由新setClock记录来源，普通activity resume不可解除；旧legacy pause来源不可完整追溯，仅在用户明确正常进入后采用，不冒称识别过去所有人工暂停。

小安只读指出expired managed旧档会占cron名额，已从claim排除并优先continuous；原全局每日2档、每天一次频率未扩大。补epoch2 unknown/inflight及真实trial绑定过滤。真实world_scheduler PG并发两领取只得两个，expired/manual/unknown不入列，scheduler无读取私人表权限。

纯clock6、check3320/build通过；原时间PG11（离线1倍/SQL一致/返回/手动暂停/多标签）；到达PG14含连续离线到达一次、回滚/CAS/知情边界；原native语义PG20保持付费cause来源/unknown/quiet去重；真实trial PG9含不可变绑定拒绝采用/外人拒绝；scheduler PG1。0商业调用，150仍5/6 open且测试档暂停。开发夹具首次把子测试放到持锁兄弟调度中造成等待，已修正为独立子测试；SQL Date精度断言、cleanup epoch守卫和UUID includes类型问题已修夹具并通过。未改变生产失败/unknown记录。

生产0092已应用：91→92 checksum一致，107世界state/version/hash前后完全相同，未批量unpause或补历史；实际app角色只读确认截图81bab正常采用资格成立，测试trial拒绝采用且仍paused，foreign=false。待本批提交READY后补公网证据。

## 尚未完成，不标全系统连续演绎完成

后台仍每天一次、全局最多2档处理，不能保证所有离线世界分钟级产生持久剧情；下一项154需世界条件唤醒持久任务/公平领取/短租约、确定性执行与模型预算分离，并核实生产触发频率能力。前台返回补原调度已接通，但不能冒称所有离线期间都即时推演。148/150人物引用/协商时间与完整事件演绎仍未通过真实模型，继续独立处理；本批不靠离线时长制造新事故、假消息或强制完成。

## 新旧页面协议边界

发现旧客户端WorldClockSchema是strictObject；新时钟内部字段不能无协商直接发给旧页面。追加同一clock接口的X-World-Time-Protocol:continuous-v1表示层协商：新LifeClient read/activity/control使用新形状；未协商的旧页面仅剥离新增continuityMode/pauseReason，原运行权限、真实时间和内核状态不改变。并非另起时钟或运行入口，wait回执本来不嵌clock，无需旁路。两项契约验证覆盖旧shape与新版三操作、0额外网络请求。生产团队实际plan读取为hobby，当前配置仍每天一次cron；未擅自升级订阅或扩大商业模型日上限。154作为后续调度能力工作保留。

公网兼容检查首轮旧员工会话401，使用已有合成验收身份重新登录后只读检查；发现staff trial proxy未透传新协议头（正常玩家直接入口不受该代理影响）。代理白名单新增仅clock/clock activity且值精确continuous-v1的表示层头，绝不转发调用者Cookie/Authorization。三项协议/代理测试、check3323/build通过；修复将与同一153交付，不将私有试演改为正常持续世界。
