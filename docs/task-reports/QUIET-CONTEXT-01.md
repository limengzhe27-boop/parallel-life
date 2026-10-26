# QUIET-CONTEXT-01 · 已消费的自主考虑不随分钟重新购买

2026-10-26，quiet-loop-review-20261026，独立quiet-context-review，root唯一集成。0模型、0原档写、0端口操作，不新增表/列。

## 原档只读证据

本地clone原渣男体验4953…在v293–327连续35个agent.state_committed；对应39个attempt中35个sent_at非空，实际确实调用模型，而运行消息仍272条。大头npc_own_condition_ready/source actor_local，模型输出statements=[]和no_current_intent。同一context仅因真实分钟bucket变化产生新candidate。

同时director在多个互不共享资源的private候选上走competing_actors分支；正常独立人物仅当另有pending Director时绕过审批，反而常规路径重复调用导演。已看到同一“周末见爸爸/准备美食”依次换episodeId再派同一人物，人物每次quiet；多次导演invalid_output又被15秒timer当作新评估，由其他quiet的world/frame变化形成新的付费身份。stale_evidence是另外的作者资格读保护日志，不是这些local调用的直接来源。

## 最小修改

1. localInitiativeContext用本人已授权观察、有效状态和实际结果构造稳定语义身份，去掉contactWindow分钟盐。不把wake receipt、自己的发言、revision/continuation等处理元信息当新证据。
2. 复用现有continuation.basisHash与actorContinuationBasis：历史quiet/no_current_intent、await_response若状态摘要仍相同，且无决定之后的新外部观察/真实行动结果，直接视为已消费；旧分钟版quiet无需重买一次来迁移。来源改变/真实选择/状态实质变化仍可恢复，actor_plan/observation等确定性调度不受影响。
3. 无真实global wake且导演未到合法评估边界时，无共享资源的private个人工作独立执行，其他候选保留原排序与batch公平。真实全局wake/共享资源/需要coordination仍保留导演。
4. invalid_output不因纯timer自动开启新paid review；真实新wake、显式用户重试/评估仍走原准入。unknown/恢复/权限/事务保护不放宽。

## 验证

- 新5项+原collector49项：54/54通过；typecheck 0。
- 原collector“contact work renewed by real window only”仅调整最后断言：已消费上下文到下一真实分钟仍0，不再要求新ID；其他防未知、多人物、真实行动/约定来源断言保留。
- 原advance PG执行过，当前5 pass/13 fail；多数UNKNOWN_SOURCE及旧路由预期，不修改源校验或弱化断言。没有在同环境对改前运行以证明这些全部属于既有失败，因此不宣称PG已通过。交root统一判断，运行参数 `NPC_ADVANCE_TEST_PORT=55432 node --experimental-strip-types --test tests/integration/npc-agent-advance-service.test.ts`。首次独立树无runtime凭据的28P01属配置，后复用被忽略的主本地测试配置运行，未另起数据库。
- 未跑全量check/build，未调用真实模型，不代替root最终原档读/模型验收。

## 未解决且不能手工补的材料问题

实际某人物快照name为林白语，但其persona模块lifeContext/traits/drives描述的是青青邻家妹妹青梅。这是模型收到的材料，能解释人格错线。本任务仅保存只读证据在忽略.local，未擅自改作者设定；需后续区分作者原稿错误或actorKey绑定错误。导演已存在的重复episode历史不删、不改写，最小修复阻止此处无新依据的新购买，不宣称全部已有事项已自动整理。

## root集成接续

- 已合main 9e1e1ef1；原advance PG在同一主目录/本地55432改前、改后均5pass/13fail，失败用例名称完全相同。不能称该套PG通过，也未放宽来源校验；记录`.local/local-play/quiet-advance-before.log`与`quiet-advance-after.log`。
- 完整check4047/4047、build17通过。原档真实只读快照（0调用/0业务写）6人物：4个历史已消费quiet不再提供local候选，剩2个候选在当前、+1分钟、+3分钟保持完全相同id；不再每分钟产生新身份。未将候选等同真实对白或事件进展。
- build17本地3218 PID93936、3219 PID93939，worker93940健康；双端读取原档200且version334一致。v292→334发生于旧调度器实际运行期间，消息仍272；不宣称这些空状态回合是剧情进展。已停止用于排查的原档浏览器advance，未删历史/回执。
- 新调度不强迫人物发消息。原档人物材料错线、旧重复episode的正式接续/长期事件实质推进仍在清单，未以“少调用了模型”宣称主动演绎已跑通。
