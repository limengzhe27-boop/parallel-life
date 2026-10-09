# NAR-02S · 有依据的跨日跟进

状态：待验收。Agent codex-f-01a0c7c8-nar02s-20261009；短锁已领取，独立/Users/limengzhe/.codex/worktrees/return-followups/人生剧本，codex/return-followups，干净基线13634ad。GROUP-02/NAR-02RI最终已验收并释放。唯一集成人仍是排查分支创建失败线程，执行者不部署。

登记范围：advance-world.ts、domain/agenda.ts、新domain/return-followups.ts、infrastructure/turn-planner.ts；新tests/return-followups.test.ts与tests/integration/return-followups.test.ts；本报告和主表本人行。PG55448/预览3242；未占用别人的数据库。UI、services、公共契约、clock仓储、迁移和旅行/地图引擎不修改。

诊断：selectSpeaker以整个补算actors数组永久排除已发言人，造成后来采样日期仍有新事项时同联系人也不再发言。不能简单传空数组：持续承诺/等待选择会变成每天催促。拟保留同故事日去重和12h冷却，只在该人物出现新的可见、已保存事项节点时开放后续日期；已回应choice、一次关心、同一未定/过期邀请仍抑制；至多三拍，未用槽保持安静。

验证：纯规则和独立真实PG已通过，真实模型按I最新协调暂停等待线上服务诊断/来源协调。此前GROUP-02复制原树模型配置的审批拒绝保留；本轮曾问授权，随后I明确本项目已有AI使用授权、不得重复申请并要求暂不测试，本执行者遵循暂停、不读取/复制模型凭据。本树数据库/session为新生成忽略环境，非生产密钥。

接续：落实已保存事项节点的跨日选择和过期邀请过滤，记录模型/来源边界，check/build、真实PG与模型证据，独立提交待验收，I负责串行迁移核对/Ready/公网验证。当前上线13634ad文档所记26ba6b7，本批无上线能力。

## 实现

- 新纯规则followupAgenda先验证节点的故事时刻，再按固定UTC+08日期和12小时过滤；记录来自已提交/已重放的拍及版本。重复人物只对后来到期的已确认日程或版本证明的新用户决定/结果/待回复开放；相同日期、旧节点、旧承诺、重复关心及未回应邀请不因日期变化再次发。
- advanceWorld在选人前使用该过滤，替代整个補算期间永久排除人物；已提交beat仍按稳定commandId读回并补账，不重复调用模型。旧12h recentActors、世界锁、attempt unknown、事件/回执及事务接线保持现有路径。时钟、速度、三拍上限/既有pacing均不改。
- agenda的日程节点附内部basisId/basisAt，日程可见性核验使用确切ID而非同名标题；不会把日程ID误当[choice:]。时间比较使用Date.parse，支持等价offset。过期且未确认邀请不激活提醒；到期已确认事项说明原日期，不能替主角判断到场、失约、完成或重新邀请。
- Planner补同一人物跨日只承接本轮已保存节点，不假称旧提议是新进展；原角色/资料/媒体/重大后果及next_step边界保留。

本批可验证的持续事项以有日期的已确认日程阶段、实际新结果/新用户输入为依据；不会仅凭仍pending的选择生成三天新成果。没有新节点就可能只有一条或保持安静，不保证每天有消息。没有新增后台模拟、常驻角色或新叙事引擎。

## 验证进展

最终常规check400/400、边界248/typecheck通过；登记格式检查通过；最终build通过。7项新纯规则及原world-clock一起27项通过。

真实PostgreSQL18.4/55448：新专项7通过、1真实模型opt-in跳过。单联系人同一事项3个已确认阶段跨3个UTC+08故事日期、真实事件storyAt/occurredAt、原消息不变、3个稳定回执、重放不调用、两账号互拒；多联系人A/B/A仍≤3拍；真实持久beat12h冷却；空世界/暂停/过期未确认邀请/旧choice回应后安静；unknown不自动再付、事件提交后补账失败的恢复不重复模型、撤回日程来源不进入cue；摄影筹展/社区咖啡店两种合成身份均有各自阶段，无跨世界串话。全部使用生产PostgreSQL仓储；这些回复来自明确fixture Planner，不是真实模型剧情或真实自然度评价。

第一次完整PG72项：67通过/5可选跳过；补两项持久冷却/双身份后，最终完整真实PG74项：69通过、5可选跳过、0失败。跳过分别为群/人物/本任务/旧回访模型及PLAYER原始HTTP opt-in，未当作通过。最新日志.local/nar02s-full-db.log、nar02s-db-tests.log、nar02s-check.log、nar02s-build.log。没有迁移，测试dev/test均本树独立38迁移，不连接生产。

## 失败与限制

早期findLast不在本项目TypeScript目标库，改为有界3拍数组反向find；新测试动态effect类型及GatewayConfig.timeoutMs缺失导致typecheck失败，补精确literal/参数后400通过。第一次多人夹具让A替B提出邀约，被正式角色权限拒绝，改由B自己的来源事件再由同一owner显式确认，不放宽权限。第一次“过期”夹具仍含未来邀请，断言失败；改为全部在第一采样拍前已过期，保留未来未定邀约的一次正常提示。以上非模型调用失败。

主对话随后要求暂停模型：根QA两位新访客首条SSE仅UNAVAILABLE，任务unknown/UNKNOWN，没有token；原因待PLAY-QA-01/集成人诊断，并非已证实网关欠费。本执行者未尝试真实模型，未读取/复制已有AI配置，未再触发新的凭据审批。此前GROUP-02的配置复制审批拒绝保留，不间接绕行；本次不重复申请已有项目AI授权。已有两身份opt-in评测（RETURN_FOLLOWUP_MODEL_EVAL=1）准备好，恢复与配置来源由I协调或I集中执行，不删除失败/unknown证据或重付来冒称首次成功。

## 接续

独立提交准备待验收；业务集成人为排查分支创建失败线程。仅接本任务7个登记文件，复验最终check/build/真实PG，再在服务恢复后的已协调本项目AI环境运行两身份真实模型和完整生产回访（旧日期、每条来源、重复/暂停/unknown与过期邀约）；生产38迁移核对、READY和公网之后才可标完成。本执行者不自行发布，不夹带主目录LIB-04B，不碰SCENE-03/TRANSITION-01/UI/services。报告/主表回传；没有直接人类跨线程消息授权时不主动发消息给他人。


## 交接清单

仅7个登记文件：src/modules/world/application/advance-world.ts；src/modules/world/domain/agenda.ts、return-followups.ts；src/modules/world/infrastructure/turn-planner.ts；tests/return-followups.test.ts、tests/integration/return-followups.test.ts；docs/task-reports/NAR-02S.md。独立提交由主表列出。常规400、真实PG69/5skip、格式/diff检查、build通过；本执行者未运行真实模型/公网接口/浏览器或生产部署，不能称完整交付完成。两身份真实模型、自然度/不重复催促、最终公共端点与手机日期定位验收仍归I。

数据库夹具通过自己创建的accounts并在finally按精确owner清理；无真实用户或私人访谈。PG55448在结束时按PID/数据目录核对停止并释放，预览3242从未启动且释放；工作树和非敏感日志保留，本树新生成服务端env仍忽略。之后停止本范围写入等待I验收，不自行领取其他任务。

最后评测脚本补了追加式.local/nar02s-model-eval.jsonl：将未来每次合成模型输入/原输出/错误码及部分已持久化来源保存，不覆盖早期失败，不包含凭据/真实用户资料。仅准备默认跳过的评测，本轮没有执行。该测试文件完善后再次check；因本树PG已提前停掉，常规RLS/照片测试报ECONNREFUSED，失败日志保留nar02s-check-after-db-stop.log；重新启动同一自有PG后最终400/400、typecheck通过。没有放宽断言，业务源码未再改变，最终build对应相同业务源。
