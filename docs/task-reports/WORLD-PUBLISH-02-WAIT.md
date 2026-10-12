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
