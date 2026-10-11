# NAR-03-UX-QA · 现场、事项与微信反馈独立审查

状态：待验收（独立审查交付；五个断点及业务集成、真实PG/公网尚未验收）。负责人 codex-f-nar03-uxqa-01a0c7c8-20261011；会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。

## 基线、分工和资源

从最新已发布 origin/main d2f8eb8 建独立分支 codex/nar03-ux-qa，沿用已交付的 photo-compose-02 独立工作树，保留原 SPACE-02B 分支。主目录96e51d1与其WIP仅只读，不作为开发基线。领取独立审查，不领取或修改后端NAR-03。

仅写 tests/nar03-phone-feedback.test.ts、本文与主表本人行。I独占 scene-panel.tsx、world-phone-app.tsx、scenes/world-sync.ts、tests/scene-world-sync.test.ts及事项呈现；后端执行者独占NAR-03规则/仓储/反馈。任何公共字段需求先记录给I。

0模型调用/0图片/0生产创建上传，不部署、不推main。没有启动端口、浏览器或数据库。新测试只调用实际纯规则/受控组件，夹具不等于生产仓储，不计真实模型/数据库/公网证据。

## 验收与接续

只读核对当前现场提交后的刷新链路、备忘录四区、桌面事项、日历和微信来源；I已发现异步完成后未刷新phone，避开其专项重复。重点核对事项只读、状态归类、来源入口、知情者可达、旧档和失败/并发/隐私反例，补有意义的行为测试。运行专项、npm run check和npm run build，记录实际结果；完成后独立提交并标待验收，由I集成真实PG/公网后判定完成。

本次读回确认领取成功后才开始代码。下一步：建立分支、阅读冻结基线和只读后端WIP，产出可复现问题与专项测试。

## 首轮行为复现（基线 d2f8eb8，2026-10-11）

已写专属 tests/nar03-phone-feedback.test.ts，17项实际行为测试：首轮12通过，5个已知断点使用node:test todo运行断言并真实失败。TODO不计通过，不宣称17项全绿。它们不会改生产函数；I修复后须移除TODO并使同一断言通过。第5项首轮用了非UUID失效ID，失败在契约解析而非死链；已改为合法但不在actors中的UUID，重跑验证真正导航断点，首轮结果不能作为该项最终证据。

### 应阻止本批验收的问题

1. **失败/部分成功仍可客观完成并领取奖励**：world/domain/matters.ts transitionWorldMatter（约194-208行）仅在成功证据时改变assertion，失败/partial仍继承旧world_verified。实际反例：先由director_progression核实“已开始准备”，再把失败scene_action提交为completed，claimMatterReward竟通过。这不是模型评测，是调用真实最终领域函数的反例。须I协调matters.ts最终门槛，不能只依赖上层planner选择正确status；不得把本检查扩成长奖励功能。
2. **屏蔽结果来源后仍让NPC知道已完成**：world/application/actor-context.ts 115-126只过滤matter.id和creation source.eventId，不过滤evidence.eventId。genesis来源matter被event_scene完成后，即使blockedSources含event_scene，context.matters仍有completed/world_verified。须后端按来源撤销/屏蔽重新裁剪，不让relatedActorIds本身替代实际知情证明。
3. **完成详情缺实际结果与可核对来源**：world/domain/player-records.ts 562-589把source简化为matterId/updatedAt，text永远是原description，忽略evidence的sceneId/actionId/eventId/eventVersion。用户路径：桌面近期事项→地图现场→提交行动→同步完成→备忘录“此前记录”打开同一sys/matter ID，只看到“亲手把作品集交给现场负责人”的任务要求，无法看到实际发生/失败原因/对应行动。这是上线基线源码缺口，尚未验证I拟接线后的效果。I已表示将专属接入运行时校验过的resolution.observation及只读来源；F不改字段或repo，不抓后端动态WIP作验证。
4. **反馈入口丢失及死链**：player-records.ts 570-575按place→firstActor→invitation取唯一navigation。即使三者全部合法，place存在时没有NPC/日历relatedLinks；关联角色第一个为合法格式但已不存在的UUID时仍选它，已有第二个合法actor不被选择。测试通过NotesRecordDetail真实按钮回调收集open调用，可复现只得到map，不能从事项进入关联NPC/约定。须I在授权投影中校验actors/appointments，再保留多入口；不按姓名匹配，不凭UI虚构现场进入。
5. **客观受阻被写成“你说遇到阻碍”**：player-records.ts labels.blocked共用用户自述文案，world_event验证blocked、assertion=world_verified的事项仍显示用户自述状态。保留用户自述专有标签，客观现场受阻单独呈现原因/来源。

### 已确认保留的能力

实际投影把客观completed移入history，自述完成为reported_done/player_statement且不能领客观奖励；近期受阻与长期追求仍各在current/about。隐藏和其他世界事项不出现在records；旧档无matters不凭空造任务。NotesRecordDetail/NotesRecords实际按钮只调用导航，点击前后传入投影深比较不变，没有完成表单。异世界/迟到records读取会停，过低phoneVersion拒绝，版本不一致有界两读失败；通知仅来自传入的持久未读NPC消息，排用户/已读/重复，以actorId区分同名人。此处均为规则/组件输入夹具，不能证明Repository/事务/真实数据库/公网。

### 与并行者的界限

I已交付刷新修复f0d761d，F仅核对其4文件清单，不把I所报684check当F证据；F仍测试d2f8eb8冻结基线。后端已合安全基线6e1d048并仍开发中；F只读看见agenda的旧matter_result WIP仅按relatedActorIds/status选择，缺worldId/visibility/客观来源知情证明，以及同一角色任意较晚assistant消息可能吞掉未反馈结果。它们不是上线新代码结论，须等正式后端commit后复测；不移入本轮已通过项。I已批准四官方设定v3、保留旧v1/v2，内部scene.worldResults只由运行时验证并回放，实际在场才知情、约定者不自动在场。F不会新增公共字段。

下一步：完成完整check/build、修正第5个测试夹具并复测，独立提交及待验收报告；I接续客观结果显示/来源、多入口、领域终态门槛及后端冻结后真实PG/公网验证。

## 本轮最终交付与验证

修改文件仅：独立树 tests/nar03-phone-feedback.test.ts、docs/task-reports/NAR-03-UX-QA.md，以及主登记目录 docs/DEVELOPMENT.md 本人NAR-03-UX-QA行/本文。独立分支基线d2f8eb8，未合I刷新修复或后端动态WIP；源码没有Repository/API/业务函数/公共契约/UI改动，没有新增领域原型。测试调用既有真实纯函数和受控React按钮回调，输入是明确合成夹具；不是内存生产Repository，更不是模型、事务或产品浏览器验收。

最终结果：

- 专属格式校验通过。专项常规模式17项：12通过、5运行断言失败的TODO，0skip；不能把exit0叫全通过。
- **严格模式** `NAR03_UXQA_STRICT=1 node --experimental-strip-types --test tests/nar03-phone-feedback.test.ts`：17项，12通过、5失败、0TODO，exit1。与默认模式同一组行为断言，用于I验收时阻止漏修。失败和partial都实际运行并获得completed/world_verified/rewardClaimed=true；仅修reward而仍错误完成不能通过该项门槛。第五项已改合法且不在actors中的UUID，最终实际断言复现导航到不存在的人，非UUID解析失败。
- 最终 npm run check：模块边界316文件和typecheck通过；697测试中688通过、4失败、5TODO，exit1。4失败都为既有character-image-flow两项、rls-tenant-isolation两项连接127.0.0.1:55458 ECONNREFUSED。没有为消除失败启动旧库或复用他人数据库。最终测试日志 /tmp/nar03-uxqa-check-final.log；严格日志 /tmp/nar03-uxqa-strict.log。
- 最终 npm run build：exit0；日志 /tmp/nar03-uxqa-build-final.log。
- **真实PostgreSQL验证：本F本轮0成功、未运行test:db。** 当前真库能力不能由上述夹具证明。
- **浏览器/公网：本F本轮未启动浏览器/端口，无新截图、真机或公网验收。** 没有UI实现更改；新效果需I修复后的手机/PC验收。当前冻结远程代码d2f8eb8；本F没有核实当前生产部署，不宣称新任务已上线。0付费模型/0图片/0生产世界/上传；未推main、未部署。

## I与后端接续验收路径

主对话真实用户已授权“给另外两位Agent交付任务，你们一同进行”，已将本轮断点、专属文件和实际验证结果回传主集成人；未自行向其他人发外部信息。

1. I按已登记范围接事项详情：打开活动事项→查看地图当前地点→进入真实现场→提交特定达成行动→核对原command/task→相同或更新的world版本读phone/records→已完成事项进入此前记录→详情能看真实resolution.observation与scene/action/event/version来源→跳到授权人物和约定。结果来源须按运行时已校验记录读取，不能仅把description换成用户自述。
2. 客观blocked仍在当前，显示实际障碍及其来源，不显示“你说”；failed/partial/只聊天或只是看一眼不能完成交作品集任务。用户说“已交好了”和预设想法仍分别保留自述/尝试，不据此构造world_verified。
3. 后端正式冻结后用当前来源而非relatedActorIds单字段验证知情：实际在场且可观察角色承接一次；仅被邀约、已离场、未收到耳语、跨世界、隐藏及被撤销/屏蔽来源的角色不得获知结果；任意晚于结果的无关assistant消息不能冒充已经反馈此事项。I需真实PG重复command/回放/冲突/原子回滚/跨owner证据。
4. I确认五个TODO均已修复后移除todo包装或运行严格模式；保留现有12个防线。由于F只交独立审查，本任务先待验收，由I受控合入、结合后端提交重新check/真实PG/build、生产READY、手机长短/PC与公网关键路径验证后再标已完成。

独立提交完成后准确hash登记在主表及主目录报告；不会新增领取其他任务。
