# MA-ARCH-44-3-B — 统一候选应用调度核心

负责人 codex-ma-arch44-3-b；root唯一公共契约/集成。工作树npc-director-progress，分支codex/ma-arch44-3-b。公共基线3e9bc64；本树只读接root a00b490→4630c34以匹配最终纯domain/端口。独占新schedule-agents.ts、agent-scheduler.test.ts及本报告；现有services/time/UI/SQL/具体collectors均未修改。

## 精确交付

业务提交 `5225d91c` → `fa87ba98`，仅两个新源码/测试文件。中间f881ad07/036bccd3是root公共提交的本树重放，不作为B源码回传，不应重复pick。报告另提交。

入口 `scheduleAgents(deps, input): Promise<AgentSchedule>`：
- deps.sources为`{id,failureScope,source:AgentCandidateSource}[]`注册，deps.director使用已冻结DirectorAgent。
- input由服务端授权传入owner/world、engineEpoch、worldVersion、actorRevisions、storyAt、observations和可选blockers。
- 可选approvedCoordination `{engineEpoch,worldVersion,plan}`只能由调用方按当前真实依赖**重新授权**后传入；不是浏览器能提交的安全声明，不能只把旧版本号改成新值。core重验其当前版本、候选分区、人物归属和guidance；不自动跨版本缓存/重分析/付费。
- 输出selected或quiet明确reason、不可变候选快照、最多一个待领取descriptor（candidate+readVersion+本人guidance）、作用域blocked、deferred、sourceFailures和可保留的coordination计划。**本模块不领取、不执行、不保存事实。**

## 行为

1. 全部source通过Promise.allSettled收集，每source一次，不serial handled。完成顺序与注册顺序不改变优先级；按priority降序/id字节序稳定排序。
2. 失败或非法collection显式报告安全枚举，生成该注册failureScope的stale_projection blocker；其他source仍收集。世界权威source失败可安全挡world，actor B source失败只挡B，不把原始异常/隐私内容带入结果。failureScope必须由可信server注册准确声明，不能让客户端/模型选择缩小故障范围。
3. world/actor/episode/channel+thread/action/resource六种阻断匹配；B开场unknown不会因为同episode就挡A早回复（除非真实上游提供更大合法阻断）。无候选的world paused也明确blocked，不伪称一切正常。
4. 校world/actor read versions，stale不重设版本；同ID等价候选去重，矛盾候选明确conflicting，不任意选先返回的源。每条candidate携真实sourceIds，模型不参与资格生成。
5. 已协调的单人/独立确定性承接免导演；requiresCoordination或跨actor同episode/resource/group/scene thread竞争才coordinate一次。只把eligible当前候选及授权观察给导演。
6. 严格验证director结果只能引用给定eligible IDs、selected/deferred不能重复/重叠/无声漏项，guidance必须对应所选candidate的actor。拒绝speech/statements/私人状态等额外字段，不用正则冒充对自然语言intent的语义证明。guidance只作为意图交接，不生成NPC对白；实际台词仍由NPC决定、内核验证。
7. director失败或不合法结果返回明确quiet，不偷偷重试或fallback选另一个人；valid defer保原因。ordered plan即使列多项，每pass只selected首项，其余next_snapshot_required，提交后重新collect/revalidate。current-approved plan可免本次导演调用；epoch/version旧则stale_coordination，单candidate也不忽略。
8. 选择所用canonical frozen candidate以同一个对象交给director并输出claim descriptor，readVersion保持原epoch/world/actor值。输入在异步前克隆，结果、观察、数组、scope冻结；不能靠回调改候选数组注入新资格。Kernel/AttemptStore仍须最终CAS，静态不可变快照不代替事务。

## 验证

- 专项 `node --experimental-strip-types --test tests/agent-scheduler.test.ts` **39/39**通过（含子案例）。覆盖全收集、六scope、partial opening、world/actor源失败、非法/foreign collection、旧版本、重复冲突、稳定排序、必要时一次director、只一claim、多步后重新快照、forged/blocked IDs、指导人物错配、额外对白字段、静默漏项、合法defer、协调失败无重试、不可变输入与当前授权计划复用。
- 最终type通过；模块边界通过514文件；最终fresh build通过。日志`.local/ma44-3-b-unit-final.log`、`ma44-3-b-type-final.log`、`ma44-3-b-boundaries.log`、`ma44-3-b-build-final.log`。
- 完整npm check实际运行：2526=2522pass+4fail。四项均旧character-image-flow两项、rls-tenant-isolation两项直接连接本树已停的127.0.0.1:55503，ECONNREFUSED；没有scheduler红例。没有删测试/跳过测试/擅启dev库来掩盖；root已明确由最后联合DB环境跑完整gate。本B不能称完整check全绿。最终approved-plan窄后继按root要求不重复全check，已专项/type/边界与fresh build。
- 全部director/source为内存测试port，不是真实模型；0模型/生产/PG/SQL/生图。没有调用已闭账43额度。

## 未实现与下一接线边界

- 尚无真实collector、Director模型实现、状态仓储领取或Kernel执行入口切换；旧services三段链仍原样存在，本交付不宣称替换完成/上线。
- collect必须纯读且已授权；不能直接把当前会选人/初始化进度的旧publication opportunities当新collector而宣称仓储已纯化。root统一coordinator需接opening/pub/普通责任的原始候选，统一scope和版本口径。
- 本函数只保证一次调用内不重复调用协调；跨请求幂等、真实付费预算、协调attempt的unknown保存/恢复与engineEpoch最终写栅栏由持久coordinator/内核负责。不能把coordination_failed理解成可以免费自动再调。
- 既有公共Candidate/Blocker没有完整clock due/read-set/snapshot receipt字段；本模块不自造时间资格、不推进时钟。上游提供当前合法candidate/blocker，后续契约与内核在领取时核39时间/权限及真实依赖。
- approvedCoordination重新授权是真实调用方职责，不是本模块能验证所有事实未改变。snapshot engineEpoch/readVersion为最终领取使用，不是已领取回执。新版本coordination计划不得沿旧snapshot直接执行第二项。

源码已冻结、主表待验收；root联合DB检查、入口集成、真实新授权模型验收、生产迁移/READY/公网均不在本B完成声明内。
