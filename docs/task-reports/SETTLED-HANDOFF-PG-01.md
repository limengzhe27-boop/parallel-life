# SETTLED-HANDOFF-PG-01

负责人quiet-event-trace-20261027，独立grok-image工作树/codex/settled-handoff-test-20261027，基线root edc4b81b。仅新增专属tests/integration/settled-handoff-continuity.test.ts及本报告；公共源码由root独占。本轮0真实模型、0原存档写、0端口/worker操作、0迁移/业务字段。仅独立PG55651的parallel_life_test合成fixture；每轮清理将创建世界暂停。

## 已完成真实PG验证

原PublicationRepository发布→原startPublished→原engine初始化/admitNew→原bootstrap导演→原NPC consideration→原内核事务，模型为显式TextModel内存stub，不请求外部API，不把该结果作为自然对话质量验收。

两条独立合成旅程（3/3含父测试通过）：

1. 两个参与者的quiet_handoff事件：原advance每次最多执行一名NPC。第一名quiet、另一名尚无receipt时readSettledUnpresentedHandoffs=[]；两名均quiet后返回完整2条原receipt证明，shared episode仍proposed，没有强行withdrawn/active/result。
2. 第一名quiet后、另一名尚待考虑时，经过原snapshot/repository/runDirectorAgent产生一个无作者窗口的全局invalid_output（stub返回无效JSON，真实原attempt状态guard）。同command再调用仍INVALID_STATE，stub仅1次；随后原dispatch能正常处理第二名quiet。这个最新invalid付费身份不变成重试授权，也不再永久挡住另一个未评估作者事件。
3. 双quiet之后原wake恰好只含other_unassessed，未包含quiet_handoff；同一状态反复读cause整体稳定且不增加stub调用。再经原advance有限处理第二个事件（两个NPC），总计2个合法导演窗口、4个NPC consideration、4个原receipt、0消息。作者目录耗尽后cause=null，重复读不再买模型，不重评旧q。
4. quiet+defer旅程：真实followUp等待责任通过原内核保存，readSettledUnpresentedHandoffs=[]；没有把暂缓当安静结束。
5. 跨owner事务读取同world返回[]，无原receipt泄露；缺任一参与者receipt的负向由真实尚未执行的request形成，没有人为删除不可变回执来制造测试。

最终命令：`node --conditions=react-server --experimental-strip-types --test tests/integration/settled-handoff-continuity.test.ts`，3/3通过。`npm run typecheck`通过，`node scripts/check-boundaries.mjs`通过（751文件），`git diff --check`通过。按root要求未重复全量check/build。证据日志在独立树忽略目录`.local/quiet-trace-20261027/settled-pg.log`、`settled-type.log`。

## 严格审查结论与限制

root实现将新证明只放到previouslyAssessed分支之后的未评估门槛和最终wake身份，没有改原contextToken/paidReviewContexts；方向符合“不把旧quiet重新包装为新事件”。新helper核完整参与者数量、原request/receipt/attempt/event/command链，保守排除参与者活动目标/计划/责任/动作及在途付费；本测试覆盖其实际原事务证明和RLS。

已向root提示：question.sourceId通常为NPC消息来源，不保证等于episode-intent:requestId，当前同源精确检查不能宣传为覆盖所有语义上同episode的问题。现代码不扩大来源权限、不强制参与；是否补充相关事项证明由root统一决定，本任务未并写。

尝试以旧v45证据重读正在被root操作的2fb克隆时，原版本校验拒绝VERSION_CONFLICT。该只读拒绝符合保护，没有回写或重试原档，也未将它冒称新代码在原档真实来信通过。历史只读因果报告64d827a6仍固定v45；本测试证明机械接续，不能替代root的真实模型主动消息、现场、返回锁屏整包验收。

交root审查集成；源码范围继续由root控制。
