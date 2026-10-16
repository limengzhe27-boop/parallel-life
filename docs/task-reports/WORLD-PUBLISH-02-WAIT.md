# WORLD-PUBLISH-02-WAIT · 到达地点后等到本人确认的约定

2026-10-12；Agent codex-publisher-wait-02-01a0c7c8-20261012。主目录原未有WAIT行，按根明确新任务及11文件冻结定义短锁追加本人行，读回进行中。独立 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/publisher-wait-02自准确e59dc9ed0d87ca10ed88a749a1b2b4af48ee7127；原plot分支保留。

范围11文件：新modules/world/domain/appointment-wait.ts、application/appointment-wait.ts、infrastructure/appointment-wait-repository.ts、新contracts/appointment-wait.ts、新server/appointment-wait-http.ts、新app/api/v1/worlds/[id]/invitations/wait/route.ts；旧features/phone/apps/calendar.tsx独占；新tests/appointment-wait.test.ts、appointment-wait-ui.test.ts、integration/appointment-wait.test.ts；本报告/主镜像/本人行。旧history/Postgres/scene/space/publication-context/services/http/client/phone types/host/trial allowlist由根；B46与root47只读，不占48。

只读断点：旅行只加真实route.durationMinutes，日历与Scene.enter要求时间已到；现advanceClock/projectStoryTime不提供目标邀约等待。旧时钟/暂停/倍速不是等待；不循环旅行或改倍速造时间。根批准appointment.waited v1，字段沿space/scene使用storyAt；源UTC可省毫秒，event归一至现domain严格ISO毫秒，同一实际邀约instant，不改邀请原文时间。

根已冻结guard：owner/world/version+stablecommand、已confirmed未来实际时间、可靠已抵达唯一地点、无activeScene/在途/unknown；阻止别的地点更早未过confirmed邀约，未接受候选不阻止。等待只推进time/version，不假旅程、赴约、NPC出现、事项完成，不模型/Scene.execute。事务保存command/event/state/clock锚，回执从原event派生，原命令回放不重复推进。

初步写入domain/application/public严格contract。根要求先单独冻结接口+纯测试，再接其history/context精确依赖完成真实PG复合验证。55482启前lsof无监听且已主表登记；尚未启动。0生产/模型/图/浏览器，本阶段尚无PG证据。

基线hydrate只在已有真实attendance事件时执行整段history重放；wait新类型必须根补union/dispatch，以支持这类旧存档及回溯/分支，不在测试内存改写旧源码或假绿。根将提供真实邀约来源→同世界地点的上下文函数，fresh get在前、事务world锁版本一致下使用其hydrated快照，不复制第二套hydration。

第一段接口冻结前验证：23/23纯domain/实际严格contract/application端口测试、0skip；首次type退出2（领域fixture便签缺version/updatedAt/sourceEventId，正在补齐复验）、384boundary、格式/diff检查通过。覆盖20分钟旅行后按真实19:30时点等待、仅time/version变更、不自动attend、future/已过/暂停/activeScene、别地点更早确认阻止、可选未接受不锁、跨天与UTC规范化、原event目标与responseVersion不可篡改、稳定源和反向时间。此时没有Repository/API/真实PG证据，只是领域与接口交付，不标任务完成。

类型复验再发现同一领域fixture缺WorldState.schemaVersion；已补真实V1字段，源码也明确拒绝非V1世界。尚待最终type结果，不以首个prototype测试通过替代类型通过。55482独立ignored新cluster正在启动，旧runtime已私有备份、.env未动；当前无PG验收结论。

最终接口段复验：便签与WorldState真实字段补齐后type退出0，23/23纯测试再次通过；384boundary。本阶段只有五个已登记新文件，暂无repo/API/PG用例，仍进行中。独立PG18.4/55482已启动，dev/test独立，未运行本任务迁移测试或写入fixtures；旧.env保存。

## 后半段源码冻结与实际证据

PostgresAppointmentWaitRepository使用真实PostgresDatabase与既有PostgresWorldRepository.get，不接内存生产仓储、不复制hydrate。owner/RLS读取原command+event派生严格原回执；fresh snapshot后同tx advisory activity lock、world FOR UPDATE/version复核、在途/unknown与activeScene、clock FOR UPDATE。事务以raw已锁world.time更新有效快照，防同版本时间读差；plan/apply验证可信邀约/唯一地点/更早别地确认；只写commands、world_events、worlds(time/version)、world_clock锚。保存raw紧凑状态只time/version，不把hydrated幕后投影或派生place links复制回原状态；不写world_space_receipts、不造travel/attendance/tasks/outbox/model。后半段没有新迁移。

新POST /api/v1/worlds/[id]/invitations/wait，body严格仅三字段；owner由authenticated/CSRF提供，limit+parseBody后调用根组装的s.waitToAppointment，无真实方法时503。回执须match当前world/command/invitation/version。已知domain挡点回中文消息，未知错误仍原sanitized endpoint，不dump隐私。services/client/phone host/types/private-trial allowlist由根接，本树未写这些旧文件，独立API组装尚未完成，不能称接口/线上已可用。

CalendarWaitAction只在canWaitToAppointment callback明确true、wait callback真实存在、confirmed未来时显示“等到约定时间”；未给资格不摆假入口。读busy并在手调handler时也防写；provider原run以invitation/responseVersion/at固定signature提供stable command，root host负责unknown维持expectedVersion/持久恢复与刷新。只在严格真实回执且当前world/command/invitation一致后显示跨天日期和“时间到了，还没有替你进入现场或记录赴约”；不自动入场/ModelExecute。日历保原接受/更改/赴约入口，场景仍另点进入。

46/46本任务联合专项通过、0skip：23domain/合同/application原型 +9实际React SSR/native callback（32纯）+13 child与parent合14真实PostgreSQL集成。独立fresh55482 dev/test已应用基线45迁移，PG fixture用真实initialize/commit/accept/travel/wait，初始proposal明确本地合成不是供应商，fixture世界只有本地数据；真实20分钟travel→19:30等待、clock同event锚、其它投影/任务/初快照不改、confirmed不冒attended、重连原回执/暂停后回放、篡body冲突、owner与RLS隔离、改期取消版本冲突、更早别地/可选未接受、跨天、真实queued scene BUSY与activeScene、晚clock失败完全rollback、并发仅一推进。PG通过不代表模型、HTTP、worker或线上证明。

后半段type首次查到UI畸形undefined status用例与PostgresWorldSpace测试漏catalog参数，再发现试猜catalog模块路径错误；均补真实catalog export和JSON畸形record，未弱化行为断言；46联合原断言再过，最终type退出0。先前SQL核验证据14与pureUI31保留，最新补畸形JSON回归32/14=46。全check/build仍下一步，根等待源码所以先冻结，不以missing组装/旧history或未来brief/worker未验伪绿。

根已接fcef90f4a4cbe11c03d5d549335ac84f69fd30fe的核心（准确以首次已发hash为准），提供8744330e/context/history与a75f852/B48 worker后继。本人未将这些公共WIP复制进本树；旧已赴约存档完整history/动态offer地点证据/worker scene复合验证仍待在根最新准确集成树检验。private trial仍paused拒fresh wait；不偷偷resume。0生产/模型/图片/浏览器，无截图。

独立PG55482仍在运行（session82402），完整check/build/根复合接续完成后必须停止并核无监听；此前runtime已ignored私有备份，.env从未改。日志 /private/tmp/appointment-wait-{core,ui,pg,delivery-tests}.log；不输出凭据、不提交ignored运行资源。报告将继续更新，源码后半段先交根，不自动领取其它任务。

## 最终本树检查、只读联调发现与资源释放

2026-10-12，本树完整 npm run check 1725/1725（3 suites，0skip/0TODO），387boundary/type0；npm run build退出0，十个范围代码/测试Prettier通过、diff通过、业务源码自f9364fd50b2c0bc0caefcc55a916fbfad55be02b未改。源码冻结根已受控cherry为9344a94dd6d3fa385b3ff3a5719cd670c1f4a51d；本段只是报告，不能将本树旧e59的完整检查说成覆盖根新B46/B48或线上。日志 /private/tmp/appointment-wait-full-check.log 与 appointment-wait-full-build.log。32领域/SSR+14真实PG证据保留。

根要求后续仅只读、不新增PG/model/browser/源。本次只读9344及四文件lifecycle WIP：services真实组装PostgresAppointmentWaitRepository，host以map.data可靠地点/at/paused/busy/currentScene资格，保存unknown原command与expectedVersion到本机；历史已接appointment.waited union/dispatch。private lifecycle只接受paused bool，principal authorize与exact trialSession决定private owner/world，不接受caller owner/world/speed/time；读真实clock状态、automatic=false，clock代理POST仍未开放。只有源码审查，不声称该lifecycle真实HTTP或撤权并发已验。

发现且已回根的UNKNOWN恢复缺口：响应丢失但wait已commit后，重读at已到会被host canWait和Calendar未来资格双门隐藏原按钮；localStorage原命令未核对导致其它邀约永远BUSY，但没有可点原回放入口。刷新后provider.run产生新cmdB而host使用cachedA，Calendar对sentCommandB严格匹配也会拒绝真实A的过渡文案。Repo的原owner/hash真实event回执在paused/due之后可重放已有PG证据，根需增加“核对上次等待”的明确replay入口与canonical command协调，不能放开全部过去日程fresh wait或删除记录冒成功。Root最终修复/浏览器/public尚未回传，不标完成。无需为此新增付费/model/世界。

资源：依据自有.local/wait-02/postgres/postmaster.pid核postgres与父bootstrap脚本/cwd，向仅本人wrapper发SIGTERM，原session82402退出0；lsof55482无监听。恢复私有backup.runtime到此前55458，只恢复本人文件，.env从未修改；未删除既有ignored旧库或其它任务数据。新fixture/cluster留本人ignored目录可复核，不推生产。原普通沙箱读取ps EPERM后通过任务已授权的提权核自有进程，仅关闭本人资源，无其它进程操作。

交付状态待验收：Repository/API路由/UI源和本地PG证据已提供；root services/client/host/history/context复合旧存档/worker/FK、UNKNOWN恢复、真实手机PC/公网与READY统一由根最终验收。没有供应商调用/生产数据/浏览器/截图，母项目仍非全部完成。下一步仅等待根修复与验收结果，不续领其它任务。
