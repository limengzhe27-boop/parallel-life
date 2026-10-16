# 44-62-HANDOFF-ACCEPT-C

- Agent：codex-ma44-handoff-accept62-c；root 为唯一源码/SQL/公共契约/服务集成与发布负责人。
- 工作树：/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本；起点 cfd777c5，root2388295d 实际 hook/dispatcher 已拣为 c67105ce。
- 独占：existing tests/integration/agent-narrative.test.ts；NEW tests/integration/agent-episode-advance.test.ts；本报告、主镜像、本人主表行。其余文件只读。
- 资源：隔离 PG55503，仅合成 fixture 与显式 mock model。0真实模型、生产、全量check/build、推送部署。
- 2026-10-16已按主登记短锁领取。状态进行中。

## 接续

先复现 P58 在自动 project 后旧断言的失败，再适配默认kernel回执/readonly replay与lineage；严格输入拒绝需记录真实拒绝边界，半回执使用真实 deferredFK COMMIT 故障。新增实际 advance + realDirectorSnapshot 验收 admitted genesis无plans启动、逐角色新版本、隐私、闲置/重放/unknown与诚实进展。源问题仅报告root。

## 冻结交付

- 测试提交：742f2db5437bf5f8bf3346d080c9547c19a26de9，准确2文件：existing agent-narrative.test.ts、NEW agent-episode-advance.test.ts。基线是 own cb18/cfd + root2388295d 本地 c67105ce。
- 最终真实 PG55503 联合验收22/22、0跳过（advance6含parent，narrative16含parent）；typecheck exit0、两测试文件prettier与git diff检查通过。没有运行完整check/build。
- PG55503 Node14282 正常SIGTERM停止，会话41435 exit0；lsof确认无监听。停止前实际catalog检查本任务临时触发器0、函数0。
- 本人没有改任何产品源码、契约、SQL迁移、配置、CI或其他测试；没有真实模型、生产、浏览器、推送部署操作。

## 实际推进验收范围

使用真实 owner RLS repositories、PostgresDirectorSnapshotRepository、npcAgentAdvanceServices、NpcAgentModel/WorldDirectorAgentModel adapters、NPC runner/default kernel及自动参与回执。模型返回全为显式合成 mock，模型调用时确认没有持有 app transaction/world row lock。fixture通过实际 worlds.initialize→initializeActorAgentState→switch epoch→admitNewAgentNarrative 建立version0；没有手造epoch2历史，不预填goal/plan/action，不初始化旧publication_story_plans。

1. 未admit的空world重复advance安静，0model/attempt/decision/event/oldplan。
2. firstChoice=quiet与decline各一个真实world：首次advance仅一次bootstrap Director真实快照（0candidates）产生机会，然后A独立无台词考虑→V1/0message/自身参与历史/shared proposed；第二次advance优先B，B真实snapshot世界V1且不含A的PRIVATE_DECLINE_REASON，再engage→V2/1message/两个独立receipt。typed intent严格6key、空placeOptionIds及本人definition basis，不含Director description/audit或全局去向。角色decisions仍空；shared仅active/sourceEventIds一个，无result/unresolvedResponsibility。公共story读仍presented=[]，没有把一条消息变成incident完成。
3. 已提交B attempt用默认kernel/runNpcAgent(null snapshot)真正重放：0model，world/event/message/command/actorstate/request/receipt/shared/outbox整行未变。两次参与引起一次后续全局quiet Director评估（总Director2，其中bootstrap1）；之后3次闲置advance不买模型、不写新行。
4. Director transport实际mock抛错→unknown_after_send，后续3次advance均UNKNOWN且0新model/decision/request/event；同一bootstrap未重买。
5. A NPC transport实际mock抛错→unknown_after_send且无参与历史，B仍可独立engage/commit；unknown A request保留pending，重复advance不重买A，不改名生成替代attempt。只1个实际receipt、2个实际NPCattempt（unknown+committed）。
6. world-scoped真实BEFORE INSERT receipt故障抛异常：原NPC event/message/command/receipt/outbox全0，worldV0、actorrevision0、participation缺失、两个request仍pending，Director已提交的proposed机会保留。移除故障后实际advance先恢复response_received的protected raw，0第二NPCmodelcall即可commit V1/receipt/consume；随后B正常独立处理。

## P58旧用例适配与覆盖变化

- 基线确实复现原16nodes12pass4fail（3leaf+parent），不把它们说成产品缺陷：默认kernel已自动project，旧“缺receipt”断言失效；malformed body在默认project先拒绝，旧直接SQL extension不可达；旧半回执extension其实重复插入，先触发actor receipt guard。
- 默认kernel用例改为真实首次回执已存在、helper在无继承写authority的新事务中只读重放、默认runner重放零模型/行数及回执整行不变。原4个错误token/command/inputHash/actorRevision lineage拒绝断言保留。
- 6种malformed typed body仍走真实NPCkernel自动project，精确INVALID_NARRATIVE_BASIS，extensioncallback计数0，整轮event/state/receipt/consume回滚，attempt真实终结invalid_output。旧直接SQL strict-body触发器分支在自动project之前已被阻止，不能再宣称本次执行到INVALID_EPISODE_REQUEST_INPUT；移除了需要该过时空隙的insertActualUnassessed helper，没有改产品防护/SQL guard。本次证据为更早的实际产品拒绝，独立direct-SQL malformed分支不是本次新验收证据。
- 半回执使用本world最后排序的zzz BEFORE UPDATE request触发器RETURN OLD：正常helper确实看到rowCount1，afterCommit extension已返回（断言true），真实COMMIT才抛23503且error.constraint与实际catalog查得的DEFERRABLE INITIALLY DEFERRED (world_id,request_id,input_receipt_id) FK名严格相等。worldV0、actorrevision0、requestpending+空receipt/input、event/message/command/receipt全回滚；protectedraw后续用正常kernel恢复unassessed receipt。原禁止proposed插active/无实际消息fakeactive/commit外绑定input的负断言保留。
- 中间新增assert一度误期望非法body attempt维持response_received，实际runNpcAgent按INVALID_PROPOSAL正确终结invalid_output；修正到精确真实终态。最后两次联合运行均22/22，最终强化了指定FK与rollback断言。

## 限制与集成接续

- 新advance fixture是明确合成的普通world genesis与真实admission；未在此新suite执行作者发布/试演SQL完整创建入口，也没有bound authored-material目录或实际authored incident发生/完成证据。不能从本suite推断全部作者时间窗/旧存档adoption已验收。
- 未验实际group/scene episode、真实模型行为、生产权限/迁移/上线、全量check/build。source时间精度只读发现已交root，由root另修。
- Root接续：仅cherry-pick742f2db5测试提交，再pick本报告提交；root已有2388295d不用再拣c67105ce。运行新suite需设AGENT_EPISODE_ADVANCE_TEST_PORT为root专用本地端口（本地默认55503仅本执行者资源）。最终整体验证、CI端口分配、部署READY与公网验收由root执行。
- 主表待验收，不能独自标已完成；未上线测试交付不能称产品已上线。
